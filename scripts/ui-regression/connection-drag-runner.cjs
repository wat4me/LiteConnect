const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'liteconnect-drag-ui-'))
app.setPath('userData', path.join(artifacts, 'profile'))
let action = 'load'
const watchdog = setTimeout(() => { console.error('Timed out', { action, artifacts }); app.exit(1) }, 120_000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { backgroundThrottling: false } })
  const run = source => win.webContents.executeJavaScript(source)
  const wait = async predicate => {
    const until = Date.now() + 10000
    while (!await predicate()) {
      if (Date.now() > until) throw new Error('Timeout: ' + action + '; ' + await run('window.__perfError || ""'))
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  const settle = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const rect = selector => run('(()=>{const r=document.querySelector(' + JSON.stringify(selector) + ').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()')
  const point = (rect, fraction = 0.5) => ({ x: rect.x + rect.width * fraction, y: rect.y + rect.height / 2 })
  const group = id => '.group-block[data-group-id="' + id + '"] > .group-item'
  await win.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await wait(() => run('!!window.__perf'))
  await run('window.__perf.mountDrag()')
  await settle()
  assert.equal(await run('document.querySelectorAll(".drag-handle,.group-drag-handle,.sidebar-conn-handle").length'), 0)
  win.webContents.debugger.attach('1.3')
  const cdp = (method, params) => win.webContents.debugger.sendCommand(method, params)
  await cdp('Input.setInterceptDrags', { enabled: true })
  let intercepted = null
  win.webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Input.dragIntercepted') intercepted = params.data
  })
  const mouse = (type, location, extra = {}) => cdp('Input.dispatchMouseEvent', { type, ...location, ...extra })
  async function drag(from, to, options = {}) {
    action = 'native drag ' + from + ' -> ' + to
    intercepted = null
    const origin = point(await rect(from), options.fromFraction ?? 0.3)
    const targetRect = await rect(to)
    const target = options.before ? { x: targetRect.x + targetRect.width / 2, y: targetRect.y + 1 } : point(targetRect)
    await mouse('mouseMoved', origin)
    await mouse('mousePressed', origin, { button: 'left', buttons: 1, clickCount: 1 })
    await mouse('mouseMoved', { x: origin.x + 12, y: origin.y + 8 }, { button: 'left', buttons: 1 })
    await mouse('mouseMoved', { x: origin.x + 24, y: origin.y + 16 }, { button: 'left', buttons: 1 })
    if (options.blocked) {
      await new Promise(resolve => setTimeout(resolve, 150))
      const data = intercepted
      if (data) await cdp('Input.dispatchDragEvent', { type: 'dragCancel', ...target, data })
      await mouse('mouseMoved', target, { buttons: 1 })
      await mouse('mouseReleased', target, { button: 'left', clickCount: 1 })
      assert.equal(data, null, 'Controls do not start a native row drag: ' + from)
      return
    }
    await wait(() => !!intercepted)
    const data = intercepted
    await cdp('Input.dispatchDragEvent', { type: 'dragEnter', ...target, data })
    await cdp('Input.dispatchDragEvent', { type: 'dragOver', ...target, data })
    await cdp('Input.dispatchDragEvent', { type: 'drop', ...target, data })
    await mouse('mouseReleased', target, { button: 'left', clickCount: 1 })
    await settle()
    return data.items
  }

  const beforeExpanded = await run('document.querySelector(' + JSON.stringify(group('servers') + ' .collapse-btn') + ').getAttribute("aria-expanded")')
  const payload = await drag(group('archive') + ' .group-name', group('servers'))
  assert.ok(payload.some(item => item.mimeType === 'application/x-lite-connect-group' && item.data === 'archive'))
  assert.equal(await run('window.__perf.groupReorders.length'), 1, 'Dragging a group name reorders sibling groups')
  assert.equal(await run('document.querySelector(".group-block").dataset.groupId'), 'archive')
  assert.equal(await run('document.querySelector(' + JSON.stringify(group('servers') + ' .collapse-btn') + ').getAttribute("aria-expanded")'), beforeExpanded, 'Dragging does not toggle expansion')
  await run('document.querySelector(' + JSON.stringify(group('archive') + ' .collapse-btn') + ').click()')
  await drag(group('child') + ' .group-name', group('archive'))
  assert.equal(await run('window.__perf.groupReorders.length'), 1, 'Dragging across parent levels preserves the hierarchy')

  await drag('[data-conn-index="2"] .conn-name-text', '[data-conn-index="0"]', { before: true })
  assert.deepEqual(await run('window.__perf.reorders.at(-1)'), ['host-2', 'host-0', 'host-1'], 'Connection names start native reorder drags')
  await drag('[data-conn-index="1"] .connection-row', '[data-conn-index="0"]', { fromFraction: 0.6, before: true })
  assert.deepEqual(await run('window.__perf.reorders.at(-1)'), ['host-0', 'host-2', 'host-1'], 'Card whitespace also starts a drag')
  await drag('.sidebar-conn-name', group('archive'))
  assert.deepEqual(await run('window.__perf.moves.at(-1)'), ['host-0', 'archive'], 'Sidebar connection text moves to another group')
  await drag('.connection-row .conn-name-text', group('archive'))
  assert.deepEqual(await run('window.__perf.moves.at(-1)'), ['host-2', 'archive'], 'Main connection text moves to another group')

  const reorders = await run('window.__perf.reorders.length')
  const groupReorders = await run('window.__perf.groupReorders.length')
  const moves = await run('window.__perf.moves.length')
  await drag('.connection-row .action-btn', group('archive'), { blocked: true })
  await drag(group('servers') + ' .collapse-btn', group('archive'), { blocked: true })
  await drag('.sidebar-conn-pin', group('archive'), { blocked: true })
  assert.equal(await run('window.__perf.reorders.length'), reorders)
  assert.equal(await run('window.__perf.groupReorders.length'), groupReorders)
  assert.equal(await run('window.__perf.moves.length'), moves)
  // Real double-clicks still connect after a completed drag.
  action = 'double-click connection'
  const location = point(await rect('.connection-row .conn-name-text'))
  for (const clickCount of [1, 2]) {
    await mouse('mousePressed', location, { button: 'left', buttons: 1, clickCount })
    await mouse('mouseReleased', location, { button: 'left', clickCount })
  }
  await wait(() => run('window.__perf.connects.length===1'))
  assert.equal(await run('window.__perf.connects[0]'), 'host-1')

  action = 'group rename protection'
  await run('document.querySelector(' + JSON.stringify(group('servers')) + ').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:120,clientY:300}))')
  await wait(() => run('!!document.querySelector(".ui-menu")'))
  await run('[...document.querySelectorAll(".ui-menu-item")].find(el=>el.textContent.trim()==="重命名").click()')
  await wait(() => run('!!document.querySelector(".rename-input")'))
  assert.equal(await run('document.querySelector(".rename-input").closest(".group-item").draggable'), false)
  await drag('.rename-input', group('archive'), { blocked: true })
  await run('document.querySelector(".rename-input").dispatchEvent(new KeyboardEvent("keyup",{key:"Escape",bubbles:true}))')
  await settle()
  assert.equal(await run('window.__perfError || null'), null)
  fs.writeFileSync(path.join(artifacts, 'connections-direct-drag.png'), (await win.webContents.capturePage()).toPNG())
  console.log(JSON.stringify({ passed: true, nativeMouseDrag: true, flows: ['group reorder', 'hierarchy protection', 'connection name and whitespace reorder', 'sidebar and main group moves', 'button and rename protection', 'double-click connect'], artifacts }))
  clearTimeout(watchdog); win.destroy(); app.quit()
}).catch(error => { console.error(error, { action, artifacts }); clearTimeout(watchdog); app.exit(1) })
