/**
 * Interactive demo controller — layout mirrors App.vue / SshWorkspace.
 */
;(function () {
  const DEMO = window.DEMO
  const icon = window.icon
  if (!DEMO?.hosts?.length) {
    console.error('[demo] DEMO data missing')
    return
  }
  if (typeof icon !== 'function') {
    console.error('[demo] icons.js missing — load icons.js before app.js')
    return
  }

  const $ = (id) => document.getElementById(id)
  const els = {
    modeLabel: $('mode-label'),
    modeToggle: $('mode-toggle'),
    titlebarConn: $('titlebar-conn'),
    workspaceTop: $('workspace-top'),
    hostTabs: $('host-tabs'),
    homeBtn: $('home-btn'),
    leftToolbar: $('left-toolbar'),
    sidePanel: $('side-panel'),
    sideResize: $('side-resize'),
    subTabs: $('sub-tabs'),
    mainPane: $('main-pane'),
    terminalHost: $('terminal-host'),
    monitorDock: $('monitor-dock'),
    monitorMetrics: $('monitor-metrics'),
    sshWorkspace: $('ssh-workspace'),
    dbWorkspace: $('db-workspace'),
    dbShell: $('db-shell'),
  }

  /** @type {'ssh' | 'database'} */
  let appMode = 'ssh'
  let activeHostId = DEMO.hosts[0].id
  /** per-host tool override: 'ai' | 'sftp' | null | undefined(use default) */
  const toolOverride = Object.create(null)
  /** per-host monitor override */
  const monitorOverride = Object.create(null)
  /**
   * per-host Docker workspace mode (mirrors useDockerWorkspaceMode).
   * true = Docker replaces terminal content on this SSH session; not a separate host tab.
   */
  const dockerOverride = Object.create(null)

  function host() {
    return DEMO.hosts.find((h) => h.id === activeHostId) || DEMO.hosts[0]
  }

  function dockerTabState(h) {
    const v = dockerOverride[h.id]
    if (v === 'active' || v === true) return 'active'
    if (v === 'open') return 'open'
    return 'closed'
  }

  function isDockerMode(h) {
    return dockerTabState(h) === 'active'
  }

  function isDockerTabOpen(h) {
    return dockerTabState(h) !== 'closed'
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function formatBody(text) {
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>')
  }

  function latencyColor(ms) {
    if (ms < 200) return 'var(--success)'
    if (ms < 500) return 'var(--warning)'
    return 'var(--danger)'
  }

  function barColor(pct) {
    if (pct >= 85) return 'var(--danger)'
    if (pct >= 65) return 'var(--warning)'
    return 'var(--success)'
  }

  function effectiveTool(h) {
    if (toolOverride[h.id] !== undefined) return toolOverride[h.id]
    return h.tool
  }

  function effectiveMonitor(h) {
    if (isDockerMode(h)) return false
    if (monitorOverride[h.id] !== undefined) return monitorOverride[h.id]
    return !!h.monitor
  }

  /* —— TabBar —— */
  function renderHostTabs() {
    els.hostTabs.innerHTML = DEMO.hosts
      .map((h) => {
        const active = appMode === 'ssh' && h.id === activeHostId
        return `
          <button type="button" class="tab${active ? ' active' : ''}" role="tab" aria-selected="${active}" data-host="${h.id}">
            <span class="tab-indicator"></span>
            <span class="tab-name">${escapeHtml(h.name)}</span>
            ${h.sessionCount > 1 ? `<span class="tab-count">${h.sessionCount}</span>` : ''}
            <span class="tab-latency" style="color:${latencyColor(h.latency)}">${h.latency}ms</span>
            <span class="tab-close" data-close aria-hidden="true">${icon('close', 'xs')}</span>
          </button>`
      })
      .join('')
  }

  /* —— Left toolbar —— */
  function renderToolbar(h) {
    const tool = effectiveTool(h)
    const mon = effectiveMonitor(h)
    const docker = isDockerMode(h)
    els.leftToolbar.querySelectorAll('.toolbar-icon-btn').forEach((btn) => {
      const t = btn.dataset.tool
      let active = false
      if (t === 'docker') active = docker
      else if (t === 'monitor') active = mon
      else if (t === 'ai' || t === 'sftp') active = tool === t
      btn.classList.toggle('active', active)
      btn.disabled = false
    })
  }

  /* —— Side panels —— */
  function renderSide(h) {
    const tool = effectiveTool(h)
    if (!tool) {
      els.sidePanel.hidden = true
      els.sideResize.hidden = true
      els.sidePanel.innerHTML = ''
      return
    }

    if (tool === 'ai' && h.ai) {
      els.sidePanel.hidden = false
      els.sideResize.hidden = false
      els.sidePanel.innerHTML = `
        <div class="ai-sidebar">
          <div class="ai-header">
            <div class="ai-title">AI 助手</div>
            <div class="ai-header-actions">
              <button type="button" title="历史">${icon('history', 'sm')}</button>
              <button type="button" title="设置">${icon('settings', 'sm')}</button>
              <button type="button" data-close-side title="关闭" aria-label="关闭">${icon('close', 'sm')}</button>
            </div>
          </div>
          <div class="ai-body">
            <div class="ai-messages">
              ${h.ai.messages
                .map(
                  (m) => `
                <div class="ai-msg ${m.role}">
                  <div class="meta">${escapeHtml(m.meta)}</div>
                  <div class="body">${formatBody(m.body)}</div>
                </div>`,
                )
                .join('')}
            </div>
            <div class="ai-model-row"><span>gpt-compatible</span><span>演示只读</span></div>
            <div class="ai-composer"><div class="ai-composer-box">输入消息…</div></div>
          </div>
        </div>`
      return
    }

    if (tool === 'sftp' && h.sftp) {
      els.sidePanel.hidden = false
      els.sideResize.hidden = false
      els.sidePanel.innerHTML = `
        <div class="file-sidebar">
          <div class="file-sidebar-head">
            <span>SFTP</span>
            <button type="button" data-close-side aria-label="关闭">${icon('close', 'sm')}</button>
          </div>
          <div class="file-sidebar-tabs">
            <button type="button" class="active">文件</button>
            <button type="button">传输</button>
          </div>
          <div class="sftp-path-bar">${escapeHtml(h.sftp.path)}</div>
          <div class="sftp-list">
            ${h.sftp.entries
              .map(
                (e) => `
              <div class="sftp-row">
                <span class="sftp-kind">${e.kind === 'dir' ? icon('folder', 'sm') : icon('file-text', 'sm')}</span>
                <span>${escapeHtml(e.name)}</span>
                <span class="meta">${escapeHtml(e.size)}</span>
              </div>`,
              )
              .join('')}
          </div>
          <div class="sftp-xfer">
            <h4>传输</h4>
            ${h.sftp.transfers
              .map(
                (t) => `
              <div class="xfer-row">
                <span>${escapeHtml(t.name)}</span>
                <span class="ok">${escapeHtml(t.state)}</span>
              </div>`,
              )
              .join('')}
          </div>
        </div>`
      return
    }

    els.sidePanel.hidden = true
    els.sideResize.hidden = true
  }

  /* —— Sub tabs —— */
  function renderSubTabs(h) {
    const dockerOn = isDockerMode(h)
    const dockerOpen = isDockerTabOpen(h)
    const tabs =
      (h.subTabs || [])
        .map(
          (t) => `
        <button type="button" class="sub-tab${!dockerOn && t.active ? ' active' : ''}" data-sub="${t.id}">
          <span class="sub-tab-label">终端 ${t.n}</span>
          <span class="sub-tab-close" aria-hidden="true">${icon('close', 'xs')}</span>
        </button>`,
        )
        .join('') +
      (dockerOpen
        ? `<button type="button" class="sub-tab${dockerOn ? ' active' : ''}" data-sub="docker">
          <span class="sub-tab-label">Docker</span>
          <span class="sub-tab-close" data-close-docker aria-hidden="true">${icon('close', 'xs')}</span>
        </button>`
        : '') +
      `<button type="button" class="sub-tab-add" title="新建终端" aria-label="新建终端">${icon('plus', 'xs')}</button>`
    els.subTabs.innerHTML = tabs
  }

  function renderTerminal(lines) {
    return `<div class="term-view">${(lines || [])
      .map((line) => {
        if (line.prompt != null) {
          const cur = line.cursor ? '<span class="term-cursor" aria-hidden="true"></span>' : ''
          return `<div class="term-line"><span class="prompt">${escapeHtml(line.prompt)}</span><span class="cmd">${escapeHtml(line.cmd || '')}</span>${cur}</div>`
        }
        return `<div class="term-line ${line.cls || ''}">${escapeHtml(line.text || '')}</div>`
      })
      .join('')}</div>`
  }

  function renderDocker(view) {
    const counts = view.counts || { all: view.containers.length, running: 0, stopped: 0 }
    const selected = view.containers.find((c) => c.active) || view.containers[0]
    const filter = view.filter || 'all'

    const rows = view.containers
      .map((c) => {
        const running = c.state === 'running'
        return `
          <div class="container-row${c.active ? ' selected' : ''}" data-cid="${escapeHtml(c.id)}" role="option" aria-selected="${!!c.active}">
            <span class="col-state">
              <span class="state-pill ${running ? 'tone-ok' : 'tone-muted'}">
                <span class="status-dot"></span>${running ? 'running' : 'exited'}
              </span>
            </span>
            <span class="col-container">
              <span class="row-name">${escapeHtml(c.name)}</span>
              <span class="row-image">${escapeHtml(c.image)}</span>
            </span>
            <span class="col-runtime">
              <span class="row-ports">${escapeHtml(c.ports)}</span>
              <span class="row-status">${escapeHtml(c.status)}</span>
            </span>
            <span class="col-actions">
              <button type="button" class="action-btn">${escapeHtml(c.action || (running ? '停止' : '启动'))}</button>
            </span>
          </div>`
      })
      .join('')

    const detailName = selected?.fullName || selected?.name || ''
    const detailImage = selected?.fullImage || selected?.image || ''
    const portChips = (selected?.portChips || [])
      .map((p) => `<span class="port-chip">${escapeHtml(p)}</span>`)
      .join('')
    const mounts = (selected?.mounts || [])
      .map((m) => `<div class="mount-row mono">${escapeHtml(m)}</div>`)
      .join('')
    const fullId = selected?.fullId || selected?.id || ''

    return `
      <div class="docker-workspace">
        <div class="docker-probe-banner">
          <div class="probe-left">
            <span class="probe-brand">${icon('docker', 'md')} Docker</span>
            <span class="status-pill tone-ok"><span class="status-dot"></span>可用</span>
            <span class="probe-meta">${escapeHtml(view.engine || '26.1.4')} · API ${escapeHtml(view.api || '1.45')}</span>
          </div>
          <div class="probe-right">
            <button type="button" class="docker-btn ghost" data-back-terminal>${icon('terminal', 'sm')} 返回终端</button>
            <button type="button" class="docker-btn ghost">${icon('refresh', 'sm')} 刷新</button>
          </div>
        </div>
        <div class="docker-main">
          <div class="docker-split">
            <div class="list-column">
              <div class="docker-toolbar">
                <div class="filter-group">
                  <button type="button" class="filter-btn${filter === 'all' ? ' active' : ''}">全部 <span class="filter-count">${counts.all}</span></button>
                  <button type="button" class="filter-btn${filter === 'running' ? ' active' : ''}">运行中 <span class="filter-count">${counts.running}</span></button>
                  <button type="button" class="filter-btn${filter === 'stopped' ? ' active' : ''}">已停止 <span class="filter-count">${counts.stopped}</span></button>
                </div>
                <input class="search-input" type="search" placeholder="搜索名称或镜像…" readonly />
              </div>
              <div class="list-pane">
                <div class="list-table">
                  <div class="list-head" aria-hidden="true">
                    <span class="col-state">状态</span>
                    <span class="col-container">容器</span>
                    <span class="col-runtime">端口 / 运行状态</span>
                    <span class="col-actions">操作</span>
                  </div>
                  <div class="container-list" role="listbox">${rows}</div>
                </div>
              </div>
            </div>
            <div class="detail-pane">
              <div class="detail-header">
                <div class="detail-title-block">
                  <div class="detail-title-main">
                    <h3 class="detail-name">${escapeHtml(detailName)}</h3>
                    <span class="state-pill tone-ok"><span class="status-dot"></span>运行中</span>
                  </div>
                  <div class="detail-actions">
                    <button type="button" class="action-btn primary">停止</button>
                    <button type="button" class="action-btn primary">重启</button>
                  </div>
                </div>
                <div class="detail-tabs">
                  <button type="button" class="tab-btn active" data-dtab="overview">概览</button>
                  <button type="button" class="tab-btn" data-dtab="logs">日志</button>
                  <button type="button" class="tab-btn" data-dtab="terminal">终端</button>
                  <button type="button" class="tab-btn" data-dtab="inspect">Inspect</button>
                </div>
              </div>
              <div class="detail-body" data-dpanel="overview">
                <section class="ov-section">
                  <h4 class="ov-section-title">基本信息</h4>
                  <dl class="overview-grid">
                    <div class="ov-row"><dt>ID</dt><dd class="mono">${escapeHtml(fullId)}</dd></div>
                    <div class="ov-row"><dt>名称</dt><dd>${escapeHtml(detailName)}</dd></div>
                    <div class="ov-row"><dt>镜像</dt><dd>${escapeHtml(detailImage)}</dd></div>
                    <div class="ov-row"><dt>状态</dt><dd>运行中 · ${escapeHtml(selected?.status || '')}</dd></div>
                    <div class="ov-row"><dt>创建时间</dt><dd>${escapeHtml(selected?.created || '—')}</dd></div>
                    <div class="ov-row"><dt>启动时间</dt><dd>${escapeHtml(selected?.started || '—')}</dd></div>
                    <div class="ov-row"><dt>重启策略</dt><dd>${escapeHtml(selected?.restartPolicy || 'no')}</dd></div>
                  </dl>
                </section>
                <section class="ov-section">
                  <h4 class="ov-section-title">网络与端口</h4>
                  <dl class="overview-grid">
                    <div class="ov-row"><dt>网络</dt><dd>${escapeHtml(selected?.network || 'bridge')}</dd></div>
                    <div class="ov-row"><dt>端口</dt><dd><div class="port-chips">${portChips || '—'}</div></dd></div>
                  </dl>
                </section>
                <section class="ov-section">
                  <h4 class="ov-section-title">挂载</h4>
                  <div class="mount-list">${mounts || '<div class="mount-row">—</div>'}</div>
                </section>
              </div>
              <div class="detail-body docker-logs-body" data-dpanel="logs" hidden>
                <div class="docker-logs-toolbar"><span>follow · tail 200</span></div>
                <pre class="docker-logs-view">2026-07-28T02:14:01Z  GET /health 200  1.2ms
2026-07-28T02:14:08Z  GET /api/v1/orders 200  18ms
2026-07-28T02:14:11Z  POST /api/v1/checkout 201  41ms
2026-07-28T02:14:19Z  GET /metrics 200  2.0ms</pre>
              </div>
              <div class="detail-body detail-empty-body" data-dpanel="terminal" hidden>容器交互终端（演示只读）</div>
              <div class="detail-body detail-empty-body mono" data-dpanel="inspect" hidden>{ "Id": "${escapeHtml(fullId.slice(0, 12))}…", "State": { "Status": "running" } }</div>
            </div>
          </div>
        </div>
      </div>`
  }

  function bindDockerInteractions(view) {
    const root = els.mainPane.querySelector('.docker-workspace')
    if (!root) return

    root.querySelectorAll('.tab-btn[data-dtab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-dtab')
        root.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn))
        root.querySelectorAll('.detail-body').forEach((panel) => {
          panel.hidden = panel.getAttribute('data-dpanel') !== id
        })
      })
    })

    root.querySelectorAll('.container-row[data-cid]').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-cid')
        view.containers.forEach((c) => {
          c.active = c.id === id
        })
        // re-render to refresh detail pane
        const h = host()
        if (isDockerMode(h)) renderMain(h)
      })
    })
  }

  function renderMain(h) {
    // Docker replaces terminal host content area like real app (terminal stays mounted under v-show)
    const subBar = els.terminalHost.querySelector('.sub-tab-bar-wrap')
    const dockerView = DEMO.dockerView
    if (subBar) subBar.hidden = false
    if (isDockerMode(h) && dockerView) {
      els.mainPane.innerHTML = renderDocker(dockerView)
      bindDockerInteractions(dockerView)
    } else {
      els.mainPane.innerHTML = renderTerminal(h.terminal)
    }
  }

  function renderMonitor(h) {
    const show = effectiveMonitor(h)
    if (!show || !h.monitorMetrics) {
      els.monitorDock.hidden = true
      return
    }
    const m = h.monitorMetrics
    els.monitorDock.hidden = false
    els.monitorMetrics.innerHTML = `
      <div class="dock-chip">
        <span class="dock-chip-text">${escapeHtml(m.host)}</span>
      </div>
      <div class="dock-metric">
        <span class="dock-metric-label">CPU</span>
        <div class="dock-bar"><div class="dock-bar-fill" style="width:${m.cpu}%;background:${barColor(m.cpu)}"></div></div>
        <span class="dock-metric-value" style="color:${barColor(m.cpu)}">${m.cpu}%</span>
      </div>
      <div class="dock-metric">
        <span class="dock-metric-label">内存</span>
        <div class="dock-bar"><div class="dock-bar-fill" style="width:${m.mem}%;background:${barColor(m.mem)}"></div></div>
        <span class="dock-metric-value" style="color:${barColor(m.mem)}">${m.mem}%</span>
      </div>
      <div class="dock-metric">
        <span class="dock-metric-label">磁盘</span>
        <div class="dock-bar"><div class="dock-bar-fill" style="width:${m.disk}%;background:${barColor(m.disk)}"></div></div>
        <span class="dock-metric-value" style="color:${barColor(m.disk)}">${m.disk}%</span>
      </div>
      <div class="dock-chip">
        <span class="dock-metric-label">负载</span>
        <span class="dock-metric-value">${escapeHtml(m.load)}</span>
      </div>`
  }

  function highlightSql(sql) {
    return escapeHtml(sql)
      .replace(
        /\b(SELECT|FROM|WHERE|ORDER BY|DESC|ASC|LIMIT|AND|OR|USE)\b/gi,
        '<span class="kw">$1</span>',
      )
      .replace(/(^|\n)(--[^\n]*)/g, '$1<span class="cm">$2</span>')
      .replace(/'([^']*)'/g, '<span class="str">\'$1\'</span>')
  }

  /** Full-page DatabaseView shell (from website/db.txt + DatabaseView.vue) */
  function renderDatabase() {
    const db = DEMO.database
    const engine = db.engine || 'mysql'

    const connBlocks = (db.connections || [])
      .map((c) => {
        const rowCls = [
          'nav-conn-row',
          c.active ? 'active focused' : '',
          c.expanded ? 'expanded' : '',
        ]
          .filter(Boolean)
          .join(' ')
        const children =
          c.expanded && c.dbs?.length
            ? `<div class="nav-conn-children">
                ${c.dbs
                  .map(
                    (name, i) => `
                  <div class="bk-db-block">
                    <button type="button" class="bk-db-row${i === 2 ? ' active' : ''}">
                      ${icon('chevron-right', 'xs', 'bk-chevron')}
                      ${icon('database', 'sm', 'bk-ico')}
                      <span class="bk-name">${escapeHtml(name)}</span>
                    </button>
                  </div>`,
                  )
                  .join('')}
              </div>`
            : ''
        return `
          <div class="nav-conn-block">
            <div class="${rowCls}">
              ${icon('chevron-right', 'xs', `bk-chevron${c.expanded ? ' open' : ''}`)}
              <span class="nav-conn-icon">${icon('database', 'sm')}</span>
              <span class="nav-conn-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
              <span class="nav-status-slot">
                ${c.live ? '<span class="nav-live-dot" title="已连接"></span>' : ''}
              </span>
            </div>
            ${children}
          </div>`
      })
      .join('')

    const resultRows = (db.rows || [])
      .map(
        (row) =>
          `<tr>${row
            .map((cell, i) => {
              const isStatus = db.columns[i] === 'status'
              return `<td class="${isStatus ? 'tag' : ''}">${escapeHtml(cell)}</td>`
            })
            .join('')}</tr>`,
      )
      .join('')

    els.dbShell.innerHTML = `
      <div class="bk-workspace">
        <header class="bk-topbar">
          <div class="bk-topbar-left">
            <span class="bk-engine-badge sm ${escapeHtml(engine)}">${escapeHtml(engine.toUpperCase())}</span>
            <strong class="bk-conn-name">${escapeHtml(db.connName)}</strong>
            <span class="bk-top-meta">${escapeHtml(db.meta)}</span>
          </div>
          <div class="bk-topbar-right">
            <button type="button" class="ui-btn ui-btn-sm">新建查询</button>
            <button type="button" class="ui-btn ui-btn-sm">导入 SQL</button>
            <button type="button" class="ui-btn ui-btn-sm ui-btn-danger">断开当前</button>
          </div>
        </header>

        <div class="bk-main">
          <aside class="bk-sidebar">
            <div class="bk-sidebar-head">
              <span>数据库</span>
              <div class="nav-head-actions">
                <button type="button" class="ui-icon-btn" title="导入连接">${icon('download', 'sm')}</button>
                <button type="button" class="ui-icon-btn" title="导出连接">${icon('upload', 'sm')}</button>
                <button type="button" class="ui-icon-btn" title="新建连接">${icon('plus', 'sm')}</button>
              </div>
            </div>
            <div class="bk-sidebar-search">
              <input type="text" placeholder="筛选连接 / 库…" readonly />
            </div>
            <div class="bk-sidebar-scroll">
              ${connBlocks}
            </div>
          </aside>

          <div class="bk-editor">
            <div class="bk-tabs" role="tablist">
              <div class="bk-tab active" title="连接：${escapeHtml(db.tabConn)}">
                <span class="bk-tab-kind query">查</span>
                <span class="bk-tab-conn" title="${escapeHtml(db.meta)}">${escapeHtml(db.tabConn)}</span>
                <span class="bk-tab-title">${escapeHtml(db.tabTitle)}</span>
                <button type="button" class="bk-tab-x" aria-label="关闭">${icon('close', 'xs')}</button>
              </div>
              <button type="button" class="bk-tab add" title="新建查询">${icon('plus', 'sm')}</button>
            </div>

            <div class="query-split">
              <div class="query-top">
                <div class="query-context-bar">
                  <div class="query-conn-chip" title="${escapeHtml(db.meta)}">
                    <span class="query-conn-label">连接</span>
                    <span class="query-conn-name">${escapeHtml(db.tabConn)}</span>
                  </div>
                  <span class="query-ctx-sep">|</span>
                  <div class="db-picker-wrap">
                    <button type="button" class="db-picker-btn" title="选择本查询在哪个库上执行（USE）">
                      <span class="db-picker-label">库</span>
                      <span class="db-picker-value">${escapeHtml(db.defaultDb || 'shop')}</span>
                      <span class="db-picker-caret">${icon('chevron-down', 'xs')}</span>
                    </button>
                  </div>
                  <span class="query-ctx-sep">|</span>
                  <button type="button" class="saved-picker-btn">SQL 脚本</button>
                  <div class="ctx-tx-actions">
                    <button type="button" class="ui-btn ui-btn-xs">自动提交</button>
                    <button type="button" class="ui-btn ui-btn-xs">开始事务</button>
                  </div>
                </div>

                <div class="query-editor-row">
                  <div class="query-action-rail">
                    <div class="rail-run-group">
                      <button type="button" class="rail-btn primary" title="运行">${icon('play', 'sm')}</button>
                      <span class="rail-scope-label">${escapeHtml(db.runScope || '全部')}</span>
                    </div>
                    <span class="rail-divider"></span>
                    <button type="button" class="rail-btn" title="执行计划">${icon('query-plan', 'sm')}</button>
                    <button type="button" class="rail-btn" title="取消">${icon('stop', 'sm')}</button>
                  </div>
                  <div class="editor-main">
                    <pre class="sql-cm-host">${highlightSql(db.sql)}</pre>
                  </div>
                </div>
                <div class="query-status-bar">
                  <span>${escapeHtml(db.editorStatus || '1:1')}</span>
                  <span>执行选区/语句: Ctrl + Enter</span>
                </div>
              </div>

              <div class="query-split-bar" aria-hidden="true"></div>

              <div class="query-bottom">
                <div class="query-output">
                  <div class="output-tabs">
                    <button type="button" class="output-tab active" data-out="result">结果</button>
                    <button type="button" class="output-tab" data-out="message">消息</button>
                    <button type="button" class="output-tab" data-out="plan">执行计划</button>
                    <button type="button" class="output-tab" data-out="history">历史</button>
                  </div>
                  <div class="output-body" data-panel="result">
                    <div class="result-toolbar">
                      <span>3 行 · 42ms</span>
                      <span class="result-toolbar-actions">
                        <button type="button" class="ui-btn ui-btn-xs">复制</button>
                        <button type="button" class="ui-btn ui-btn-xs">CSV</button>
                        <button type="button" class="ui-btn ui-btn-xs">JSON</button>
                      </span>
                    </div>
                    <div class="db-result-grid">
                      <table>
                        <thead><tr>${(db.columns || []).map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
                        <tbody>${resultRows}</tbody>
                      </table>
                    </div>
                  </div>
                  <div class="output-body" data-panel="history" hidden>
                    <div class="history-panel-inline">
                      <div class="history-head">
                        <span>查询历史</span>
                        <button type="button" class="ui-btn ui-btn-xs">清空</button>
                      </div>
                      ${(db.history || [])
                        .map(
                          (h) => `
                        <div class="history-item">
                          <span class="history-meta">${escapeHtml(h.time)}</span>
                          <span class="history-ms">${escapeHtml(h.ms)}</span>
                          <span class="history-rows">${escapeHtml(h.rows)}</span>
                          <span class="history-status ${h.ok ? 'ok' : 'err'}">${h.ok ? '成功' : '失败'}</span>
                        </div>`,
                        )
                        .join('')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer class="bk-statusbar">${escapeHtml(db.footer || '')}</footer>
      </div>`

    // output tab switching within DB demo
    els.dbShell.querySelectorAll('.output-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const id = tab.getAttribute('data-out')
        els.dbShell.querySelectorAll('.output-tab').forEach((t) => t.classList.remove('active'))
        tab.classList.add('active')
        els.dbShell.querySelectorAll('.output-body').forEach((body) => {
          const panel = body.getAttribute('data-panel')
          body.hidden = !(panel === id || (id === 'result' && panel === 'result') || (id === 'history' && panel === 'history'))
          // show result for message/plan as simple empty state
          if (id === 'message' || id === 'plan') {
            if (panel === 'result') {
              body.hidden = false
              body.querySelector('.db-result-grid')?.classList.add('is-placeholder')
            }
          } else {
            body.querySelector('.db-result-grid')?.classList.remove('is-placeholder')
          }
        })
        if (id === 'result') {
          const r = els.dbShell.querySelector('.output-body[data-panel="result"]')
          if (r) r.hidden = false
          const h = els.dbShell.querySelector('.output-body[data-panel="history"]')
          if (h) h.hidden = true
        }
        if (id === 'history') {
          const r = els.dbShell.querySelector('.output-body[data-panel="result"]')
          if (r) r.hidden = true
          const h = els.dbShell.querySelector('.output-body[data-panel="history"]')
          if (h) h.hidden = false
        }
      })
    })
  }

  function applyAppMode() {
    const isSsh = appMode === 'ssh'
    const appRoot = document.getElementById('app')

    // Class-driven exclusive layout (mirrors App.vue v-show on mode)
    if (appRoot) {
      appRoot.classList.toggle('mode-ssh', isSsh)
      appRoot.classList.toggle('mode-database', !isSsh)
    }

    els.modeLabel.textContent = isSsh ? 'SSH' : 'DB'
    // Attribute + class: ensure SSH shell is fully unmounted from layout in DB mode
    els.workspaceTop.hidden = !isSsh
    els.sshWorkspace.hidden = !isSsh
    els.dbWorkspace.hidden = isSsh
    els.sshWorkspace.setAttribute('aria-hidden', isSsh ? 'false' : 'true')
    els.dbWorkspace.setAttribute('aria-hidden', isSsh ? 'true' : 'false')

    if (isSsh) {
      const h = host()
      els.titlebarConn.textContent = h.titlebar
      renderHostTabs()
      renderToolbar(h)
      renderSide(h)
      renderSubTabs(h)
      renderMain(h)
      renderMonitor(h)
    } else {
      // Full-page DB module — no host tabs, no left toolbar, no SSH chrome
      els.titlebarConn.textContent = DEMO.database.titlebar
      renderDatabase()
    }

    try {
      sessionStorage.setItem('liteconnect.demo', JSON.stringify({ appMode, activeHostId }))
    } catch {
      /* ignore */
    }
  }

  function selectHost(id) {
    if (!DEMO.hosts.some((h) => h.id === id)) return
    activeHostId = id
    appMode = 'ssh'
    applyAppMode()
  }

  /* Events */
  els.hostTabs.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) {
      e.stopPropagation()
      return
    }
    const tab = e.target.closest('[data-host]')
    if (tab) selectHost(tab.dataset.host)
  })

  els.homeBtn.addEventListener('click', () => {
    // Demo: home just highlights; real app shows ConnectionsView
    els.homeBtn.classList.add('active')
    window.setTimeout(() => els.homeBtn.classList.remove('active'), 400)
  })

  els.modeToggle.addEventListener('click', () => {
    appMode = appMode === 'ssh' ? 'database' : 'ssh'
    applyAppMode()
  })

  els.leftToolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.toolbar-icon-btn')
    if (!btn || btn.disabled) return
    const h = host()
    const tool = btn.dataset.tool

    if (tool === 'docker') {
      dockerOverride[h.id] = isDockerMode(h) ? 'open' : 'active'
      applyAppMode()
      return
    }

    if (tool === 'ai' || tool === 'sftp') {
      const cur = effectiveTool(h)
      toolOverride[h.id] = cur === tool ? null : tool
      // AI and SFTP are exclusive in real app (AI panel vs file sidebar)
      applyAppMode()
      return
    }

    if (tool === 'monitor') {
      monitorOverride[h.id] = !effectiveMonitor(h)
      applyAppMode()
    }
  })

  els.sidePanel.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-side]')) {
      toolOverride[activeHostId] = null
      applyAppMode()
    }
  })

  els.monitorDock.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-monitor]')) {
      monitorOverride[activeHostId] = false
      applyAppMode()
    }
  })

  els.mainPane.addEventListener('click', (e) => {
    if (e.target.closest('[data-back-terminal]')) {
      dockerOverride[activeHostId] = 'open'
      applyAppMode()
    }
  })

  els.subTabs.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-docker]')) {
      dockerOverride[activeHostId] = false
      applyAppMode()
      return
    }
    const tab = e.target.closest('.sub-tab')
    if (!tab || e.target.closest('.sub-tab-close')) return
    if (tab.dataset.sub === 'docker') {
      dockerOverride[activeHostId] = 'active'
      applyAppMode()
      return
    }
    dockerOverride[activeHostId] = isDockerTabOpen(host()) ? 'open' : false
    applyAppMode()
    els.subTabs.querySelectorAll('.sub-tab').forEach((el) => el.classList.remove('active'))
    tab.classList.add('active')
  })

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return
    if (e.key === 'd' || e.key === 'D') {
      if (e.ctrlKey || e.metaKey) return
      appMode = appMode === 'ssh' ? 'database' : 'ssh'
      applyAppMode()
      return
    }
    const n = Number(e.key)
    if (n >= 1 && n <= DEMO.hosts.length) {
      e.preventDefault()
      selectHost(DEMO.hosts[n - 1].id)
    }
  })

  /* Init */
  try {
    const saved = JSON.parse(sessionStorage.getItem('liteconnect.demo') || '{}')
    if (saved.appMode === 'ssh' || saved.appMode === 'database') appMode = saved.appMode
    if (saved.activeHostId && DEMO.hosts.some((h) => h.id === saved.activeHostId)) {
      activeHostId = saved.activeHostId
    }
  } catch {
    /* ignore */
  }

  applyAppMode()
})()
