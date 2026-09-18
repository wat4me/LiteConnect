import { describe, expect, it } from 'vitest'
import {
  applyQueryTabRename,
  canRestoreDraft,
  cancelQueryTabRename,
  isQueryTabDirty,
  nextLastFullDocExecutedSql,
  parseQueryDraftFile,
  pruneOrphanDrafts,
  removeDraftsForConnection,
  resolveQueryTabTitle,
  sanitizeDraftRecord,
  serializeQueryDraftFile,
  sqlTitleSummary,
  tabToDraftRecord,
  upsertDraft,
  QUERY_DRAFT_MAX_SQL_CHARS,
} from './queryDrafts'

describe('isQueryTabDirty / nextLastFullDocExecutedSql (scope-aware)', () => {
  it('never-run tab is dirty only when sql has content', () => {
    expect(isQueryTabDirty({ sql: '', lastFullDocExecutedSql: null })).toBe(false)
    expect(isQueryTabDirty({ sql: '  SELECT 1  ', lastFullDocExecutedSql: null })).toBe(true)
  })

  it('statement scope on single-statement file never clears dirty', () => {
    const full = 'SELECT 1'
    const next = nextLastFullDocExecutedSql({
      scope: 'statement',
      dispatchFullDocSql: full,
      executedSql: full, // equals full doc — still must stay dirty
      currentFullDocSql: full,
      previous: null,
    })
    expect(next).toBeNull()
    expect(isQueryTabDirty({ sql: full, lastFullDocExecutedSql: next })).toBe(true)
  })

  it('selection scope never clears dirty even when selection equals full doc', () => {
    const full = 'SELECT 1; SELECT 2'
    const next = nextLastFullDocExecutedSql({
      scope: 'selection',
      dispatchFullDocSql: full,
      executedSql: full,
      currentFullDocSql: full,
      previous: null,
    })
    expect(next).toBeNull()
    expect(isQueryTabDirty({ sql: full, lastFullDocExecutedSql: next })).toBe(true)
  })

  it('all scope clears dirty when doc unchanged through success', () => {
    const full = 'SELECT 1; SELECT 2'
    const next = nextLastFullDocExecutedSql({
      scope: 'all',
      dispatchFullDocSql: full,
      executedSql: full,
      currentFullDocSql: full,
      previous: null,
    })
    expect(next).toBe(full)
    expect(isQueryTabDirty({ sql: full, lastFullDocExecutedSql: next })).toBe(false)
  })

  it('all scope keeps dirty when doc edited while pending', () => {
    const dispatch = 'SELECT 1'
    const next = nextLastFullDocExecutedSql({
      scope: 'all',
      dispatchFullDocSql: dispatch,
      executedSql: dispatch,
      currentFullDocSql: 'SELECT 1\nSELECT 2', // edited during flight
      previous: null,
    })
    expect(next).toBeNull()
    expect(
      isQueryTabDirty({
        sql: 'SELECT 1\nSELECT 2',
        lastFullDocExecutedSql: next,
      }),
    ).toBe(true)
  })

  it('partial multi-statement run does not clear dirty', () => {
    const full = 'SELECT 1; SELECT 2'
    const next = nextLastFullDocExecutedSql({
      scope: 'statement',
      dispatchFullDocSql: full,
      executedSql: 'SELECT 1',
      currentFullDocSql: full,
      previous: null,
    })
    expect(next).toBeNull()
    expect(isQueryTabDirty({ sql: full, lastFullDocExecutedSql: next })).toBe(true)
  })

  it('edit after successful all run becomes dirty again', () => {
    const next = nextLastFullDocExecutedSql({
      scope: 'all',
      dispatchFullDocSql: 'SELECT 1',
      executedSql: 'SELECT 1',
      currentFullDocSql: 'SELECT 1',
      previous: null,
    })
    expect(isQueryTabDirty({ sql: 'SELECT 2', lastFullDocExecutedSql: next })).toBe(true)
  })
})

describe('applyQueryTabRename / cancelQueryTabRename', () => {
  it('non-empty draft marks customized', () => {
    expect(
      applyQueryTabRename({
        draft: '  My report  ',
        previousTitle: 'SELECT 1',
        previousCustomized: false,
      }),
    ).toEqual({ title: 'My report', titleCustomized: true })
  })

  it('empty draft keeps previous title and customized flag', () => {
    expect(
      applyQueryTabRename({
        draft: '   ',
        previousTitle: 'Old',
        previousCustomized: true,
      }),
    ).toEqual({ title: 'Old', titleCustomized: true })
  })

  it('cancel restores previous state', () => {
    expect(
      cancelQueryTabRename({ previousTitle: 'T', previousCustomized: false }),
    ).toEqual({ title: 'T', titleCustomized: false })
  })

  it('custom title prevents auto title from sql', () => {
    expect(
      resolveQueryTabTitle({
        title: 'My query',
        titleCustomized: true,
        sql: 'SELECT 1',
        fallback: '查询 1',
      }),
    ).toBe('My query')
  })
})

describe('sqlTitleSummary / resolveQueryTabTitle', () => {
  it('skips line and block comments', () => {
    expect(sqlTitleSummary('-- hi\n/* block */\nSELECT id FROM t')).toContain('SELECT id FROM t')
  })

  it('truncates long sql', () => {
    const s = sqlTitleSummary('SELECT ' + 'x'.repeat(100), 20)
    expect(s.length).toBeLessThanOrEqual(20)
    expect(s.endsWith('…')).toBe(true)
  })

  it('uses sql summary when not customized', () => {
    expect(
      resolveQueryTabTitle({
        title: '查询 1',
        titleCustomized: false,
        sql: 'SELECT 42',
        fallback: '查询 1',
      }),
    ).toBe('SELECT 42')
  })
})

describe('draft sanitize / parse / upsert', () => {
  it('strips unknown secret-like fields', () => {
    const rec = sanitizeDraftRecord({
      draftId: 'd1',
      connectionId: 'c1',
      database: 'db',
      title: 't',
      titleCustomized: false,
      sql: 'SELECT 1',
      updatedAt: 1,
      password: 'secret',
      sessionId: 'sess',
      result: { rows: [] },
    })
    expect(rec).toEqual({
      draftId: 'd1',
      connectionId: 'c1',
      database: 'db',
      title: 't',
      titleCustomized: false,
      sql: 'SELECT 1',
      updatedAt: 1,
      readOnly: false,
      defaultRunScope: undefined,
      maxRows: undefined,
      timeoutMs: undefined,
      savedQueryId: null,
    })
    expect(JSON.stringify(rec)).not.toContain('password')
    expect(JSON.stringify(rec)).not.toContain('sessionId')
    expect(JSON.stringify(rec)).not.toContain('result')
  })

  it('ignores corrupt storage and wrong version', () => {
    expect(parseQueryDraftFile('not-json').drafts).toEqual([])
    expect(parseQueryDraftFile(JSON.stringify({ version: 99, drafts: [{ draftId: 'x' }] })).drafts).toEqual(
      [],
    )
  })

  it('round-trips serialize/parse', () => {
    const file = {
      version: 1 as const,
      drafts: [
        {
          draftId: 'd1',
          connectionId: 'c1',
          database: 'app',
          title: 'SELECT 1',
          titleCustomized: false,
          sql: 'SELECT 1',
          updatedAt: 10,
        },
      ],
    }
    const raw = serializeQueryDraftFile(file)
    expect(parseQueryDraftFile(raw).drafts).toHaveLength(1)
  })

  it('upserts and removes empty sql', () => {
    let list = upsertDraft([], {
      draftId: 'd1',
      connectionId: 'c1',
      database: '',
      title: 't',
      titleCustomized: false,
      sql: 'SELECT 1',
      updatedAt: 1,
    })
    expect(list).toHaveLength(1)
    list = upsertDraft(list, {
      draftId: 'd1',
      connectionId: 'c1',
      database: '',
      title: 't',
      titleCustomized: false,
      sql: '   ',
      updatedAt: 2,
    })
    expect(list).toHaveLength(0)
  })

  it('truncates oversized sql', () => {
    const big = 'x'.repeat(QUERY_DRAFT_MAX_SQL_CHARS + 50)
    const rec = sanitizeDraftRecord({
      draftId: 'd',
      connectionId: 'c',
      sql: big,
      database: '',
      title: '',
      titleCustomized: false,
      updatedAt: 1,
    })
    expect(rec!.sql.length).toBe(QUERY_DRAFT_MAX_SQL_CHARS)
  })

  it('never rebinds draft to another connection', () => {
    const draft = {
      draftId: 'd',
      connectionId: 'c1',
      database: '',
      title: '',
      titleCustomized: false,
      sql: 'SELECT 1',
      updatedAt: 1,
    }
    expect(canRestoreDraft({ draft, connectionId: 'c2', connectionExists: true })).toBe(false)
    expect(canRestoreDraft({ draft, connectionId: 'c1', connectionExists: true })).toBe(true)
    expect(canRestoreDraft({ draft, connectionId: 'c1', connectionExists: false })).toBe(false)
  })

  it('prunes orphans when connection deleted', () => {
    const drafts = [
      {
        draftId: 'a',
        connectionId: 'gone',
        database: '',
        title: '',
        titleCustomized: false,
        sql: 'SELECT 1',
        updatedAt: 1,
      },
      {
        draftId: 'b',
        connectionId: 'keep',
        database: '',
        title: '',
        titleCustomized: false,
        sql: 'SELECT 2',
        updatedAt: 2,
      },
    ]
    expect(pruneOrphanDrafts(drafts, new Set(['keep'])).map((d) => d.draftId)).toEqual(['b'])
    expect(removeDraftsForConnection(drafts, 'gone').map((d) => d.draftId)).toEqual(['b'])
  })

  it('never rebinds orphan draft sql to a different connectionId', () => {
    const orphan = {
      draftId: 'a',
      connectionId: 'deleted-conn',
      database: 'db',
      title: 'x',
      titleCustomized: false,
      sql: 'SELECT secret_from_old_conn',
      updatedAt: 1,
    }
    expect(pruneOrphanDrafts([orphan], new Set(['other-conn']))).toEqual([])
    expect(
      canRestoreDraft({
        draft: orphan,
        connectionId: 'other-conn',
        connectionExists: true,
      }),
    ).toBe(false)
  })

  it('tabToDraftRecord maps only safe fields', () => {
    const rec = tabToDraftRecord({
      tabId: 'tab-1',
      connectionId: 'c1',
      database: 'db',
      title: 't',
      titleCustomized: false,
      sql: 'SELECT 1',
      now: 99,
    })
    expect(rec?.draftId).toBe('tab-1')
    expect(rec?.updatedAt).toBe(99)
  })

  it('persists readOnly boolean only (no secrets)', () => {
    const rec = tabToDraftRecord({
      tabId: 'd',
      connectionId: 'c',
      database: '',
      title: 't',
      titleCustomized: false,
      sql: 'SELECT 1',
      readOnly: true,
      now: 1,
    })
    expect(rec?.readOnly).toBe(true)
    const raw = serializeQueryDraftFile({ version: 1, drafts: [rec!] })
    expect(raw).not.toContain('password')
    expect(raw).not.toContain('sessionId')
    expect(parseQueryDraftFile(raw).drafts[0]?.readOnly).toBe(true)
  })

  it('persists and clamps per-tab exec options with backward compatibility', () => {
    const rec = tabToDraftRecord({
      tabId: 'd',
      connectionId: 'c',
      database: '',
      title: 't',
      titleCustomized: false,
      sql: 'SELECT 1',
      maxRows: 50,
      timeoutMs: 5000,
      defaultRunScope: 'all',
      now: 1,
    })
    expect(rec?.maxRows).toBe(50)
    expect(rec?.timeoutMs).toBe(5000)
    expect(rec?.defaultRunScope).toBe('all')
    const raw = serializeQueryDraftFile({ version: 1, drafts: [rec!] })
    const parsed = parseQueryDraftFile(raw).drafts[0]
    expect(parsed?.maxRows).toBe(50)
    expect(parsed?.defaultRunScope).toBe('all')

    // Legacy draft without options still sanitizes
    const legacy = sanitizeDraftRecord({
      draftId: 'old',
      connectionId: 'c',
      database: '',
      title: '',
      titleCustomized: false,
      sql: 'SELECT 1',
      updatedAt: 1,
    })
    expect(legacy?.maxRows).toBeUndefined()
    expect(legacy?.timeoutMs).toBeUndefined()
    expect(legacy?.defaultRunScope).toBeUndefined()
  })
})
