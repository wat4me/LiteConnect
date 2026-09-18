export default {
  x11: {
    autoStarted: '已自动启动本机显示服务（{host}:{port}）。',
    skipped: '图形界面转发已跳过：{detail}',
    notReady: '本机显示服务未就绪',
    autoStartDisabled:
      '本机显示服务未就绪，且已关闭自动启动。请手动启动 VcXsrv/Xming，或在设置中开启「连接时自动启动本机显示服务」。',
    platformUnsupported: '当前系统不支持自动启动显示服务，请自行安装并启动（如 macOS 上的 XQuartz）。',
    notFound:
      '未找到 VcXsrv/Xming。请安装 VcXsrv（推荐），或在「设置 → 连接 → 图形界面」中指定 vcxsrv.exe 路径。',
    notFoundPrompt:
      '未检测到本机显示服务（VcXsrv/Xming）。可前往「设置 → 连接」安装 LiteConnect 附带的 VcXsrv，或仍保存连接（连接时可能无法打开图形程序）。',
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
  },
} as const
