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
// Hidden Electron windows can throttle animation frames, especially while
// other renderer suites compile. Keep per-condition deadlines at 15 seconds.
const suiteTimeoutMs = 600_000
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
    if (!source.startsWith('new Promise')) lastAction = source.slice(0, 180)
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
          usage:document.querySelector('.ai-fixture .usage-line')?.outerHTML,
          usagePanel:document.querySelector('.ai-usage-popover')?.outerHTML.slice(0,250),
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
    const cropSelector = name.startsWith('style-system-') ? '.style-system-fixture' : name.startsWith('lite-ai-') ? '.lite-ai-workspace-fixture' : name.startsWith('ai-settings-panel-') ? '.ai-image-composer-fixture' : name.startsWith('ai-background-result-') ? '.ai-fixture' : name.startsWith('ai-usage-') ? '.ai-fixture, .ai-usage-popover' : name.startsWith('ai-context-') ? '.ai-image-composer-fixture .composer, .ai-context-popover' : name.startsWith('ai-image-preview-') ? '.ai-image-dialog[open]' : null
    const rect = cropSelector ? await run(`(() => {
      const boxes=[...document.querySelectorAll('${cropSelector}')].map(node=>node.getBoundingClientRect());
      const r={left:Math.min(...boxes.map(box=>box.left)),top:Math.min(...boxes.map(box=>box.top)),right:Math.max(...boxes.map(box=>box.right)),bottom:Math.max(...boxes.map(box=>box.bottom))};
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
  const openConversationMenu = async () => {
    await run(`document.querySelector('.lite-ai-chat .ai-conversation-menu-trigger').click()`)
    await waitFor('document.querySelector(".ai-conversation-menu")')
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert.ok(await run(`(() => {const menu=document.querySelector('.ai-conversation-menu'),r=menu.getBoundingClientRect();return r.left>=0 && r.top>=0 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1 && menu.scrollWidth<=menu.clientWidth+1})()`), 'The conversation menu fits the viewport')
  }
  const disconnectAiConversation = async () => {
    const before = await run('window.__uiRegression.workspaceCloses.length')
    await openConversationMenu()
    await run(`document.querySelector('.ai-conversation-menu [data-action="disconnect"]').click()`)
    await waitFor('document.querySelector(".app-dialog")')
    await run(`document.querySelector('.app-dialog-actions button:last-child').click()`)
    await waitFor(`!document.querySelector('.app-dialog') && window.__uiRegression.workspaceCloses.length > ${before}`)
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
  const groupExpansion = 'Array.from(document.querySelectorAll(".group-item .collapse-btn")).map(button=>button.getAttribute("aria-expanded"))'
  const pressGroupKey = async (key) => run(`document.querySelector('.group-item.active').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true}))`)
  const searchGroups = async (query) => run(`(() => {const input=document.querySelector('.group-search-input');input.value=${JSON.stringify(query)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await run(`document.querySelector('.group-item.active .group-name').click()`)
  assert.deepEqual(await run(groupExpansion), ['false', 'false'], 'Clicking the current group name collapses its connections')
  assert.equal(await run('document.querySelectorAll(".connection-row").length'), 1, 'Collapsing the tree preserves the right-hand connection list')
  await pressGroupKey(' ')
  assert.deepEqual(await run(groupExpansion), ['true', 'false'], 'Space reopens the current group')
  await pressGroupKey('Enter')
  assert.deepEqual(await run(groupExpansion), ['false', 'false'], 'Enter toggles the current group')
  await pressGroupKey('ArrowRight')
  await pressGroupKey('ArrowRight')
  assert.deepEqual(await run(groupExpansion), ['true', 'false'], 'Right arrow expands without toggling shut')
  await pressGroupKey('ArrowLeft')
  await pressGroupKey('ArrowLeft')
  assert.deepEqual(await run(groupExpansion), ['false', 'false'], 'Left arrow collapses without reopening')
  await run(`document.querySelector('.smart-item').click()`)
  await run(`document.querySelector('.group-item').click()`)
  assert.equal(await run('!!document.querySelector(".group-item.active") && !document.querySelector(".smart-item.active")'), true, 'Returning from a smart view selects the group even if its ID is unchanged')
  assert.deepEqual(await run(groupExpansion), ['true', 'false'])
  await run(`document.querySelectorAll('.group-item .collapse-btn')[1].click()`)
  assert.equal(await run('document.querySelector(".group-item.active .group-name").textContent'), '默认分组', 'The arrow expands another group without selecting it')
  await run(`document.querySelectorAll('.group-item')[1].click()`)
  assert.deepEqual(await run(groupExpansion), ['true', 'true'], 'Selecting an already expanded other group keeps both groups open')
  await run(`document.querySelector('.group-item').click()`)
  await run(`document.querySelectorAll('.group-item .collapse-btn')[1].click()`)
  await searchGroups('server')
  assert.deepEqual(await run(groupExpansion), ['true', 'true'], 'Search reveals matching connections in every group')
  await run(`document.querySelectorAll('.group-item .collapse-btn')[1].click()`)
  assert.deepEqual(await run(groupExpansion), ['true', 'false'], 'Search results can be manually collapsed')
  await run(`document.querySelector('.group-item.active').click()`)
  assert.deepEqual(await run(groupExpansion), ['false', 'false'], 'Whole-row toggling also works during search')
  await pressGroupKey('ArrowRight')
  assert.deepEqual(await run(groupExpansion), ['true', 'false'], 'Keyboard expansion works during search')
  await searchGroups('服务器')
  assert.deepEqual(await run(groupExpansion), ['true', 'true'], 'A new search reveals results again')
  await searchGroups('')
  assert.deepEqual(await run(groupExpansion), ['true', 'false'], 'Clearing search restores the normal expansion state')
  assert.equal(await run('(() => {const rect=document.querySelector(".collapse-btn").getBoundingClientRect();return rect.width>=24 && rect.height>=24})()'), true, 'Expand arrows have a 24px click target')
  assert.equal(await run('window.__uiError || null'), null)
  if (process.env.LITECONNECT_UI_GROUPS_ONLY === '1') {
    await run(`document.querySelector('.group-item.active button[aria-label="更多分组操作"]').click()`)
    await waitFor('document.querySelector(".ui-menu[role=menu]")')
    await run(`Array.from(document.querySelectorAll('.ui-menu[role=menu] .ui-menu-item')).find(button=>button.textContent.trim()==='打开分组').click()`)
    const groupSelector = id => `.group-block[data-group-id="${id}"]`
    const openGroupMenu = async (id) => {
      await run(`document.querySelector(${JSON.stringify(`${groupSelector(id)} .group-item`)}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:150,clientY:300}))`)
      await waitFor('document.querySelector(".ui-menu[role=menu]")')
    }
    const clickGroupMenu = async (text) => {
      await run(`Array.from(document.querySelectorAll('.ui-menu[role=menu] .ui-menu-item')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`)
    }
    const addSubgroup = async (id, name) => {
      await openGroupMenu(id)
      await clickGroupMenu('新建子分组')
      await waitFor('document.querySelector(".app-dialog input")')
      await run(`(() => {const input=document.querySelector('.app-dialog input');input.value=${JSON.stringify(name)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.app-dialog-actions button:last-child').click()})()`)
      await waitFor(`Array.from(document.querySelectorAll('.group-name')).some(node=>node.textContent===${JSON.stringify(name)})`)
      return run(`document.querySelector('.group-item.active').closest('.group-block').dataset.groupId`)
    }
    const moveConnectionTo = async (connectionId, groupId) => {
      await run(`(() => {const dataTransfer=new DataTransfer();dataTransfer.setData('application/x-lite-connect-conn',${JSON.stringify(connectionId)});document.querySelector(${JSON.stringify(`${groupSelector(groupId)} .group-item`)}).dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}))})()`)
      await waitFor(`window.__uiRegression.calls.moves.includes(${JSON.stringify(`${connectionId}:${groupId}`)})`)
    }
    const child = await addSubgroup('prod', '应用')
    const leaf = await addSubgroup(child, '华东')
    assert.equal(await run(`document.querySelector(${JSON.stringify(groupSelector(leaf))}).dataset.depth`), '2', 'Grandchildren render at the third level')
    assert.equal(await run('document.querySelector(".page-title").textContent'), '生产环境 Production / 应用 / 华东', 'The selected group shows its full path')
    await moveConnectionTo('two', leaf)
    await run(`document.querySelector('.group-block[data-group-id="prod"] .group-item').click()`)
    assert.equal(await run('document.querySelectorAll(".connection-row").length'), 1, 'Parent selection includes hosts in nested groups')
    assert.equal(await run('document.querySelector(".connection-row .conn-group").title'), '生产环境 Production / 应用 / 华东', 'Aggregated results identify the connection’s full group path')
    assert.equal(await run('document.querySelector(".group-block[data-group-id=prod] .group-count").textContent'), '1', 'Parent count includes nested hosts')
    await run(`document.querySelector('.group-block[data-group-id="prod"] .group-item').click()`)
    assert.equal(await run(`!!document.querySelector(${JSON.stringify(groupSelector(leaf))})`), false, 'Collapsing a parent hides descendants')
    await searchGroups('Server two')
    assert.equal(await run(`document.querySelector(${JSON.stringify(groupSelector(leaf))}).querySelectorAll('.sidebar-conn').length`), 1, 'Host search reveals the complete ancestor chain')
    await searchGroups('应用')
    assert.equal(await run(`document.querySelector(${JSON.stringify(groupSelector(leaf))}).querySelectorAll('.sidebar-conn').length`), 1, 'Searching an ancestor group name shows descendant hosts')
    await searchGroups('')
    assert.equal(await run(`!!document.querySelector(${JSON.stringify(groupSelector(leaf))})`), false, 'Clearing nested search restores the collapsed parent')
    await run(`document.querySelector('.group-block[data-group-id="prod"] .collapse-btn').click()`)
    await openGroupMenu(child)
    await clickGroupMenu('移动分组到…')
    assert.equal(await run(`Array.from(document.querySelectorAll('.group-move-target')).some(button=>button.title.includes('应用'))`), false, 'Move targets exclude the source and its descendants')
    await run(`Array.from(document.querySelectorAll('.group-move-target')).find(button=>button.title==='默认分组').click()`)
    await waitFor(`document.querySelector(${JSON.stringify(`${groupSelector(child)} .group-name`)})?.title === '默认分组 / 应用'`)
    assert.equal(await run(`document.querySelector(${JSON.stringify(`${groupSelector(leaf)} .group-name`)}).title`), '默认分组 / 应用 / 华东', 'Moving a parent retains its subtree')
    await saveScreenshot('connection-nested-groups.png')
    await moveConnectionTo('one', child)
    await openGroupMenu(child)
    await clickGroupMenu('删除')
    await waitFor('document.querySelector(".app-dialog")')
    assert.ok(await run('document.querySelector(".app-dialog-message").textContent.includes("子分组将提升到上一级")'), 'Delete confirmation explains child promotion')
    await run(`document.querySelector('.app-dialog-actions button:last-child').click()`)
    await waitFor(`!document.querySelector(${JSON.stringify(groupSelector(child))})`)
    assert.equal(await run(`document.querySelector(${JSON.stringify(groupSelector(leaf))}).dataset.depth`), '1', 'Deleting a parent promotes its surviving children')
    await run(`document.querySelector('.group-block[data-group-id="dev"] .group-item').click()`)
    assert.equal(await run('document.querySelectorAll(".connection-row").length'), 2, 'Direct and nested connections both survive deletion')
    assert.equal(await run('window.__uiError || null'), null)
    await saveScreenshot('connection-groups.png')
    console.log(JSON.stringify({passed:true,flows:['group row and arrow toggling','keyboard expansion','smart view selection','search expansion overrides','nested group creation and selection','nested connection moves','ancestor search','subtree moves','child promotion on deletion'],artifacts}))
    clearTimeout(watchdog)
    window.destroy()
    app.quit()
    return
  }
  await run('window.__uiRegression.setConnectionStage("keyboard")')
  await waitFor('document.querySelector(".connection-row").textContent.includes("等待验证码")')
  await run('document.querySelector(".connection-row .action-btn.connect").click()')
  assert.deepEqual(await run('window.__uiRegression.cancelledConnections'), ['one'], 'Pending connection exposes a direct cancel action')
  assert.deepEqual(await run('window.__uiRegression.calls.connects'), [], 'Cancel does not start another connection')
  await run('window.__uiRegression.setConnectionStage()')
  await run('window.__uiRegression.setConnectionFailure(true)')
  await waitFor('document.querySelector(".connection-row .conn-error")?.textContent.includes("检查服务器是否开机")')
  assert.equal(await run('document.querySelector(".connection-row .action-btn.connect").getAttribute("aria-label")'), '重试连接')
  assert.ok(await run('document.querySelector(".sidebar-conn button[aria-label^=重试连接]")'), 'The compact connection tree also exposes the retained failure')
  assert.ok(await run('(() => {const row=document.querySelector(".connection-row"),error=row.querySelector(".conn-error");return error.getBoundingClientRect().bottom<=row.getBoundingClientRect().bottom && error.scrollWidth<=error.clientWidth+1})()'), 'The failure text stays inside the row and wraps')
  await saveScreenshot('ssh-offline-failure.png')
  await run('window.__uiRegression.setConnectionFailure(false)')
  for (const zoom of [0.92, 1, 1.08]) {
    window.webContents.setZoomFactor(zoom)
    await window.webContents.capturePage()
    for (const label of ['默认分组', 'Production', '生产环境 Production '.repeat(12)]) {
      const heading = await run(`(() => {
        const title=document.querySelector('.page-title');const count=document.querySelector('.page-result-count');
        title.textContent=${JSON.stringify(label)};
        const marker=()=>{const el=document.createElement('span');el.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';return el};
        const a=marker(),b=marker();title.append(a);count.append(b);
        const result={gap:Math.abs(a.getBoundingClientRect().top-b.getBoundingClientRect().top),
          overflow:title.getBoundingClientRect().right>document.querySelector('.page-title-row').getBoundingClientRect().right+1,
          ellipsis:getComputedStyle(title).textOverflow};
        a.remove();b.remove();return result;
      })()`)
      assert.ok(heading.gap < 1 && !heading.overflow && heading.ellipsis === 'ellipsis', `Heading label baseline at ${zoom}: ${JSON.stringify(heading)}`)
    }
  }
  window.webContents.setZoomFactor(1)
  await run('document.querySelector(".page-title").textContent="默认分组"')
  assert.equal(await run('(() => {const label=document.querySelector(".group-name");return label.scrollWidth <= label.clientWidth})()'), true, 'Short default group name is fully visible')
  await run('document.querySelector(".toolbar-more-button").click()')
  await waitFor('document.querySelector(".toolbar-menu")')
  await waitFor('document.querySelector(".toolbar-menu").contains(document.activeElement)')
  assert.equal(await run('document.querySelectorAll(".toolbar-menu button").length'), 4, 'Secondary toolbar actions and credentials remain available')
  const dropdownStyle = `(() => {const style=getComputedStyle(document.querySelector('.dropdown-menu'));return {background:style.backgroundColor,border:style.border,radius:style.borderRadius,shadow:style.boxShadow,padding:style.padding}})()`
  const actionMenuStyle = await run(dropdownStyle)
  await run('(() => {const button=document.querySelector(".toolbar-menu button:not(:disabled)");button.focus();button.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))})()')
  await waitFor('!document.querySelector(".toolbar-menu")')
  await waitFor('document.activeElement === document.querySelector(".toolbar-more-button")')
  await run('document.querySelector(".tag-filter .dropdown-trigger").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true}))')
  await waitFor('document.querySelector(".tag-filter-menu")?.contains(document.activeElement)')
  assert.deepEqual(await run(dropdownStyle), actionMenuStyle, 'Filter and action menus share the same themed surface')
  await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))')
  await waitFor('!document.querySelector(".tag-filter-menu") && document.activeElement === document.querySelector(".tag-filter .dropdown-trigger")')
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
      const chip=document.querySelector('.tag-filter .dropdown-trigger');
      const probe=document.createElement('span'); probe.style.background='var(--tab-selected-surface)'; document.body.append(probe);
      const result={ background:getComputedStyle(row).backgroundColor, expected:getComputedStyle(probe).backgroundColor,
        tag:getComputedStyle(row).borderLeftColor, chipText:getComputedStyle(chip).color, text:getComputedStyle(root).getPropertyValue('--text-primary').trim() };
      probe.remove(); return result;
    })()`)
    assert.equal(state.background, state.expected, `${theme} selection follows its theme token`)
    assert.notEqual(state.tag, state.background, 'Connection tag remains distinct from selected background')
    assert.ok(state.chipText, 'The tag filter trigger retains theme text')
    const actions = await run(`Array.from(document.querySelectorAll('.connection-row .secondary-action')).map(el => ({opacity:getComputedStyle(el).opacity,pointerEvents:getComputedStyle(el).pointerEvents}))`)
    assert.equal(actions.length, 1, 'More actions remain discoverable from the row menu')
    assert.ok(actions.every(action => action.opacity === '1' && action.pointerEvents !== 'none'), `${theme} row actions are visible and clickable without hover`)
    if (theme === 'custom') {
      await run('document.documentElement.style.setProperty("--text-primary", "#ae49e1")')
      await new Promise(resolve => setTimeout(resolve, 160))
      const dynamic = await run(`(() => {const row=document.querySelector('.connection-row');const probe=document.createElement('span');probe.style.background='var(--tab-selected-surface)';document.body.append(probe);const result={row:getComputedStyle(row).backgroundColor,expected:getComputedStyle(probe).backgroundColor};probe.remove();return result})()`)
      assert.equal(dynamic.row, dynamic.expected, 'Runtime token overrides update selected rows (neutral selection, docs/UI_STYLES.md)')
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
  await run('document.querySelector(".tag-filter .dropdown-trigger").click()')
  await waitFor('document.querySelector(".tag-filter-menu")?.contains(document.activeElement)')
  await saveScreenshot('filter-menu-light.png')
  await run('(() => {const button=document.querySelector(".toolbar-more-button");button.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));button.click()})()')
  await waitFor('document.querySelector(".toolbar-menu") && !document.querySelector(".tag-filter-menu")')
  await saveScreenshot('action-menu-light.png')
  await run('document.querySelector(".toolbar-more-button").click()')
  await run('window.__uiRegression.setTheme("dark")')

  for (const mode of ['recent', 'frequent', 'manual']) {
    await run('document.querySelector(".sort-control .dropdown-trigger").click()')
    await waitFor('!!document.querySelector(".sort-menu")')
    await run('document.querySelector(".sort-menu [data-value=' + mode + ']").click()')
    await waitFor('document.querySelector(".sort-control").dataset.value===' + JSON.stringify(mode))
  }

  await run(`(() => {
    const input = document.querySelector('.search-input');
    input.value = 'Server'; input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  await waitFor('document.querySelectorAll(".connection-row").length === 1')
  await run('document.querySelector(".smart-item[data-view=all]").click()')
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
  await run('document.querySelector(".group-block[data-group-id=prod] .group-item").click()')
  await waitFor('document.querySelector(".page-title").textContent === "生产环境 Production" && !document.querySelector(".smart-item.active")')

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
    assert.equal(await run('document.querySelectorAll(".sftp-toolbar-menu button").length'), 4, 'Secondary SFTP actions remain available (collapse, upload folder, sync, query cwd)')
    assert.equal(await run(`(() => {const menu=document.querySelector('.sftp-toolbar-menu').getBoundingClientRect();const pane=document.querySelector('.sftp-toolbar-fixture').getBoundingClientRect();return menu.left>=pane.left-1 && menu.right<=pane.right+1})()`), true, 'Overflow menu fits within the pane')
    if (width === 280) await saveScreenshot('sftp-toolbar-narrow.png')
    await run('document.querySelector(".sftp-toolbar-more .dropdown-trigger").click()')
  }
  await run(`window.__uiRegression.setTreeFiles(${JSON.stringify([
    { name: 'anaconda-ks.cfg', path: '/anaconda-ks.cfg', isDirectory: false, isSymlink: false, size: 1945, modifyTime: 1, permissions: 'rw-r--r--' },
    { name: 'commons-compress.jar', path: '/commons-compress.jar', isDirectory: false, isSymlink: false, size: 1048576, modifyTime: 1, permissions: 'rw-r--r--' },
  ])})`)
  const sizeAlignment = await run(`(() => {
    const pane=document.querySelector('.sftp-tree-fixture');pane.style.width='360px';
    const rows=[...pane.querySelectorAll('.tree-row')].filter(row=>row.querySelector('.tree-size'));
    const edges=rows.map(row=>Math.round(row.querySelector('.tree-size').getBoundingClientRect().right));
    const actions=rows.map(row=>row.querySelectorAll('.tree-quick-btn').length);
    return {edges,actions};
  })()`)
  assert.deepEqual(sizeAlignment.actions, [2, 1], 'Only editable files show the edit action')
  assert.ok(Math.max(...sizeAlignment.edges) - Math.min(...sizeAlignment.edges) <= 1, `SFTP sizes stay aligned: ${JSON.stringify(sizeAlignment)}`)
  await run('window.__uiRegression.setTreeName("config.log")')
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
  assert.deepEqual(await run(`Array.from(document.querySelectorAll('.ai-fixture .tool-run-state')).map(el=>el.textContent.trim())`), ['成功', '成功', '成功', '已启动', '失败'], 'Tool outcomes use unified status labels')
  assert.equal(await run(`document.querySelector('.ai-fixture').textContent.includes('退出码')`), false, 'Tool cards label the outcome without a numeric code heading')
  assert.match(await run(`document.querySelector('.ai-fixture .tool-run-exit')?.textContent || ''`), /^exit \d+$/, 'A failed command shows its exit code')
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
      assert.deepEqual(await run(`Array.from(document.querySelectorAll('.background-result-body .tool-run-state')).map(node=>node.textContent.trim())`), ['成功', '失败', '已超时', '已停止'], 'Delivered results share the tool row outcomes including failed exit codes and timeouts')
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

  const usageRows = () => run(`Object.fromEntries([...document.querySelectorAll('.ai-usage-popover .usage-row')].map(row=>[row.querySelector('dt').textContent,row.querySelector('dd').textContent]))`)
  const openUsage = async () => {
    await run(`document.querySelector('.ai-fixture .usage-line').click()`)
    await waitFor(`document.querySelector('.ai-fixture .usage-line')?.getAttribute('aria-expanded')==='true' && !!document.querySelector('.ai-usage-popover .usage-details')`)
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  }
  const closeUsage = async () => {
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await waitFor(`document.querySelector('.ai-fixture .usage-line')?.getAttribute('aria-expanded')==='false' && !document.querySelector('.ai-usage-popover .usage-details')`)
  }
  await run('window.__uiRegression.aiUsage({promptTokens:3000,cachedPromptTokens:2300,uncachedPromptTokens:700,completionTokens:300,reasoningTokens:60,totalTokens:3300,requestCount:2,streamOutput:{tokens:227,durationMs:1000}})')
  await waitFor(`document.querySelector('.ai-fixture .usage-line')?.textContent.includes('用量 3.3k tok · 227 tok/s')`)
  assert.equal(await run(`document.querySelector('.ai-fixture .usage-line').textContent.includes('缓存')`), false, 'Footer keeps cache and output details inside the disclosure')
  await run(`document.querySelector('.ai-fixture').scrollIntoView({block:'center'})`)
  await openUsage()
  assert.deepEqual(await usageRows(), {'输入总量':'3,000 tok','缓存命中率':'76.7%','未缓存输入':'700 tok','缓存读取':'2,300 tok','输出':'300 tok','流式输出速度':'227 tok/s','其中推理':'60 tok','模型请求次数':'2'}, 'Popover exposes exact accounting and the measured stream rate')
  await run(`document.querySelector('.ai-fixture .usage-line').dispatchEvent(new MouseEvent('mouseleave'))`)
  await run(`new Promise(resolve=>setTimeout(resolve,220))`)
  assert.equal(await run(`document.querySelector('.ai-fixture .usage-line').getAttribute('aria-expanded')`), 'true', 'Click pins the preview after the pointer leaves')
  await closeUsage()
  await run(`document.querySelector('.ai-fixture .usage-line').dispatchEvent(new MouseEvent('mouseenter'))`)
  await waitFor(`!!document.querySelector('.ai-usage-popover .usage-details')`)
  await run(`document.querySelector('.ai-fixture .usage-line').dispatchEvent(new MouseEvent('mouseleave'))`)
  await waitFor(`!document.querySelector('.ai-usage-popover .usage-details')`)
  window.webContents.focus()
  await run(`document.querySelector('.ai-fixture .usage-line').focus()`)
  assert.equal(await run(`document.activeElement===document.querySelector('.ai-fixture .usage-line')`), true, 'Keyboard test starts on the usage button')
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'})
  window.webContents.sendInputEvent({type:'char',keyCode:'Enter'})
  window.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'})
  await waitFor(`document.querySelector('.ai-fixture .usage-line').getAttribute('aria-expanded')==='true'`)
  await closeUsage()
  assert.equal(await run(`document.activeElement===document.querySelector('.ai-fixture .usage-line')`), true, 'Escape preserves keyboard focus on the usage button')
  await openUsage()
  await run(`document.querySelector('.ai-fixture .message-content').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
  await waitFor(`document.querySelector('.ai-fixture .usage-line').getAttribute('aria-expanded')==='false'`)

  for (const theme of ['light','dark','eyecare']) {
    await run(`window.__uiRegression.setTheme('${theme}')`)
    for (const width of [300,440,900]) {
      await run(`(() => {const fixture=document.querySelector('.ai-fixture');fixture.style.width='${width}px';fixture.scrollIntoView({block:'center'})})()`)
      await run('window.__uiRegression.aiUsage({promptTokens:7498817,cachedPromptTokens:7491072,uncachedPromptTokens:7745,completionTokens:13730,totalTokens:7512547,requestCount:18})')
      await waitFor(`document.querySelector('.ai-fixture .usage-line')?.textContent.includes('7.5M')`)
      assert.ok(await run(`(() => {const footer=document.querySelector('.ai-fixture .message-footer');const nodes=[footer.querySelector('.usage-line'),footer.querySelector('.message-time'),footer.querySelector('.message-actions')];return footer.scrollWidth<=footer.clientWidth+1 && nodes.every(node=>Math.abs(node.getBoundingClientRect().top+node.clientHeight/2-(nodes[0].getBoundingClientRect().top+nodes[0].clientHeight/2))<3)})()`), `Usage, time and actions share a row at ${theme}/${width}px`)
      await openUsage()
      assert.equal((await usageRows())['缓存命中率'], '99.9%')
      assert.equal(await run(`document.querySelector('.usage-heading strong').textContent`), '7,512,547 tok')
      assert.ok(await run(`(() => {const panel=document.querySelector('.ai-usage-popover');const rect=panel.getBoundingClientRect();return panel.scrollWidth<=panel.clientWidth+1 && rect.left>=0 && rect.right<=innerWidth+1 && rect.top>=0 && rect.bottom<=innerHeight+1 && !document.querySelector('.ai-fixture').contains(panel)})()`), `Teleported details stay inside the viewport at ${theme}/${width}px`)
      await saveScreenshot(`ai-usage-${theme}-${width}.png`)
      await closeUsage()
    }
  }
  await run(`window.__uiRegression.setTheme('light')`)
  await run(`document.querySelector('.ai-fixture').style.width='440px'`)
  await run('window.__uiRegression.aiUsage({promptTokens:3000,cachedPromptTokens:800,uncachedPromptTokens:200,completionTokens:300,totalTokens:3300,requestCount:2,cacheUsageIncomplete:true})')
  await waitFor(`!!document.querySelector('.ai-fixture .usage-partial')`)
  await openUsage()
  assert.equal((await usageRows())['缓存命中率'], '未返回', 'Incomplete cache data does not produce a misleading turn-wide hit rate')
  assert.equal((await usageRows())['未缓存输入'], '200 tok')
  assert.ok(await run(`document.querySelector('.usage-incomplete').textContent.includes('部分请求未返回缓存明细')`))
  await closeUsage()
  await run('window.__uiRegression.aiUsage({promptTokens:1000,completionTokens:100})')
  assert.equal(await run(`document.querySelector('.ai-fixture .usage-line').textContent.includes('tok/s')`), false, 'Older history has no measured stream rate')
  await openUsage()
  assert.equal((await usageRows())['缓存读取'], '未返回', 'Unknown cache statistics never become zero hits')
  assert.equal((await usageRows())['缓存命中率'], '未返回')
  await closeUsage()
  await run('window.__uiRegression.aiUsage({requestCount:1,usageIncomplete:true,cacheUsageIncomplete:true})')
  await waitFor(`document.querySelector('.ai-fixture .usage-line')?.textContent.includes('未返回用量')`)
  await openUsage()
  assert.equal(await run(`document.querySelector('.usage-heading strong').textContent`), '未返回')
  assert.equal((await usageRows())['输出'], '未返回')
  await closeUsage()

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
  await waitFor('!!document.querySelector(".composer-input") && !document.querySelector(".composer input[type=file], .composer-add-image")')
  assert.equal(await run(`document.querySelector('.composer-context-meter')`), null, 'SSH sidebars omit the context meter')
  await run('window.__uiRegression.setContextLayout(true)')
  await waitFor(`!!document.querySelector('.composer-context-meter')`)
  const initialContextPercent = await run('Number(document.querySelector(".composer-context-meter [role=meter]").getAttribute("aria-valuenow"))')
  assert.ok(await run('document.querySelector(".composer-context-meter").getAttribute("aria-label").includes("自动压缩触发点")'), 'Context meter explains the backend pressure threshold')
  await run(`(() => {const input=document.querySelector('.composer-input');input.value='测试草稿'.repeat(2000);input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor(`Number(document.querySelector('.composer-context-meter [role=meter]').getAttribute('aria-valuenow')) > ${initialContextPercent}`)
  assert.equal(await run('window.__uiRegression.calls.aiRequests.length'), 0, 'Draft context estimation never makes a model request')
  await run(`(() => {const input=document.querySelector('.composer-input');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await run('document.querySelector(".ai-image-composer-fixture").scrollIntoView({block:"center"})')
  const openContext = async () => {
    await run(`document.querySelector('.composer-context-meter').click()`)
    await waitFor(`document.querySelector('.composer-context-meter').getAttribute('aria-expanded')==='true' && !!document.querySelector('.context-info-rows')`)
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  }
  const closeContext = async () => {
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await waitFor(`!document.querySelector('.context-info-rows')`)
  }
  await openContext()
  assert.ok(await run(`document.querySelector('.context-info-source').textContent.includes('未识别模型容量')`), 'Unknown model capacity explicitly identifies the default budget')
  assert.ok(await run(`document.querySelector('.context-compact-button').disabled`), 'An empty chat can inspect context without enabling manual compaction')
  assert.equal(await run(`window.__uiRegression.manualCompactions.length`), 0, 'Clicking the ring opens information without compacting')
  await closeContext()
  await run('window.__uiRegression.setContextModelWindow(undefined,64000)')
  await openContext()
  assert.ok(await run(`document.querySelector('.context-info-source').textContent.includes('提供商接口') && document.querySelector('.context-info-summary').textContent.includes('64k')`), 'Provider capacity is identified and replaces the fallback budget')
  await closeContext()
  await run('window.__uiRegression.setContextModelWindow(32000,64000)')
  await openContext()
  assert.ok(await run(`document.querySelector('.context-info-source').textContent.includes('手动设置') && document.querySelector('.context-info-summary').textContent.includes('32k')`), 'A manual capacity override takes precedence over provider metadata')
  await closeContext()
  await run('window.__uiRegression.setContextModelWindow()')
  await run('window.__uiRegression.setLiveContextPressure({usedTokens:81400,windowTokens:300000,outputReserveTokens:16384,inputBudgetTokens:283616,thresholdTokens:226892,retainTokens:15000})')
  await waitFor(`document.querySelector('.context-meter-percent').textContent==='27.1%'`)
  await openContext()
  assert.equal(await run(`document.querySelector('.context-info-summary').textContent`), '81.4k / 300k tok')
  assert.deepEqual(await run(`Array.from(document.querySelectorAll('.context-info-rows dd')).map(node=>node.textContent)`), ['81,400 tok','300,000 tok','16,384 tok','226,892 tok','0'], 'The ring displays exact runtime context pressure, not reply usage')
  assert.equal(await run(`document.querySelector('.context-compact-button').disabled`), true, 'Context information remains available while generating, but compaction is disabled')
  await closeContext()
  for (const workspace of [false,true]) {
    await run(`window.__uiRegression.setContextLayout(${workspace})`)
    for (const width of [300,440,900]) {
      await run(`(() => {const fixture=document.querySelector('.ai-image-composer-fixture');fixture.style.width='${width}px';fixture.scrollIntoView({block:'center'})})()`)
      if (workspace) {
        await openContext()
        assert.ok(await run(`(() => {const panel=document.querySelector('.ai-context-popover'),rect=panel.getBoundingClientRect(),form=document.querySelector('.composer');return panel.scrollWidth<=panel.clientWidth+1 && rect.left>=0 && rect.right<=innerWidth+1 && rect.top>=0 && rect.bottom<=innerHeight+1 && form.scrollWidth<=form.clientWidth+1})()`), `LiteAI context information fits ${width}px`)
        assert.ok(await run(`(() => {const label=document.querySelector('.ai-model-switcher-name'),button=document.querySelector('.ai-model-switcher'),meter=document.querySelector('.composer-context-meter');return label.getBoundingClientRect().width>=40 && button.getBoundingClientRect().right<=meter.getBoundingClientRect().left+1})()`), 'The context meter does not squeeze out or overlap the model name')
      }
      if (!workspace) {
        assert.ok(await run(`(() => {
          const form=document.querySelector('.ai-image-composer-fixture .composer');
          const permission=form.querySelector('.composer-permission-selector');
          const center=node=>{const r=node.getBoundingClientRect();return r.top+r.height/2};
          const model=form.querySelector('.model-switcher-wrap');
          const send=form.querySelector('.send-btn,.stop-btn');
          return !form.querySelector('.composer-context-meter,.context-meter-percent')
            && form.querySelector('.ai-model-switcher-name').getBoundingClientRect().width>=40
            && form.scrollWidth<=form.clientWidth+1
            && form.querySelectorAll('.composer-permission-selector').length===1
            && permission.closest('.composer-actions-right')
            && Math.abs(center(permission)-center(send))<2
            && Math.abs(center(model)-center(send))<2
            && model.getBoundingClientRect().right<=permission.getBoundingClientRect().left+1
            && permission.getBoundingClientRect().right<=send.getBoundingClientRect().left+1
            && !form.querySelector('.composer-context-strip .composer-permission-selector');
        })()`), `Sidebar model, permissions and send controls share one row without overlap at ${width}px`)
      }
      await saveScreenshot(`ai-context-${workspace?'workspace':'sidebar'}-${width}.png`)
      if (workspace) await closeContext()
    }
  }
  await run(`window.__uiRegression.setContextLayout(false)`)
  await run(`document.querySelector('.ai-image-composer-fixture').style.width='440px'`)
  await run('window.__uiRegression.setLiveContextPressure({usedTokens:290000,windowTokens:300000,outputReserveTokens:4000,inputBudgetTokens:296000,thresholdTokens:236800,retainTokens:15000})')
  assert.equal(await run(`document.querySelector('.composer-context-meter,.context-meter-percent,.composer-context-warning[role="status"]')`), null, 'SSH sidebars omit context percentages even near the capacity limit')
  await run('window.__uiRegression.setLiveContextPressure()')
  await run(`document.querySelector('.ai-model-switcher').click()`)
  await waitFor(`!!document.querySelector('.model-switcher-dropdown')`)
  assert.equal(await run(`document.querySelector('.model-context-info')`), null, 'SSH model menus also omit context statistics')
  await waitFor(`document.activeElement?.matches('.model-switcher-item[role="menuitemradio"]')`)
  assert.equal(await run(`document.querySelector('.model-switcher-dropdown').getAttribute('role')`), 'menu', 'Model switching exposes menu semantics')
  for (const [key, index] of [['End', -1], ['ArrowDown', 0], ['Home', 0], ['ArrowUp', -1]]) {
    await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true}))`)
    assert.ok(await run(`document.activeElement===Array.from(document.querySelectorAll('.model-switcher-item')).at(${index})`), `${key} navigates the model menu`)
  }
  await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`)
  await waitFor(`!document.querySelector('.model-switcher-dropdown') && document.activeElement.matches('.ai-model-switcher')`)
  await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}))`)
  await waitFor(`document.activeElement===Array.from(document.querySelectorAll('.model-switcher-item')).at(-1)`)
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'})
  window.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'})
  await waitFor(`!document.querySelector('.model-switcher-dropdown') && !document.activeElement.matches('.ai-model-switcher')`)
  await run(`document.querySelector('.ai-model-switcher').click()`)
  await waitFor(`!!document.querySelector('.model-switcher-dropdown')`)
  await run(`document.querySelector('.model-switcher-overlay')?.click()`)
  await waitFor(`!document.querySelector('.model-switcher-dropdown')`)
  const addFixtureImage = (mode, color) => run(`(async () => {
    const canvas=document.createElement('canvas');canvas.width=800;canvas.height=450;
    const ctx=canvas.getContext('2d');ctx.fillStyle=${JSON.stringify(color)};ctx.fillRect(0,0,800,450);ctx.fillStyle='#fff';ctx.font='32px sans-serif';ctx.fillText('Connection refused / 连接失败',40,90);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const file=new File([blob],'报错截图.png',{type:'image/png'});const transfer=new DataTransfer();transfer.items.add(file);
    if(${JSON.stringify(mode)}==='paste')document.querySelector('.composer-input').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
    else document.querySelector('.ai-image-composer-fixture .ai-sidebar').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
  })()`)
  await addFixtureImage('paste', '#174e7b')
  await waitFor('document.querySelectorAll(".composer-images .ai-image-thumbnail").length === 1')
  await run('document.querySelector(".composer-images .ai-image-thumbnail").click()')
  await waitFor('document.querySelector(".ai-image-dialog[open] img")?.naturalWidth === 800')
  assert.equal(await run('document.querySelector(".ai-image-dialog[open] img").naturalWidth'), 800)
  const checkImagePreview = async () => {
    await waitFor('document.querySelector(".ai-image-dialog img").getBoundingClientRect().width > 0')
    const initial = await run(`(() => {const r=document.querySelector('.ai-image-dialog').getBoundingClientRect();return {x:r.left,y:r.top,centered:Math.abs(r.left+r.width/2-innerWidth/2)<2 && Math.abs(r.top+r.height/2-innerHeight/2)<2,scale:document.querySelector('.ai-image-preview-scale').textContent}})()`)
    assert.ok(initial.centered, 'Image previews start centered instead of inheriting the global zero-margin reset')
    const drag = async (selector, dx, dy) => {
      const point = await run(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
      const zoom = window.webContents.getZoomFactor()
      const from = { x: Math.round(point.x * zoom), y: Math.round(point.y * zoom) }
      const to = { x: Math.round((point.x + dx) * zoom), y: Math.round((point.y + dy) * zoom) }
      window.webContents.sendInputEvent({ type: 'mouseMove', ...from })
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...from })
      window.webContents.sendInputEvent({ type: 'mouseMove', ...to })
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...to })
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    }
    await drag('.ai-image-preview-head > span', 24, 16)
    assert.ok(await run(`(() => {const r=document.querySelector('.ai-image-dialog').getBoundingClientRect();return r.left>${initial.x}+1 && r.top>${initial.y}+1 && r.right<=innerWidth && r.bottom<=innerHeight})()`), 'The title bar moves the preview within the window bounds')
    await run(`(() => {const button=document.querySelector('.ai-image-preview-toolbar [aria-label="放大图片"]');button.click();button.click()})()`)
    await waitFor('document.querySelector(".ai-image-preview-viewport").classList.contains("pannable")')
    const before = await run(`(() => {const r=document.querySelector('.ai-image-dialog img').getBoundingClientRect();return {x:r.left,y:r.top,width:r.width}})()`)
    await drag('.ai-image-preview-viewport', 36, 24)
    assert.ok(await run(`(() => {const image=document.querySelector('.ai-image-dialog img').getBoundingClientRect(),stage=document.querySelector('.ai-image-preview-viewport').getBoundingClientRect();return Math.abs(image.left-(${before.x}))>1 && (image.width<=stage.width+1 || image.left<=stage.left+1 && image.right>=stage.right-1)})()`), 'Enlarged images pan without exposing empty space beyond their edges')
    await run(`(() => {const stage=document.querySelector('.ai-image-preview-viewport'),r=stage.getBoundingClientRect();stage.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,cancelable:true}))})()`)
    assert.ok(await run(`document.querySelector('.ai-image-dialog img').getBoundingClientRect().width>${before.width}`), 'The wheel zooms the image')
    await saveScreenshot('ai-image-preview-zoomed.png')
    await run(`document.querySelector('.ai-image-preview-toolbar [aria-label="适应窗口"]').click()`)
    assert.equal(await run('document.querySelector(".ai-image-preview-scale").textContent'), initial.scale, 'Fit restores the initial zoom')
    assert.equal(await run('document.querySelector(".ai-image-preview-viewport").classList.contains("pannable")'), false)
    await saveScreenshot('ai-image-preview-fit.png')
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await waitFor('!document.querySelector(".ai-image-dialog[open]")')
    await run('document.querySelector(".composer-images .ai-image-thumbnail").click()')
    await waitFor('document.querySelector(".ai-image-dialog[open] img")?.getBoundingClientRect().width > 0')
    assert.equal(await run('document.querySelector(".ai-image-preview-scale").textContent'), initial.scale, 'Reopening starts with a fresh view')
  }
  await checkImagePreview()
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
  await run('window.__uiRegression.setContextLayout(true)')
  const rowsBeforeManualCompaction = await run('document.querySelectorAll(".ai-image-composer-fixture .chat-row").length')
  await run(`(() => {const input=document.querySelector('.composer-input');input.value='手动压缩时保留草稿';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.composer-context-meter').click()})()`)
  await waitFor(`!!document.querySelector('.context-compact-button') && !document.querySelector('.context-compact-button').disabled`)
  await run(`document.querySelector('.context-compact-button').click()`)
  await waitFor('window.__uiRegression.manualCompactions.length === 1 && !document.querySelector(".stop-btn")')
  assert.equal(await run('document.querySelectorAll(".ai-image-composer-fixture .chat-row").length'), rowsBeforeManualCompaction, 'Manual compaction creates no chat message')
  assert.equal(await run('document.querySelector(".composer-input").value'), '手动压缩时保留草稿', 'Manual compaction preserves the unsent draft')
  await run('window.__uiRegression.setContextLayout(false)')
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
  await run(`document.querySelector('.background-float-trigger').click()`)
  await waitFor('document.querySelector(".background-popover") && !document.querySelector(".background-popover").getAnimations({subtree:true}).length')
  await waitFor('document.querySelector(".ai-background-tasks code")?.textContent.includes("sleep 30")')
  await run(`document.querySelector('.background-job').open=true`)
  await waitFor('document.querySelector(".background-job-detail")?.textContent.includes("命令执行中")')
  assert.equal(await run('document.querySelector(".background-job-detail .tool-run-args").textContent'), 'sleep 30 && echo done', 'Expanded background task shows the full command')
  await run(`window.__uiRegression.switchImageSession('other-fixture')`)
  await waitFor('!document.querySelector(".ai-background-tasks") && !document.querySelector(".background-toolbar-fixture .ai-task-count-badge")')
  await run(`window.__uiRegression.switchImageSession('image-fixture')`)
  await waitFor('document.querySelector(".ai-background-tasks.running")')
  await run(`document.querySelector('.background-float-trigger').click()`)
  await waitFor('document.querySelector(".background-popover") && !document.querySelector(".background-popover").getAnimations({subtree:true}).length')
  await waitFor('document.querySelector(".background-job")')
  await run(`document.querySelector('.background-job').open=true`)
  await saveScreenshot('ai-background-running.png')
  await run(`(() => { window.__uiRegression.setBackgroundJobs([{jobId:'stop-one',sessionId:'image-fixture',command:'sleep 90',status:'running',startedAt:1},{jobId:'keep-running',sessionId:'image-fixture',command:'sleep 120',status:'running',startedAt:1}]); window.__uiRegression.setCancelJobFailure(true) })()`)
  await waitFor('document.querySelectorAll(".background-job-stop").length === 2')
  const requestsBeforeStop = await run('window.__uiRegression.calls.aiRequests.length')
  await run(`document.querySelector('.background-job-stop').click()`)
  await waitFor('document.querySelector(".ai-background-tasks [role=alert]")?.textContent.includes("停止任务失败")')
  assert.equal(await run('document.querySelectorAll(".background-job-stop").length'), 2, 'Failed interruption retains running state and permits retry')
  await run(`(() => { window.__uiRegression.setCancelJobFailure(false); document.querySelector('.background-job-stop').click() })()`)
  await waitFor('document.querySelectorAll(".background-job-stop").length === 1 && document.querySelector(".ai-background-tasks li[data-status=stopped]")')
  assert.equal(await run('document.querySelector(".background-job-stop").closest("li").querySelector("code").textContent'), 'sleep 120', 'Interruption targets only the selected job')
  assert.equal(await run('window.__uiRegression.calls.aiRequests.length'), requestsBeforeStop, 'Interruption never sends a new AI message')
  await saveScreenshot('ai-background-interrupted.png')
  await run(`window.__uiRegression.setBackgroundJobs([{jobId:'failed-job',sessionId:'image-fixture',command:'false',status:'completed',startedAt:1,finishedAt:2,exitCode:127}])`)
  await waitFor('document.querySelector(".ai-background-tasks .tool-run-state")?.textContent === "失败"')
  assert.equal(await run('document.querySelector(".ai-background-tasks").textContent.includes("退出码")'), false, 'Nonzero background exits show failure without an exit code')
  await run(`window.__uiRegression.setBackgroundJobs([{jobId:'running-job',sessionId:'image-fixture',command:'sleep 30 && echo done',status:'completed',startedAt:1,finishedAt:2,exitCode:0}])`)
  await waitFor('!document.querySelector(".background-toolbar-fixture .ai-task-count-badge") && !document.querySelector(".ai-background-tasks.running")')
  await run(`document.querySelector('.background-job').open=true`)
  await waitFor('document.querySelector(".ai-background-tasks li")?.textContent.includes("成功")')
  await waitFor('document.querySelector(".background-job-detail .tool-run-out")?.textContent.includes("verification passed")')
  assert.ok(await run('document.querySelector(".background-job-times").title.includes("结束时间") && document.querySelector(".background-job-times").textContent.includes("–")'), 'Completed jobs show a compact time range with full timestamps in the tooltip')
  assert.equal(await run('document.querySelector(".ai-background-tasks .tool-run-detail")'), null, 'Successful jobs omit the redundant zero exit code')
  assert.equal(await run('document.querySelector(".ai-background-tasks .tool-run-state").textContent'), '成功', 'Background jobs use the tool card completion label')
  await saveScreenshot('ai-background-completed-details.png')
  const backgroundScroll = await run(`(() => {
    const body=document.querySelector('.background-task-body');
    const output=body.querySelector('.tool-run-out');
    output.textContent='long background command output\\n'.repeat(100);
    const before=body.scrollTop; body.scrollTop=body.scrollHeight;
    return {height:body.clientHeight,overflow:body.scrollHeight>body.clientHeight,scrollable:body.scrollTop>before,heading:body.parentElement.querySelector('.background-heading').getBoundingClientRect().height};
  })()`)
  assert.ok(backgroundScroll.height <= 420 && backgroundScroll.overflow && backgroundScroll.scrollable && backgroundScroll.heading > 0, 'Long task details scroll within a capped area while the heading remains outside it')
  await run(`window.__uiRegression.setBackgroundJobs([{jobId:'cancel-on-new',sessionId:'image-fixture',command:'sleep 120',status:'running',startedAt:Date.now()}])`)
  await run('window.__uiRegression.seedConversationMessage()')
  const beforeNew = await run('({creates:window.__uiRegression.calls.aiCreates.length,requests:window.__uiRegression.calls.aiRequests.length,thread:window.__uiRegression.imageSessionState("image-fixture").threadId})')
  await run(`document.querySelector('.ai-image-composer-fixture .ai-header-actions button[title^="保留当前对话"]').click()`)
  await waitFor('document.querySelector(".app-dialog-actions .ui-btn") && document.body.textContent.includes("中断后台任务并新建对话")')
  assert.equal(await run('window.__uiRegression.calls.aiCreates.length'), beforeNew.creates, 'Opening confirmation does not create a conversation')
  await run(`document.querySelector('.app-dialog-actions .ui-btn:first-child').click()`)
  await waitFor('!document.querySelector(".app-dialog-actions")')
  assert.equal(await run('window.__uiRegression.imageSessionState("image-fixture").threadId'), beforeNew.thread, 'Cancelling retains the current conversation')
  assert.ok(await run('document.querySelector(".ai-background-tasks.running") !== null'), 'Cancelling retains the running job')
  await run(`document.querySelector('.ai-image-composer-fixture .ai-header-actions button[title^="保留当前对话"]').click()`)
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
  await run('window.__uiRegression.showStylePreview()')
  await waitFor('document.querySelector(".style-system-fixture .settings-select")')
  const initialFont = await run('document.querySelector(".style-system-fixture .font-size-value").textContent')
  await run('document.querySelector(".style-system-fixture .font-size-row button:last-child").click()')
  await waitFor('document.querySelector(".style-system-fixture .font-size-value").textContent !== ' + JSON.stringify(initialFont))
  await run(`(() => {const select=document.querySelector('.style-system-fixture .settings-select');select.value='skip';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  assert.equal(await run('document.querySelector(".style-system-fixture .settings-select").value'), 'skip', 'Shared settings controls retain their editing behavior')
  const styleCases = []
  for (const theme of ['light', 'dark', 'eyecare']) {
    await run(`window.__uiRegression.setTheme('${theme}')`)
    for (const width of [300, 600]) {
      await run(`(() => {const root=document.querySelector('.style-system-fixture');root.style.width='${width}px';root.scrollIntoView({block:'start'})})()`)
      const state = await run(`(() => {const root=document.querySelector('.style-system-fixture'),bounds=root.getBoundingClientRect();return {fits:root.scrollWidth<=root.clientWidth+1,controlsFit:[...root.querySelectorAll('button,select')].every(node=>{const box=node.getBoundingClientRect();return box.left>=bounds.left-1&&box.right<=bounds.right+1}),scoped:getComputedStyle(root.querySelector('.settings-content')).containerName,colors:[...root.querySelectorAll('.file-type-icon')].map(node=>getComputedStyle(node).color)}})()`)
      assert.ok(state.fits && state.controlsFit, `Shared settings fit ${theme}/${width}: ${JSON.stringify(state)}`)
      assert.equal(state.scoped, 'settings-panel', 'General settings retain their own layout container')
      styleCases.push({ theme, width, colors: state.colors })
      await saveScreenshot(`style-system-${theme}-${width}.png`)
    }
  }
  assert.notDeepEqual(styleCases[0].colors, styleCases[2].colors, 'File type colors adapt between light and dark themes')
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
