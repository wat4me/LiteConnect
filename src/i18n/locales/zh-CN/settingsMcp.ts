export default {
  settingsMcp: {
    title: 'MCP',
    intro:
      '向本机 MCP 客户端开放 SSH 会话。可以打开已保存的主机，也可以新增主机。默认关闭；开关立即生效，不必再点保存。',
    service: 'MCP 服务',
    enabled: '已开启',
    disabled: '已关闭',
    hint:
      '开启后仅在 127.0.0.1 提供 Streamable HTTP。Agent 可以新增已保存主机并打开会话，不会把命令写入你正在看的终端。破坏性命令默认拒绝。请保管 Bearer Token。',
    listening: '正在监听 {url}',
    stopped: '未监听',
    enableTitle: '向本机 Agent 开放 SSH 会话？',
    enableMessage:
      '开启后，知道此 Token 的本机程序可以对已保存主机执行只读命令和受控 exec，也可以新增主机（使用它提供的账号）。请确认当前没有不受信任的本机软件。',
    enableConfirm: '开启 MCP 服务',
    rotateTitle: '更换 Token？',
    rotateMessage: '旧 Token 立即失效，需要把新 Token 重新填进 MCP 客户端。',
    rotateConfirm: '更换 Token',
    token: 'Bearer Token',
    port: '端口',
    applyPort: '应用端口',
    rotate: '更换 Token',
    copyToken: '复制 Token',
    copyUrl: '复制地址',
    copyShare: '复制接入说明',
    copyGeneric: '复制通用 JSON',
    anyClient: 'MCP 客户端接入',
    anyClientHint:
      '对方只要支持 Streamable HTTP MCP，把地址和 Bearer 填进去即可。客户端必须跑在这台电脑上（地址是 127.0.0.1）。',
    shareCard:
      'LiteConnect SSH MCP（本机）\n传输：Streamable HTTP（POST）\n地址：{url}\n鉴权请求头：Authorization: Bearer {token}\n健康检查：{health}\n\nLiteConnect 必须开着，并且设置里 MCP 已打开。可以 list/connect 已保存主机，也可以 save_connection 新增。不会把命令写入用户正在看的终端。',
    endpoint: '地址',
    transport: '传输',
    transportValue: 'Streamable HTTP（HTTP POST）',
    authHeader: '鉴权请求头',
    genericHint: '通用 JSON，多数客户端改字段名后就能用',
    startFailed: '无法监听：{error}',
  },
} as const
