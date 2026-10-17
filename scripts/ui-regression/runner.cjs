const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'liteconnect-ui-'))
app.setPath('userData', path.join(artifacts, 'profile'))
// Includes 200-turn stress coverage, images, model controls, background jobs,
// grouped host picking and independently scrolling conversation sections.
// Individual UI conditions still fail after 15 seconds.
const suiteTimeoutMs = 300_000
let lastAction = 'loading test page'
const watchdog = setTimeout(() => {
  console.error(`UI regression timed out after ${suiteTimeoutMs / 1000} seconds`, { lastAction, artifacts })
  app.exit(1)
}, suiteTimeoutMs)

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false, width: 1200, height: 1000,
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
  })
  const run = async (source) => {
    lastAction = source.slice(0, 180)
    const result = await window.webContents.executeJavaScript(`(async () => {
      try { return { ok: true, value: await (${source}) }; }
      catch (error) { return { ok: false, error: error.stack || String(error) }; }
    })()`)
    if (!result.ok) throw new Error(`${result.error}\nRenderer expression: ${source.slice(0, 180)}`)
    return result.value
  }
  const waitFor = async (expression) => {
    const deadline = Date.now() + 15_000
    while (!await run(`Boolean(${expression})`)) {
      if (Date.now() > deadline) {
        const state = await run(`({
          error:window.__uiError,
          notices:Array.from(document.querySelectorAll('.el-message')).map(el=>el.textContent),
          bookmarkWidth:document.querySelector('.bookmark-menu')?.getBoundingClientRect().width,
          sidebarWidth:document.querySelector('.file-sidebar')?.getBoundingClientRect().width,
          activity:document.querySelector('.activity-status')?.textContent,
          scheduleError:document.querySelector('.schedule-error')?.textContent,
          scroll:document.querySelector('.ai-fixture .chat-list')?.scrollTop,
          focused:document.activeElement?.outerHTML.slice(0,400),
        })`)
        throw new Error(`Timed out waiting for ${expression}: ${JSON.stringify(state)}`)
      }
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  const saveScreenshot = async (name) => {
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await window.webContents.capturePage()
    await new Promise(resolve => setTimeout(resolve, 100))
    const zoom = window.webContents.getZoomFactor()
    const cropSelector = name.startsWith('lite-ai-') ? '.lite-ai-workspace-fixture' : name.startsWith('ai-settings-panel-') ? '.ai-image-composer-fixture' : name.startsWith('ai-background-result-') ? '.ai-fixture' : null
    const rect = cropSelector ? await run(`(() => {
      const r=document.querySelector('${cropSelector}').getBoundingClientRect();
      const x=Math.max(0,Math.floor(r.left)),y=Math.max(0,Math.floor(r.top));
      return {x:Math.floor(x*${zoom}),y:Math.floor(y*${zoom}),width:Math.max(1,Math.floor((Math.min(r.right,innerWidth)-x)*${zoom})),height:Math.max(1,Math.floor((Math.min(r.bottom,innerHeight)-y)*${zoom}))};
    })()`) : undefined
    fs.writeFileSync(path.join(artifacts, name), (await window.webContents.capturePage(rect)).toPNG())
  }
  const openSettingsSection = async (id) => {
    if (await run('!!document.querySelector(".settings-box.is-panel") && !document.querySelector(".settings-category")')) {
      await run('document.querySelector(".settings-panel-header > button").click()')
      await waitFor('document.querySelector(".settings-category")')
    }
    await run(`document.querySelector('.settings-box [data-section="${id}"]').click()`)
    await waitFor(`document.querySelector('.settings-content[data-section="${id}"]')`)
  }
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await waitFor('window.__uiRegression && document.querySelector(".connection-row")')
  assert.equal(await run('window.__uiError || null'), null)
  await run(`(() => {for(const box of document.querySelectorAll('.sync-target input')) {box.click()}})()`)
  await run(`Array.from(document.querySelectorAll('.sync-heading button')).find(button=>button.textContent.includes('开启同步')).click()`)
  await waitFor('document.querySelector(".sync-status")?.textContent.includes("2")')
  await run('window.__uiRegression.sendSynchronizedInput("echo hello\\r")')
  assert.deepEqual(await run('window.__uiRegression.synchronizedWrites'), ['two:echo hello\r'], 'Synchronized input reaches the selected peer once')
  await run(`Array.from(document.querySelectorAll('.sync-heading button')).find(button=>button.textContent.includes('停止同步')).click()`)
  await run('window.__uiRegression.sendSynchronizedInput("ignored")')
  assert.equal(await run('window.__uiRegression.synchronizedWrites.length'), 1, 'Stopping immediately stops forwarding')
  assert.deepEqual(await run(`Array.from(document.querySelectorAll('.group-block')).map(block=>({
    name:block.querySelector('.group-name').textContent,
    active:block.querySelector('.group-item').classList.contains('active'),
    expanded:block.querySelector('.collapse-btn').getAttribute('aria-expanded'),
    connections:block.querySelectorAll('.sidebar-conn').length,
  }))`), [
    {name:'默认分组',active:true,expanded:'true',connections:1},
    {name:'生产环境 Production',active:false,expanded:'false',connections:0},
  ], 'The initially selected default group expands while other groups remain collapsed')
  await run(`document.querySelector('.group-item.active .collapse-btn').click()`)
  await waitFor('document.querySelectorAll(".group-connections").length === 0')
  assert.equal(await run('document.querySelector(".group-item.active .group-name").textContent'), '默认分组', 'Manually collapsing the current group preserves its selection')
  await run(`document.querySelector('.group-item.active').click()`)
  await waitFor('document.querySelector(".group-item.active .collapse-btn").getAttribute("aria-expanded") === "true"')
  await run(`document.querySelectorAll('.group-item')[1].click()`)
  await waitFor('document.querySelectorAll(".group-item")[1].classList.contains("active") && document.querySelectorAll(".group-item .collapse-btn")[1].getAttribute("aria-expanded") === "true"')
  assert.equal(await run('document.querySelectorAll(".group-block")[1].querySelector(".sidebar-conn .sidebar-conn-name").textContent'), '服务器二 Server two', 'Selecting another group expands its own connections')
  await run(`document.querySelector('.group-item').click()`)
  await run(`document.querySelectorAll('.group-item .collapse-btn')[1].click()`)
  await waitFor('document.querySelectorAll(".group-item")[0].classList.contains("active") && document.querySelectorAll(".group-item .collapse-btn")[1].getAttribute("aria-expanded") === "false"')
  await run('window.__uiRegression.setConnectionStage("keyboard")')
  await waitFor('document.querySelector(".connection-row").textContent.includes("等待验证码")')
  await run('document.querySelector(".connection-row .action-btn.connect").click()')
  assert.deepEqual(await run('window.__uiRegression.cancelledConnections'), ['one'], 'Pending connection exposes a direct cancel action')
  assert.deepEqual(await run('window.__uiRegression.calls.connects'), [], 'Cancel does not start another connection')
  await run('window.__uiRegression.setConnectionStage()')
  for (const zoom of [0.92, 1, 1.08]) {
    window.webContents.setZoomFactor(zoom)
    await window.webContents.capturePage()
    for (const label of ['默认分组', 'Production', '生产环境 Production '.repeat(12)]) {
      const heading = await run(`(() => {
        const title=document.querySelector('.page-title');const pill=document.querySelector('.page-group-pill');
        pill.textContent=${JSON.stringify(label)};
        const marker=()=>{const el=document.createElement('span');el.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';return el};
        const a=marker(),b=marker();title.append(a);pill.append(b);
        const result={gap:Math.abs(a.getBoundingClientRect().top-b.getBoundingClientRect().top),
          overflow:pill.getBoundingClientRect().right>document.querySelector('.page-title-row').getBoundingClientRect().right+1,
          ellipsis:getComputedStyle(pill).textOverflow};
        a.remove();b.remove();return result;
      })()`)
      assert.ok(heading.gap < 1 && !heading.overflow && heading.ellipsis === 'ellipsis', `Heading label baseline at ${zoom}: ${JSON.stringify(heading)}`)
    }
  }
  window.webContents.setZoomFactor(1)
  await run('document.querySelector(".page-group-pill").textContent="默认分组"')
  assert.equal(await run('(() => {const label=document.querySelector(".group-name");return label.scrollWidth <= label.clientWidth})()'), true, 'Short default group name is fully visible')
  await run('document.querySelector(".toolbar-more-button").click()')
  await waitFor('document.querySelector(".toolbar-menu")')
  await waitFor('document.querySelector(".toolbar-menu").contains(document.activeElement)')
  assert.equal(await run('document.querySelectorAll(".toolbar-menu button").length'), 3, 'Secondary toolbar actions remain available')
  const dropdownStyle = `(() => {const style=getComputedStyle(document.querySelector('.dropdown-menu'));return {background:style.backgroundColor,border:style.border,radius:style.borderRadius,shadow:style.boxShadow,padding:style.padding}})()`
  const actionMenuStyle = await run(dropdownStyle)
  await run('(() => {const button=document.querySelector(".toolbar-menu button:not(:disabled)");button.focus();button.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))})()')
  await waitFor('!document.querySelector(".toolbar-menu")')
  await waitFor('document.activeElement === document.querySelector(".toolbar-more-button")')
  await run('document.querySelector(".search-scope .dropdown-trigger").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true}))')
  await waitFor('document.querySelector(".scope-menu")?.contains(document.activeElement)')
  assert.deepEqual(await run(dropdownStyle), actionMenuStyle, 'Scope and action menus share the same themed surface')
  await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))')
  await waitFor('!document.querySelector(".scope-menu") && document.activeElement === document.querySelector(".search-scope .dropdown-trigger")')
  const themeCases = [
    ['dark'], ['light'], ['eyecare'],
    ['custom', {fontColor:'#ead9f5', bgColor:'#291a34'}],
    ['custom', {fontColor:'#3c2449', bgColor:'#f5e9fa'}],
  ]
  for (const [theme, colors] of themeCases) {
    await run(`window.__uiRegression.setTheme(${JSON.stringify(theme)},${JSON.stringify(colors) || 'undefined'})`)
    await run('(() => {const row=document.querySelector(".connection-row");row.style.transition="none";row.classList.add("keyboard-active")})()')
    const state = await run(`(() => {
      const root=document.documentElement;
      const row=document.querySelector('.connection-row'); row.classList.add('keyboard-active');
      const chip=document.querySelector('.tag-filter-chip.active');
      const probe=document.createElement('span'); probe.style.background='var(--accent-bg)'; document.body.append(probe);
      const result={ background:getComputedStyle(row).backgroundColor, expected:getComputedStyle(probe).backgroundColor,
        tag:getComputedStyle(row).borderLeftColor, chipText:getComputedStyle(chip).color, text:getComputedStyle(root).getPropertyValue('--text-primary').trim() };
      probe.remove(); return result;
    })()`)
    assert.equal(state.background, state.expected, `${theme} selection follows its theme token`)
    assert.notEqual(state.tag, state.background, 'Connection tag remains distinct from selected background')
    assert.ok(state.chipText, 'Selected filter retains theme text')
    const actions = await run(`Array.from(document.querySelectorAll('.connection-row .secondary-action')).map(el => ({opacity:getComputedStyle(el).opacity,pointerEvents:getComputedStyle(el).pointerEvents}))`)
    assert.equal(actions.length, 4, 'Copy, edit, pin and more actions remain discoverable')
    assert.ok(actions.every(action => action.opacity === '1' && action.pointerEvents !== 'none'), `${theme} row actions are visible and clickable without hover`)
    if (theme === 'custom') {
      await run('document.documentElement.style.setProperty("--accent", "#ae49e1")')
      await new Promise(resolve => setTimeout(resolve, 160))
      const dynamic = await run(`(() => {const row=document.querySelector('.connection-row');const probe=document.createElement('span');probe.style.background='var(--accent-bg)';document.body.append(probe);const result={row:getComputedStyle(row).backgroundColor,expected:getComputedStyle(probe).backgroundColor};probe.remove();return result})()`)
      assert.equal(dynamic.row, dynamic.expected, 'Runtime accent overrides update selected rows')
    }
  }
  await run('window.__uiRegression.setTheme("dark")')
  const resizeBefore = await run('Number(document.querySelector(".group-panel-resizer").getAttribute("aria-valuenow"))')
  await run('document.querySelector(".group-panel-resizer").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,cancelable:true}))')
  assert.equal(await run('Number(document.querySelector(".group-panel-resizer").getAttribute("aria-valuenow"))'), resizeBefore + 10, 'Sidebar width adjusts with the keyboard')
  await run('document.querySelector(".group-panel-resizer").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true,cancelable:true}))')
  const grip = await run('(() => {const r=document.querySelector(".group-panel-resizer").getBoundingClientRect();return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+40)}})()')
  window.webContents.sendInputEvent({type:'mouseMove', ...grip})
  window.webContents.sendInputEvent({type:'mouseDown', ...grip, button:'left', clickCount:1})
  window.webContents.sendInputEvent({type:'mouseMove', x:grip.x+30, y:grip.y})
  window.webContents.sendInputEvent({type:'mouseUp', x:grip.x+30, y:grip.y, button:'left', clickCount:1})
  await waitFor(`Number(document.querySelector('.group-panel-resizer').getAttribute('aria-valuenow')) === ${resizeBefore + 30}`)
  await run('document.querySelector(".group-panel-resizer").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",shiftKey:true,bubbles:true,cancelable:true}))')
  window.setSize(740, 1000)
  await window.webContents.capturePage()
  await waitFor('window.innerWidth < 800')
  assert.equal(await run('document.querySelector(".connections-page").scrollWidth <= document.querySelector(".connections-page").clientWidth + 1'), true, 'Narrow window does not overflow horizontally')
  await saveScreenshot('connections-narrow.png')
  window.setSize(1200, 1000)
  await window.webContents.capturePage()
  await waitFor('window.innerWidth > 1000')
  await saveScreenshot('connections-dark.png')
  await run('window.__uiRegression.setTheme("light")')
  await saveScreenshot('connections-light.png')
  await run('document.querySelector(".search-scope .dropdown-trigger").click()')
  await waitFor('document.querySelector(".scope-menu")?.contains(document.activeElement)')
  await saveScreenshot('scope-menu-light.png')
  await run('(() => {const button=document.querySelector(".toolbar-more-button");button.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));button.click()})()')
  await waitFor('document.querySelector(".toolbar-menu") && !document.querySelector(".scope-menu")')
  await saveScreenshot('action-menu-light.png')
  await run('document.querySelector(".toolbar-more-button").click()')
  await run('window.__uiRegression.setTheme("dark")')

  assert.equal(await run('document.querySelector(".sort-label").tabIndex'), -1, 'Sort description is not an interactive control')
  for (const label of ['最近使用', '最常使用', '手动排序']) {
    await run(`Array.from(document.querySelectorAll('.sort-option')).find(button=>button.textContent.trim()===${JSON.stringify(label)}).click()`)
    await waitFor(`document.querySelector('.sort-option[aria-pressed=true]')?.textContent.trim()===${JSON.stringify(label)}`)
    assert.equal(await run('document.querySelectorAll(".sort-option[aria-pressed=true]").length'), 1, 'Exactly one sort option is selected')
  }

  await run(`(() => {
    const input = document.querySelector('.search-input');
    input.value = 'Server'; input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  await waitFor('document.querySelectorAll(".connection-row").length === 1')
  await run('document.querySelector(".search-scope .dropdown-trigger").click()')
  await waitFor('document.querySelector(".scope-menu [aria-checked=true]")')
  assert.equal(await run('document.querySelector(".scope-menu [aria-checked=true]").dataset.value'), 'group', 'Scope menu marks the current selection')
  await waitFor('document.querySelector(".scope-menu").contains(document.activeElement)')
  await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true}))')
  assert.equal(await run('document.activeElement.dataset.value'), 'all', 'Arrow keys move through scope options')
  await run('document.activeElement.click()')
  await waitFor('document.querySelectorAll(".connection-row").length === 2')
  assert.equal(await run('document.querySelectorAll(".conn-group").length'), 2, 'Global results show their groups')

  await run(`(() => {
    const input = document.querySelector('.search-input'); input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true}));
  })()`)
  assert.deepEqual(await run('window.__uiRegression.calls.connects'), ['one'], 'Enter connects the first result')

  const dragResult = await run(`(() => {
    const row = document.querySelector('.connection-row');
    const name = row.querySelector('.conn-name');
    name.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
    const transfer = new DataTransfer();
    name.dispatchEvent(new DragEvent('dragstart', {bubbles:true,cancelable:true,dataTransfer:transfer}));
    const id = transfer.getData('application/x-lite-connect-conn');
    const target = document.querySelectorAll('.group-item')[1];
    target.dispatchEvent(new DragEvent('dragover', {bubbles:true,cancelable:true,dataTransfer:transfer}));
    target.dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:transfer}));
    row.dispatchEvent(new DragEvent('dragend', {bubbles:true,dataTransfer:transfer}));
    return id;
  })()`)
  assert.equal(dragResult, 'one', 'The card text starts a connection drag')
  await waitFor('window.__uiRegression.calls.moves.length === 1')
  assert.deepEqual(await run('window.__uiRegression.calls.moves'), ['one:prod'], 'Searching allows moves to a collapsed group')
  assert.equal(await run('window.__uiRegression.calls.reorders'), 0, 'Moving global results does not reorder connections')

  assert.equal(await run(`(() => {
    const row = document.querySelector('.connection-row');
    row.querySelector('.action-btn').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
    return row.dispatchEvent(new DragEvent('dragstart', {bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}));
  })()`), false, 'Dragging from action buttons is prevented')
  await run('document.querySelector(".group-item").click()')
  await waitFor('document.querySelector(".search-scope").dataset.value === "group"')

  for (const width of [280, 320, 360, 600]) {
    for (const name of ['config.log', '协同管理软件_安装日志_Production_'.repeat(12) + '.log']) {
      await run(`window.__uiRegression.setTreeName(${JSON.stringify(name)})`)
      const treeBounds = await run(`(() => {
        const pane=document.querySelector('.sftp-tree-fixture');pane.style.width='${width}px';
        const tree=pane.querySelector('.sftp-dir-tree'),row=tree.querySelector('.tree-row');
        const label=row.querySelector('.tree-name'),actions=row.querySelector('.tree-quick-actions');
        const box=tree.getBoundingClientRect();
        return {width:pane.getBoundingClientRect().width,overflow:tree.scrollWidth>tree.clientWidth,
          actionsInside:actions.getBoundingClientRect().right<=box.right+1,
          truncated:label.scrollWidth>label.clientWidth,ellipsis:getComputedStyle(label).textOverflow,title:row.title};
      })()`)
      assert.equal(treeBounds.width, width, 'File names do not change the requested SFTP width')
      assert.ok(!treeBounds.overflow && treeBounds.actionsInside, `SFTP tree fits at ${width}: ${JSON.stringify(treeBounds)}`)
      assert.equal(treeBounds.title, '/' + name, 'The full path remains available on hover')
      if (name.length > 100) assert.ok(treeBounds.truncated && treeBounds.ellipsis === 'ellipsis', 'Long file names truncate within the row')
    }
    await run(`(() => {const fixture=document.querySelector('.sftp-toolbar-fixture');fixture.style.width='${width}px';fixture.scrollIntoView({block:'center'})})()`)
    const bounds = await run(`(() => {
      const toolbar=document.querySelector('.sftp-toolbar-fixture .navigation-actions');const box=toolbar.getBoundingClientRect();
      const controls=Array.from(toolbar.querySelectorAll('button')).filter(button=>getComputedStyle(button).display!=='none');
      return {count:controls.length,inside:controls.every(button=>{const r=button.getBoundingClientRect();return r.left>=box.left-1 && r.right<=box.right+1}),
        binding:getComputedStyle(toolbar.querySelector('.sftp-binding')).display};
    })()`)
    assert.ok(bounds.inside && bounds.count === 7, `SFTP toolbar fits at ${width}: ${JSON.stringify(bounds)}`)
    assert.equal(bounds.binding === 'none', width < 340, 'Binding badge yields space on narrow panes')
    await run('document.querySelector(".sftp-toolbar-more .dropdown-trigger").click()')
    await waitFor('document.querySelector(".sftp-toolbar-menu")')
    assert.equal(await run('document.querySelectorAll(".sftp-toolbar-menu button").length'), 3, 'Secondary SFTP actions remain available')
    assert.equal(await run(`(() => {const menu=document.querySelector('.sftp-toolbar-menu').getBoundingClientRect();const pane=document.querySelector('.sftp-toolbar-fixture').getBoundingClientRect();return menu.left>=pane.left-1 && menu.right<=pane.right+1})()`), true, 'Overflow menu fits within the pane')
    if (width === 280) await saveScreenshot('sftp-toolbar-narrow.png')
    await run('document.querySelector(".sftp-toolbar-more .dropdown-trigger").click()')
  }
  for (const action of ['collapse-tree', 'upload-folder', 'directory-sync']) {
    await run('document.querySelector(".sftp-toolbar-more .dropdown-trigger").click()')
    await waitFor('document.querySelector(".sftp-toolbar-menu")')
    await run(`document.querySelector('.sftp-toolbar-menu [data-value="${action}"]').click()`)
    await waitFor('!document.querySelector(".sftp-toolbar-menu")')
  }
  assert.deepEqual(await run('window.__uiRegression.calls.sftpActions'), ['collapse-tree', 'upload-folder', 'directory-sync'], 'Overflow actions dispatch their original events')
  await run('document.querySelector(".regression-root").scrollTop=0')

  await run('window.__uiRegression.openBookmarks()')
  await waitFor('document.querySelector(".bookmark-menu.ready")')
  await run('document.querySelector(".bookmark-more").click()')
  await waitFor('document.querySelector(".bookmark-row-menu")')
  await run('document.querySelector(".bookmark-row-menu .ui-menu-item").click()')
  await waitFor('document.querySelector(".bookmark-name")?.textContent.startsWith("重命名后的")')

  let layoutCases = 0
  for (const zoom of [0.92, 1, 1.08]) {
    window.webContents.setZoomFactor(zoom)
    for (const width of [220, 260, 320]) {
      await run(`window.__uiRegression.setWidth(${width})`)
      await window.webContents.capturePage()
      await waitFor(`Math.abs(document.querySelector('.bookmark-menu').getBoundingClientRect().width - ${Math.min(320, Math.max(200, width - 12))}) < 2`)
      for (const name of ['logs', '服务器日志', 'Production 生产环境', '很长的重命名书签'.repeat(15)]) {
        await run(`window.__uiRegression.setName(${JSON.stringify(name)})`)
        const rows = await run(`Array.from(document.querySelectorAll('.bookmark-row')).map(row => {
          const name = row.querySelector('.bookmark-name');
          const path = row.querySelector('.bookmark-path');
          const textRect = el => { const range=document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect(); };
          return {
            gap: Math.abs(textRect(name).bottom - textRect(path).bottom),
            pathWidth: path.getBoundingClientRect().width,
            height: row.getBoundingClientRect().height,
            overflow: row.querySelector('.bookmark-more').getBoundingClientRect().right > row.getBoundingClientRect().right + 1,
            nowrap: getComputedStyle(name).whiteSpace === 'nowrap',
          };
        })`)
        for (const row of rows) {
          assert.ok(row.gap <= 2 && row.pathWidth > 0 && row.height <= 34 && !row.overflow && row.nowrap,
            `Bookmark layout failed: ${JSON.stringify({zoom,width,name,...row})}`)
          layoutCases++
        }
      }
    }
  }
  const label = await run(`(() => {
    const box = document.querySelector('.label-fixture');
    const count = box.querySelector('.fixture-count').getBoundingClientRect();
    const text = box.querySelector('.inline-label-text');
    return {overflow:count.right > box.getBoundingClientRect().right + 1,truncated:text.scrollWidth > text.clientWidth};
  })()`)
  assert.ok(!label.overflow && label.truncated, 'Long labels truncate while counts remain visible')
  await run('window.__uiRegression.closeBookmarks()')
  for (const [phase, label] of [['requesting','正在请求模型'],['reasoning','正在接收思考'],['tool','正在执行工具'],['approval','等待你确认操作']]) {
    await run(`window.__uiRegression.aiPhase('${phase}')`)
    await waitFor(`document.querySelector('.activity-line')?.textContent.includes('${label}')`)
    assert.equal(await run('document.querySelector(".activity-delay") !== null'), false, 'Active stages do not show a false delay')
  }
  await run("window.__uiRegression.aiPhase('reasoning', 31000)")
  await waitFor('document.querySelector(".activity-line")?.textContent.includes("等待模型") && document.querySelector(".activity-delay")')
  assert.equal(await run('document.querySelector(".reasoning-title")?.textContent.trim()'), '深度思考', 'Stale reasoning is no longer labelled as live')
  await run('window.__uiRegression.finishAi()')
  await waitFor('!document.querySelector(".activity-status")')
  const toolRuns = [
    { id: 'file', name: 'read_file', status: 'done', content: 'hello' },
    { id: 'exec', name: 'exec', status: 'done', content: JSON.stringify({ exitCode: 0, stdout: 'ok', truncated: true }) },
    { id: 'grep', name: 'grep', status: 'done', content: JSON.stringify({ matchCount: 0, content: '' }) },
    { id: 'job', name: 'exec', status: 'done', content: JSON.stringify({ jobId: 'job', status: 'running' }) },
    { id: 'error', name: 'exec', status: 'done', content: JSON.stringify({ exitCode: 1, stdout: '' }) },
  ].map(run => ({ args: '{}', isError: false, ...run }))
  await run(`window.__uiRegression.aiTools(${JSON.stringify(toolRuns)})`)
  await waitFor(`document.querySelectorAll('.ai-fixture .tool-run-state').length === 5`)
  assert.deepEqual(await run(`Array.from(document.querySelectorAll('.ai-fixture .tool-run-state')).map(el=>el.textContent.trim())`), ['执行成功', '执行成功', '执行成功', '已启动', '执行失败'], 'Tool outcomes use unified status labels')
  assert.equal(await run(`document.querySelector('.ai-fixture').textContent.includes('退出码')`), false, 'Tool cards show outcome without exposing any numeric exit codes')
  assert.ok(await run(`document.querySelector('.ai-fixture').textContent.includes('找到 0 处匹配')`), 'Empty search results retain their count')
  assert.ok(await run(`document.querySelector('.ai-fixture').textContent.includes('输出已截断')`), 'Truncation is separate from completion')
  for (const width of [300, 440]) {
    await run(`document.querySelector('.ai-fixture').style.width='${width}px'`)
    assert.ok(await run(`Array.from(document.querySelectorAll('.ai-fixture .tool-run-outcome')).every(el=>el.scrollWidth<=el.clientWidth+1)`), 'Tool status details fit narrow sidebars')
  }
  const backgroundResultNotice = 'Application completion\n' + JSON.stringify([
    { jobId: 'ok', command: 'wc -l /var/log/messages', status: 'completed', exitCode: 0, stdout: '19704363 journal\n372530 avahi-daemon', truncated: true },
    { jobId: 'failed', command: 'inspect-service --target=' + 'long-host-name-'.repeat(20), status: 'completed', exitCode: 1, stderr: 'service unavailable' },
    { jobId: 'timeout', command: 'inspect-process', status: 'timeout', error: 'command timed out' },
    { jobId: 'cancelled', command: 'inspect-logs', status: 'cancelled' },
  ])
  await run(`window.__uiRegression.aiBackgroundResults(${JSON.stringify(backgroundResultNotice)})`)
  await run(`document.querySelector('.ai-fixture').style.height='500px'`)
  for (const theme of ['light', 'dark', 'eyecare']) {
    await run(`window.__uiRegression.setTheme('${theme}')`)
    for (const width of [300, 440]) {
      await run(`(() => {const fixture=document.querySelector('.ai-fixture');fixture.style.width='${width}px';fixture.scrollIntoView({block:'center'});document.querySelector('.background-result-notice').open=false})()`)
      assert.ok(await run(`(() => {const card=document.querySelector('.background-result-notice');const head=card.querySelector('summary');const title=head.querySelector('.background-result-title');return card.scrollWidth<=card.clientWidth+1&&head.scrollWidth<=head.clientWidth+1&&title.scrollHeight<=parseFloat(getComputedStyle(title).lineHeight)+1&&head.textContent.includes('4 项')&&head.textContent.includes('2 失败')})()`), `Background result summary fits one line at ${width}px in ${theme}`)
      await saveScreenshot(`ai-background-result-${theme}-${width}-collapsed.png`)
      await run(`document.querySelector('.background-result-heading').click()`)
      assert.deepEqual(await run(`Array.from(document.querySelectorAll('.background-result-body .tool-run-state')).map(node=>node.textContent.trim())`), ['执行成功', '执行失败', '已超时', '已停止'], 'Delivered results share the tool row outcomes including failed exit codes and timeouts')
      await run(`document.querySelector('.background-result-body .tool-run > summary').click()`)
      await waitFor('document.querySelector(".background-result-body .tool-run-out")?.textContent.includes("19704363 journal")')
      assert.ok(await run(`(() => {const card=document.querySelector('.background-result-notice');return card.scrollWidth<=card.clientWidth+1&&[...card.querySelectorAll('.tool-run-head')].every(head=>head.scrollWidth<=head.clientWidth+1)})()`), 'Long commands and expanded output stay within the result card')
      await saveScreenshot(`ai-background-result-${theme}-${width}-expanded.png`)
      await run(`document.querySelector('.background-result-body .tool-run > summary').click()`)
    }
  }
  await run(`window.__uiRegression.aiBackgroundResults('invalid result')`)
  await run(`document.querySelector('.background-result-heading').click()`)
  assert.ok(await run(`document.querySelector('.background-result-unavailable').textContent.includes('详情格式无法识别')`), 'Malformed legacy results have a visible fallback instead of an empty disclosure')
  await run(`(() => {const fixture=document.querySelector('.ai-fixture');fixture.style.height='280px';fixture.style.width='440px'})()`)
  await run(`window.__uiRegression.setTheme('light')`)
  await run('window.__uiRegression.longAiReply()')
  await waitFor(`(() => {const list=document.querySelector('.ai-fixture .chat-list');return list.scrollHeight > list.clientHeight && list.scrollHeight-list.scrollTop-list.clientHeight < 2})()`)
  await run('window.__uiRegression.delayAiReply()')
  await waitFor(`(() => {const list=document.querySelector('.ai-fixture .chat-list');return !!list.querySelector('.activity-delay') && list.scrollHeight-list.scrollTop-list.clientHeight < 2})()`)
  await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
  await run(`(() => {const list=document.querySelector('.ai-fixture .chat-list');list.scrollTop=0;list.dispatchEvent(new Event('scroll'))})()`)
  await run('window.__uiRegression.resumeAiReply()')
  await waitFor('document.querySelector(".activity-line")?.textContent.includes("正在请求模型")')
  assert.equal(await run('document.querySelector(".ai-fixture .chat-list").scrollTop'), 0, 'Activity changes respect manual scrollback')
  await run('window.__uiRegression.finishAi()')

  await run('window.__uiRegression.aiUsage({promptTokens:3000,cachedPromptTokens:2300,uncachedPromptTokens:700,completionTokens:300,reasoningTokens:60,totalTokens:3300,requestCount:2})')
  await waitFor('document.querySelector(".ai-fixture .usage-line")?.textContent.includes("缓存 2.3k")')
  assert.ok(await run('document.querySelector(".ai-fixture .usage-line").textContent.includes("非缓存 700") && document.querySelector(".ai-fixture .usage-line").textContent.includes("输出 300")'), 'Token footer exposes cache hits, uncached input and output')
  assert.ok(await run('document.querySelector(".ai-fixture .usage-line").title.includes("模型请求 2 次") && document.querySelector(".ai-fixture .usage-line").title.includes("其中推理 60（已计入输出）")'), 'Exact accounting details explain request counts and reasoning without double counting')
  for (const width of [300,440]) {
    await run(`document.querySelector('.ai-fixture').style.width='${width}px'`)
    assert.ok(await run(`(() => {const footer=document.querySelector('.ai-fixture .message-footer');const usage=footer.querySelector('.usage-line');const rect=footer.getBoundingClientRect();return footer.scrollWidth<=footer.clientWidth+1 && usage.getBoundingClientRect().right<=rect.right+1 && getComputedStyle(usage).visibility==='visible' && Number(getComputedStyle(usage).opacity)>0})()`), `Token breakdown fits and is visible without hover at ${width}px`)
  }
  await run('window.__uiRegression.aiUsage({promptTokens:3000,cachedPromptTokens:800,uncachedPromptTokens:200,completionTokens:300,totalTokens:3300,requestCount:2,cacheUsageIncomplete:true})')
  await waitFor('document.querySelector(".ai-fixture .usage-line")?.textContent.includes("缓存部分统计")')
  assert.ok(await run('document.querySelector(".ai-fixture .usage-line").textContent.includes("非缓存 200")'), 'Incomplete cache accounting is not extrapolated to unknown requests')
  await run('window.__uiRegression.aiUsage({promptTokens:1000,completionTokens:100})')
  await waitFor('document.querySelector(".ai-fixture .usage-line")?.textContent.includes("缓存未提供")')
  assert.equal(await run('document.querySelector(".ai-fixture .usage-line").textContent.includes("缓存 0")'), false, 'Unavailable cache data never becomes zero hits')
  await run('window.__uiRegression.aiUsage({requestCount:1,usageIncomplete:true,cacheUsageIncomplete:true})')
  await waitFor('document.querySelector(".ai-fixture .usage-line")?.textContent.includes("未返回用量")')

  await run('window.__uiRegression.aiTimeline(200)')
  await waitFor('document.querySelectorAll(".chat-timeline-item").length > 0 && document.querySelectorAll(".chat-timeline-item").length <= 12')
  await run('document.querySelector(".ai-fixture").scrollIntoView({block:"center"})')
  window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('DOM.enable')
  await window.webContents.debugger.sendCommand('CSS.enable')
  const documentNode = await window.webContents.debugger.sendCommand('DOM.getDocument')
  const timelineNode = await window.webContents.debugger.sendCommand('DOM.querySelector', {nodeId:documentNode.root.nodeId, selector:'.chat-timeline'})
  await window.webContents.debugger.sendCommand('CSS.forcePseudoState', {nodeId:timelineNode.nodeId, forcedPseudoClasses:['hover']})
  await run('document.querySelector(".chat-timeline").dispatchEvent(new MouseEvent("mouseenter"))')
  await waitFor('document.querySelectorAll(".chat-timeline-item").length === 200')
  const expandedTimeline = await run(`(() => {const rail=document.querySelector('.chat-timeline');rail.scrollTop=80;return {width:rail.getBoundingClientRect().width,scroll:getComputedStyle(rail).scrollbarWidth,overflow:rail.scrollHeight>rail.clientHeight}})()`)
  assert.ok(expandedTimeline.width > 100 && expandedTimeline.scroll === 'thin' && expandedTimeline.overflow, 'Expanded timeline can scroll through many turns')
  await saveScreenshot('ai-timeline-expanded.png')
  await window.webContents.debugger.sendCommand('CSS.forcePseudoState', {nodeId:timelineNode.nodeId, forcedPseudoClasses:[]})
  await run('document.querySelector(".chat-timeline").dispatchEvent(new MouseEvent("mouseleave"))')
  await waitFor('document.querySelectorAll(".chat-timeline-item").length <= 12')
  const collapsedTimeline = await run(`(() => {const rail=document.querySelector('.chat-timeline');return {width:rail.getBoundingClientRect().width,scroll:getComputedStyle(rail).scrollbarWidth,webkit:getComputedStyle(rail,'::-webkit-scrollbar').width,position:rail.scrollTop}})()`)
  assert.ok(collapsedTimeline.width <= 17 && collapsedTimeline.scroll === 'none' && collapsedTimeline.webkit === '0px', `Collapsed timeline shows a bounded overview without a scrollbar: ${JSON.stringify(collapsedTimeline)}`)
  await saveScreenshot('ai-timeline-collapsed.png')
  await run('document.querySelector(".chat-timeline").dispatchEvent(new MouseEvent("mouseenter"))')
  await waitFor('document.querySelectorAll(".chat-timeline-item").length === 200 && Math.abs(document.querySelector(".chat-timeline").scrollTop - 80) < 1')
  await run('document.querySelector(".chat-timeline").dispatchEvent(new MouseEvent("mouseleave"))')
  window.webContents.debugger.detach()
  await run('window.__uiRegression.openImageComposer()')
  await waitFor('window.__uiRegression.calls.aiCreates.length === 1')
  assert.equal(await run('document.querySelectorAll(".ai-image-composer-fixture .chat-row").length'), 0, 'A new SSH window starts blank even when the host has an active historical conversation')
  await waitFor('document.querySelector(".composer-add-image") && !document.querySelector(".composer-add-image").disabled')
  const initialContextPercent = await run('Number(document.querySelector(".composer-context-meter [role=meter]").getAttribute("aria-valuenow"))')
  assert.ok(await run('document.querySelector(".composer-context-meter").title.includes("自动压缩触发点")'), 'Context meter explains the backend pressure threshold')
  await run(`(() => {const input=document.querySelector('.composer-input');input.value='测试草稿'.repeat(2000);input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor(`Number(document.querySelector('.composer-context-meter [role=meter]').getAttribute('aria-valuenow')) > ${initialContextPercent}`)
  assert.equal(await run('window.__uiRegression.calls.aiRequests.length'), 0, 'Draft context estimation never makes a model request')
  await run(`(() => {const input=document.querySelector('.composer-input');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await run('document.querySelector(".ai-image-composer-fixture").scrollIntoView({block:"center"})')
  const addFixtureImage = (mode, color) => run(`(async () => {
    const canvas=document.createElement('canvas');canvas.width=800;canvas.height=450;
    const ctx=canvas.getContext('2d');ctx.fillStyle=${JSON.stringify(color)};ctx.fillRect(0,0,800,450);ctx.fillStyle='#fff';ctx.font='32px sans-serif';ctx.fillText('Connection refused / 连接失败',40,90);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const file=new File([blob],'报错截图.png',{type:'image/png'});const transfer=new DataTransfer();transfer.items.add(file);
    if(${JSON.stringify(mode)}==='select'){const input=document.querySelector('.composer input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}
    else if(${JSON.stringify(mode)}==='paste')document.querySelector('.composer-input').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
    else document.querySelector('.ai-image-composer-fixture .ai-sidebar').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
  })()`)
  await addFixtureImage('select', '#174e7b')
  await waitFor('document.querySelectorAll(".composer-images .ai-image-thumbnail").length === 1')
  await run('document.querySelector(".composer-images .ai-image-thumbnail").click()')
  await waitFor('document.querySelector(".ai-image-dialog[open]")')
  assert.equal(await run('document.querySelector(".ai-image-dialog[open] img").naturalWidth'), 800)
  await run('document.querySelector(".ai-image-dialog[open] .ui-icon-btn").click()')
  await addFixtureImage('paste', '#4e236b')
  await waitFor('document.querySelectorAll(".composer-images .ai-image-thumbnail").length === 2')
  await addFixtureImage('drop', '#1e6949')
  await waitFor('document.querySelectorAll(".composer-images .ai-image-thumbnail").length === 3')
  await run(`(() => {const transfer=new DataTransfer();transfer.items.add(new File(['hello'],'notes.txt',{type:'text/plain'}));document.querySelector('.ai-image-composer-fixture .ai-sidebar').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}))})()`)
  await waitFor('Array.from(document.querySelectorAll(".el-message")).some(el => el.textContent.includes("PNG"))')
  assert.equal(await run('document.querySelectorAll(".composer-images .ai-image-thumbnail").length'), 3, 'Non-image drops do not alter the draft or navigate the app')
  await run('document.querySelector(".ai-image-composer-fixture").style.width="300px"')
  assert.equal(await run('(() => {const form=document.querySelector(".composer");const strip=document.querySelector(".composer-images");return strip.scrollWidth <= strip.clientWidth+1 && form.getBoundingClientRect().width < 300})()'), true, 'Attachments wrap in a narrow AI sidebar')
  await run('document.querySelector(".ai-image-composer-fixture").style.width="440px"')
  for (const theme of ['dark', 'light', 'eyecare', 'custom']) {
    await run(`window.__uiRegression.setTheme(${JSON.stringify(theme)})`)
    const layout = await run(`(() => {const form=document.querySelector('.composer');const images=form.querySelector('.composer-images');return {fits:images.getBoundingClientRect().right<=form.getBoundingClientRect().right+1,sendEnabled:!form.querySelector('.send-btn').disabled}})()`)
    assert.ok(layout.fits && layout.sendEnabled, 'Image attachments fit the themed composer and can send without text')
    await saveScreenshot('ai-images-' + theme + '.png')
  }
  await run('window.__uiRegression.setVisionEnabled(false)')
  assert.equal(await run('document.querySelector(".composer .send-btn").disabled'), true, 'Switching to a text model blocks sending pending images')
  await run('window.__uiRegression.setVisionEnabled(true)')
  await run('document.querySelector(".composer-images .ai-image-remove").click()')
  await waitFor('document.querySelectorAll(".composer-images .ai-image-thumbnail").length === 2')
  await run('document.querySelector(".composer .send-btn").click()')
  await waitFor('window.__uiRegression.calls.aiRequests.length === 1 && !document.querySelector(".composer-images")')
  const imageRequest = await run('window.__uiRegression.calls.aiRequests[0][0]')
  assert.equal(imageRequest.content, '')
  assert.equal(imageRequest.images.length, 2, 'Image-only message carries both original attachments')
  assert.ok(imageRequest.images.every(image => image.dataUrl.startsWith('data:image/png;base64,') && image.width === 800 && /^[a-f0-9]{64}$/.test(image.id)))
  await waitFor('document.querySelectorAll(".ai-image-composer-fixture .chat-row .ai-image-thumbnail").length === 2')
  const rowsBeforeManualCompaction = await run('document.querySelectorAll(".ai-image-composer-fixture .chat-row").length')
  await run(`(() => {const input=document.querySelector('.composer-input');input.value='手动压缩时保留草稿';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.composer-context-meter').click()})()`)
  await waitFor('window.__uiRegression.manualCompactions.length === 1 && !document.querySelector(".stop-btn")')
  assert.equal(await run('document.querySelectorAll(".ai-image-composer-fixture .chat-row").length'), rowsBeforeManualCompaction, 'Manual compaction creates no chat message')
  assert.equal(await run('document.querySelector(".composer-input").value'), '手动压缩时保留草稿', 'Manual compaction preserves the unsent draft')
  await run(`(() => {const input=document.querySelector('.composer-input');input.value='A 窗口未发送的草稿';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  const originalSession = await run('window.__uiRegression.imageSessionState("image-fixture")')
  await run('window.__uiRegression.switchImageSession("image-fixture-c")')
  await waitFor('document.querySelectorAll(".ai-image-composer-fixture .chat-row").length === 0')
  await run('window.__uiRegression.switchImageSession("image-fixture")')
  await waitFor('document.querySelectorAll(".ai-image-composer-fixture .chat-row .ai-image-thumbnail").length === 2')
  assert.deepEqual(await run('window.__uiRegression.imageSessionState("image-fixture")'), originalSession, 'A to C to A retains the active conversation and input')
  await run('window.__uiRegression.closeImageComposer()')
  await run('window.__uiRegression.changeSavedActiveThread()')
  await run('window.__uiRegression.openImageComposer()')
  await waitFor('document.querySelectorAll(".ai-image-composer-fixture .chat-row .ai-image-thumbnail").length === 2')
  assert.deepEqual(await run('window.__uiRegression.imageSessionState("image-fixture")'), originalSession, 'Remounting A restores its session even when another terminal changes the persisted active thread')
  assert.equal(await run('window.__uiRegression.calls.aiCreates.length'), 2, 'Only the first opening of A and C initializes a conversation; switching and reopening retain them')
  await run('window.__uiRegression.setCompactionCount(2)')
  assert.equal(await run('!!document.querySelector(".composer-long-session")'), false)
  await run('window.__uiRegression.setCompactionCount(3)')
  await waitFor('document.querySelector(".composer-long-session")?.textContent.includes("3 次")')
  await saveScreenshot('ai-long-session-reminder.png')
  await run('document.querySelector(".composer-long-session .ui-btn-ghost").click()')
  await waitFor('!document.querySelector(".composer-long-session")')
  await run('window.__uiRegression.setCompactionCount(4)')
  await waitFor('document.querySelector(".composer-long-session")?.textContent.includes("4 次")')
  await run('document.querySelector(".composer-long-session .ui-btn").click()')
  await waitFor('!document.querySelector(".composer-long-session") && document.querySelectorAll(".ai-image-composer-fixture .chat-row").length === 0')
  const savedThreads = await run('window.__uiRegression.getImageHistory().threads')
  assert.ok(savedThreads.find(thread => thread.id === originalSession.threadId).messages.length >= 2, 'Starting fresh retains the previous conversation')
  assert.equal(savedThreads.find(thread => thread.id === 'new-image-thread-3').compactionCount || 0, 0)
  assert.equal(savedThreads.find(thread => thread.id === 'image-thread').messages[0].content, '旧窗口的历史消息', 'Opening a new SSH window preserves old host history')
  await run('document.querySelector(".header-settings-action").click()')
  await waitFor('document.querySelectorAll(".settings-category").length === 4')
  assert.equal(await run('document.querySelector(".settings-nav")'), null, 'Embedded SSH settings use a category overview rather than scrolling tabs')
  for (const width of [300, 440]) {
    await run(`(() => {const fixture=document.querySelector('.ai-image-composer-fixture');fixture.style.width='${width}px';fixture.scrollIntoView({block:'center'})})()`)
    const overview = await run(`(() => {const root=document.querySelector('.settings-box');const cards=[...root.querySelectorAll('.settings-category')];const rects=cards.map(card=>card.getBoundingClientRect());return {fits:root.scrollWidth<=root.clientWidth+1,vertical:rects.every((rect,index)=>!index||rect.top>=rects[index-1].bottom),labels:cards.every(card=>{const label=card.querySelector('.settings-category-title');return label.scrollWidth<=label.clientWidth+1}),footer:!!root.querySelector('footer')}})()`)
    assert.ok(overview.fits && overview.vertical && overview.labels && !overview.footer, 'All four embedded categories fit vertically without a redundant save footer')
    await saveScreenshot(`ai-settings-panel-overview-${width}.png`)
    for (const id of ['providers', 'conversation', 'permissions', 'notifications']) {
      await openSettingsSection(id)
      const layout = await run(`(() => {const root=document.querySelector('.settings-box');const content=root.querySelector('.settings-content');const footer=root.querySelector('footer');const r=root.getBoundingClientRect();const f=footer.getBoundingClientRect();return {fits:root.scrollWidth<=root.clientWidth+1&&content.scrollWidth<=content.clientWidth+1,title:root.querySelector('.settings-panel-title').textContent,footerFits:f.bottom<=r.bottom+1&&[...footer.querySelectorAll('button')].every(button=>{const b=button.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right+1&&button.scrollWidth<=button.clientWidth+1})}})()`)
      assert.ok(layout.fits && layout.footerFits, `Embedded ${id} content and footer fit at ${width}px`)
      await saveScreenshot(`ai-settings-panel-${id}-${width}.png`)
    }
    await run('document.querySelector(".settings-panel-header > button").click()')
    await waitFor('document.querySelector(".settings-category")')
    assert.equal(await run('document.activeElement.dataset.section'), 'notifications', 'Returning from a category restores keyboard focus to its entry')
  }
  await openSettingsSection('permissions')
  await run(`(() => {const input=document.querySelector('#ai-tool-rounds');input.value='37';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await openSettingsSection('conversation')
  await run(`(() => {const input=document.querySelector('#ai-history-max-threads');input.value='1';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor('document.querySelector(".history-cleanup-preview").textContent.includes("预计清理 1 个会话")')
  await run('document.querySelector(".settings-panel-header > button").click()')
  await waitFor('document.querySelectorAll(".settings-category-dirty").length === 2')
  assert.equal(await run('window.__uiRegression.settingsSaves.length'), 0, 'Back to the overview preserves drafts without saving them')
  await saveScreenshot('ai-settings-panel-pending.png')
  await run('document.querySelector(".settings-panel-header > button").click()')
  await waitFor('document.querySelector(".app-dialog-actions")')
  await run('document.querySelector(".app-dialog-actions button:first-child").click()')
  await waitFor('!document.querySelector(".app-dialog-actions") && document.querySelectorAll(".settings-category-dirty").length === 2')
  await openSettingsSection('providers')
  const providerActions = await run(`(() => {const actions=document.querySelector('.provider-item .provider-item-actions');return {buttons:actions.querySelectorAll('button').length,menus:actions.querySelectorAll('details').length,visible:[...actions.querySelectorAll('button')].every(button=>getComputedStyle(button).visibility==='visible'&&getComputedStyle(button).opacity!=='0')}})()`)
  assert.ok(providerActions.buttons === 2 && providerActions.menus === 0 && providerActions.visible, 'Provider edit and delete are visible without hover or a menu')
  await run('document.querySelector(".provider-item-info").click()')
  await waitFor('document.querySelector(".model-editor summary")')
  assert.equal(await run('document.querySelector("#ai-provider-protocol").value'), 'openai', 'Legacy provider settings default to OpenAI compatible')
  await run(`(() => {const input=document.querySelector('#ai-provider-url');input.value='https://api.openai.com/v1';input.dispatchEvent(new Event('input',{bubbles:true}));const select=document.querySelector('#ai-provider-protocol');select.value='anthropic';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await waitFor('document.querySelector("#ai-provider-url").value === "https://api.anthropic.com/v1"')
  assert.ok(await run(`document.querySelector('.settings-box').textContent.includes('Anthropic Messages')`), 'Claude protocol is visible in provider settings')
  await run(`(() => {const input=document.querySelector('#ai-provider-url');input.value='https://gateway.example/custom';input.dispatchEvent(new Event('input',{bubbles:true}));const select=document.querySelector('#ai-provider-protocol');select.value='openai';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await waitFor('document.querySelector("#ai-provider-protocol").value === "openai"')
  assert.equal(await run('document.querySelector("#ai-provider-url").value'), 'https://gateway.example/custom', 'Changing protocol preserves a custom gateway URL')
  await run('document.querySelector(".model-editor").open=true')
  assert.equal(await run('document.querySelector(".model-advanced").open'), false, 'Context and output parameters start in a collapsed advanced section')
  await run(`document.querySelector('.model-advanced').open=true`)
  await waitFor('document.querySelector(".context-source")?.textContent.includes("未识别")')
  await run(`[...document.querySelectorAll('.provider-item-actions button')].find(button=>button.textContent.includes('获取模型')).click()`)
  await waitFor('document.querySelector(".model-picker[role=dialog]") && !document.querySelector(".model-picker [aria-busy=true]")')
  assert.equal(await run('document.activeElement.closest(".model-picker-search") !== null'), true, 'The model picker opens with focus on search')
  assert.ok(await run('document.querySelector(".model-choice.added input").checked && document.querySelector(".model-choice.added input").disabled'), 'Added models have a checked, disabled control and an explicit status')
  await run(`(() => {const button=document.querySelector('.model-picker-cancel');button.focus();button.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))})()`)
  assert.ok(await run('document.activeElement.classList.contains("model-picker-close")'), 'Tab stays within the model selection dialog')
  await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`)
  await waitFor('!document.querySelector(".model-picker") && document.activeElement.closest(".provider-models-header")')
  await run(`[...document.querySelectorAll('.provider-models-header button')].find(button=>button.textContent.includes('获取模型')).click()`)
  await waitFor('document.querySelector(".model-picker[role=dialog]") && !document.querySelector(".model-picker [aria-busy=true]")')
  await saveScreenshot('ai-settings-model-picker.png')
  await run(`(() => {const input=document.querySelector('.model-picker-search input');input.value='available';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor('document.querySelectorAll(".model-choice").length === 1')
  await run(`document.querySelector('.model-choice input').click()`)
  await run(`document.querySelector('.model-picker footer .ui-btn-primary').click()`)
  await waitFor('!document.querySelector(".model-picker") && document.querySelectorAll(".model-editor").length === 2')
  await run(`document.querySelectorAll('.model-summary-actions')[1].querySelector('button:last-child').click()`)
  await waitFor('document.querySelectorAll(".model-editor").length === 1')
  await waitFor('document.querySelector(".context-source")?.textContent.includes("提供商接口")')
  const discoveredWindow = await run(`document.querySelector('.model-fields input[type="number"]').placeholder`)
  assert.equal(discoveredWindow, '64000', 'Provider context becomes the automatic budget')
  await run(`(() => {const input=document.querySelector('.model-fields input[type="number"]');input.value='32000';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor('document.querySelector(".context-source")?.textContent.includes("手动设置")')
  await run(`(() => {const input=document.querySelector('.model-fields input[type="number"]');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor('document.querySelector(".context-source")?.textContent.includes("提供商接口")')
  for (const width of [300, 440]) {
    await run(`document.querySelector('.ai-image-composer-fixture').style.width='${width}px'`)
    const capability = await run(`(() => {const label=document.querySelector('.model-image-capability');const input=label.querySelector('input').getBoundingClientRect();const text=label.querySelector('span').getBoundingClientRect();return {display:getComputedStyle(label).display,aligned:Math.abs(input.top+input.height/2-text.top-text.height/2)<1,ordered:input.right<text.left,height:input.height,fits:label.scrollWidth<=label.clientWidth+1}})()`)
    assert.ok(capability.display === 'flex' && capability.aligned && capability.ordered && capability.height <= 20 && capability.fits, 'Vision checkbox and label share one aligned row at narrow and regular widths')
    const modelRows = await run(`(() => {const header=document.querySelector('.provider-models-header');const texts=[header.querySelector('.field-label'),...header.querySelectorAll('button')];const ranges=texts.map(node=>{const range=document.createRange();range.selectNodeContents(node);const rect=range.getBoundingClientRect();return rect.top+rect.height/2});const summary=document.querySelector('.model-editor > summary');const name=summary.querySelector('span');const tag=summary.querySelector('small');const a=name.getBoundingClientRect();const b=tag.getBoundingClientRect();return {headerAligned:Math.max(...ranges)-Math.min(...ranges)<1,headerFits:header.scrollWidth<=header.clientWidth+1,tagAligned:Math.abs(a.top+a.height/2-b.top-b.height/2)<1,sameType:getComputedStyle(name).fontSize===getComputedStyle(tag).fontSize&&getComputedStyle(name).lineHeight===getComputedStyle(tag).lineHeight}})()`)
    assert.ok(modelRows.headerAligned && modelRows.headerFits && modelRows.tagAligned && modelRows.sameType, 'Model list title, actions, model name and default tag align at narrow and regular widths')
  }
  await run(`(() => {document.querySelector('.model-editor').open=false;document.querySelector('.model-editor').scrollIntoView({block:'center'})})()`)
  await run(`[...document.querySelectorAll('.provider-models-header button')].find(button=>button.textContent.includes('手动添加')).click()`)
  await waitFor('document.querySelectorAll(".model-editor").length === 2')
  await run(`(() => {const row=document.querySelectorAll('.model-editor')[1];const input=row.querySelector('.model-fields input');input.value='second-model';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor('document.querySelectorAll(".model-summary-name")[1]?.textContent.includes("second-model")')
  await run(`document.querySelectorAll('.model-editor').forEach(row=>row.open=false)`)
  await run(`document.querySelectorAll('.model-summary-actions')[1].querySelector('button').click()`)
  await waitFor('document.querySelector(".model-summary-name")?.textContent.includes("second-model")')
  const modelActions = await run(`(() => {const rows=[...document.querySelectorAll('.model-editor')];return {closed:rows.every(row=>!row.open),visible:rows.every(row=>[...row.querySelectorAll('.model-summary-actions button')].every(button=>getComputedStyle(button).visibility==='visible'&&getComputedStyle(button).opacity!=='0')),defaultDisabled:rows[0].querySelector('.model-summary-actions button').disabled}})()`)
  assert.ok(modelActions.closed && modelActions.visible && modelActions.defaultDisabled, 'Collapsed models expose actions and setting default does not expand a row')
  await saveScreenshot('ai-settings-model-actions.png')
  await run(`document.querySelector('.model-summary-actions button:last-child').click()`)
  await waitFor('document.querySelectorAll(".model-editor").length === 1 && document.querySelector(".model-summary-name")?.textContent.includes("vision-fixture")')
  assert.equal(await run(`document.querySelector('.model-editor').open`), false, 'Deleting a model does not expand the remaining row')
  await saveScreenshot('ai-settings-model-row-alignment.png')
  await run(`document.querySelector('.model-editor').open=true`)
  await saveScreenshot('ai-settings-image-capability.png')
  await run(`document.querySelector('.provider-edit-actions > button:not(.settings-save)').click()`)
  await waitFor('window.__uiRegression.providerTests.length === 1')
  await run(`document.querySelector('.settings-save').click()`)
  await waitFor('document.querySelector(".provider-item-info") && window.__uiRegression.settingsSaves.length === 1')
  assert.ok(await run('document.querySelector(".provider-default-model").textContent.includes("vision-fixture")'), 'Provider summary names its default model explicitly')
  assert.equal(await run('window.__uiRegression.settingsSaves.at(-1).maxToolRounds'), 50, 'Saving a provider does not save pending execution settings')
  assert.equal(await run('window.__uiRegression.settingsSaves.at(-1).historyMaxThreads'), 50, 'Saving a provider does not apply pending history cleanup')
  await openSettingsSection('permissions')
  assert.equal(await run('document.querySelector("#ai-tool-rounds").value'), '37', 'Provider save retains other settings drafts')
  await run(`document.querySelector('.settings-save').click()`)
  await waitFor('window.__uiRegression.settingsSaves.length === 2')
  assert.equal(await run('window.__uiRegression.settingsSaves.at(-1).maxToolRounds'), 37)
  assert.equal(await run('window.__uiRegression.settingsSaves.at(-1).historyMaxThreads'), 50, 'Saving general settings leaves history limits unchanged')
  await openSettingsSection('conversation')
  await waitFor('!document.querySelector(".settings-save").disabled')
  await saveScreenshot('ai-settings-history-preview.png')
  await run(`document.querySelector('.settings-save').click()`)
  await waitFor('document.querySelector(".app-dialog-actions")')
  await run(`document.querySelector('.app-dialog-actions button:first-child').click()`)
  await waitFor('!document.querySelector(".app-dialog-actions") && !document.querySelector(".settings-save").disabled')
  assert.equal(await run('window.__uiRegression.settingsSaves.length'), 2, 'Cancelling cleanup does not save settings or delete history')
  await run(`document.querySelector('.settings-save').click()`)
  await waitFor('document.querySelector(".app-dialog-actions")')
  await run(`document.querySelector('.app-dialog-actions .ui-btn-danger-solid').click()`)
  await waitFor('window.__uiRegression.settingsSaves.length === 3 && document.querySelector(".settings-save").disabled')
  assert.equal(await run('window.__uiRegression.settingsSaves.at(-1).historyMaxThreads'), 1, 'History limits apply only after explicit cleanup confirmation')
  await run(`(() => {const input=document.querySelector('#ai-history-max-threads');input.value='50';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor('!document.querySelector(".settings-save").disabled')
  await run(`document.querySelector('.settings-save').click()`)
  await waitFor('window.__uiRegression.settingsSaves.length === 4')
  await openSettingsSection('permissions')
  await run(`(() => {const input=document.querySelector('#ai-tool-rounds');input.value='50';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await run(`document.querySelector('.settings-save').click()`)
  await waitFor('window.__uiRegression.settingsSaves.length === 5')
  await run(`window.__uiRegression.setBackgroundJobs([{jobId:'running-job',sessionId:'image-fixture',command:'sleep 30 && echo done',status:'running',startedAt:1}])`)
  await waitFor('document.querySelector(".background-toolbar-fixture .ai-task-count-badge")?.textContent === "1"')
  await run('window.__uiRegression.closeImageComposer()')
  assert.equal(await run('document.querySelector(".background-toolbar-fixture .ai-task-count-badge").textContent'), '1', 'Closing the AI panel keeps the real background task indicator')
  await run('window.__uiRegression.openImageComposer()')
  await waitFor('document.querySelector(".ai-background-tasks.running")')
  await run(`document.querySelector('.ai-background-tasks').open=true`)
  await waitFor('document.querySelector(".ai-background-tasks code")?.textContent.includes("sleep 30")')
  await run(`document.querySelector('.background-job').open=true`)
  await waitFor('document.querySelector(".background-job-detail")?.textContent.includes("命令执行中")')
  assert.equal(await run('document.querySelector(".background-job-detail .tool-run-args").textContent'), 'sleep 30 && echo done', 'Expanded background task shows the full command')
  await run(`window.__uiRegression.switchImageSession('other-fixture')`)
  await waitFor('!document.querySelector(".ai-background-tasks") && !document.querySelector(".background-toolbar-fixture .ai-task-count-badge")')
  await run(`window.__uiRegression.switchImageSession('image-fixture')`)
  await waitFor('document.querySelector(".ai-background-tasks.running")')
  await run(`(() => { document.querySelector('.ai-background-tasks').open=true; document.querySelector('.background-job').open=true })()`)
  await saveScreenshot('ai-background-running.png')
  await run(`(() => { window.__uiRegression.setBackgroundJobs([{jobId:'stop-one',sessionId:'image-fixture',command:'sleep 90',status:'running',startedAt:1},{jobId:'keep-running',sessionId:'image-fixture',command:'sleep 120',status:'running',startedAt:1}]); window.__uiRegression.setCancelJobFailure(true) })()`)
  await waitFor('document.querySelectorAll(".background-job-stop").length === 2')
  const requestsBeforeStop = await run('window.__uiRegression.calls.aiRequests.length')
  await run(`document.querySelector('.background-job-stop').click()`)
  await waitFor('document.querySelector(".ai-background-tasks [role=alert]")?.textContent.includes("中断任务失败")')
  assert.equal(await run('document.querySelectorAll(".background-job-stop").length'), 2, 'Failed interruption retains running state and permits retry')
  await run(`(() => { window.__uiRegression.setCancelJobFailure(false); document.querySelector('.background-job-stop').click() })()`)
  await waitFor('document.querySelectorAll(".background-job-stop").length === 1 && document.querySelector(".ai-background-tasks li[data-status=stopped]")')
  assert.equal(await run('document.querySelector(".background-job-stop").closest("li").querySelector("code").textContent'), 'sleep 120', 'Interruption targets only the selected job')
  assert.equal(await run('window.__uiRegression.calls.aiRequests.length'), requestsBeforeStop, 'Interruption never sends a new AI message')
  await saveScreenshot('ai-background-interrupted.png')
  await run(`window.__uiRegression.setBackgroundJobs([{jobId:'failed-job',sessionId:'image-fixture',command:'false',status:'completed',startedAt:1,finishedAt:2,exitCode:127}])`)
  await waitFor('document.querySelector(".ai-background-tasks .tool-run-state")?.textContent === "执行失败"')
  assert.equal(await run('document.querySelector(".ai-background-tasks").textContent.includes("退出码")'), false, 'Nonzero background exits show failure without an exit code')
  await run(`window.__uiRegression.setBackgroundJobs([{jobId:'running-job',sessionId:'image-fixture',command:'sleep 30 && echo done',status:'completed',startedAt:1,finishedAt:2,exitCode:0}])`)
  await waitFor('!document.querySelector(".background-toolbar-fixture .ai-task-count-badge") && !document.querySelector(".ai-background-tasks.running")')
  await run(`(() => { document.querySelector('.ai-background-tasks').open=true; document.querySelector('.background-job').open=true })()`)
  await waitFor('document.querySelector(".ai-background-tasks li")?.textContent.includes("执行成功")')
  await waitFor('document.querySelector(".background-job-detail .tool-run-out")?.textContent.includes("verification passed")')
  assert.ok(await run('document.querySelector(".background-job-times").title.includes("结束时间") && document.querySelector(".background-job-times").textContent.includes("–")'), 'Completed jobs show a compact time range with full timestamps in the tooltip')
  assert.equal(await run('document.querySelector(".ai-background-tasks .tool-run-detail")'), null, 'Successful jobs omit the redundant zero exit code')
  assert.equal(await run('document.querySelector(".ai-background-tasks .tool-run-state").textContent'), '执行成功', 'Background jobs use the tool card completion label')
  await saveScreenshot('ai-background-completed-details.png')
  const backgroundScroll = await run(`(() => {
    const body=document.querySelector('.background-task-body');
    const output=body.querySelector('.tool-run-out');
    output.textContent='long background command output\\n'.repeat(100);
    const before=body.scrollTop; body.scrollTop=body.scrollHeight;
    return {height:body.clientHeight,overflow:body.scrollHeight>body.clientHeight,scrollable:body.scrollTop>before,heading:body.parentElement.querySelector('.background-heading').getBoundingClientRect().height};
  })()`)
  assert.ok(backgroundScroll.height <= 220 && backgroundScroll.overflow && backgroundScroll.scrollable && backgroundScroll.heading > 0, 'Long task details scroll within a capped area while the heading remains outside it')
  await run(`window.__uiRegression.setBackgroundJobs([{jobId:'cancel-on-new',sessionId:'image-fixture',command:'sleep 120',status:'running',startedAt:Date.now()}])`)
  await run('window.__uiRegression.seedConversationMessage()')
  const beforeNew = await run('({creates:window.__uiRegression.calls.aiCreates.length,requests:window.__uiRegression.calls.aiRequests.length,thread:window.__uiRegression.imageSessionState("image-fixture").threadId})')
  await run(`document.querySelector('.ai-header-actions button:first-child').click()`)
  await waitFor('document.querySelector(".app-dialog-actions .ui-btn") && document.body.textContent.includes("中断后台任务并新建对话")')
  assert.equal(await run('window.__uiRegression.calls.aiCreates.length'), beforeNew.creates, 'Opening confirmation does not create a conversation')
  await run(`document.querySelector('.app-dialog-actions .ui-btn:first-child').click()`)
  await waitFor('!document.querySelector(".app-dialog-actions")')
  assert.equal(await run('window.__uiRegression.imageSessionState("image-fixture").threadId'), beforeNew.thread, 'Cancelling retains the current conversation')
  assert.ok(await run('document.querySelector(".ai-background-tasks.running") !== null'), 'Cancelling retains the running job')
  await run(`document.querySelector('.ai-header-actions button:first-child').click()`)
  await waitFor('document.querySelector(".app-dialog-actions .ui-btn-danger-solid")')
  await run(`document.querySelector('.app-dialog-actions .ui-btn-danger-solid').click()`)
  await waitFor(`window.__uiRegression.calls.aiCreates.length === ${beforeNew.creates + 1} && !document.querySelector('.ai-background-tasks.running')`)
  assert.equal(await run('window.__uiRegression.calls.aiRequests.length'), beforeNew.requests, 'Interrupting for a new conversation never sends an AI message')
  assert.equal(await run('document.querySelectorAll(".ai-image-composer-fixture .chat-row").length'), 0, 'Confirmation opens a blank conversation after stopping the job')
  await run(`window.__uiRegression.emitBackgroundReply('running')`)
  await waitFor('document.querySelector(".background-result-notice") && document.querySelector(".stop-btn")')
  await run(`window.__uiRegression.emitBackgroundReply('completed')`)
  await waitFor('document.querySelector(".ai-image-composer-fixture").textContent.includes("后台命令已完成并验证结果") && !document.querySelector(".stop-btn")')
  assert.equal(await run('document.querySelector(".background-result-notice").open'), false, 'Background result cards start collapsed')
  assert.ok(await run('document.querySelector(".background-result-heading").textContent.includes("1 成功")'), 'Background completion cards expose the outcome before expanding')
  await run('document.querySelector(".background-result-heading").click()')
  await run('document.querySelector(".background-result-body .tool-run > summary").click()')
  await waitFor('document.querySelector(".background-result-notice .tool-run-out")?.textContent.includes("container healthy")')
  await run('window.__uiRegression.closeImageComposer()')
  await run('document.querySelector(".regression-root").scrollTop=0')

  await run('window.__uiRegression.openEditor()')
  await waitFor('document.querySelector(".editor-textarea")?.value === "original content"')
  await run(`(() => {
    const area = document.querySelector('.editor-textarea'); area.value = 'local draft'; area.dispatchEvent(new Event('input',{bubbles:true}));
    window.__uiRegression.changeRemote();
  })()`)
  await waitFor('!document.querySelector(".editor-header .editor-save-btn").disabled')
  await run('document.querySelector(".editor-header .editor-save-btn").click()')
  await waitFor('document.querySelector(".editor-error[role=alert]")')
  await saveScreenshot('editor-conflict.png')
  assert.equal(await run('document.querySelector(".editor-textarea").value'), 'local draft', 'Remote changes preserve the local draft')
  assert.equal(await run('window.__uiRegression.calls.editorSaves.length'), 1, 'Conflicting saves do not retry automatically')
  await run(`(() => {
    const backup = document.querySelector('.editor-footer input'); backup.click();
    document.querySelector('.editor-error[role=alert] .editor-save-btn').click();
  })()`)
  await waitFor('document.querySelector(".app-dialog-overlay")')
  assert.equal(await run('window.__uiRegression.calls.editorSaves.length'), 1, 'Overwrite waits for explicit confirmation')
  await run(`Array.from(document.querySelectorAll('.app-dialog button')).find(button => button.textContent.includes('覆盖')).click()`)
  await waitFor('window.__uiRegression.calls.editorSaves.length === 2 && !document.querySelector(".editor-error[role=alert]")')
  assert.equal(await run('window.__uiRegression.calls.editorSaves[1].options.backup'), true, 'Optional backup is requested on the confirmed overwrite')
  await run('document.querySelector(".editor-actions .ui-icon-btn-close").click()')
  await waitFor('!document.querySelector(".editor-overlay")')

  await run('window.__uiRegression.openSync()')
  await waitFor('document.querySelectorAll(".sync-row").length === 4')
  await saveScreenshot('directory-preview.png')
  assert.deepEqual(await run('Array.from(document.querySelectorAll(".sync-row input")).map(input => ({checked:input.checked,disabled:input.disabled}))'),
    [{checked:true,disabled:false},{checked:false,disabled:true},{checked:false,disabled:true},{checked:false,disabled:true}], 'Only new files are selected; changes and blocked entries are protected')
  await run(`(() => {
    window.__uiRegression.failPreview();
    document.querySelector('.sync-modal footer button').click();
  })()`)
  await waitFor('document.querySelector(".sync-modal [role=alert]")')
  assert.equal(await run('Array.from(document.querySelectorAll(".sync-modal footer button")).find(button=>button.textContent.includes("上传")).disabled'), true, 'A failed refresh invalidates the previous upload selection')
  assert.equal(await run('window.__uiRegression.calls.uploads.length'), 0)
  await run(`(() => {
    window.__uiRegression.restorePreview();
    document.querySelector('.sync-modal footer button').click();
  })()`)
  await waitFor('document.querySelectorAll(".sync-row").length === 4')
  await run(`Array.from(document.querySelectorAll('.sync-modal footer button')).find(button => button.textContent.includes('上传')).click()`)
  await waitFor('window.__uiRegression.calls.uploads.length === 1')
  assert.equal(await run('window.__uiRegression.calls.uploads[0][3]'), 'new.txt', 'Sync only queues the explicitly selected new file')
  assert.equal(await run('window.__uiRegression.calls.uploads[0][5].conflict'), 'skip', 'Default sync never overwrites a newly conflicting target')
  assert.equal(await run('window.__uiError || null'), null)
  window.webContents.setZoomFactor(1)
  await run('window.__uiRegression.openLiteAi()')
  await run(`document.querySelector('.lite-ai-workspace-fixture').scrollIntoView({block:'center'})`)
  await run(`document.querySelector('.lite-ai-workspace-fixture .titlebar-brand-module').click()`)
  await waitFor('document.querySelectorAll(".titlebar-mode-menu .titlebar-mode-item").length === 3')
  await run(`document.querySelector('.titlebar-mode-menu .titlebar-mode-item:last-child').click()`)
  await waitFor('document.querySelectorAll(".workspace-card").length === 2')
  assert.ok(await run(`(() => {const current=document.querySelector('.rail-current').getBoundingClientRect();const history=document.querySelector('.rail-history').getBoundingClientRect();return current.height<100 && history.top-current.bottom<30})()`), 'An empty current-chat section leaves room for history instead of reserving a fixed panel')
  assert.equal(await run('document.querySelector(".workspace-toolbar").textContent.includes("新建巡检")'), false, 'Server browsing keeps inspection creation in the inspection page')
  assert.deepEqual(await run('Array.from(document.querySelectorAll(".workspace-view-switch button")).map(button=>[button.textContent.trim(),button.getAttribute("aria-pressed")])'), [['卡片','false'],['列表','true']], 'The compact list is the default and both modes have visible labels')

  assert.equal(await run('document.querySelectorAll(".workspace-card-status").length'), 2, 'Every server exposes its connection state before selection')
  await run(`document.querySelector('[data-filter=connected]').click()`)
  await waitFor('document.querySelector(".workspace-empty")?.textContent.includes("还没有已连接")')
  assert.equal(await run('document.querySelectorAll(".workspace-card").length'), 0, 'Connected filter excludes saved but disconnected servers')
  await run(`document.querySelector('.workspace-empty button').click()`)
  await waitFor('document.querySelectorAll(".workspace-card").length === 2')
  await run(`(() => {const input=document.querySelector('.workspace-search-field input');input.value='没有这样的服务器';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor('document.querySelector(".workspace-empty")?.textContent.includes("没有匹配")')
  await run(`document.querySelector('.workspace-search-clear').click()`)
  await waitFor('document.querySelectorAll(".workspace-card").length === 2')
  for (const width of [1050, 680, 520]) {
    await run(`document.querySelector('.lite-ai-workspace-fixture').style.width='${width}px'`)
    const overflow = await run(`(() => {const panel=document.querySelector('.ai-workspace');const browser=document.querySelector('.workspace-browser');return [panel.scrollWidth-panel.clientWidth,browser.scrollWidth-browser.clientWidth]})()`)
    assert.ok(overflow.every(value => value <= 1), `Server list fits a ${width}px workspace: ${JSON.stringify(overflow)}`)
    assert.ok(await run(`(() => {const browser=document.querySelector('.workspace-browser').getBoundingClientRect();const button=document.querySelector('.workspace-models-button');const rect=button.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(button);const text=range.getBoundingClientRect();return button.textContent.includes('管理模型')&&rect.left>=browser.left&&rect.right<=browser.right+1&&text.right<=rect.right+1&&getComputedStyle(button).borderTopStyle==='solid'})()`), `The home model button and its label remain visible at ${width}px`)
  }
  await run(`document.querySelector('.lite-ai-workspace-fixture').style.width='1050px'`)

  assert.equal(await run('document.querySelectorAll(".workspace-selected").length'), 0, 'Server cards have one entry action without a duplicated footer')
  await run(`document.querySelector('.workspace-view-switch [data-view=list]').click()`)
  await waitFor('document.querySelector(".workspace-card-grid.is-list")')
  assert.equal(await run('document.querySelector(".workspace-view-switch [data-view=list]").getAttribute("aria-pressed")'), 'true', 'List view visibly marks its selected mode')
  await saveScreenshot('lite-ai-host-list.png')
  await run(`document.querySelector('.workspace-view-switch [data-view=cards]').click()`)
  assert.equal(await run('localStorage.getItem("LiteConnect.aiWorkspace.hostView")'), 'cards', 'View preference is remembered')
  await saveScreenshot('lite-ai-welcome.png')
  await run(`document.querySelectorAll('.workspace-host-checkbox')[1].click()`)
  const homeSelection = await run('Array.from(document.querySelectorAll(".workspace-host-checkbox:checked")).map(input=>input.closest(".workspace-card").dataset.connectionId)')
  await run(`document.querySelector('.workspace-models-button').click()`)
  await waitFor('document.querySelector(".workspace-model-settings .provider-item-info")')
  assert.equal(await run('window.__uiRegression.workspaceOpens.length'), 0, 'Managing models from home does not connect to a server')
  assert.equal(await run('window.__uiRegression.workspaceScopes.length'), 0, 'Managing models from home does not create an AI conversation')
  await saveScreenshot('lite-ai-home-model-settings.png')
  await run(`document.querySelector('.workspace-model-settings .settings-panel-header > button').click()`)
  await waitFor('!document.querySelector(".workspace-model-settings") && document.activeElement.classList.contains("workspace-models-button")')
  assert.deepEqual(await run('Array.from(document.querySelectorAll(".workspace-host-checkbox:checked")).map(input=>input.closest(".workspace-card").dataset.connectionId)'), homeSelection, 'Returning from model settings retains the home server selection')
  await run(`document.querySelectorAll('.workspace-host-checkbox')[1].click()`)
  const firstAiHostId = await run('document.querySelector(".workspace-card").dataset.connectionId')
  const terminalConnectsBeforeAi = await run('window.__uiRegression.calls.connects.length')
  await run(`document.querySelector('.workspace-card').click()`)
  assert.equal(await run('window.__uiRegression.workspaceOpens.length'), 0, 'Single-click only selects a server')
  await run(`window.__uiRegression.seedLegacyWorkspaceHistory(${JSON.stringify(firstAiHostId)})`)
  await run(`document.querySelector('.workspace-toolbar-actions .ui-icon-btn').click()`)
  await waitFor('document.querySelector(".rail-history .rail-item")?.textContent.includes("旧版单机会话")')
  await run(`document.querySelector('.rail-history .rail-item').click()`)

  await waitFor('document.querySelector(".lite-ai-chat .composer-input")')
  assert.equal(await run('window.__uiRegression.calls.connects.length'), terminalConnectsBeforeAi, 'LiteAI does not create an SSH terminal tab')
  assert.equal(await run('document.querySelectorAll(".lite-ai-chat .chat-row").length'), 1, 'Old single-server history can still be restored')
  await run(`(() => {const input=document.querySelector('.lite-ai-chat .composer-input');input.value='检查磁盘和 Docker 状态';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor('!document.querySelector(".lite-ai-chat .send-btn").disabled')
  await run(`document.querySelector('.lite-ai-chat .send-btn').click()`)
  await waitFor('document.querySelector(".lite-ai-chat").textContent.includes("服务器磁盘和服务状态正常") && document.querySelector(".lite-ai-chat .code-block")')
  assert.equal(await run('document.querySelectorAll(".lite-ai-chat .code-action-btn").length'), 0, 'Independent AI hides actions that write to an unseen terminal')
  await saveScreenshot('lite-ai-conversation.png')
  assert.ok(await run(`(() => {const toolbar=document.querySelector('.lite-ai-chat .ai-header');return toolbar.contains(document.querySelector('.workspace-target')) && toolbar.getBoundingClientRect().height<100})()`), 'Conversation title and server controls share one compact toolbar')
  assert.ok(await run(`(() => {const toolbar=document.querySelector('.lite-ai-chat .ai-header');const centers=['.workspace-back','.ai-title','.workspace-target','.ai-header-actions','.workspace-session-action'].map(selector=>{const r=toolbar.querySelector(selector).getBoundingClientRect();return r.top+r.height/2});return Math.max(...centers)-Math.min(...centers)<=1})()`), 'Title, server information and session actions align on one row in a wide window')
  assert.ok(await run(`(() => {const button=document.querySelector('.workspace-session-action');const style=getComputedStyle(button);return !!button.querySelector('svg') && style.borderTopStyle==='solid' && parseFloat(style.borderTopWidth)>=1 && !['transparent','rgba(0, 0, 0, 0)'].includes(style.backgroundColor)})()`), 'Closing a session has an icon, visible border and surface before hover')
  await run(`window.__uiRegression.setTheme('light')`)
  await saveScreenshot('lite-ai-desktop-chat-light.png')
  await run(`window.__uiRegression.setTheme('dark')`)
  await saveScreenshot('lite-ai-desktop-chat-dark.png')
  await run(`window.__uiRegression.setTheme('custom')`)
  await run(`(() => {const input=document.querySelector('.lite-ai-chat .composer-input');input.value='服务器 A 的草稿';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await run(`document.querySelector('.workspace-target-host').click()`)
  await waitFor('document.querySelectorAll(".host-picker-item").length === 2')
  await run(`document.querySelectorAll('.host-picker-item')[1].click()`)
  await waitFor('document.querySelectorAll(".lite-ai-chat .chat-row").length === 0 && document.querySelector(".lite-ai-chat .composer-input")')
  await run(`document.querySelector('.workspace-target-host').click()`)
  await waitFor('document.querySelectorAll(".host-picker-item").length === 2')
  await run(`document.querySelector('.host-picker-item').click()`)
  await waitFor('document.querySelector(".lite-ai-chat .composer-input")?.value === "服务器 A 的草稿"')
  assert.equal(await run('window.__uiRegression.workspaceOpens.length'), 2, 'Switching back reuses the workspace connection and conversation')
  await run(`document.querySelector('.workspace-host-entry').click()`)
  await waitFor('document.querySelector(".workspace-browser")?.getClientRects().length')
  await run(`document.querySelector('[data-filter=connected]').click()`)
  await waitFor('document.querySelectorAll(".workspace-card.connected").length === 2')
  await run(`document.querySelector('[data-filter=all]').click()`)
  await run(`document.querySelector('.workspace-view-switch [data-view=list]').click()`)
  await run(`Array.from(document.querySelectorAll('.rail-current-list .rail-item')).find(button=>button.dataset.connectionId===${JSON.stringify(firstAiHostId)}).click()`)
  await waitFor('document.querySelector(".lite-ai-chat .composer-input")?.value === "服务器 A 的草稿"')
  assert.equal(await run('window.__uiRegression.workspaceOpens.length'), 2, 'The sidebar continues an existing conversation without reconnecting or discarding the draft')

  await run(`document.querySelector('.lite-ai-workspace-fixture').style.width='680px'`)
  await saveScreenshot('lite-ai-narrow.png')
  assert.ok(await run(`(() => {const toolbar=document.querySelector('.lite-ai-chat .ai-header');const bounds=toolbar.getBoundingClientRect();return toolbar.scrollWidth<=toolbar.clientWidth+1 && [...toolbar.querySelectorAll('button')].filter(button=>button.getClientRects().length).every(button=>{const rect=button.getBoundingClientRect();return rect.left>=bounds.left && rect.right<=bounds.right+1})})()`), 'Every conversation toolbar action remains visible within a narrow window')
  const disconnectedHost = await run('document.querySelector(".workspace-target-host strong").textContent')
  await run(`document.querySelector('.workspace-disconnect').click()`)
  await waitFor(`document.querySelector(".workspace-target-host strong") && document.querySelector(".workspace-target-host strong").textContent !== ${JSON.stringify(disconnectedHost)}`)
  assert.equal(await run('document.querySelectorAll(".rail-current-list .rail-item").length'), 1, 'Disconnecting A retains the independent connection to B')
  await run(`document.querySelector('.workspace-schedule-entry').click()`)
  await waitFor('document.querySelector(".ai-schedule-panel")')
  assert.equal(await run('document.querySelector(".ai-workspace-rail").getBoundingClientRect().width > 0'), true, 'Inspection keeps workspace navigation visible')
  await run(`document.querySelector('.rail-collapse').click()`)
  await waitFor('document.querySelector(".ai-workspace-rail.collapsed")')
  assert.ok(await run('document.querySelector(".ai-workspace-rail").getBoundingClientRect().width < 80'), 'Collapsed rail keeps more room for the report')
  await run(`document.querySelector('.rail-collapse').click()`)

  await run(`document.querySelector('.schedule-new').click()`)
  await waitFor('document.querySelector(".schedule-form")')
  await run(`document.querySelector('.schedule-targets input:not(:checked)').click()`)
  await run(`(() => {const name=document.querySelector('.schedule-form input'); name.value='服务器磁盘巡检'; name.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('.schedule-form button[type=submit]').click()})()`)
  await waitFor('document.querySelectorAll(".schedule-plan").length === 1 && !document.querySelector(".schedule-form")')
  assert.equal(await run('window.__uiRegression.scheduleSnapshot().plans[0].connectionIds.length'), 2, 'A saved inspection plan retains multiple targets')
  assert.ok(await run('document.querySelector(".schedule-plan").textContent.includes("下次执行")'), 'Schedules show the next execution time')
  await run(`document.querySelector('.schedule-actions button:nth-child(2)').click()`)
  await waitFor('document.querySelector(".schedule-plan").textContent.includes("已暂停")')
  await run(`document.querySelector('.schedule-run').click()`)
  await waitFor('document.querySelector(".schedule-result[data-status=running] .schedule-stop")')
  await run(`document.querySelector('.schedule-stop').click()`)
  await waitFor('document.querySelector(".schedule-result[data-status=cancelled]") && !document.querySelector(".schedule-stop")')
  await run(`document.querySelector('.schedule-run').click()`)
  await waitFor('document.querySelector(".schedule-stop")')
  await run('window.__uiRegression.finishSchedule()')
  await waitFor('document.querySelector(".schedule-result[data-status=completed]")')
  await waitFor('document.querySelector(".schedule-result-body").textContent.includes("磁盘空间正常")')
  assert.equal(await run('document.querySelectorAll(".schedule-result[data-status=completed] .schedule-host-tab").length'), 2, 'Cross-server reports show each host separately')
  assert.equal(await run('document.querySelector(".ai-schedule-panel").textContent.includes("退出码")'), false, 'Schedule reports retain user-facing outcome labels without exit codes')
  assert.ok(await run('document.querySelector(".schedule-counts").textContent.includes("台检查完成")'), 'Host counts describe inspection coverage instead of machine health')
  await run(`document.querySelector('.ai-tool-group > summary').click()`)
  await waitFor('document.querySelector(".schedule-host-detail .tool-run")')
  assert.ok(await run('document.querySelector(".schedule-host-detail .tool-run-head").textContent.includes("检查磁盘空间")'), 'Inspection uses the same purpose-aware tool row as chat')
  await run(`document.querySelector('.schedule-host-detail .tool-run > summary').click()`)
  await waitFor('document.querySelector(".schedule-host-detail .tool-run-out")?.textContent.includes("disk healthy")')
  await saveScreenshot('lite-ai-inspection-tool-details.png')

  assert.ok(await run('(() => {const main=document.querySelector(".schedule-plan-main");return main.getBoundingClientRect().width >= 280})()'), 'Narrow inspection cards wrap actions instead of squeezing plan metadata')
  await saveScreenshot('lite-ai-schedules-narrow.png')
  await run(`document.querySelector('.lite-ai-workspace-fixture').style.width='1050px'`)
  await saveScreenshot('lite-ai-schedules.png')
  await run(`document.querySelector('.schedule-run').click()`)
  await waitFor('document.querySelector(".schedule-stop")')
  await run('window.__uiRegression.failSchedule()')
  await waitFor('document.querySelector(".schedule-result[data-status=failed] .schedule-result-body")')
  assert.ok(await run('document.querySelector(".schedule-result[data-status=failed] .schedule-counts").textContent.includes("1 台检查未完成")'), 'Tool failure is shown as incomplete inspection coverage')
  assert.ok(await run('document.querySelector(".schedule-result[data-status=failed] .schedule-health").textContent.includes("健康结论：发现异常")'), 'Health assessment remains distinct from execution failure')
  assert.equal(await run('document.querySelectorAll(".schedule-result[data-status=failed] .schedule-report ol > li").length'), 2, 'Report keeps numbering across nested bullet lists')
  await run(`document.querySelector('.schedule-result[data-status=failed] .ai-tool-group > summary').click()`)
  await waitFor('document.querySelector(".schedule-result[data-status=failed] .tool-run.blocked" ) || document.querySelector(".schedule-result[data-status=failed] .tool-run.error")')
  assert.ok(await run('document.querySelector(".schedule-result[data-status=failed] .ai-tool-group > summary").textContent.includes("1 已拦截")'), 'Blocked tools have their own count')
  await run(`(() => {const panel=document.querySelector('.ai-schedule-panel');const result=document.querySelector('.schedule-result[data-status=failed]');panel.scrollTop += result.getBoundingClientRect().top - panel.getBoundingClientRect().top})()`)
  await saveScreenshot('lite-ai-inspection-failure.png')

  await run(`document.querySelector('.schedule-actions button:nth-child(3)').click()`)
  await waitFor('document.querySelector(".schedule-kind")')
  await run(`(() => {const select=document.querySelector('.schedule-kind');select.value='daily';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await waitFor('document.querySelector(".schedule-time")')
  await run(`(() => {const input=document.querySelector('.schedule-time');input.value='07:45';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.schedule-form button[type=submit]').click()})()`)
  await waitFor('!document.querySelector(".schedule-form") && document.querySelector(".schedule-plan").textContent.includes("每天 07:45")')
  await run(`document.querySelector('.schedule-actions button:nth-child(3)').click()`)
  await waitFor('document.querySelector(".schedule-kind")?.value === "daily" && document.querySelector(".schedule-time")?.value === "07:45"')
  await run(`(() => {const select=document.querySelector('.schedule-kind');select.value='weekly';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await waitFor('document.querySelector(".schedule-weekday")')
  await run(`(() => {const day=document.querySelector('.schedule-weekday');day.value='5';day.dispatchEvent(new Event('change',{bubbles:true}));const input=document.querySelector('.schedule-time');input.value='08:15';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.schedule-form button[type=submit]').click()})()`)
  await waitFor('!document.querySelector(".schedule-form") && document.querySelector(".schedule-plan").textContent.includes("每周五 08:15")')
  await waitFor('!document.querySelector(".schedule-actions button:nth-child(2)").disabled')
  await run(`document.querySelector('.schedule-actions button:nth-child(2)').click()`)
  await waitFor('document.querySelector(".schedule-plan").textContent.includes("已启用")')
  assert.deepEqual(await run(`(() => {const plan=window.__uiRegression.scheduleSnapshot().plans[0];const next=new Date(plan.nextRunAt);return [next.getDay(),next.getHours(),next.getMinutes(),plan.nextRunAt>Date.now()]})()`), [5,8,15,true], 'Weekly plans retain the weekday and local wall time through save and re-enable')
  await saveScreenshot('lite-ai-calendar-schedules.png')
  await run(`document.querySelector('.schedule-header-actions button').click()`)
  await waitFor('document.querySelector(".notification-url")')
  await run(`(() => {const input=document.querySelector('.notification-url');input.value='https://notify.example.test/hook';input.dispatchEvent(new Event('input',{bubbles:true}));window.__uiRegression.failNotificationTest(true)})()`)
  await waitFor('!document.querySelector(".notification-test").disabled')
  await run(`document.querySelector('.notification-test').click()`)
  await waitFor('document.querySelector(".notification-error")?.textContent.includes("通知服务不可用")')
  await run(`(() => {window.__uiRegression.failNotificationTest(false);document.querySelector('.notification-test').click()})()`)
  await waitFor('document.querySelector(".ai-notification-settings [role=status]")?.textContent.includes("测试通知已发送")')
  await saveScreenshot('lite-ai-webhook-settings.png')
  await run(`document.querySelector('.schedule-actions button:last-child').click()`)
  await waitFor('document.querySelectorAll(".app-dialog-actions button").length === 2')
  await run(`document.querySelector('.app-dialog-actions button:last-child').click()`)
  await waitFor('!document.querySelector(".schedule-plan")')

  await run(`document.querySelector('.workspace-host-entry').click()`)
  if (await run('!!document.querySelector(".ai-workspace-rail.collapsed")')) {
    await run(`document.querySelector('.rail-collapse').click()`)
  }
  await run(`document.querySelector('.rail-section .rail-item').click()`)
  await waitFor('document.querySelector(".lite-ai-chat .composer-input")')
  await run(`(() => {const input=document.querySelector('.lite-ai-chat .composer-input');input.value='检查当前服务器状态';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor('!document.querySelector(".lite-ai-chat .send-btn").disabled')
  await run(`document.querySelector('.lite-ai-chat .send-btn').click()`)
  await waitFor('document.querySelector(".lite-ai-chat").textContent.includes("服务器磁盘和服务状态正常") && !document.querySelector(".lite-ai-chat .stop-btn")')
  await run(`window.__uiRegression.setTheme('light')`)
  const createsBeforeWorkspace = await run('window.__uiRegression.calls.aiCreates.length')
  const opensBeforeWorkspace = await run('window.__uiRegression.workspaceOpens.length')
  await run(`document.querySelector('.workspace-new-chat').click()`)
  await waitFor('document.querySelectorAll(".host-picker-item").length === 2')
  assert.equal(await run('document.activeElement.classList.contains("host-picker-search")'), true, 'New conversation focuses server search')
  assert.equal(await run('document.querySelector(".host-picker-footer button").disabled'), true, 'An explicit scope is required before creating a conversation')
  await run(`document.querySelectorAll('.host-picker-item').forEach(button=>button.click())`)
  await waitFor('document.querySelectorAll(".host-picker-item[aria-pressed=true]").length === 2')
  assert.ok(await run('document.querySelector(".host-picker-footer").textContent.includes("已选 2 台")'), 'Selected servers form one conversation scope')
  await saveScreenshot('lite-ai-multi-server-selection.png')
  await run(`document.querySelector('.host-picker-footer button').click()`)
  await waitFor(`window.__uiRegression.calls.aiCreates.length === ${createsBeforeWorkspace + 1} && document.querySelector('.lite-ai-chat .composer-input') && document.querySelector('.workspace-scope-target')`)
  assert.equal(await run('window.__uiRegression.workspaceOpens.length'), opensBeforeWorkspace + 1, 'Scope creation reuses the connected server and reconnects the other selected server')
  assert.ok(await run('document.querySelector(".workspace-scope-details summary").textContent.includes("本会话管理 2 台")'), 'The conversation header exposes its full scope')
  assert.equal(await run('document.querySelectorAll(".lite-ai-chat .chat-row").length'), 0, 'New conversation opens an empty thread')
  await run(`(() => {const input=document.querySelector('.lite-ai-chat .composer-input');input.value='比较两台服务器的磁盘使用情况';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.workspace-scope-details summary').click()})()`)
  await waitFor('!document.querySelector(".lite-ai-chat .send-btn").disabled')
  assert.equal(await run('document.querySelectorAll(".workspace-scope-details li").length'), 2, 'Scope details list both selected targets')
  await saveScreenshot('lite-ai-multi-server-conversation.png')
  await run(`document.querySelector('.lite-ai-chat .send-btn').click()`)
  await waitFor('document.querySelector(".lite-ai-chat").textContent.includes("服务器磁盘和服务状态正常") && !document.querySelector(".lite-ai-chat .stop-btn")')
  await run('window.__uiRegression.seedScopedJobs()')
  await waitFor('document.querySelectorAll(".lite-ai-chat .background-task-body li").length === 2')
  assert.ok(await run('!document.querySelector(".lite-ai-chat .ai-background-tasks").textContent.includes("unrelated task")'), 'A scope only shows background tasks started by this conversation')
  await run(`document.querySelector('.lite-ai-chat .background-heading').click()`)
  await saveScreenshot('lite-ai-multi-server-background-jobs.png')
  const rowsBeforeReconnect = await run('document.querySelectorAll(".lite-ai-chat .chat-row").length')
  await run(`window.__uiRegression.disconnectScopedHost()`)
  await waitFor('document.querySelector(".workspace-error")?.textContent.includes("重新连接")')
  await run(`(() => {const input=document.querySelector('.lite-ai-chat .composer-input');input.value='继续检查';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  assert.equal(await run('document.querySelector(".lite-ai-chat .send-btn").disabled'), true, 'A disconnected scope cannot fall through to a different server')
  await run(`document.querySelector('.workspace-retry').click()`)
  await waitFor('!document.querySelector(".workspace-error") && !document.querySelector(".lite-ai-chat .send-btn").disabled')
  assert.equal(await run('document.querySelectorAll(".lite-ai-chat .chat-row").length'), rowsBeforeReconnect, 'Reconnecting preserves the shared conversation')
  assert.equal(await run('document.querySelectorAll(".lite-ai-chat .background-task-body li").length'), 2, 'Task details remain visible when a host reconnects with a new SSH session id')
  await run(`document.querySelector('.lite-ai-chat .ai-new-chat-menu summary').click()`)
  await run(`document.querySelector('.lite-ai-chat .ai-new-chat-dropdown button').click()`)
  await waitFor('document.querySelector(".app-dialog-actions button")')
  await run(`document.querySelector('.app-dialog-actions button:last-child').click()`)
  await waitFor('!document.querySelector(".app-dialog") && document.querySelectorAll(".lite-ai-chat .chat-row").length === 0')
  assert.deepEqual(await run('window.__uiRegression.scopedJobStatus()'), [['scope-job-0','cancelled'],['scope-job-1','cancelled'],['another-conversation-job','running']], 'New conversation cancels its own tasks without stopping other conversations on the same hosts')
  await run('window.__uiRegression.setBackgroundJobs([])')
  await run(`document.querySelector('.workspace-close-session').click()`)
  await waitFor('!document.querySelector(".workspace-scope-target") && document.querySelector(".rail-history .rail-item")')
  await run(`document.querySelector('.rail-history .rail-item[data-connection-id^="workspace:"]').click()`)
  await waitFor('document.querySelector(".workspace-scope-target") && document.querySelector(".lite-ai-chat").textContent.includes("比较两台服务器")')
  assert.equal(await run('window.__uiRegression.workspaceOpens.length'), opensBeforeWorkspace + 2, 'Restoring a multi-server history preserves its scope and reuses both connections')
  await run(`document.querySelector('.workspace-close-session').click()`)
  await waitFor('!document.querySelector(".workspace-scope-target")')

  // Re-select an already open server: IPC must receive plain data and preserve the old chat.
  // The previous disconnect flow may have closed the last single-host conversation.
  await run(`window.__uiRegression.seedLegacyWorkspaceHistory(document.querySelector('.workspace-card').dataset.connectionId)`)
  await run(`document.querySelector('.workspace-toolbar-actions .ui-icon-btn').click()`)
  await waitFor('document.querySelector(".rail-history .rail-item")?.textContent.includes("旧版单机会话")')
  await run(`document.querySelector('.rail-history .rail-item').click()`)
  await waitFor('document.querySelector(".workspace-target-host strong") && document.querySelector(".lite-ai-chat .composer-input")')
  const reusedHost = await run('document.querySelector(".workspace-target-host strong").textContent')
  const sameServerOpens = await run('window.__uiRegression.workspaceOpens.length')
  const existingChatRows = await run('document.querySelectorAll(".lite-ai-chat .chat-row").length')
  await run(`(() => {const input=document.querySelector('.lite-ai-chat .composer-input');input.value='保留已有会话草稿';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.workspace-new-chat').click()})()`)
  await waitFor('document.querySelectorAll(".host-picker-item").length === 2')
  await run(`Array.from(document.querySelectorAll('.host-picker-item')).find(button=>button.querySelector('strong').textContent===${JSON.stringify(reusedHost)}).click()`)
  await run(`document.querySelector('.host-picker-footer button').click()`)
  await waitFor('document.querySelector(".workspace-scope-target") && !document.querySelector(".host-picker")')
  assert.equal(await run('window.__uiRegression.workspaceOpens.length'), sameServerOpens, 'Re-selecting an open server reuses its connection')
  assert.equal(await run('window.__uiRegression.workspaceScopes.at(-1).connectionIds.length'), 1, 'One selected open server forms a valid serializable scope')
  assert.equal(await run('!!document.querySelector(".workspace-error")'), false, 'Reactive picker arrays never cross the IPC clone boundary')
  await run(`document.querySelector('.workspace-close-session').click()`)
  await waitFor('!document.querySelector(".workspace-scope-target")')
  await run(`document.querySelector('.rail-current-list .rail-item').click()`)
  await waitFor('document.querySelector(".lite-ai-chat .composer-input")?.value === "保留已有会话草稿"')
  assert.equal(await run('document.querySelectorAll(".lite-ai-chat .chat-row").length'), existingChatRows, 'Creating a scoped conversation keeps the existing conversation messages')
  await run(`document.querySelector('.workspace-host-entry').click()`)
  if (await run('!!document.querySelector(".workspace-clear-selection")')) await run(`document.querySelector('.workspace-clear-selection').click()`)
  assert.equal(await run('document.querySelector(".workspace-start-scope").disabled'), true, 'Server browsing requires selecting a scope before starting')
  await run(`document.querySelector('.workspace-host-checkbox').click()`)
  await run(`document.querySelectorAll('.workspace-host-checkbox')[1].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`)
  await waitFor('document.querySelectorAll(".workspace-host-checkbox:checked").length === 2')
  const pageScopeOpens = await run('window.__uiRegression.workspaceOpens.length')
  await run(`(() => {const input=document.querySelector('.workspace-search-field input');input.value='prod.example';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor('document.querySelectorAll(".workspace-card").length === 1')
  assert.equal(await run('document.querySelectorAll(".workspace-selection-chip").length'), 2, 'Search preserves selected servers outside its results')
  await run(`document.querySelector('.workspace-view-switch [data-view=list]').click()`)
  assert.equal(await run('document.querySelectorAll(".workspace-host-checkbox:checked").length'), 1, 'List view retains the visible selected server')
  await run(`document.querySelector('.workspace-search-clear').click()`)
  await run(`document.querySelector('.workspace-select-results').click()`)
  await waitFor('document.querySelectorAll(".workspace-selection-chip").length === 0')
  await run(`document.querySelector('.workspace-select-results').click()`)
  await waitFor('document.querySelectorAll(".workspace-selection-chip").length === 2')
  await run(`document.querySelector('.workspace-selection-chip').click()`)
  assert.equal(await run('document.querySelectorAll(".workspace-host-checkbox:checked").length'), 1, 'Removing a selected chip updates the server checkbox')
  await run(`document.querySelector('.workspace-host-checkbox:not(:checked)').click()`)
  await run(`document.querySelector('.workspace-new-chat').click()`)
  await waitFor('document.querySelectorAll(".host-picker-item[aria-pressed=true]").length === 2')
  await run(`document.querySelector('.host-picker-backdrop').click()`)
  await run(`document.querySelector('.workspace-view-switch [data-view=cards]').click()`)
  await saveScreenshot('lite-ai-page-multi-selection.png')
  await run(`document.querySelector('.workspace-start-scope').click()`)
  await waitFor('document.querySelector(".workspace-scope-target") && document.querySelectorAll(".workspace-scope-chip").length === 2')
  assert.equal(await run('window.__uiRegression.workspaceOpens.length'), pageScopeOpens, 'Page selection reuses the selected servers and opens one coordinated conversation')
  assert.deepEqual(await run('window.__uiRegression.workspaceScopes.at(-1).connectionIds.slice().sort()'), ['one','two'], 'The page and dialog create the same explicit AI scope')
  await run(`document.querySelector('.workspace-scope-details summary').click()`)
  await saveScreenshot('lite-ai-page-scope-header.png')
  assert.ok(await run('document.querySelector(".workspace-scope-details summary").textContent.includes("已连接 2/2")'), 'Scope header shows connected targets independently from the conversation count')
  assert.ok(await run('document.querySelector(".rail-current-list .rail-item.active .rail-host-count").textContent.includes("2 台")'), 'Sidebar exposes multi-server conversation size')
  await run(`document.querySelector('.workspace-scope-details summary').click()`)
  await run('window.__uiRegression.seedWorkspaceResponse()')
  await waitFor('document.querySelectorAll(".workspace-response-host").length === 2 && document.querySelector(".workspace-response-overview table")')
  assert.equal(await run('document.querySelectorAll(".workspace-response-host[open]").length'), 0, 'Per-server details begin collapsed beneath the summary')
  assert.ok(await run('document.querySelectorAll(".workspace-response-overview")[1].textContent.includes("检查服务间连接")'), 'Shared next steps remain visible outside host details')
  await run(`document.querySelector('.workspace-response-host summary').click()`)
  await waitFor('document.querySelector(".workspace-response-host[open] .code-block")?.getClientRects().length')
  await run(`document.querySelector('.workspace-response-host[open] .copy-btn').click()`)
  await waitFor('document.querySelector(".workspace-response-host[open] .copy-btn").title === "已复制"')
  assert.equal(await run('window.__uiRegression.calls.clipboardWrites.at(-1)'), 'free -h', 'Host detail copy preserves the actual command')
  assert.equal(await run('document.querySelectorAll(".workspace-response .code-action-btn").length'), 0, 'Workspace details never offer hidden terminal execution')
  await saveScreenshot('lite-ai-workspace-response.png')
  await run(`document.querySelector('.workspace-close-session').click()`)
  await waitFor('!document.querySelector(".workspace-scope-target")')
  await run(`document.querySelector('.workspace-clear-selection').click()`)
  await run(`(() => {
    const names=['OA 应用服务器','开发环境','数据库主机','测试服务','容器节点','腾讯云主机'];
    const addresses=['10.2.178.163','10.2.5.75','10.2.178.202','10.2.5.223','10.1.131.14','10.2.178.165'];
    const notes=['OA 服务 · 日常运维','开发与联调环境','业务数据存储','自动化测试环境','Docker 应用与后台任务','云端服务'];
    const hosts=names.map((name,index)=>({id:index===0?'one':index===1?'two':'preview-'+index,name,host:addresses[index],port:22,username:'root',password:'',group:index===5?'prod':'dev',note:notes[index],createdAt:1,updatedAt:1}));
    const now=new Date();const yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);
    const history=['检查 OA 服务的运行情况','看看服务器磁盘的使用情况','排查数据库连接超时','检查 Docker 容器状态','查看服务器上的应用日志'].map((title,index)=>({connectionId:hosts[index].id,hostLabel:hosts[index].name,threadId:'preview-history-'+index,title,updatedAt:index<2?now.getTime()-index*60000:yesterday.getTime()-index*60000,messageCount:6}));
    window.__uiRegression.setWorkspacePreview(hosts,history);
    document.querySelector('.workspace-toolbar-actions .ui-icon-btn').click();
  })()`)
  await waitFor('document.querySelectorAll(".workspace-card").length === 6 && document.querySelectorAll(".rail-history-group").length === 2')
  const opensBeforePinRefresh = await run('window.__uiRegression.workspaceOpens.length')
  await run('window.__uiRegression.setWorkspaceActive(false)')
  await run(`window.LiteConnect.setConnectionPinned('preview-4',true)`)
  await run(`window.LiteConnect.setConnectionPinned('preview-5',true)`)
  await run('window.__uiRegression.setWorkspaceActive(true)')
  await waitFor('document.querySelectorAll(".workspace-card.pinned").length === 2')
  assert.equal(await run('document.querySelector(".workspace-card .workspace-host-name strong").textContent'), '容器节点', 'Returning from connection management refreshes pins and sorts them first inside their group')
  assert.equal(await run('document.querySelectorAll(".workspace-card .workspace-pin").length'), 2, 'Both card and list entries identify pinned servers')
  assert.equal(await run('window.__uiRegression.workspaceOpens.length'), opensBeforePinRefresh, 'Refreshing pin metadata preserves existing AI connections')
  await run('window.__uiRegression.setWorkspaceActive(false)')
  await run(`window.LiteConnect.setConnectionPinned('preview-4',false)`)
  await run('window.__uiRegression.setWorkspaceActive(true)')
  await waitFor('document.querySelectorAll(".workspace-card.pinned").length === 1')
  assert.equal(await run('document.querySelector(".workspace-card .workspace-host-name strong").textContent'), '测试服务', 'Unpinning restores the previous ordering')
  await run('window.__uiRegression.setWorkspaceActive(false)')
  await run(`window.LiteConnect.setConnectionPinned('preview-4',true)`)
  await run('window.__uiRegression.setWorkspaceActive(true)')
  await waitFor('document.querySelectorAll(".workspace-card.pinned").length === 2')
  assert.deepEqual(await run('Array.from(document.querySelectorAll(".rail-history-group h4")).map(el=>el.textContent)'), ['今天','昨天'], 'History groups conversations by day')
  await run(`(() => {const input=document.querySelector('.workspace-search-field input');input.value='OA 服务';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor('document.querySelectorAll(".workspace-card").length === 1')
  assert.equal(await run('document.querySelector(".workspace-host-name strong").textContent'), 'OA 应用服务器', 'Search includes server notes')
  await run(`document.querySelector('.workspace-search-clear').click()`)
  await waitFor('document.querySelectorAll(".workspace-card").length === 6')
  await run(`(() => {const fixture=document.querySelector('.lite-ai-workspace-fixture');fixture.style.height='800px';fixture.scrollIntoView({block:'center'})})()`)
  await run(`window.__uiRegression.setTheme('light')`)
  await run(`document.querySelector('.rail-section .rail-item').click()`)
  await waitFor('document.querySelector(".workspace-target-host")')
  await run(`document.querySelector('.workspace-target-host').click()`)
  await waitFor('document.querySelectorAll(".host-picker-group").length === 2')
  assert.deepEqual(await run('Array.from(document.querySelectorAll(".host-picker-group")).map(group=>[group.querySelector("strong").textContent,group.querySelectorAll(".host-picker-item").length])'), [['默认分组',5],['生产环境 Production',1]], 'In-chat server switching retains the browser group order and counts')
  assert.equal(await run('document.querySelector(".host-picker-item.current").closest(".host-picker-group").querySelector("strong").textContent'), '默认分组', 'The current connection stays in its own group')
  assert.equal(await run('document.querySelector(".host-picker-item .workspace-host-label strong").textContent'), '容器节点', 'Pinned servers take priority over connected servers inside picker groups')
  assert.equal(await run('document.querySelectorAll(".host-picker-item .workspace-pin").length'), 2, 'The in-chat picker identifies pinned servers')
  await saveScreenshot('lite-ai-grouped-host-picker.png')
  await run(`(() => {const input=document.querySelector('.host-picker-search');input.value='Production';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor('document.querySelectorAll(".host-picker-group").length === 1 && document.querySelectorAll(".host-picker-item").length === 1')
  assert.equal(await run('document.querySelector(".host-picker-group-heading strong").textContent'), '生产环境 Production', 'Group-name search retains the matching group heading')
  await run(`(() => {const input=document.querySelector('.host-picker-search');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor('document.querySelectorAll(".host-picker-group").length === 2')
  await run(`document.querySelector('.host-picker-group-heading').click()`)
  assert.equal(await run('Array.from(document.querySelectorAll(".host-picker-item")).filter(item=>item.getClientRects().length).length'), 1, 'Collapsing a picker group hides only its servers')
  await run(`(() => {const input=document.querySelector('.host-picker-search');input.value='默认分组';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor('Array.from(document.querySelectorAll(".host-picker-item")).filter(item=>item.getClientRects().length).length === 5')
  await run(`document.querySelector('.host-picker-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
  await waitFor('!document.querySelector(".host-picker")')
  await run(`document.querySelector('.workspace-new-chat').click()`)
  await waitFor('document.querySelectorAll(".host-picker-group").length === 2')
  assert.equal(await run('Array.from(document.querySelectorAll(".host-picker-group-heading")).every(button=>button.getAttribute("aria-expanded")==="true")'), true, 'New conversation uses the same groups and starts expanded')
  await run(`document.querySelector('.host-picker-backdrop').click()`)
  await run(`document.querySelector('.workspace-host-entry').click()`)
  await run(`document.querySelector('.workspace-view-switch [data-view=list]').click()`)
  for (const theme of ['light','dark','eyecare']) {
    await run(`window.__uiRegression.setTheme('${theme}')`)
    await saveScreenshot(`lite-ai-redesign-${theme}.png`)
  }
  await run(`window.__uiRegression.setTheme('light')`)
  await run(`document.querySelector('.workspace-view-switch [data-view=cards]').click()`)
  assert.ok(await run('Array.from(document.querySelectorAll(".workspace-card")).every(card=>card.getBoundingClientRect().height<=125)'), 'Compact selection-only cards fit within 125px')
  await saveScreenshot('lite-ai-redesign-cards.png')
  for (const width of [680,520]) {
    await run(`document.querySelector('.lite-ai-workspace-fixture').style.width='${width}px'`)
    for (const view of ['list','cards']) {
      await run(`document.querySelector('.workspace-view-switch [data-view=${view}]').click()`)
      const fits = await run(`(() => {const browser=document.querySelector('.workspace-browser');return browser.scrollWidth<=browser.clientWidth+1 && !document.querySelector('.workspace-card-actions') && Array.from(document.querySelectorAll('.workspace-host-checkbox')).every(input=>{const card=input.closest('.workspace-card').getBoundingClientRect();const rect=input.getBoundingClientRect();return rect.right<=card.right+1 && rect.left>=card.left-1})})()`)
      assert.ok(fits, `${view} layout and actions fit at ${width}px`)
      assert.ok(await run(`(() => {const browser=document.querySelector('.workspace-browser').getBoundingClientRect();const footer=document.querySelector('.workspace-selection-bar').getBoundingClientRect();const action=document.querySelector('.workspace-start-scope').getBoundingClientRect();return footer.bottom<=browser.bottom+1 && action.right<=browser.right+1 && action.left>=browser.left-1})()`), `Scope selection action stays visible and fits at ${width}px`)

    }
    await run(`document.querySelector('.workspace-view-switch [data-view=list]').click()`)
    await saveScreenshot(`lite-ai-redesign-${width}.png`)
  }
  await run(`(() => {const fixture=document.querySelector('.lite-ai-workspace-fixture');fixture.style.width='1050px';fixture.style.height='680px';fixture.scrollIntoView({block:'center'})})()`)
  while (await run(`!!document.querySelector('.rail-current-list .rail-item:not([data-connection-id^="workspace:"])')`)) {
    await run(`document.querySelector('.rail-current-list .rail-item:not([data-connection-id^="workspace:"])').click()`)
    await waitFor('document.querySelector(".workspace-target-host")')
    await run(`document.querySelector('.workspace-disconnect').click()`)
  }
  await run('window.__uiRegression.seedWorkspaceRail()')
  await run(`document.querySelector('.workspace-host-entry').click()`)
  await waitFor('document.querySelector(".workspace-browser")')
  // A network connection can serve a scope without opening a single-host chat.
  // Open the six chats explicitly before exercising the current-chat scroll region.
  for (let index = 0; index < 6; index++) {
    if (await run('!!document.querySelector(".workspace-clear-selection")')) await run(`document.querySelector('.workspace-clear-selection').click()`)
    await run(`document.querySelectorAll('.workspace-host-checkbox')[${index}].click()`)
    await run(`document.querySelector('.workspace-start-scope').click()`)
    await waitFor('document.querySelector(".lite-ai-chat .composer-input") && document.querySelector(".workspace-scope-target")')
    await run(`document.querySelector('.workspace-host-entry').click()`)
    await waitFor('document.querySelector(".workspace-browser")?.getClientRects().length')
  }
  await run(`document.querySelector('.workspace-toolbar-actions .ui-icon-btn').click()`)
  await waitFor('document.querySelectorAll(".rail-current-list .rail-item").length === 6 && document.querySelectorAll(".rail-history-list .rail-item").length === 5 && document.querySelector(".rail-history .rail-count").textContent === "14"')
  assert.equal(await run('document.querySelector(".rail-history-toggle").getAttribute("aria-expanded")'), 'false', 'History initially shows only five conversations')
  assert.equal(await run('document.querySelector(".rail-history-toggle").textContent.includes("9")'), true, 'History toggle shows how many extra conversations are available')
  const railPartitionHeights = await run('Array.from(document.querySelectorAll(".rail-conversations > .rail-section")).map(section=>section.getBoundingClientRect().height)')
  await run(`document.querySelector('.rail-history-toggle').click()`)
  await waitFor('document.querySelectorAll(".rail-history-list .rail-item").length === 14')
  assert.equal(await run('document.querySelector(".rail-history-toggle").getAttribute("aria-expanded")'), 'true', 'Expanding history exposes the remaining conversations')
  assert.deepEqual(await run('Array.from(document.querySelectorAll(".rail-conversations > .rail-section")).map(section=>section.getBoundingClientRect().height)'), railPartitionHeights, 'Expanding history keeps both section heights unchanged')
  assert.equal(await run(`(() => {const current=document.querySelector('.rail-current-list');const history=document.querySelector('.rail-history-list');const outer=document.querySelector('.rail-conversations');return [current,history].every(list=>list.scrollHeight>list.clientHeight && getComputedStyle(list).overflowY==='auto') && outer.scrollHeight<=outer.clientHeight+1})()`), true, 'Both conversation lists scroll inside their sections without stretching the sidebar')
  await run(`document.querySelector('.rail-current-list').scrollTop=40`)
  assert.equal(await run('document.querySelector(".rail-history-list").scrollTop'), 0, 'Scrolling opened conversations does not scroll history')
  await run(`document.querySelector('.rail-history-list').scrollTop=80`)
  assert.equal(await run('document.querySelector(".rail-current-list").scrollTop'), 40, 'Scrolling history does not scroll opened conversations')
  assert.equal(await run(`(() => {const toggle=document.querySelector('.rail-history-toggle').getBoundingClientRect();const section=document.querySelector('.rail-history').getBoundingClientRect();return toggle.bottom<=section.bottom+1 && toggle.top>=section.top})()`), true, 'History toggle stays visible outside the scrolling list')
  await saveScreenshot('lite-ai-sidebar-expanded.png')
  await run(`document.querySelector('.rail-history-toggle').click()`)
  await waitFor('document.querySelectorAll(".rail-history-list .rail-item").length === 5 && document.querySelector(".rail-history-list").scrollTop === 0')
  await saveScreenshot('lite-ai-sidebar-five.png')
  for (const height of [500,800]) {
    await run(`document.querySelector('.lite-ai-workspace-fixture').style.height='${height}px'`)
    assert.equal(await run(`(() => {const rail=document.querySelector('.ai-workspace-rail');const sections=[...document.querySelectorAll('.rail-conversations > .rail-section')];return rail.scrollHeight<=rail.clientHeight+1 && sections.every(section=>section.getBoundingClientRect().bottom<=rail.getBoundingClientRect().bottom)})()`), true, `Conversation sections stay bounded at a ${height}px workspace height`)
  }
  for (const view of ['cards', 'list']) {
    await run(`document.querySelector('.workspace-view-switch [data-view=${view}]').click()`)
    for (const targetSelected of [false, true]) {
      if (await run('!!document.querySelector(".workspace-clear-selection")')) await run(`document.querySelector('.workspace-clear-selection').click()`)
      await run(`document.querySelectorAll('.workspace-host-checkbox')[1].click()`)
      if (targetSelected) await run(`document.querySelector('.workspace-host-checkbox').click()`)
      const selectedBeforeDoubleClick = await run('Array.from(document.querySelectorAll(".workspace-host-checkbox:checked")).map(input=>input.closest(".workspace-card").dataset.connectionId)')
      const scopesBeforeDoubleClick = await run('window.__uiRegression.workspaceScopes.length')
      const opensBeforeDoubleClick = await run('window.__uiRegression.workspaceOpens.length')
      const doubleClickHost = await run('document.querySelector(".workspace-card").dataset.connectionId')
      await run(`(() => {const card=document.querySelector('.workspace-card');for(const [type,detail] of [['click',1],['click',2],['dblclick',2]]) card.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,detail}))})()`)
      await waitFor('document.querySelector(".workspace-scope-target") && document.querySelector(".lite-ai-chat .composer-input")')
      assert.equal(await run('window.__uiRegression.workspaceScopes.length'), scopesBeforeDoubleClick + 1, `${view} double-click starts exactly one conversation`)
      assert.deepEqual(await run('window.__uiRegression.workspaceScopes.at(-1).connectionIds'), [doubleClickHost], 'Double-click opens only the clicked server, independently of multi-selection')
      assert.equal(await run('window.__uiRegression.workspaceOpens.length'), opensBeforeDoubleClick, 'Double-click reuses an existing AI connection')
      await run(`document.querySelector('.workspace-close-session').click()`)
      await waitFor('document.querySelector(".workspace-browser")?.getClientRects().length')
      assert.deepEqual(await run('Array.from(document.querySelectorAll(".workspace-host-checkbox:checked")).map(input=>input.closest(".workspace-card").dataset.connectionId)'), selectedBeforeDoubleClick, 'Double-click preserves the previous selection for both selected and unselected targets')
    }
    const scopesBeforeCheckbox = await run('window.__uiRegression.workspaceScopes.length')
    await run(`(() => {const checkbox=document.querySelector('.workspace-host-checkbox');checkbox.click();checkbox.click();checkbox.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}))})()`)
    assert.equal(await run('window.__uiRegression.workspaceScopes.length'), scopesBeforeCheckbox, 'Double-clicking a checkbox only changes selection')
    assert.ok(await run('!!document.querySelector(".workspace-browser")'), 'Checkbox double-click stays on server browsing')
  }
  // Close directly from the rail without opening the target or disconnecting SSH.
  const closeTarget = await run(`document.querySelector('.rail-current-list .rail-item').dataset.connectionId`)
  const countBeforeClose = await run(`document.querySelectorAll('.rail-current-list .rail-item').length`)
  const disconnectsBeforeClose = await run(`window.__uiRegression.workspaceCloses.length`)
  await run(`(() => {window.__uiRegression.seedCloseableWorkspaceChat(${JSON.stringify(closeTarget)});window.__uiRegression.setWorkspaceChatLoading(${JSON.stringify(closeTarget)},true)})()`)
  await run(`document.querySelector('.rail-current-item .rail-close-chat').click()`)
  await waitFor(`Array.from(document.querySelectorAll('.el-message')).some(node=>node.textContent.includes('请先停止生成'))`)
  assert.equal(await run(`document.querySelectorAll('.rail-current-list .rail-item').length`), countBeforeClose, 'A generating conversation stays open when its close button is clicked')
  await run(`(() => {window.__uiRegression.setWorkspaceChatLoading(${JSON.stringify(closeTarget)},false);window.__uiRegression.setSuppressReplyFailure(true)})()`)
  await run(`document.querySelector('.rail-current-item .rail-close-chat').click()`)
  await waitFor(`Array.from(document.querySelectorAll('.el-message')).some(node=>node.textContent.includes('关闭会话失败'))`)
  assert.equal(await run(`document.querySelectorAll('.rail-current-list .rail-item').length`), countBeforeClose, 'A failed close retains the conversation')
  await run(`(() => {window.__uiRegression.setSuppressReplyFailure(false);document.querySelector('.rail-current-item .rail-close-chat').click()})()`)
  await waitFor(`document.querySelectorAll('.rail-current-list .rail-item').length===${countBeforeClose - 1}`)
  assert.ok(await run(`!!document.querySelector('.workspace-browser')?.getClientRects().length`), 'Closing from home does not open the conversation')
  assert.equal(await run(`window.__uiRegression.suppressedReplies.at(-1).sessionId`), closeTarget, 'Close suppresses automatic replies only for the selected conversation')
  assert.equal(await run(`window.__uiRegression.workspaceCloses.length`), disconnectsBeforeClose, 'Closing a rail conversation preserves SSH connections')
  if (await run(`document.querySelector('.rail-history-toggle')?.getAttribute('aria-expanded')==='false'`)) await run(`document.querySelector('.rail-history-toggle').click()`)
  await waitFor(`!!document.querySelector('.rail-history .rail-item[data-connection-id="${closeTarget}"]')`)
  await run(`document.querySelector('.rail-current-list .rail-item').click()`)
  const viewedScope = await run(`document.querySelector('.rail-current-list .rail-item.active').dataset.connectionId`)
  await run(`document.querySelector('.rail-current-list .rail-item:not(.active)').closest('.rail-current-item').querySelector('.rail-close-chat').click()`)
  await waitFor(`document.querySelectorAll('.rail-current-list .rail-item').length===${countBeforeClose - 2}`)
  assert.equal(await run(`document.querySelector('.rail-current-list .rail-item.active').dataset.connectionId`), viewedScope, 'Closing a different conversation leaves the current conversation selected')
  await run(`document.querySelector('.rail-current-list .rail-item.active').closest('.rail-current-item').querySelector('.rail-close-chat').click()`)
  await waitFor(`!!document.querySelector('.workspace-browser')?.getClientRects().length`)
  assert.equal(await run(`window.__uiRegression.workspaceCloses.length`), disconnectsBeforeClose, 'Closing the viewed conversation also preserves SSH connections')
  await saveScreenshot('lite-ai-sidebar-close-chat.png')
  await run(`document.querySelector('.rail-collapse').click()`)
  await saveScreenshot('lite-ai-redesign-collapsed.png')
  await run('window.__uiRegression.setWidth(320)')
  await saveScreenshot('ui-regression.png')
  console.log(JSON.stringify({passed:true,layoutCases,themeCases:themeCases.length,flows:['current group expansion and manual collapse','toolbar menu and Escape','sidebar pointer and keyboard resize','narrow window layout','theme selection and color tags','global search','keyboard connection','whole-card drag','button protection','bookmark rename','AI stages and stalled output','SFTP conflict and confirmed backup','directory upload selection'],artifacts}))
  clearTimeout(watchdog)
  window.destroy()
  app.quit()
}).catch(error => {
  console.error(error)
  console.error({ lastAction, artifacts })
  clearTimeout(watchdog)
  app.exit(1)
})
