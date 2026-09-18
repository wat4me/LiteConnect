export default {
  settingsDatabase: {
    title: '数据库',
    intro:
      '控制从 SSH 切换到数据库时的打开方式，以及 SQL 编辑器、结果表格等宽字体、默认分页和新建查询标签的执行默认值。与终端字体相互独立；打开方式、字体/分页保存后立即生效；查询默认值仅影响之后新建的标签。',
    openMode: '从 SSH 切换到数据库',
    openModeNewWindow: '新窗口',
    openModeCurrentWindow: '当前窗口',
    openModeHint:
      '标题栏从 SSH 切到数据库时：打开独立数据库窗口，或在当前窗口切换模块。默认新窗口。',
    fontFamily: '等宽字体',
    fontSize: '字体大小',
    pageSize: '默认每页行数',
    rowsPerPage: '{n} 行 / 页',
    pageSizeHint: '打开表数据页时的默认分页；单个标签内仍可临时改每页行数。',
    queryDefaults: '新建查询标签默认值',
    defaultMaxRows: '默认最大返回行数',
    defaultMaxRowsHint:
      '仅用于新建查询标签（1–100000）。已打开的标签与草稿中已保存的值不会被覆盖；标签内设置仍可单独修改。',
    defaultTimeoutSec: '默认查询超时（秒）',
    defaultTimeoutSecHint:
      '仅用于新建查询标签（1–600 秒）。已打开的标签与草稿中已保存的超时不会被覆盖。',
    defaultRunScope: '默认运行范围',
    defaultRunScopeHint:
      '仅用于新建查询标签。智能 / 选中 / 当前语句 / 全部；标签内设置可单独覆盖。',
    runScopeSmart: '智能',
    runScopeSelection: '选中内容',
    runScopeStatement: '当前语句',
    runScopeAll: '全部',
    safety: '安全确认',
    confirmDangerousSql: '执行危险 SQL 前二次确认',
    confirmDangerousSqlHint:
      '对 DROP、TRUNCATE，以及无 WHERE 的 UPDATE/DELETE 提示确认。解析不确定时也会提示，不会承诺“安全”。可关闭。',
    preview: 'SQL / 结果预览',
    draftBadge: '草稿',
    previewHint: '界面主题仍由「外观」统一控制；此处只调数据库场景的字体与分页默认值。',
  },
} as const
