export default {
  settingsApp: {
    title: '应用',
    intro: '管理窗口、全局快捷键和启动时的工作区恢复。',
    window: '窗口与启动',
    closeToTray: '关闭窗口时最小化到托盘',
    closeToTrayHint: '关闭主窗口后保持 SSH 会话，可从系统托盘重新打开或退出。',
    globalHotkey: '全局呼出快捷键',
    globalHotkeyHint:
      '开启后，在其他应用中按下组合键可显示或隐藏 LiteConnect。点下方按钮即可自定义组合键，保存后生效；被其他软件占用时会注册失败。',
    globalHotkeyCurrent: '呼出组合键',
    globalHotkeyCaptureTitle: '点击后按下新的组合键（Esc 取消）',
    globalHotkeyCapturing: '请按下组合键，Esc 取消',
    globalHotkeyInvalid: '至少需要一个修饰键（Ctrl / Alt / Shift / ⌘）加一个字母、数字或功能键。',
    globalHotkeyReset: '恢复默认',
    globalHotkeyResetDone: '已恢复默认快捷键 {accel}，保存后生效',
    globalHotkeyConflict: '{accel} 注册失败：可能已被其他软件占用，请更换组合键',
    workspaceRestore: '启动时恢复 SSH 标签',
    workspaceRestoreHint: '只恢复上次打开的主机标签，不会自动连接。关闭后会清除已记住的标签。',
  },
} as const
