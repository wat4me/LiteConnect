export default {
  settingsDatabase: {
    title: 'Database',
    intro: 'Set how the database opens, SQL display, result paging, and defaults for new queries.',
    openMode: 'Switch from SSH to Database',
    openModeNewWindow: 'New window',
    openModeCurrentWindow: 'Current window',
    openModeHint:
      'When the title bar switches from SSH to Database: open a separate database window, or switch modules in the current window. The default is a new window.',
    fontFamily: 'Monospace font',
    fontSize: 'Font size',
    pageSize: 'Default rows per page',
    rowsPerPage: '{n} rows / page',
    pageSizeHint: 'Default paging when a table data page opens. You can still change rows per page inside a tab.',
    queryDefaults: 'Defaults for new query tabs',
    defaultMaxRows: 'Default maximum rows returned',
    defaultMaxRowsHint:
      'Used only for new query tabs (1–100000). Open tabs and values already saved in a draft are not overwritten. Tab settings can still be changed individually.',
    defaultTimeoutSec: 'Default query timeout (seconds)',
    defaultTimeoutSecHint:
      'Used only for new query tabs (1–600 seconds). Open tabs and timeouts already saved in a draft are not overwritten.',
    defaultRunScope: 'Default run scope',
    defaultRunScopeHint:
      'Used only for new query tabs: Smart, Selection, Current statement, or All. Tab settings can override this.',
    runScopeSmart: 'Smart',
    runScopeSelection: 'Selection',
    runScopeStatement: 'Current statement',
    runScopeAll: 'All',
    safety: 'Safety confirmation',
    confirmDangerousSql: 'Confirm before running dangerous SQL',
    confirmDangerousSqlHint:
      'Asks for confirmation before DROP, TRUNCATE, and UPDATE or DELETE without a WHERE clause. It also asks when the statement cannot be parsed with confidence, and it does not promise that a statement is safe. You can turn this off.',
    preview: 'SQL and result preview',
    draftBadge: 'Draft',
    previewHint: 'The interface theme is still controlled by Appearance. This page only sets the database font and paging defaults.',
  },
}
