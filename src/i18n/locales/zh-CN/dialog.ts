export default {
  dialog: {
    hostKeyTitle: '主机密钥确认',
    kbTitle: '需要二次验证',
    kbTitleJump: '跳板机需要二次验证',
    kbHint: '服务器要求交互式认证（密码或动态口令）。',
    kbPromptFallback: '提示 {n}',
    hostKeyTitleFirst: '首次连接：请确认主机身份',
    hostKeyTitleFirstJump: '首次连接跳板机：请确认主机身份',
    hostKeyTitleMismatch: '主机密钥已变化（请谨慎）',
    hostKeyTitleMismatchJump: '跳板机密钥已变化（请谨慎）',
    hostKeyWarning: '目标主机 {host}:{port} 的 SSH 主机密钥与本地记录不一致。',
    hostKeyWarningJump: '跳板机 {host}:{port} 的 SSH 主机密钥与本地记录不一致。',
    hostKeyWarningUnknown:
      '这是第一次连接目标主机 {host}:{port}。应用会把下方指纹记在本地，之后用来识别是不是同一台机器。',
    hostKeyWarningUnknownJump:
      '这是第一次连接跳板机 {host}:{port}。请核对指纹后再信任；跳板机被冒充风险更高。',
    hostKeyNote: '这可能表示服务器已重装，也可能是中间人攻击。请核对下方指纹后再决定是否信任。',
    hostKeyNoteFirst:
      '若你信任这台主机（例如刚从运维同事处拿到地址），点「信任并连接」即可。不熟悉时，可先向管理员核对下方 SHA256 指纹。',
    hostKeyNoteMismatch:
      '密钥变化常见于服务器重装、换机或运维轮换密钥；也可能是网络被劫持。请对照「新指纹」与管理员提供的值，确认无误再继续。',
    hostKeyStep1: '对照下方大字 SHA256 指纹（可点「复制」发给同事核对）',
    hostKeyStep2: '一致 → 点「信任并连接」；应用会记住此主机',
    hostKeyStep3: '不确定 → 点「拒绝连接」，稍后再问管理员',
    fingerprintOld: '本地记录（旧）',
    fingerprintNew: '本次连接（新）',
    fingerprintCurrent: '主机密钥指纹',
    fingerprintHint: '指纹算法为 SHA256。分组显示仅便于核对，复制时为完整一行。',
    copyFingerprint: '复制指纹',
    rejectConnect: '拒绝连接',
    trustAndConnect: '信任并连接',
    trustChangedKey: '仍信任新密钥并连接',
    decryptFailedTitle: '密码解密失败',
    decryptFailedNote:
      '这通常由系统账户变更、重装系统或迁移数据导致。请在编辑连接时重新输入{field}并保存，即可恢复正常连接。',
    password: '密码',
    privateKey: '私钥',
    resetPassword: '去重设密码',
    requiredEmpty: '内容不能为空',
    invalidInput: '输入无效',
  },
} as const
