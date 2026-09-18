import { describe, expect, it } from 'vitest'
import {
  clampSelection,
  completionContextKey,
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
  uiFromEditor,
} from './cmSqlEditor'

describe('clampSelection', () => {
  it('clamps and orders start/end', () => {
    expect(clampSelection({ start: -1, end: 100 }, 10)).toEqual({ start: 0, end: 10 })
    expect(clampSelection({ start: 8, end: 3 }, 10)).toEqual({ start: 3, end: 8 })
  })
})

describe('hasNonEmptySelectionText', () => {
  it('requires non-whitespace selection', () => {
    expect(hasNonEmptySelectionText('SELECT 1', { start: 0, end: 6 })).toBe(true)
    expect(hasNonEmptySelectionText('SELECT 1', { start: 0, end: 0 })).toBe(false)
    expect(hasNonEmptySelectionText('   \n  ', { start: 0, end: 5 })).toBe(false)
  })
})

describe('shouldApplyExternalDoc', () => {
  it('skips when applying or docs match', () => {
    expect(
      shouldApplyExternalDoc({
        externalSql: 'a',
        editorDoc: 'a',
        applyingExternal: false,
      }),
    ).toBe(false)
    expect(
      shouldApplyExternalDoc({
        externalSql: 'b',
        editorDoc: 'a',
        applyingExternal: true,
      }),
    ).toBe(false)
    expect(
      shouldApplyExternalDoc({
        externalSql: 'b',
        editorDoc: 'a',
        applyingExternal: false,
      }),
    ).toBe(true)
  })
})

describe('selectionFromUi / uiFromEditor', () => {
  it('round-trips and clamps', () => {
    const ui = uiFromEditor({ anchor: 2, head: 5, scrollTop: 10, scrollLeft: 0 })
    expect(selectionFromUi(ui, 3)).toEqual({ anchor: 2, head: 3 })
    expect(selectionFromUi(null, 10)).toEqual({ anchor: 0, head: 0 })
  })
})

describe('createCompletionGeneration', () => {
  it('only live gen is accepted; invalidate drops old', () => {
    const g = createCompletionGeneration()
    const a = g.next()
    expect(g.isLive(a)).toBe(true)
    const b = g.next()
    expect(g.isLive(a)).toBe(false)
    expect(g.isLive(b)).toBe(true)
    g.invalidate()
    expect(g.isLive(b)).toBe(false)
  })
})

describe('editorKeyIntent', () => {
  it('maps ctrl/cmd+enter and escape during query', () => {
    expect(
      editorKeyIntent({
        key: 'Enter',
        ctrlKey: true,
        metaKey: false,
        composing: false,
        queryLoading: false,
        hasQueryId: false,
      }),
    ).toBe('run-default')
    expect(
      editorKeyIntent({
        key: 'Enter',
        ctrlKey: true,
        metaKey: false,
        composing: true,
        queryLoading: false,
        hasQueryId: false,
      }),
    ).toBeNull()
    expect(
      editorKeyIntent({
        key: 'Escape',
        ctrlKey: false,
        metaKey: false,
        composing: false,
        queryLoading: true,
        hasQueryId: true,
      }),
    ).toBe('cancel')
    expect(
      editorKeyIntent({
        key: 'Escape',
        ctrlKey: false,
        metaKey: false,
        composing: false,
        queryLoading: false,
        hasQueryId: false,
      }),
    ).toBeNull()
  })
})

describe('completionContextKey', () => {
  it('changes when database or dialect changes', () => {
    const a = completionContextKey({
      tabId: 't1',
      database: 'db',
      dialect: 'mysql',
      sessionAlive: true,
    })
    const b = completionContextKey({
      tabId: 't1',
      database: 'other',
      dialect: 'mysql',
      sessionAlive: true,
    })
    expect(a).not.toBe(b)
  })
})

describe('isCompletionRequestLive + runGuardedAsyncSteps (race)', () => {
  it('drops result when database changes mid-await even if gen not bumped yet', async () => {
    const gen = createCompletionGeneration()
    const g = gen.next()
    let currentDb = 'db_a'
    const snap = makeCompletionRequestSnapshot({
      gen: g,
      tabId: 'tab-1',
      database: 'db_a',
      dialect: 'mysql',
      sessionAlive: true,
      tableRef: null,
      pos: 4,
      doc: 'SEL',
      token: 'SEL',
      start: 0,
    })

    let resolveEnsure!: () => void
    const ensureP = new Promise<void>((r) => {
      resolveEnsure = r
    })

    const live = () =>
      isCompletionRequestLive({
        snapshot: snap,
        isLiveGen: (x) => gen.isLive(x),
        current: {
          tabId: 'tab-1',
          database: currentDb,
          dialect: 'mysql',
          sessionAlive: true,
          tableRef: null,
          pos: 4,
          doc: 'SEL',
          token: 'SEL',
          start: 0,
        },
      })

    const pending = runGuardedAsyncSteps({
      steps: [() => ensureP],
      isLive: live,
      build: () => ({ tables: ['users_a'] }),
    })

    // Context change while ensure is pending (no new completion started)
    currentDb = 'db_b'
    resolveEnsure()
    await expect(pending).resolves.toBeNull()
  })

  it('drops result when generation is invalidated mid-await', async () => {
    const gen = createCompletionGeneration()
    const g = gen.next()
    const snap = makeCompletionRequestSnapshot({
      gen: g,
      tabId: 'tab-1',
      database: 'db',
      dialect: 'mysql',
      sessionAlive: true,
      pos: 0,
      doc: 'x',
      token: 'x',
      start: 0,
    })
    let resolveEnsure!: () => void
    const ensureP = new Promise<void>((r) => {
      resolveEnsure = r
    })
    const pending = runGuardedAsyncSteps({
      steps: [() => ensureP],
      isLive: () =>
        isCompletionRequestLive({
          snapshot: snap,
          isLiveGen: (x) => gen.isLive(x),
          current: {
            tabId: 'tab-1',
            database: 'db',
            dialect: 'mysql',
            sessionAlive: true,
            pos: 0,
            doc: 'x',
            token: 'x',
            start: 0,
          },
        }),
      build: () => ({ ok: true }),
    })
    gen.invalidate()
    resolveEnsure()
    await expect(pending).resolves.toBeNull()
  })

  it('returns build when still live after awaits', async () => {
    const gen = createCompletionGeneration()
    const g = gen.next()
    const snap = makeCompletionRequestSnapshot({
      gen: g,
      tabId: 't',
      database: 'd',
      dialect: 'mysql',
      sessionAlive: true,
      pos: 1,
      doc: 'ab',
      token: 'b',
      start: 1,
    })
    const result = await runGuardedAsyncSteps({
      steps: [async () => undefined, async () => undefined],
      isLive: () =>
        isCompletionRequestLive({
          snapshot: snap,
          isLiveGen: (x) => gen.isLive(x),
          current: {
            tabId: 't',
            database: 'd',
            dialect: 'mysql',
            sessionAlive: true,
            pos: 1,
            doc: 'ab',
            token: 'b',
            start: 1,
          },
        }),
      build: () => ({ cols: ['id'] }),
    })
    expect(result).toEqual({ cols: ['id'] })
  })

  it('drops when pos/doc change after first step', async () => {
    const gen = createCompletionGeneration()
    const g = gen.next()
    let pos = 3
    let doc = 'SEL'
    const snap = makeCompletionRequestSnapshot({
      gen: g,
      tabId: 't',
      database: 'd',
      dialect: 'postgres',
      sessionAlive: true,
      pos: 3,
      doc: 'SEL',
      token: 'SEL',
      start: 0,
    })
    let resolve1!: () => void
    const p1 = new Promise<void>((r) => {
      resolve1 = r
    })
    const pending = runGuardedAsyncSteps({
      steps: [() => p1],
      isLive: () =>
        isCompletionRequestLive({
          snapshot: snap,
          isLiveGen: (x) => gen.isLive(x),
          current: {
            tabId: 't',
            database: 'd',
            dialect: 'postgres',
            sessionAlive: true,
            pos,
            doc,
            token: doc,
            start: 0,
          },
        }),
      build: () => ({ ok: true }),
    })
    pos = 5
    doc = 'SELEC'
    resolve1()
    await expect(pending).resolves.toBeNull()
  })
})

describe('flushEditorToTab', () => {
  it('writes doc and ui even when previously empty', () => {
    const tab = { sql: 'old', editorUi: null as ReturnType<typeof uiFromEditor> | null }
    flushEditorToTab(tab, {
      doc: 'SELECT 1',
      anchor: 2,
      head: 4,
      scrollTop: 12,
      scrollLeft: 3,
    })
    expect(tab.sql).toBe('SELECT 1')
    expect(tab.editorUi).toEqual({
      selectionAnchor: 2,
      selectionHead: 4,
      scrollTop: 12,
      scrollLeft: 3,
    })
  })

  it('isolates flush target (tab swap must not write into new tab)', () => {
    const oldTab = { sql: 'old-sql', editorUi: null as ReturnType<typeof uiFromEditor> | null }
    const newTab = { sql: 'new-sql', editorUi: null as ReturnType<typeof uiFromEditor> | null }
    // Flush only to old tab (swap isolation)
    flushEditorToTab(oldTab, {
      doc: 'flushed-from-editor',
      anchor: 0,
      head: 0,
      scrollTop: 0,
      scrollLeft: 0,
    })
    expect(oldTab.sql).toBe('flushed-from-editor')
    expect(newTab.sql).toBe('new-sql')
  })
})

describe('isCmDarkTheme', () => {
  it('maps data-theme values', () => {
    expect(isCmDarkTheme(null)).toBe(true)
    expect(isCmDarkTheme(undefined)).toBe(true)
    expect(isCmDarkTheme('dark')).toBe(true)
    expect(isCmDarkTheme('custom')).toBe(true)
    expect(isCmDarkTheme('light')).toBe(false)
    expect(isCmDarkTheme('eyecare')).toBe(false)
  })
})

