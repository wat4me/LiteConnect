<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  lineNumbers,
  placeholder,
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  highlightSelectionMatches,
  searchKeymap,
  openSearchPanel,
} from '@codemirror/search'
import {
  foldGutter,
  foldKeymap,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language'
import {
  autocompletion,
  closeCompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { sql, MySQL, PostgreSQL } from '@codemirror/lang-sql'
import type { SqlDialect } from '@/utils/database/dbSql'
import { quoteIdent } from '@/utils/database/dbSql'
import type { DbColumnInfo, DbTableInfo } from '../../env.d'
import type { QueryTab } from '@/domain/database/types'
import {
  clampSelection,
  createCompletionGeneration,
  editorKeyIntent,
  flushEditorToTab,
  hasNonEmptySelectionText,
  isCmDarkTheme,
  isCompletionRequestLive,
  makeCompletionRequestSnapshot,
  runGuardedAsyncSteps,
  selectionFromUi,
  shouldApplyExternalDoc,
  type SqlEditorSelection,
} from '@/utils/database/cmSqlEditor'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    tab: QueryTab
    sessionAlive: boolean
    dialect?: SqlDialect
    getTables: (database: string) => DbTableInfo[]
    ensureTables: (database: string) => Promise<void>
    ensureColumns: (database: string, table: string) => Promise<DbColumnInfo[]>
  }>(),
  {
    dialect: 'mysql',
  },
)

const emit = defineEmits<{
  runDefault: []
  cancel: []
  selectionChange: []
  saveQuery: []
}>()

const hostRef = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
let applyingExternal = false
/** Set only after final flush + destroy on unmount */
let destroyed = false
/** Tab currently bound to the live EditorView (for swap flush isolation) */
let boundTab: QueryTab | null = null

const langCompartment = new Compartment()
const themeCompartment = new Compartment()
const completionGen = createCompletionGeneration()
let themeObserver: MutationObserver | null = null

function sqlDialectExt() {
  // CodeMirror has no Oracle dialect; double-quote + StandardSQL-like ≈ PostgreSQL
  const dialect =
    props.dialect === 'postgres' || props.dialect === 'oracle' ? PostgreSQL : MySQL
  return sql({ dialect })
}

function readDataTheme(): string | null {
  return document.documentElement.getAttribute('data-theme')
}

function editorTheme(): Extension {
  const dark = isCmDarkTheme(readDataTheme())
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        fontSize: 'var(--db-font-size, var(--font-ui, 13px))',
        fontFamily:
          'var(--db-font-family, var(--font-mono, Cascadia Code, Fira Code, Consolas, monospace))',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
      },
      '.cm-scroller': {
        fontFamily: 'inherit',
        lineHeight: '1.5',
        overflow: 'auto',
      },
      '.cm-content': {
        caretColor: 'var(--text-primary)',
        padding: '12px 0',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-secondary)',
        color: 'var(--text-secondary)',
        border: 'none',
        borderRight: '1px solid var(--border-color)',
      },
      '.cm-activeLine': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)',
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 35%, transparent) !important',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--text-primary)',
      },
      '.cm-tooltip': {
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        color: 'var(--text-primary)',
      },
      '.cm-tooltip-autocomplete ul li[aria-selected]': {
        backgroundColor: 'var(--accent-bg)',
        color: 'var(--accent)',
      },
      '.cm-matchingBracket': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)',
        outline: '1px solid var(--accent)',
      },
      '.cm-searchMatch': {
        backgroundColor: 'color-mix(in srgb, var(--warning, #d29922) 35%, transparent)',
      },
      '.cm-panels': {
        backgroundColor: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        borderTop: '1px solid var(--border-color)',
      },
      '.cm-panels input, .cm-panels button': {
        fontSize: '12px',
      },
    },
    { dark },
  )
}

function reconfigureTheme() {
  if (!view || destroyed) return
  view.dispatch({
    effects: themeCompartment.reconfigure(editorTheme()),
  })
}

function startThemeObserver() {
  stopThemeObserver()
  themeObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'data-theme') {
        reconfigureTheme()
        break
      }
    }
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
}

function stopThemeObserver() {
  themeObserver?.disconnect()
  themeObserver = null
}

function getSqlTokenAt(doc: string, cursor: number) {
  let i = cursor - 1
  while (i >= 0 && /[\w`$]/.test(doc[i])) i -= 1
  const start = i + 1
  const token = doc.slice(start, cursor)
  let tableRef: string | null = null
  if (i >= 0 && doc[i] === '.') {
    let j = i - 1
    while (j >= 0 && /[\w`$]/.test(doc[j])) j -= 1
    tableRef = doc.slice(j + 1, i).replace(/`/g, '').replace(/"/g, '')
  }
  return { start, end: cursor, token, tableRef }
}

function parseSqlTableMap(sqlText: string): Map<string, string> {
  const map = new Map<string, string>()
  const re =
    /\b(?:from|join)\s+`?([a-zA-Z0-9_]+)`?(?:\s*\.\s*`?([a-zA-Z0-9_]+)`?)?(?:\s+(?:as\s+)?`?([a-zA-Z0-9_]+)`?)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sqlText))) {
    const a = m[1]
    const b = m[2]
    const alias = m[3]
    const table = b || a
    if (!table) continue
    const stop = new Set([
      'where',
      'on',
      'left',
      'right',
      'inner',
      'outer',
      'cross',
      'join',
      'group',
      'order',
      'limit',
      'set',
      'values',
    ])
    map.set(table.toLowerCase(), table)
    if (alias && !stop.has(alias.toLowerCase())) {
      map.set(alias.toLowerCase(), table)
    }
  }
  return map
}

function currentEditorTokenState(): { pos: number; doc: string; token: string; start: number; tableRef: string | null } {
  if (!view) {
    return { pos: 0, doc: '', token: '', start: 0, tableRef: null }
  }
  const pos = view.state.selection.main.head
  const doc = view.state.doc.toString()
  const tok = getSqlTokenAt(doc, pos)
  return { pos, doc, token: tok.token, start: tok.start, tableRef: tok.tableRef }
}

function isSchemaCompletionStillLive(
  snapshot: ReturnType<typeof makeCompletionRequestSnapshot>,
): boolean {
  if (destroyed || !view) return false
  const cur = currentEditorTokenState()
  return isCompletionRequestLive({
    snapshot,
    isLiveGen: (g) => completionGen.isLive(g),
    current: {
      tabId: props.tab.id,
      database: props.tab.database,
      dialect: props.dialect || 'mysql',
      sessionAlive: props.sessionAlive,
      tableRef: cur.tableRef,
      pos: cur.pos,
      doc: cur.doc,
      token: cur.token,
      start: cur.start,
    },
  })
}

async function schemaCompletion(context: CompletionContext): Promise<CompletionResult | null> {
  if (!props.sessionAlive || destroyed || !view) return null
  const gen = completionGen.next()
  const pos = context.pos
  const doc = context.state.doc.toString()
  const { start, token, tableRef } = getSqlTokenAt(doc, pos)
  const prefix = token.replace(/^["`]/, '').replace(/["`]$/, '')
  const database = props.tab.database
  const dialect = props.dialect || 'mysql'

  const snapshot = makeCompletionRequestSnapshot({
    gen,
    tabId: props.tab.id,
    database,
    dialect,
    sessionAlive: props.sessionAlive,
    tableRef,
    pos,
    doc,
    token,
    start,
  })

  try {
    if (tableRef && database) {
      let cols: DbColumnInfo[] = []
      const built = await runGuardedAsyncSteps({
        steps: [
          async () => {
            await props.ensureTables(database)
          },
          async () => {
            if (!isSchemaCompletionStillLive(snapshot)) return
            const tableMap = parseSqlTableMap(doc)
            const realTable = tableMap.get(tableRef.toLowerCase()) || tableRef
            cols = await props.ensureColumns(database, realTable)
          },
        ],
        isLive: () => isSchemaCompletionStillLive(snapshot),
        build: () => {
          const options = cols
            .filter(
              (c) =>
                !prefix ||
                c.name.toLowerCase().startsWith(prefix.toLowerCase()) ||
                c.name.toLowerCase().includes(prefix.toLowerCase()),
            )
            .slice(0, 40)
            .map((c) => {
              const needsQuote = !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name)
              const label = c.name
              const apply = needsQuote ? quoteIdent(c.name, dialect) : c.name
              return {
                label,
                apply,
                type: 'property' as const,
                detail: c.type || undefined,
                boost: label.toLowerCase().startsWith(prefix.toLowerCase()) ? 2 : 0,
              }
            })
          if (options.length === 0) return null
          return { from: start, options, validFor: /^[\w`$]*$/ } as CompletionResult
        },
      })
      return built
    }

    const built = await runGuardedAsyncSteps({
      steps: [
        async () => {
          if (database) await props.ensureTables(database)
        },
      ],
      isLive: () => isSchemaCompletionStillLive(snapshot),
      build: () => {
        const tables = database ? props.getTables(database) : []
        const options = tables
          .filter(
            (tbl) =>
              !prefix ||
              tbl.name.toLowerCase().startsWith(prefix.toLowerCase()) ||
              tbl.name.toLowerCase().includes(prefix.toLowerCase()),
          )
          .slice(0, 40)
          .map((tbl) => {
            const needsQuote = !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tbl.name)
            const apply = needsQuote ? quoteIdent(tbl.name, dialect) : tbl.name
            return {
              label: tbl.name,
              apply,
              type: (tbl.type === 'view' ? 'class' : 'type') as 'class' | 'type',
              detail:
                tbl.type === 'view' ? t('database.query.acView') : t('database.query.acTable'),
              boost: tbl.name.toLowerCase().startsWith(prefix.toLowerCase()) ? 2 : 0,
            }
          })
        if (options.length === 0) return null
        return { from: start, options, validFor: /^[\w`$]*$/ } as CompletionResult
      },
    })
    return built
  } catch {
    return null
  }
}

function writeTabSql(target: QueryTab, doc: string) {
  if (target.sql !== doc) {
    target.sql = doc
  }
}

function closeActiveCompletion() {
  if (view) closeCompletion(view)
}

function invalidateCompletions() {
  completionGen.invalidate()
  closeActiveCompletion()
}

function buildExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    history(),
    foldGutter(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    placeholder(t('database.query.sqlPlaceholder')),
    langCompartment.of(sqlDialectExt()),
    themeCompartment.of(editorTheme()),
    autocompletion({
      override: [schemaCompletion],
      activateOnTyping: true,
      maxRenderedOptions: 40,
    }),
    keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          if (view?.composing) return false
          emit('runDefault')
          return true
        },
      },
      {
        key: 'Mod-s',
        run: () => {
          emit('saveQuery')
          return true
        },
      },
      {
        key: 'Escape',
        run: () => {
          if (view?.composing) return false
          if (props.tab.loading && props.tab.queryId) {
            emit('cancel')
            return true
          }
          return false
        },
      },
      {
        key: 'Mod-f',
        run: openSearchPanel,
      },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (destroyed || !view || !boundTab) return
      if (update.docChanged && !applyingExternal) {
        if (!update.view.composing) {
          writeTabSql(boundTab, update.state.doc.toString())
        }
      }
      if (update.selectionSet || update.geometryChanged || update.viewportChanged) {
        // Persist selection/scroll continuously; doc only if not composing
        const main = update.state.selection.main
        const scroller = update.view.scrollDOM
        boundTab.editorUi = {
          selectionAnchor: main.anchor,
          selectionHead: main.head,
          scrollTop: scroller.scrollTop,
          scrollLeft: scroller.scrollLeft,
        }
        if (update.docChanged && !applyingExternal && !update.view.composing) {
          writeTabSql(boundTab, update.state.doc.toString())
        }
        if (update.selectionSet) emit('selectionChange')
      }
    }),
    EditorView.domEventHandlers({
      keydown(event, v) {
        if (v.composing || event.isComposing) {
          const intent = editorKeyIntent({
            key: event.key,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            composing: true,
            queryLoading: !!props.tab.loading,
            hasQueryId: !!props.tab.queryId,
          })
          if (intent) return true
        }
        return false
      },
      compositionend() {
        if (view && boundTab && !destroyed) {
          writeTabSql(boundTab, view.state.doc.toString())
        }
      },
      blur() {
        if (view && boundTab) {
          // Always flush final doc from EditorState (works even mid-composition)
          flushEditorToTab(boundTab, {
            doc: view.state.doc.toString(),
            anchor: view.state.selection.main.anchor,
            head: view.state.selection.main.head,
            scrollTop: view.scrollDOM.scrollTop,
            scrollLeft: view.scrollDOM.scrollLeft,
          })
        }
      },
    }),
    EditorView.lineWrapping,
  ]
}

function createEditor() {
  const host = hostRef.value
  if (!host || destroyed) return

  boundTab = props.tab
  const doc = props.tab.sql || ''
  const sel = selectionFromUi(props.tab.editorUi, doc.length)
  const state = EditorState.create({
    doc,
    selection: { anchor: sel.anchor, head: sel.head },
    extensions: buildExtensions(),
  })
  view = new EditorView({
    state,
    parent: host,
  })
  view.contentDOM.setAttribute('aria-label', t('database.query.editorAriaLabel'))
  view.contentDOM.setAttribute('role', 'textbox')
  view.contentDOM.setAttribute('aria-multiline', 'true')

  const ui = props.tab.editorUi
  if (ui) {
    requestAnimationFrame(() => {
      if (!view || destroyed) return
      view.scrollDOM.scrollTop = ui.scrollTop
      view.scrollDOM.scrollLeft = ui.scrollLeft
    })
  }
}

/**
 * Destroy editor.
 * - flushTo: write final doc/ui into this tab (explicit old tab on swap, or bound on unmount)
 * - Always flush doc from EditorState (including composing)
 */
function destroyEditor(opts?: { flushTo?: QueryTab | null }) {
  const target = opts?.flushTo
  if (view) {
    if (target) {
      // Final snapshot from EditorState — do not skip when composing
      flushEditorToTab(target, {
        doc: view.state.doc.toString(),
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
        scrollLeft: view.scrollDOM.scrollLeft,
      })
    }
    completionGen.invalidate()
    closeActiveCompletion()
    view.destroy()
    view = null
  } else {
    completionGen.invalidate()
  }
  boundTab = null
}

function applyExternalSql(next: string) {
  if (!view || destroyed) return
  const cur = view.state.doc.toString()
  if (
    !shouldApplyExternalDoc({
      externalSql: next,
      editorDoc: cur,
      applyingExternal,
    })
  ) {
    return
  }
  applyingExternal = true
  try {
    const len = next.length
    const main = view.state.selection.main
    const anchor = Math.min(main.anchor, len)
    const head = Math.min(main.head, len)
    view.dispatch({
      changes: { from: 0, to: cur.length, insert: next },
      selection: { anchor, head },
    })
  } finally {
    applyingExternal = false
  }
}

onMounted(() => {
  createEditor()
  startThemeObserver()
})

onBeforeUnmount(() => {
  // 1) flush into the tab currently bound to the editor (before marking destroyed)
  const tabToFlush = boundTab
  destroyEditor({ flushTo: tabToFlush })
  stopThemeObserver()
  // 2) mark destroyed only after flush+destroy
  destroyed = true
})

watch(
  () => props.tab.sql,
  (next) => {
    applyExternalSql(next ?? '')
  },
)

watch(
  () => props.dialect,
  () => {
    if (!view || destroyed) return
    invalidateCompletions()
    view.dispatch({
      effects: langCompartment.reconfigure(sqlDialectExt()),
    })
  },
)

watch(
  () => props.tab.database,
  () => {
    invalidateCompletions()
  },
)

watch(
  () => props.sessionAlive,
  () => {
    invalidateCompletions()
  },
)

watch(
  () => props.tab.id,
  (_newId, oldId) => {
    // Capture the tab that owned the previous editor BEFORE rebuild.
    // props.tab is already the new tab; use boundTab which still points at old.
    const previousTab = boundTab && boundTab.id === oldId ? boundTab : null
    // Flush final state into previous tab only (never into the new props.tab)
    destroyEditor({ flushTo: previousTab })
    destroyed = false
    createEditor()
  },
)

function getSelection(): SqlEditorSelection {
  if (!view) return { start: 0, end: 0 }
  const main = view.state.selection.main
  return clampSelection(
    { start: main.from, end: main.to },
    view.state.doc.length,
  )
}

function hasNonEmptySelection(): boolean {
  if (!view) return false
  const sel = getSelection()
  return hasNonEmptySelectionText(view.state.doc.toString(), sel)
}

function focus() {
  view?.focus()
}

function getEditorEl(): HTMLElement | null {
  return view?.dom ?? null
}

defineExpose({
  getSelection,
  hasNonEmptySelection,
  focus,
  getEditorEl,
})
</script>

<template>
  <div ref="hostRef" class="sql-cm-host" />
</template>

<style scoped>
.sql-cm-host {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  background: var(--bg-primary);
}

.sql-cm-host :deep(.cm-editor) {
  flex: 1;
  min-height: 0;
  height: 100%;
  outline: none;
}

.sql-cm-host :deep(.cm-editor.cm-focused) {
  outline: none;
}
</style>
