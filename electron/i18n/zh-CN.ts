/**
 * Main-process strings (keep keys aligned with renderer `src/i18n/locales/zh-CN` where shared).
 * Renderer uses vue-i18n; main cannot share the Vue instance.
 */
export default {
  common: {
    unnamed: '未命名',
    unnamedProvider: '未命名服务商',
    exportWriteFailed: '导出文件写入失败',
    importFailed: '导入失败: {error}',
  },
  x11: {
    autoStarted: '已自动启动本机显示服务（{host}:{port}）。',
    skipped: '图形界面转发已跳过：{detail}',
    notReady: '本机显示服务未就绪',
    autoStartDisabled:
      '本机显示服务未就绪，且已关闭自动启动。请手动启动 VcXsrv/Xming，或在设置中开启「连接时自动启动本机显示服务」。',
    platformUnsupported: '当前系统不支持自动启动显示服务，请自行安装并启动（如 macOS 上的 XQuartz）。',
    notFound:
      '未找到 VcXsrv/Xming。请安装 VcXsrv（推荐），或在「设置 → 连接 → 图形界面」中指定 vcxsrv.exe 路径。',
    stillNotReady:
      '已尝试连接显示服务，但 {host}:{port} 未通过 X11 握手（端口可连不等于是显示服务）。',
    startedButTimeout:
      '已尝试启动 {exe}，但 {host}:{port} 在 {seconds}s 内未通过 X11 握手。请检查防火墙、显示编号是否被占用，或在任务管理器中确认 vcxsrv.exe 是否在运行。',
    startExited:
      '已尝试启动 {exe}，但进程很快退出（{detail}），{host}:{port} 未通过 X11 握手。请手动运行一次 VcXsrv 查看报错，或更换显示编号。',
    startFailed: '启动本机显示服务失败：{error}',
    portOccupiedNotX11:
      '{host}:{port} 仍有进程在接受连接，但未通过 X11 握手（不是可用的显示服务）。请检查占用该端口的进程，或改用显示编号 1（端口 6001）。',
    portOccupiedResidualX:
      '判定为显示服务残留：{process} 仍占用 {host}:{port}，但已不能完成 X11 握手（常见于手动退出 VcXsrv 后进程未彻底退出）。请结束该进程后重试，或在设置中点「结束残留进程」。',
    portOccupiedOtherProcess:
      '{host}:{port} 被其他程序占用：{process}，不是 X11 显示服务。请结束该程序，或把连接的显示编号改为 1（端口 6001）。',
    residualKillOk: '已结束残留进程 {process}。请再次测试本机显示服务。',
    residualKillFailed: '结束进程失败：{error}',
    residualKillNotAllowed: '仅允许结束已判定为 VcXsrv/Xming 等显示服务的残留进程。',
    recheckFailed:
      '连接过程中本机显示服务未保持可用 {host}:{port}。{detail}',
    channelFailed: '图形界面转发失败：{error}',
    connectLocalFailed: '图形界面转发失败：无法连接本机显示服务 {host}:{port}（{error}）',
    shellRejected:
      '远端拒绝 X11 转发（{detail}）。已改用普通终端连接。请检查服务器 sshd 是否允许 X11Forwarding，以及远端是否安装 xauth。',
    shellRejectedLocalUnavailable:
      '远端拒绝 X11 转发（{detail}），且本机 {host}:{port} 未在监听。已改用普通终端。请确认 VcXsrv 是否在运行，并检查服务器 X11Forwarding / xauth。',
    selectExeTitle: '选择本机显示服务可执行文件',
    installerUnavailable: '当前安装包未附带 VcXsrv 安装器。',
    installerOpenFailed: '无法启动 VcXsrv 安装程序。请检查系统权限或稍后重试。',
    installerCancelled: '已取消安装 VcXsrv。',
  },
  appBackground: {
    pickTitle: '选择背景图片',
    invalidType: '仅支持 PNG / JPG / WebP / GIF / BMP',
    tooLarge: '图片不能超过 8MB',
  },
  sftp: {
    sessionNotFound: '会话未找到',
    notInitialized: 'SFTP 未初始化',
    unsupportedArchive: '不支持的压缩格式（支持 tar/tar.gz/tgz/zip/7z/gz 等）',
    fileTooLargeWithSize: '文件过大（{size} 字节），编辑器上限 {maxBytes} 字节',
    fileTooLarge: '文件过大，编辑器上限 {maxBytes} 字节',
    contentTooLarge: '内容过大（{size} 字节），编辑器上限 {maxBytes} 字节',
    renameFailed: '重命名失败: {error}',
    mkdirFailed: '创建目录失败: {error}',
    unlinkFailed: '删除文件失败: {error}',
    rmdirFailed: '删除目录失败: {error}',
    cannotDeleteRoot: '不允许删除根目录',
  },
  ssh: {
    noPendingHostKey: '该连接没有待确认的主机密钥',
    jumpConnected: '经跳板 {jumpHost}:{jumpPort} 已连接 {host}',
    localForwardFailed:
      '本地端口转发 {localPort}→{remoteHost}:{remotePort} 失败: {error}',
    localForwardOk: '本地转发 127.0.0.1:{localPort} → {remoteHost}:{remotePort}',
    localForwardListenFailed: '无法监听本地端口 {localPort}: {error}',
    dynamicForwardOk: 'SOCKS5 代理 127.0.0.1:{localPort}',
    dynamicForwardListenFailed: '无法监听 SOCKS 端口 {localPort}: {error}',
    remoteForwardOk:
      '远程转发 {remoteHost}:{remotePort} → {localHost}:{localPort}',
    remoteForwardFailed:
      '远程转发 {remoteHost}:{remotePort}→{localHost}:{localPort} 失败: {error}',
  },
  ai: {
    defaultSystemPrompt: [
      '你是 LiteConnect 内置的 AI 助手，主要帮助用户理解和处理 SSH 终端、Linux 命令、报错排查、服务运维和文件操作问题。',
      '请默认使用简体中文回答；只有当用户明确要求其他语言，或需要保留原始命令、日志、错误信息、配置字段时，才使用对应语言。',
      '回答要简洁、可执行，优先给出下一步操作和判断依据。涉及命令时，用 Markdown 代码块展示，并说明命令作用。',
      '对 rm、chmod、chown、mkfs、dd、防火墙、重启服务、修改 SSH 配置等可能造成破坏或断连的操作，必须先提醒风险，并给出更安全的验证步骤。',
      '如果用户提供的是终端选中文本、日志或报错，请先概括关键信息，再给出排查步骤。',
    ].join('\n'),
    noStreamBody: 'AI 响应未包含流数据',
    apiKeyRequired: '请先配置 AI API 密钥',
    requestFailed: 'AI 请求失败 ({status})',
    needUserMessage: '请先发送一条用户消息',
    titleGenerateEmpty: '模型未返回有效标题',
    titleGenerateTimeout: '生成标题超时',
    noMessageContent: 'AI 响应未包含消息内容',
  },
  dialog: {
    exportConnections: '导出连接配置',
    importConnections: '导入连接配置',
    importSshConfig: '导入 OpenSSH 配置',
    exportSnippets: '导出命令片段',
    importSnippets: '导入命令片段',
    exportDbConnections: '导出数据库连接',
    importDbConnections: '导入数据库连接',
    selectPrivateKey: '选择私钥文件',
    selectSqlScript: '选择 SQL 文件',
    exportTable: '导出表数据',
  },
  snippet: {
    noImportable: '未找到可导入的命令片段',
  },
  crypto: {
    encryptionUnavailable:
      '系统加密不可用，拒绝以明文保存密码或密钥。请检查系统凭据保护后重试。',
    passwordDecryptFailed:
      '密码解密失败，可能是系统账户或环境变更导致。请重新输入密码并保存。',
    privateKeyDecryptFailed:
      '私钥解密失败，可能是系统账户或环境变更导致。请重新导入私钥并保存。',
    dbPasswordDecryptFailed:
      '数据库密码解密失败，可能是系统账户或环境变更导致。请重新输入密码并保存。',
    apiKeyDecryptFailed:
      'API Key 解密失败，可能是系统账户或环境变更导致。请重新填写 API Key。',
  },
  db: {
    queryCancelled: '查询已取消',
  },
} as const
