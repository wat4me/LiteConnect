import type { SettingsTabId } from '@/domain/settings/types'

export interface SettingsSearchEntry {
  id: string
  tab: SettingsTabId
  titleKey: string
  hintKey?: string
  /** Extra terms people type that may not appear in the title. */
  keywords?: string[]
}

export const SETTINGS_SEARCH_CATALOG: SettingsSearchEntry[] = [
  {
    id: 'appearance',
    tab: 'appearance',
    titleKey: 'settings.tabs.appearance',
    hintKey: 'settings.tabs.appearanceDesc',
    keywords: ['界面', '主题'],
  },
  {
    id: 'appearance.theme',
    tab: 'appearance',
    titleKey: 'settingsAppearance.theme',
    keywords: ['配色', '暗色', '亮色', '护眼', '自定义'],
  },
  {
    id: 'appearance.bgImage',
    tab: 'appearance',
    titleKey: 'settingsAppearance.bgImage',
    hintKey: 'settingsAppearance.bgImageHint',
    keywords: ['壁纸', '背景图', 'wallpaper'],
  },
  {
    id: 'appearance.fancyCursor',
    tab: 'appearance',
    titleKey: 'settingsAppearance.fancyCursor',
    hintKey: 'settingsAppearance.fancyCursorHint',
    keywords: ['鼠标', '光标'],
  },
  {
    id: 'appearance.closeToTray',
    tab: 'appearance',
    titleKey: 'settingsAppearance.closeToTray',
    hintKey: 'settingsAppearance.closeToTrayHint',
    keywords: ['托盘', '最小化', '关闭窗口'],
  },
  {
    id: 'appearance.globalHotkey',
    tab: 'appearance',
    titleKey: 'settingsAppearance.globalHotkey',
    hintKey: 'settingsAppearance.globalHotkeyHint',
    keywords: ['呼出', '全局快捷键', 'alt+shift'],
  },

  {
    id: 'terminal',
    tab: 'terminal',
    titleKey: 'settings.tabs.terminal',
    hintKey: 'settings.tabs.terminalDesc',
  },
  {
    id: 'terminal.palette',
    tab: 'terminal',
    titleKey: 'settingsTerminal.palette',
    keywords: ['配色', '颜色'],
  },
  {
    id: 'terminal.fontFamily',
    tab: 'terminal',
    titleKey: 'settingsTerminal.fontFamily',
    keywords: ['字体', '等宽'],
  },
  {
    id: 'terminal.fontSize',
    tab: 'terminal',
    titleKey: 'settingsTerminal.fontSize',
    hintKey: 'settingsTerminal.fontSizeHint',
    keywords: ['字号', '大小'],
  },
  {
    id: 'terminal.scrollback',
    tab: 'terminal',
    titleKey: 'settingsTerminal.scrollback',
    hintKey: 'settingsTerminal.scrollbackHint',
    keywords: ['缓冲', '历史', '回滚'],
  },
  {
    id: 'terminal.pasteConfirm',
    tab: 'terminal',
    titleKey: 'settingsTerminal.pasteConfirm',
    hintKey: 'settingsTerminal.pasteConfirmHint',
    keywords: ['粘贴', '确认'],
  },
  {
    id: 'terminal.commandSuggest',
    tab: 'terminal',
    titleKey: 'settingsTerminal.commandSuggest',
    hintKey: 'settingsTerminal.commandSuggestHint',
    keywords: ['补全', '提示', '历史命令'],
  },
  {
    id: 'terminal.sessionLog',
    tab: 'terminal',
    titleKey: 'settingsTerminal.sessionLog',
    hintKey: 'settingsTerminal.sessionLogHint',
    keywords: ['日志', '记录', 'log'],
  },

  {
    id: 'files',
    tab: 'files',
    titleKey: 'settings.tabs.files',
    hintKey: 'settings.tabs.filesDesc',
    keywords: ['sftp', '传输'],
  },
  {
    id: 'files.downloadPath',
    tab: 'files',
    titleKey: 'settingsFiles.downloadPath',
    keywords: ['下载', '保存位置', '目录'],
  },
  {
    id: 'files.conflictStrategy',
    tab: 'files',
    titleKey: 'settingsFiles.conflictStrategy',
    hintKey: 'settingsFiles.conflictHint',
    keywords: ['重名', '覆盖', '重命名', '跳过'],
  },
  {
    id: 'files.dirTransferConcurrency',
    tab: 'files',
    titleKey: 'settingsFiles.dirTransferConcurrency',
    hintKey: 'settingsFiles.dirTransferConcurrencyHint',
    keywords: ['并发', '目录上传'],
  },
  {
    id: 'files.dirTransferFailPolicy',
    tab: 'files',
    titleKey: 'settingsFiles.dirTransferFailPolicy',
    hintKey: 'settingsFiles.dirTransferFailPolicyHint',
    keywords: ['失败', '遇错'],
  },

  {
    id: 'database',
    tab: 'database',
    titleKey: 'settings.tabs.database',
    hintKey: 'settings.tabs.databaseDesc',
    keywords: ['sql'],
  },
  {
    id: 'database.fontFamily',
    tab: 'database',
    titleKey: 'settingsDatabase.fontFamily',
    keywords: ['字体', '等宽'],
  },
  {
    id: 'database.fontSize',
    tab: 'database',
    titleKey: 'settingsDatabase.fontSize',
    keywords: ['字号'],
  },
  {
    id: 'database.pageSize',
    tab: 'database',
    titleKey: 'settingsDatabase.pageSize',
    hintKey: 'settingsDatabase.pageSizeHint',
    keywords: ['分页', '每页'],
  },
  {
    id: 'database.defaultMaxRows',
    tab: 'database',
    titleKey: 'settingsDatabase.defaultMaxRows',
    hintKey: 'settingsDatabase.defaultMaxRowsHint',
    keywords: ['最大行', 'limit'],
  },
  {
    id: 'database.defaultTimeoutSec',
    tab: 'database',
    titleKey: 'settingsDatabase.defaultTimeoutSec',
    hintKey: 'settingsDatabase.defaultTimeoutSecHint',
    keywords: ['超时', 'timeout'],
  },
  {
    id: 'database.defaultRunScope',
    tab: 'database',
    titleKey: 'settingsDatabase.defaultRunScope',
    hintKey: 'settingsDatabase.defaultRunScopeHint',
    keywords: ['运行范围', '选区', '当前语句'],
  },
  {
    id: 'database.confirmDangerousSql',
    tab: 'database',
    titleKey: 'settingsDatabase.confirmDangerousSql',
    hintKey: 'settingsDatabase.confirmDangerousSqlHint',
    keywords: ['危险', 'drop', 'truncate', 'delete'],
  },

  {
    id: 'network',
    tab: 'network',
    titleKey: 'settings.tabs.network',
    hintKey: 'settings.tabs.networkDesc',
    keywords: ['ssh', '网络'],
  },
  {
    id: 'network.latency',
    tab: 'network',
    titleKey: 'settingsNetwork.latency',
    keywords: ['延迟', 'ping'],
  },
  {
    id: 'network.usageStats',
    tab: 'network',
    titleKey: 'settingsNetwork.usageStats',
    hintKey: 'settingsNetwork.usageStatsHint',
    keywords: ['统计', '最近使用', '最常使用'],
  },
  {
    id: 'network.monitor',
    tab: 'network',
    titleKey: 'settingsNetwork.monitor',
    keywords: ['监控', 'cpu', '内存'],
  },
  {
    id: 'network.autoReconnect',
    tab: 'network',
    titleKey: 'settingsNetwork.autoReconnect',
    hintKey: 'settingsNetwork.autoReconnectHint',
    keywords: ['重连', '断线'],
  },
  {
    id: 'network.workspaceRestore',
    tab: 'network',
    titleKey: 'settingsNetwork.workspaceRestore',
    hintKey: 'settingsNetwork.workspaceRestoreHint',
    keywords: ['恢复标签', '启动'],
  },
  {
    id: 'network.x11',
    tab: 'network',
    titleKey: 'settingsNetwork.graphical',
    hintKey: 'settingsNetwork.autoStartHint',
    keywords: ['x11', '图形', 'vcxsrv', 'xming', '转发'],
  },
  {
    id: 'network.knownHosts',
    tab: 'network',
    titleKey: 'settingsNetwork.knownHostsTitle',
    hintKey: 'settingsNetwork.knownHostsHint',
    keywords: ['指纹', '主机密钥', 'known_hosts', '信任'],
  },

  {
    id: 'mcp',
    tab: 'mcp',
    titleKey: 'settings.tabs.mcp',
    hintKey: 'settings.tabs.mcpDesc',
    keywords: ['agent', 'token'],
  },
  {
    id: 'mcp.service',
    tab: 'mcp',
    titleKey: 'settingsMcp.service',
    hintKey: 'settingsMcp.hint',
    keywords: ['开关', '监听'],
  },
  {
    id: 'mcp.port',
    tab: 'mcp',
    titleKey: 'settingsMcp.port',
    keywords: ['端口'],
  },
  {
    id: 'mcp.token',
    tab: 'mcp',
    titleKey: 'settingsMcp.token',
    keywords: ['bearer', '密钥'],
  },

  {
    id: 'shortcuts',
    tab: 'shortcuts',
    titleKey: 'settings.tabs.shortcuts',
    hintKey: 'settings.tabs.shortcutsDesc',
    keywords: ['热键', '快捷键'],
  },
  {
    id: 'shortcuts.resetTips',
    tab: 'shortcuts',
    titleKey: 'settingsShortcuts.resetTipsTitle',
    hintKey: 'settingsShortcuts.resetTipsDesc',
    keywords: ['新手', '欢迎', '提示'],
  },

  {
    id: 'about',
    tab: 'about',
    titleKey: 'settings.tabs.about',
    hintKey: 'settings.tabs.aboutDesc',
    keywords: ['版本'],
  },
  {
    id: 'about.updates',
    tab: 'about',
    titleKey: 'about.updates',
    hintKey: 'about.autoUpdateHint',
    keywords: ['自动更新', '升级', '检查更新', 'github'],
  },
]
