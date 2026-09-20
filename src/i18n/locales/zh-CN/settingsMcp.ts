export default {
  settingsMcp: {
    title: 'MCP',
    intro: '允许本机 AI 客户端通过 MCP 连接已保存的 SSH 主机或新增连接。',
    service: 'MCP 服务',
    enabled: '已开启',
    disabled: '已关闭',
    hint:
      '开启后仅在 127.0.0.1 提供 Streamable HTTP。Agent 可以新增已保存主机并打开会话，不会把命令写入你正在看的终端。命令权限在本页单独设置。请保管 Bearer Token。',
    listening: '正在监听 {url}',
    stopped: '未监听',
    enableTitle: '向本机 Agent 开放 SSH 会话？',
    enableMessage:
      '开启后，知道此 Token 的本机程序可以对已保存主机执行命令，也可以新增主机。具体哪些命令能跑，由本页的「命令权限」决定。请确认当前没有不受信任的本机软件。',
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
    copyAgentPrompt: '复制给 AI 的提示词',
    approval: '命令权限',
    approvalHint:
      '只约束 exec / service_control。询问时不会在 LiteConnect 弹窗，而是返回给 Claude Code、Cursor 等客户端，让那边的人确认后再带 confirmed=true 重试。rm -rf / 这类高危命令即使确认也不放行，除非选「自动执行」。',
    approvalDeny: '拒绝危险命令',
    approvalDenyHint: '只读和普通创建类命令可执行；删除、改权限、重启服务、sudo 一律拒绝。',
    approvalAsk: '在 MCP 客户端询问',
    approvalAskHint: '危险命令先返回需要确认；你在 Claude Code / Cursor 里同意后，模型会再调一次。',
    approvalAuto: '自动执行',
    approvalAutoHint: '与侧栏 AI 的自动执行类似，包括破坏性命令。只建议自己用、且能接受风险。',
    anyClient: 'MCP 客户端接入',
    anyClientHint:
      '这是标准 MCP：JSON-RPC 2.0，Streamable HTTP（POST /mcp），Bearer 鉴权。支持该传输的客户端填地址和 Token 后会自动 tools/list。客户端必须跑在这台电脑上（127.0.0.1）。网页版 ChatGPT 调不到本机。',
    agentPromptHint:
      '已接到 MCP 的客户端，把下面提示词贴进系统提示或对话，模型就会按流程用工具。只配 JSON、不贴这段也可以，initialize 时服务已下发英文说明。',
    agentPrompt:
      '你通过 LiteConnect 的 MCP 操作本机已打开或已保存的 SSH 主机。\n\n连接（仅本机，LiteConnect 必须开着且设置里 MCP 已打开）：\n- 传输：MCP Streamable HTTP（JSON-RPC POST）\n- 地址：{url}\n- 请求头：Authorization: Bearer {token}\n\n用法：\n1. 先 list_connections 或 list_sessions。\n2. 没有会话就 connect（已保存主机）；没有主机就 save_connection（host + username + password 或 privateKey 或 useAgent），可带 connect=true。\n3. 之后 exec / read_file / grep / glob / write_file / edit_file / list_dir 都要带 sessionId。\n4. 不要整文件 dump。先 glob 找路径、grep 定位行号，再 read_file(startLine, limit) 读附近几十行。\n5. 改已有文件用 edit_file（oldString 必须逐字来自 read_file，不要带行号前缀）。只有新建或整文件覆盖才用 write_file。\n6. 安装向导、菜单、方向键：pty_open → pty_write → pty_read(mode=screen, waitForIdleMs=300) → pty_close。这是独立 PTY，不是用户正在看的终端。\n7. 超过一分钟的任务用 exec(background=true)，再 get_job / list_jobs；取消用 cancel_job。\n8. 用完 disconnect，不要堆会话。\n9. 若 exec 返回 APPROVAL_REQUIRED：在当前客户端询问用户是否执行这条命令，用户同意后再用同样参数加 confirmed=true 重试。用户没同意不要设 confirmed。rm -rf / 一类高危命令即使 confirmed 也会被拒绝（除非 LiteConnect 里选了自动执行）。不要在回复里写出密码或私钥。\n10. 这些命令不会写入用户正在看的终端。',
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
