const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const artifacts = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'liteconnect-dock-ui-'))
app.setPath('userData', path.join(artifacts, 'profile'))
let database, window, stage = 'starting', failSave = false, saveCount = 0
const timeout = setTimeout(() => { console.error('Dock UI timed out', { stage, artifacts }); app.exit(1) }, 360000)
app.whenReady().then(async () => {
  const bundle = path.join(artifacts, 'runtime.mjs')
  await require('esbuild').build({ stdin: { contents: "export {initializeAppDatabase,closeAppDatabase} from './electron/store/appDatabase'; export {SettingsStore} from './electron/store/settingsStore';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle })
  const runtime = await import(pathToFileURL(bundle))
  const preload = path.join(artifacts, 'preload.cjs')
  fs.writeFileSync(preload, "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('__dockBackend',{invoke:(op,value)=>ipcRenderer.invoke('dock-settings',op,value),settings:fn=>{const listener=(_e,value)=>fn(value);ipcRenderer.on('settings:changed',listener);return()=>ipcRenderer.removeListener('settings:changed',listener)}});")
  const store = new runtime.SettingsStore()
  database = await runtime.initializeAppDatabase(path.join(artifacts, 'profile'))
  await store.init()
  ipcMain.handle('dock-settings', async (_event, op, value) => {
    if (op === 'get') return store.getAll()
    if (op === 'set') {
      if (failSave) { failSave = false; throw new Error('fixture disk unavailable') }
      assert.deepEqual(Object.keys(value), ['sshWorkspaceLayout'])
      saveCount++
      return store.applyMany(value)
    }
    if (op === 'fail') { failSave = true; return true }
    if (op === 'count') return saveCount
    if (op === 'external') {
      const saved = await store.applyMany({ sshWorkspaceLayout: value })
      window.webContents.send('settings:changed', { settings: saved, changed: ['sshWorkspaceLayout'] })
      return saved
    }
    throw new Error('Unknown fixture operation')
  })
  window = new BrowserWindow({ show: false, frame: false, width: 1200, height: 900, webPreferences: { preload, contextIsolation: true, backgroundThrottling: false } })
  window.webContents.debugger.attach('1.3')
  const run = async source => {
    let raw
    try { raw = await window.webContents.executeJavaScript(`(async()=>{try{return JSON.stringify({ok:true,value:await (${source})})}catch(error){return JSON.stringify({ok:false,error:error.stack||String(error)})}})()`) }
    catch (error) { throw new Error(`${error.message}\nExpression: ${source.slice(0,400)}`) }
    const result = JSON.parse(raw)
    if (!result.ok) throw new Error(`${result.error}\nExpression: ${source.slice(0,400)}`)
    return result.value
  }
  const tick = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const wait = async expression => {
    const deadline = Date.now() + 20000
    while (!await run(expression)) {
      if (Date.now() > deadline) throw new Error(`Timeout ${expression}: ${await run('JSON.stringify({error:window.__dockError,unknown:window.__dock?.calls.unknown,body:document.body.innerText.slice(0,2500)})')}`)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  const click = async (selector, button = 'left') => {
    const point = await run(`(() => {const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button, clickCount: 1 })
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button, clickCount: 1 })
    await tick()
  }
  const tool = id => `.workspace-tool-rail [data-tool-id="${id}"]`
  const move = async (id, edge) => {
    await click(tool(id), 'right'); await wait('!!document.querySelector(".workspace-layout-menu")')
    await click(`[data-move-edge="${edge}"]`)
    await wait(`window.__dock.snapshot().layout.tools.find(tool=>tool.id===${JSON.stringify(id)}).edge===${JSON.stringify(edge)} && !window.__dock.snapshot().saving`)
  }
  const screenshot = async name => {
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8 })
    await run('new Promise(resolve=>setTimeout(resolve,200))'); await tick()
    fs.writeFileSync(path.join(artifacts, name), (await window.webContents.capturePage()).toPNG())
  }
  stage = 'loading real SSH workspace'
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await wait('window.__dock?.snapshot().ready && !!document.querySelector(".xterm-screen")')
  await wait('window.__dock.calls.resizes.length>0')
  assert.equal(await run('window.__dockError || null'), null)
  if (process.env.LITECONNECT_DOCK_AI_PERMISSION_ONLY === '1') {
    stage = 'changing the idle SSH chat mode while another chat is running'
    const visiblePanel = '.ai-sidebar:not([style*="display: none"])'
    const permission = `${visiblePanel} .composer-selector`
    await click(tool('ai'))
    await wait(`!!document.querySelector('${visiblePanel} .ai-model-switcher')`)
    await run(`(() => { const input = document.querySelector('${visiblePanel} .composer-input'); input.value = 'Check disk'; input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await wait(`document.querySelector('${visiblePanel} .send-btn')?.disabled === false`)
    await click(`${visiblePanel} .send-btn`)
    await wait(`!!document.querySelector('${visiblePanel} .stop-btn')`)
    await run('window.__dock.session("three")')
    await wait(`!!document.querySelector('${visiblePanel} .send-btn')`)
    assert.equal(await run(`document.querySelector('${permission}').disabled`), false)
    await click(permission)
    await wait('!!document.querySelector(".composer-selector-menu")')
    await run(`document.querySelector('.ai-sidebar[style*="display: none"] .chat-list').dispatchEvent(new Event('scroll'))`)
    assert.equal(await run('!!document.querySelector(".composer-selector-menu")'), true, 'Scrolling another chat must not dismiss the permission menu')
    await click('.composer-selector-menu [role="menuitemradio"]:last-child')
    await wait(`document.querySelector('${permission}').textContent.includes('只读')`)
    await click(permission)
    await wait('!!document.querySelector(".composer-selector-menu")')
    await run('window.__dock.session("one")')
    await wait(`!!document.querySelector('${visiblePanel} .stop-btn')`)
    assert.equal(await run('!!document.querySelector(".composer-selector-menu")'), false, 'The menu closes when its chat is hidden')
    await run('window.__dock.finishAiReply()')
    await wait(`!!document.querySelector('${visiblePanel} .send-btn')`)
    assert.equal(await run('window.__dockError || null'), null)
    console.log(JSON.stringify({ passed: true, flow: stage, artifacts }))
    clearTimeout(timeout); window.destroy(); runtime.closeAppDatabase(); app.quit(); return
  }
  if (process.env.LITECONNECT_DOCK_CWD_ONLY === '1') {
    stage = 'locating after successful and failed cd commands'
    await click(tool('files'))
    await wait('document.querySelector(".file-sidebar .path-display")?.textContent.trim()==="/home/ops"')
    await click('.file-sidebar .navigation-actions button[aria-pressed="true"]')
    await run('window.__dock.enableCwdInputEcho()')
    const input = window.webContents.debugger
    const submit = async (command, checkedPath) => {
      await run('document.querySelector(".xterm-helper-textarea").focus()')
      await input.sendCommand('Input.insertText', { text: command })
      await input.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await input.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await wait(`window.__dock.calls.cwdChecks.includes(${JSON.stringify(checkedPath)})`)
    }
    const locate = '.file-sidebar .navigation-actions > button:first-child'
    await submit('cd /home/v5-automation-servers', '/home/v5-automation-servers')
    await click(locate)
    await wait('document.querySelector(".file-sidebar .path-display")?.textContent.trim()==="/home/v5-automation-servers"')
    await submit('cd ..', '/home')
    await submit('cd tab', '/home/tab')
    await submit('cd bcdd', '/home/bcdd')
    const writes = await run('window.__dock.calls.writes.length')
    await click(locate)
    await wait('document.querySelector(".file-sidebar .path-display")?.textContent.trim()==="/home"')
    assert.equal(await run('window.__dock.calls.writes.length'), writes, 'Locate must not write to the terminal')
    assert.ok(await run('window.__dock.calls.fileLoads.every(path => !/\\/(tab|bcdd)(\\/|$)/.test(path))'), 'Invalid cwd candidates must not be listed')
    console.log(JSON.stringify({ passed: true, flows: ['cd ..', 'consecutive failed cd commands', 'SFTP locate without terminal input'], artifacts }))
    clearTimeout(timeout); window.destroy(); runtime.closeAppDatabase(); app.quit(); return
  }
  const subscriptions = await run('window.__dock.calls.dataSubscriptions')
  if (!process.env.LITECONNECT_DOCK_MATRIX_ONLY) {
  stage = 'moving AI and preserving its composer'
  await click(tool('ai')); await wait('!!document.querySelector(".ai-sidebar .composer textarea")')
  assert.equal(await run('document.querySelectorAll(".workspace-dock-tabs").length'), 0, 'Docking adds no duplicate panel tab bar')
  await run(`(() => {const input=document.querySelector('.ai-sidebar .composer textarea');input.value='Keep this draft while moving';input.dispatchEvent(new Event('input',{bubbles:true}));window.__savedAiInput=input;window.__savedTerminal=document.querySelector('.terminal-host .xterm-screen')})()`)
  await move('ai', 'right')
  await wait('!!document.querySelector(".dock-right .ai-sidebar")')
  assert.ok(await run(`(() => {
    const canvas = document.querySelector('.workspace-dock-canvas').getBoundingClientRect();
    const left = document.querySelector('.workspace-tool-rail[data-dock-edge="left"]').getBoundingClientRect();
    const right = document.querySelector('.workspace-tool-rail[data-dock-edge="right"]').getBoundingClientRect();
    return left.width < 40 && right.width === left.width && Math.abs(canvas.left - left.right) <= 1 && Math.abs(canvas.right - right.left) <= 1;
  })()`), 'Compact tool rails fit exactly beside the canvas')
  assert.equal(await run('getComputedStyle(window.__savedAiInput).fontSize'), '13px', 'AI input keeps its content font at the compact UI scale')
  assert.ok(await run('document.querySelector(".ai-sidebar .composer textarea")===window.__savedAiInput'))
  assert.equal(await run('window.__savedAiInput.value'), 'Keep this draft while moving')
  stage = 'simultaneous file and AI panels'
  await click(tool('files')); await wait('!!document.querySelector(".dock-left .file-sidebar")')
  await wait('window.__dock.calls.fileLoads.length>0')
  await click('.file-sidebar .path-display')
  await wait('!!document.querySelector(".file-sidebar .path-input")')
  await run(`(() => {const input=document.querySelector('.file-sidebar .path-input');input.value='/srv/app';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click('.file-sidebar .path-action-btn.confirm')
  await wait('document.querySelector(".file-sidebar").textContent.includes("/srv/app")')
  assert.deepEqual(await run('({ai:window.__dock.snapshot().panels.ai,files:window.__dock.snapshot().panels.files})'), { ai: true, files: true })
  assert.ok(await run(`(() => {const right=document.querySelector('.dock-right');return !right.innerText.includes('批量执行') && !right.innerText.includes('命令片段') && !right.querySelector('[role=tablist]')})()`), 'Opening AI does not advertise unopened batch/snippet tools')
  assert.ok(await run(`['left','right'].every(edge=>{const region=document.querySelector('.dock-'+edge),body=region.querySelector('.workspace-dock-body');return Math.abs(body.getBoundingClientRect().top-region.getBoundingClientRect().top)<=2})`), 'Original panel content starts directly at its dock boundary')
  await run('window.__savedFilePane=document.querySelector(".file-sidebar")')
  await screenshot('dock-files-ai.png')
  stage = 'fixed SFTP font and density across panel widths'
  const fileDensity = await run(`(() => {const row=document.querySelector('.file-sidebar .tree-row');return {font:getComputedStyle(row).fontSize,row:row.getBoundingClientRect().height,icon:row.querySelector('.tree-icon').getBoundingClientRect().width}})()`)
  const originalLeft = await run('window.__dock.snapshot().layout.sizes.left')
  await run(`document.querySelector('.dock-left .workspace-dock-resize').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`)
  await wait('!window.__dock.snapshot().saving && window.__dock.snapshot().layout.sizes.left===720')
  assert.deepEqual(await run(`(() => {const row=document.querySelector('.file-sidebar .tree-row');return {font:getComputedStyle(row).fontSize,row:row.getBoundingClientRect().height,icon:row.querySelector('.tree-icon').getBoundingClientRect().width}})()`), fileDensity, 'SFTP font, rows and icons stay the same when the panel gets wider')
  await run(`(() => {const layout=window.__dock.snapshot().layout;layout.sizes.left=${originalLeft};return window.__dockBackend.invoke('external',layout)})()`)
  await run(`window.dispatchEvent(new CustomEvent('sftp-font-settings-change',{detail:{fontSize:15}}))`)
  await wait('getComputedStyle(document.querySelector(".file-sidebar .tree-row")).fontSize==="15px"')
  await run(`window.dispatchEvent(new CustomEvent('sftp-font-settings-change',{detail:{fontSize:12}}))`)
  stage = 'original icon toggle and region switching'
  await click(tool('batch')); await wait('window.__dock.snapshot().panels.batch && !window.__dock.snapshot().panels.ai')
  await click(tool('snippets')); await wait('window.__dock.snapshot().panels.snippets && !window.__dock.snapshot().panels.batch')
  await click(tool('ai')); await wait('window.__dock.snapshot().panels.ai && !window.__dock.snapshot().panels.snippets')
  assert.ok(await run('window.__savedAiInput.checkVisibility() && window.__savedAiInput.value==="Keep this draft while moving"'))
  assert.ok(await run(`(() => {const right=document.querySelector('.dock-right');return !right.innerText.includes('批量执行') && !right.innerText.includes('命令片段') && !right.querySelector('.workspace-dock-tabs')})()`), 'Previously opened tools also stay hidden after switching back to AI')
  stage = 'left and right placement without remounting'
  for (const edge of ['left', 'right']) {
    await move('ai', edge)
    await wait(`!!document.querySelector('.dock-${edge} .ai-sidebar')`)
    assert.ok(await run('window.__savedAiInput.checkVisibility()'), 'The moved panel stays expanded even when another tool occupied its destination')
    assert.ok(await run('document.querySelector(".ai-sidebar .composer textarea")===window.__savedAiInput'))
    assert.equal(await run('window.__savedAiInput.value'), 'Keep this draft while moving')
    assert.ok(await run('document.querySelector(".terminal-host .xterm-screen")===window.__savedTerminal'))
  }
  assert.equal(await run('window.__dock.calls.dataSubscriptions'), subscriptions)
  stage = 'close focus and per-session state'
  await click(tool('ai')); await wait('!window.__dock.snapshot().panels.ai')
  await wait('document.activeElement?.classList.contains("xterm-helper-textarea")')
  await click(tool('ai')); await wait('window.__savedAiInput.checkVisibility()')
  await click(tool('files')); await wait('window.__dock.snapshot().panels.files')
  assert.ok(await run('document.querySelector(".file-sidebar")===window.__savedFilePane'))
  assert.ok(await run('window.__savedFilePane.textContent.includes("/srv/app")'))
  await run('window.__dock.session("two")')
  await wait('document.querySelectorAll(".ai-sidebar").length===2')
  await run('window.__dock.session("one")')
  await wait('window.__savedAiInput.checkVisibility()')
  assert.equal(await run('window.__savedAiInput.value'), 'Keep this draft while moving')
  stage = 'split keeps independent docks open'
  const savedSizes = await run('window.__dock.snapshot().layout.sizes')
  await click('.terminal-layout-actions button:last-child')
  await wait('window.__dock.snapshot().split && window.__dock.snapshot().splitMode==="vertical"')
  assert.deepEqual(await run('({ai:window.__dock.snapshot().panels.ai,files:window.__dock.snapshot().panels.files})'), { ai: true, files: true })
  assert.equal(await run(`document.querySelector('${tool('ai')}').disabled`), false)
  assert.ok(await run('window.__savedAiInput.checkVisibility() && window.__savedAiInput.value==="Keep this draft while moving"'))
  await wait('document.querySelector(".terminal-container").getBoundingClientRect().width>=485')
  assert.ok(await run(`[...document.querySelectorAll('.terminal-pane')].filter(el=>el.checkVisibility()).every(el=>el.getBoundingClientRect().width>=239)`), 'Dock sizes reserve room for both side-by-side panes')
  assert.deepEqual(await run('window.__dock.snapshot().layout.sizes'), savedSizes, 'Split allocation never overwrites saved dock sizes')
  await screenshot('dock-split-files-ai.png')
  stage = 'cross-host split target and manual panel choices'
  await run('window.__dock.split(true,"vertical",true)')
  await wait('document.querySelectorAll(".split-pane-host").length===2')
  assert.ok(await run('window.__savedAiInput.checkVisibility() && window.__savedFilePane.checkVisibility()'))
  assert.ok(await run('document.querySelector(".ssh-ai-target").innerText.includes("Production")'))
  await click('.terminal-pane.is-secondary .terminal-pane-body')
  assert.ok(await run('window.__savedAiInput.checkVisibility() && document.querySelector(".ssh-ai-target").innerText.includes("Production")'), 'Focusing the secondary pane never silently retargets AI')
  await click('.terminal-pane.is-primary .split-pane-actions button:first-child')
  await wait('window.__dock.snapshot().primary==="three"')
  await wait(`[...document.querySelectorAll('.ssh-ai-target')].some(el=>el.checkVisibility() && el.innerText.includes('Staging'))`)
  await click(tool('ai')); await wait('!window.__dock.snapshot().panels.ai')
  await click('.terminal-pane.is-primary .split-pane-actions button:nth-child(3)')
  await wait('!window.__dock.snapshot().split')
  assert.equal(await run('window.__dock.snapshot().panels.ai'), false, 'Leaving a split preserves an explicit close instead of reopening a stale snapshot')
  assert.equal(await run('window.__dock.snapshot().panels.files'), true)
  await run('window.__dock.session("one")')
  await click(tool('ai')); await wait('window.__savedAiInput.checkVisibility()')
  stage = 'stacked split with left and right docks'
  await run('window.__dock.split(true,"horizontal")')
  await wait(`[...document.querySelectorAll('.terminal-pane')].filter(el=>el.checkVisibility()).length === 2`)
  const stackedHeights = await run(`[...document.querySelectorAll('.terminal-pane')].filter(el=>el.checkVisibility()).map(el=>el.getBoundingClientRect().height)`)
  assert.equal(stackedHeights.length, 2)
  assert.ok(stackedHeights.every(height => height >= 154), 'Side docks leave space for both stacked panes')
  assert.ok(await run('window.__savedAiInput.checkVisibility() && window.__savedFilePane.checkVisibility()'))
  await wait(`(() => {const panel=window.__savedAiInput.closest('.ai-sidebar'),target=panel.querySelector('.ssh-ai-target').getBoundingClientRect(),composer=panel.querySelector('.composer-area').getBoundingClientRect(),send=panel.querySelector('.send-btn').getBoundingClientRect();return target.height>0 && target.bottom<=composer.top+1 && send.bottom<=composer.bottom+1})()`)
  await screenshot('dock-stacked-tools.png')
  await run('window.__dock.split(false)')
  assert.equal(await run('window.__dock.calls.dataSubscriptions'), subscriptions)
  stage = 'resizing and committing once'
  const before = await run('window.__dockBackend.invoke("count")')
  const point = await run(`(() => {const r=document.querySelector('.dock-right .workspace-dock-resize').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  assert.ok(await run(`document.elementFromPoint(${point.x},${point.y})?.classList.contains('workspace-dock-resize')`), JSON.stringify(await run(`({point:${JSON.stringify(point)},hit:document.elementFromPoint(${point.x},${point.y})?.outerHTML.slice(0,300),handle:document.querySelector('.dock-right .workspace-dock-resize').outerHTML})`)))
  await run(`(() => {window.__resizeEvents=[];for(const type of ['pointerdown','pointermove','pointerup']) window.addEventListener(type,event=>window.__resizeEvents.push([type,event.pointerId,event.clientX,String(event.target.className?.baseVal ?? event.target.className),document.body.style.cursor]),true)})()`)
  await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 4; i++) await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x - i * 20, y: point.y, button: 'left', buttons: 1 })
  assert.equal(await run('window.__dockBackend.invoke("count")'), before, 'Live resize does not write SQLite on every mousemove')
  await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x - 80, y: point.y, button: 'left', clickCount: 1 })
  await wait('!window.__dock.snapshot().saving')
  assert.equal(await run('window.__dockBackend.invoke("count")'), before + 1, JSON.stringify(await run('window.__resizeEvents')))
  stage = 'keyboard resize and icon order'
  const previousSize = await run('window.__dock.snapshot().layout.sizes.right')
  await run(`document.querySelector('.dock-right .workspace-dock-resize').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`)
  await wait('!window.__dock.snapshot().saving')
  assert.ok(await run('window.__dock.snapshot().layout.sizes.right') > previousSize)
  const panelDestination = await run('window.__dock.snapshot().layout.tools.find(tool=>tool.id==="batch").panelEdge')
  await click(tool('batch'), 'right'); await wait('!!document.querySelector(".workspace-layout-menu")')
  assert.deepEqual(await run(`[...document.querySelectorAll('[data-move-edge]')].map(button=>button.dataset.moveEdge)`), ['left', 'right'])
  await run(`document.querySelector('.workspace-layout-menu button[role="menuitem"]:not([data-move-edge])').click()`)
  await wait('!window.__dock.snapshot().saving')
  assert.equal(await run('window.__dock.snapshot().layout.tools.find(tool=>tool.id==="batch").panelEdge'), panelDestination)
  stage = 'drag drop preview and ordering'
  const startToolDrag = async id => {
    await run(`(() => {
      window.__dragData = new DataTransfer();
      document.querySelector(${JSON.stringify(tool(id))}).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dragData }));
    })()`)
    await wait('document.querySelectorAll(".dock-drop-strip").length === 2')
  }
  const dragAt = (type, selector, y = 0.5) => run(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    const clientX = rect.left + rect.width / 2, clientY = rect.top + rect.height * ${y};
    document.elementFromPoint(clientX, clientY).dispatchEvent(new DragEvent(${JSON.stringify(type)}, {
      bubbles: true, cancelable: true, dataTransfer: window.__dragData, clientX, clientY,
    }));
  })()`)
  const strip = edge => `[data-tool-drop-edge="${edge}"]`
  const saveCountBeforeCancel = await run('window.__dockBackend.invoke("count")')
  await startToolDrag('ai')
  for (const edge of ['left', 'right']) {
    await dragAt('dragover', strip(edge))
    await wait(`document.querySelector('.dock-drop-strip.selected')?.dataset.toolDropEdge === '${edge}'`)
  }
  for (const y of [0.03, 0.97]) {
    await dragAt('dragover', strip('right'))
    await dragAt('dragover', '.workspace-dock-center', y)
    await wait('!document.querySelector(".dock-drop-strip.selected")')
  }
  await dragAt('dragover', strip('left'))
  await wait(`!!document.querySelector('${strip('left')}.selected')`)
  await dragAt('drop', '.workspace-dock-center')
  await wait('!document.querySelector(".workspace-dock-targets")')
  assert.equal(await run('window.__dockBackend.invoke("count")'), saveCountBeforeCancel, 'A center drop cancels even after hovering an edge')

  await startToolDrag('snippets')
  await dragAt('dragover', tool('monitor'), 0.25)
  await wait(`document.querySelector('${tool('monitor')}')?.dataset.dropMarker === 'before'`)
  await dragAt('drop', tool('monitor'), 0.25)
  await wait('!window.__dock.snapshot().saving')
  const leftTools = await run('window.__dock.snapshot().layout.tools.filter(tool => tool.edge === "left").map(tool => tool.id)')
  assert.equal(leftTools[leftTools.indexOf('snippets') + 1], 'monitor', 'The icon is inserted at the marked position')

  await startToolDrag('ai')
  await dragAt('dragover', strip('left'))
  await wait(`!!document.querySelector('${strip('left')}.selected')`)
  await run('window.__dock.theme("light", "zh-CN")')
  await screenshot('dock-drag-preview.png')
  await run('window.__dock.theme("dark", "zh-CN")')
  await dragAt('drop', strip('left'))
  await wait('window.__dock.snapshot().layout.tools.find(tool=>tool.id==="ai").edge==="left" && !window.__dock.snapshot().saving')
  stage = 'layout lock and reset'
  await click('.dock-layout-button'); await click('[data-layout-lock]'); await wait('window.__dock.snapshot().layout.locked && !window.__dock.snapshot().saving')
  assert.equal(await run(`document.querySelector('${tool('ai')}').draggable`), false)
  await click(tool('ai'), 'right')
  assert.ok(await run('Array.from(document.querySelectorAll("[data-move-edge]")).every(button=>button.disabled)'))
  await click('[data-layout-lock]'); await wait('!window.__dock.snapshot().layout.locked && !window.__dock.snapshot().saving')
  stage = 'failed persistence and retry'
  await run('window.__dockBackend.invoke("fail")')
  await move('ai', 'right')
  await wait('window.__dock.snapshot().error')
  await click('.dock-layout-error button'); await wait('!window.__dock.snapshot().error && !window.__dock.snapshot().saving')
  stage = 'persisted reload'
  const expected = await run('window.__dock.snapshot().layout')
  await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.webContents.reload() }); await wait('window.__dock?.snapshot().ready')
  assert.deepEqual(await run('window.__dock.snapshot().layout'), expected)
  stage = 'external window settings notification with legacy edges'
  await run(`(() => {
    const layout=window.__dock.snapshot().layout, ai=layout.tools.find(tool=>tool.id==='ai'), monitor=layout.tools.find(tool=>tool.id==='monitor');
    ai.edge=ai.panelEdge='top'; monitor.edge=monitor.panelEdge='bottom'; layout.sizes.top=600; layout.sizes.bottom=480;
    return window.__dockBackend.invoke('external',layout)
  })()`)
  await wait(`(() => {
    const {tools,sizes}=window.__dock.snapshot().layout, ai=tools.find(tool=>tool.id==='ai'), monitor=tools.find(tool=>tool.id==='monitor');
    return ai.edge==='left' && ai.panelEdge==='left' && monitor.edge==='right' && monitor.panelEdge==='right' && !('top' in sizes) && !('bottom' in sizes);
  })()`)
  await click(tool('monitor'))
  await wait('document.querySelector(".dock-right .monitor-header")?.checkVisibility()')
  await click(tool('monitor'))
  await click(tool('sync'))
  await wait('document.querySelector(".dock-left .sync-input-bar")?.checkVisibility()')
  await click(tool('sync'))
  } else {
    stage = 'side dock composer and split target visibility'
    await move('ai', 'right')
    await click(tool('ai')); await click(tool('files'))
    await wait('!!document.querySelector(".ai-sidebar .send-btn") && !!document.querySelector(".file-sidebar")')
    await run('window.__dock.split(true,"horizontal")')
    await wait(`(() => {const panel=document.querySelector('.ai-sidebar'),target=panel.querySelector('.ssh-ai-target')?.getBoundingClientRect(),composer=panel.querySelector('.composer-area').getBoundingClientRect(),send=panel.querySelector('.send-btn').getBoundingClientRect();return target?.height>0 && target.bottom<=composer.top+1 && send.bottom<=composer.bottom+1})()`)
    await screenshot('dock-stacked-target.png')
    await run('window.__dock.split(false)'); await click(tool('files'))
  }
  stage = 'narrow windows and display variations'
  let layouts = 0
  for (const theme of ['light', 'dark', 'eyecare']) for (const locale of ['zh-CN', 'en-US']) for (const [w, h, zoom] of [[1200, 900, 1], [440, 700, 1.25]]) {
    stage = `layout ${theme} / ${locale} / ${w}x${h} / ${zoom}`
    window.setSize(w, h); window.webContents.setZoomFactor(zoom)
    await run(`window.__dock.theme('${theme}','${locale}')`)
    if (!await run('window.__dock.snapshot().panels.ai')) await click(tool('ai'))
    await tick()
    await wait(`(() => {const root=document.querySelector('.workspace-dock'),panels=[...document.querySelectorAll('.workspace-dock-region')].filter(panel=>panel.checkVisibility()),b=root.getBoundingClientRect();return panels.length && panels.every(panel=>{const r=panel.getBoundingClientRect();return r.width>0 && r.height>0 && r.left>=b.left-1 && r.right<=b.right+1 && r.top>=b.top-1 && r.bottom<=b.bottom+1})})()`)
    const bounds = await run(`(() => {const root=document.querySelector('.workspace-dock'),panels=[...document.querySelectorAll('.workspace-dock-region')].filter(panel=>panel.checkVisibility());return {root:root.getBoundingClientRect().toJSON(),scroll:root.scrollWidth,client:root.clientWidth,panels:panels.map(panel=>({rect:panel.getBoundingClientRect().toJSON(),style:panel.getAttribute('style')})),state:window.__dock.snapshot()}})()`)
    assert.ok(bounds.panels.length && bounds.panels.every(({rect:r}) => r.width>0 && r.height>0 && r.left>=bounds.root.left-1 && r.right<=bounds.root.right+1 && r.top>=bounds.root.top-1 && r.bottom<=bounds.root.bottom+1) && bounds.scroll<=bounds.client+1, JSON.stringify(bounds))
    assert.equal(await run('window.__dockError || null'), null)
    assert.equal(await run('document.querySelectorAll(".workspace-dock-tabs").length'), 0)
    if (theme === 'dark' && locale === 'zh-CN') await screenshot(w > 1000 ? 'dock-wide.png' : 'dock-narrow.png')
    layouts++
  }
  await click('.dock-layout-button'); await click('[data-layout-reset]'); await wait('window.__dock.snapshot().layout.tools.every(tool=>tool.edge==="left") && !window.__dock.snapshot().saving')
  console.log(JSON.stringify({ passed: true, layouts, flows: process.env.LITECONNECT_DOCK_MATRIX_ONLY ? ['side dock composer', 'layout variations', 'reset'] : ['left/right move', 'composer/file path/xterm identity preserved', 'simultaneous regions', 'fixed SFTP font and density', 'terminal focus', 'session switch', 'same-host and cross-host splits with independent docks', 'explicit AI target and manual close preserved', 'split-aware dock allocation', 'pointer and keyboard resize', 'icon ordering', 'drag preview/drop', 'lock/reset', 'save failure retry', 'SQLite reload', 'cross-window notification and legacy edge migration'], artifacts }))
  clearTimeout(timeout); window.destroy(); runtime.closeAppDatabase(); app.quit()
}).catch(error => { console.error(error, { stage, artifacts }); clearTimeout(timeout); window?.destroy(); database?.close(); app.exit(1) })
