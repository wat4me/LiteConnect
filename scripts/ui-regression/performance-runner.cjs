const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'liteconnect-ui-performance-'))
app.setPath('userData', path.join(artifacts, 'profile'))
let action = 'load'
const watchdog = setTimeout(() => { console.error('Timed out', { action, artifacts }); app.exit(1) }, 180_000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { backgroundThrottling: false } })
  const run = source => { action = source.slice(0, 180); return win.webContents.executeJavaScript(source) }
  const wait = async source => {
    const deadline = Date.now() + 20000
    while (!await run(source)) {
      if (Date.now() > deadline) throw new Error('Timeout: ' + source + '; error: ' + await run('window.__perfError || null'))
      await new Promise(resolve => setTimeout(resolve, 35))
    }
  }
  const settle = async () => {
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await new Promise(resolve => setTimeout(resolve, 80))
  }
  const click = selector => run('document.querySelector(' + JSON.stringify(selector) + ').click()')
  const search = async value => {
    await run('(() => { const input=document.querySelector("input.search-input"); input.value=' + JSON.stringify(value) + '; input.dispatchEvent(new Event("input",{bubbles:true})); })()')
    await settle()
  }
  await win.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await wait('!!window.__perf')
  const metrics = []
  for (const density of ['standard', 'compact']) {
    for (const count of [100, 500, 2000]) {
      const row = await run('window.__perf.mount(' + count + ',' + JSON.stringify(density) + ')')
      await settle()
      row.renderedRows = await run('document.querySelectorAll(".connection-row-wrap").length')
      row.domNodes = await run('document.querySelectorAll("*").length')
      row.hover = await run('window.__perf.hover()')
      assert.ok(row.renderedRows > 0 && row.renderedRows < 60, JSON.stringify(row))
      assert.ok(row.domNodes < 5000, 'Both main list and group sidebar stay bounded')
      metrics.push(row)
    }
  }
  await run('window.__perf.mount(2000,"standard")'); await settle()
  const initialDom = await run('document.querySelectorAll("*").length')
  await run('document.querySelector(".connections-list").scrollTop = 80000')
  await settle()
  assert.ok(await run('Number(document.querySelector(".connection-row-wrap").dataset.connIndex) > 500'))
  await search('server-01999')
  assert.equal(await run('document.querySelectorAll(".connection-row-wrap").length'), 1)
  assert.ok(await run('document.querySelector(".conn-name-text").textContent.includes("01999")'))
  await search('')
  await run('document.querySelector("input.search-input").focus(); document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true,cancelable:true}))')
  await wait('!!document.querySelector("[data-conn-index=\\"1999\\"]")')
  await settle()
  assert.ok(await run('(()=>{const row=document.querySelector("[data-conn-index=\\"1999\\"]").getBoundingClientRect(),list=document.querySelector(".connections-list").getBoundingClientRect();return row.bottom<=list.bottom+2 && row.top>=list.top-2})()'), 'Keyboard navigation reveals virtual rows')
  await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))')
  assert.equal(await run('window.__perf.connects.at(-1)'), 'host-1999')
  await run('(()=>{const row=document.querySelector("[data-conn-index=\\"1999\\"]");window.__dragSource=row;window.__dragData=new DataTransfer();row.querySelector(".conn-name-text").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));row.querySelector(".conn-name-text").dispatchEvent(new DragEvent("dragstart",{bubbles:true,cancelable:true,dataTransfer:window.__dragData}));document.querySelector(".connections-list").scrollTop=0})()')
  await settle()
  assert.equal(await run('window.__dragSource.isConnected'), true, 'Dragging source remains mounted while scrolling')
  await run('(()=>{const row=document.querySelector("[data-conn-index=\\"0\\"]"),r=row.getBoundingClientRect();row.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:window.__dragData,clientY:r.top+1}));row.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:window.__dragData}));document.dispatchEvent(new DragEvent("dragend",{bubbles:true}))})()')
  await wait('window.__perf.reorders.length===1')
  assert.equal(await run('window.__perf.reorders[0][0]'), 'host-1999')
  await settle()
  await run('window.__perf.error("host-1999")'); await settle()
  assert.ok(await run('(()=>{const rows=[...document.querySelectorAll(".connection-row-wrap")];return rows[1].getBoundingClientRect().top>=rows[0].getBoundingClientRect().bottom-1})()'), 'Multiline errors do not overlap the next row')
  await run('document.querySelector(".connections-list").scrollTop=40000'); await settle()
  const anchor = await run('(()=>{const list=document.querySelector(".connections-list").getBoundingClientRect(),rows=[...document.querySelectorAll(".connection-row-wrap")];const row=rows.find(el=>el.getBoundingClientRect().bottom>list.top+2);return{index:row.dataset.connIndex,top:row.getBoundingClientRect().top,above:rows[0].closest("[data-virtual-key]").dataset.virtualKey}})()')
  await run('window.__perf.error(' + JSON.stringify(anchor.above) + ')'); await settle()
  const anchorTop = await run('document.querySelector("[data-conn-index=\\"' + anchor.index + '\\"]").getBoundingClientRect().top')
  assert.ok(Math.abs(anchorTop-anchor.top)<3, 'Growing an overscanned row keeps the visible scroll anchor stable')
  await run('document.querySelector(".group-list").scrollTop=1e9'); await settle()
  assert.ok(await run('[...document.querySelectorAll(".sidebar-conn-name")].some(el=>el.textContent.includes("01999"))'), 'Sidebar virtual list reaches the last connection')
  await click('.density-switch button:last-child'); await settle()
  assert.ok(await run('document.querySelectorAll(".connection-row.compact").length>0'))
  assert.ok(await run('document.querySelectorAll("*").length') < initialDom * 3)
  for (const width of [800, 1000, 1440]) {
    win.setSize(width, 800); await settle()
    assert.equal(await run('(()=>{const list=document.querySelector(".connections-list");return list.scrollWidth<=list.clientWidth+1})()'), true)
  }
  await run('window.__perf.diagnostics(true)'); await settle()
  await click('.renderer-performance summary')
  await wait('!!document.querySelector(".performance-grid dd")?.textContent.match(/\\d+\\.\\d+/)')
  assert.ok(await run('document.querySelector(".performance-grid").textContent.includes("120.0 ms")'))
  await run('window.__perf.hidden(true)')
  await wait('document.querySelector(".renderer-performance").textContent.includes("采样已暂停")')
  await run('window.__perf.hidden(false); window.__perf.locale("en-US")'); await settle()
  assert.ok(await run('document.querySelector(".renderer-performance summary").textContent.includes("performance")'))
  await run('window.__perf.locale("zh-CN")')
  await win.webContents.capturePage(); await settle()
  fs.writeFileSync(path.join(artifacts, 'diagnostics.png'), (await win.webContents.capturePage()).toPNG())
  await run('window.__perf.diagnostics(false)'); await settle()
  // Hidden Electron windows can deliver native rAF at 1 Hz. Drive only the
  // cursor-idle check with queued test frames rather than a wall-clock guess.
  await run('window.__perf.fastFrames(true); window.__perf.cursor(true)')
  await new Promise(resolve => setTimeout(resolve, 100))
  await run('document.body.dispatchEvent(new PointerEvent("pointermove",{clientX:400,clientY:200,bubbles:true}))')
  await new Promise(resolve => setTimeout(resolve, 100))
  const cursorFrames = await run('window.__perf.rafCount()')
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await run('window.__perf.rafCount()'), cursorFrames, 'Trail cursor stops requesting frames once settled')
  await run('window.__perf.cursor(false); window.__perf.fastFrames(false)')
  assert.equal(await run('window.__perfError || null'), null)
  fs.writeFileSync(path.join(artifacts, 'metrics.json'), JSON.stringify({ environment: 'Isolated Electron development renderer; mocked IPC; timings observational', metrics }, null, 2))
  console.log(JSON.stringify({ passed: true, metrics, flows: ['bounded main and sidebar DOM', 'full-data search', 'keyboard reveal and connect', 'drag across virtual windows', 'variable error heights', 'density and resizing', 'diagnostics and hidden pause', 'cursor idle stop'], artifacts }))
  clearTimeout(watchdog); app.quit()
}).catch(error => { console.error({ action, artifacts }, error); clearTimeout(watchdog); app.exit(1) })
