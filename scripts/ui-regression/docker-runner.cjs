const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'liteconnect-docker-ui-'))
app.setPath('userData', path.join(artifacts, 'profile'))
let action = 'load'
const watchdog = setTimeout(() => { console.error('Timed out', { action, artifacts }); app.exit(1) }, 180_000)
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { backgroundThrottling: false } })
  const run = source => { action = source.slice(0, 200); return window.webContents.executeJavaScript(`(async () => { return (${source}) })()`) }
  const waitFor = async expression => {
    const deadline = Date.now() + 10_000
    while (!await run(expression)) {
      if (Date.now() > deadline) {
        const state = await run(`(() => { const el=document.querySelector('.logs-scroll'); return {error:window.__uiError, scroll:el && [el.scrollTop,el.clientHeight,el.scrollHeight], autoScroll:document.querySelectorAll('.logs-check input')[1]?.checked} })()`)
        throw new Error(`Timed out: ${expression}; state: ${JSON.stringify(state)}`)
      }
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  const settled = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const atBottom = `(() => { const el=document.querySelector('.logs-scroll'); return el && el.scrollHeight-el.scrollTop-el.clientHeight<2 })()`
  const autoScroll = `document.querySelectorAll('.logs-check input')[1].checked`
  const search = async value => {
    await run(`(() => { const el=document.querySelector('.logs-search'); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
    await settled()
  }
  const screenshot = async name => {
    await settled()
    fs.writeFileSync(path.join(artifacts, name), (await window.webContents.capturePage()).toPNG())
  }
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await waitFor('document.querySelectorAll(".container-row").length === 21')
  await run('document.querySelector(".container-row").click()')
  await run(`Array.from(document.querySelectorAll('.detail-tabs button')).find(el=>el.textContent.trim()==='日志').click()`)
  await waitFor('document.querySelector(".logs-scroll .virtual-list")?.dataset.itemCount === "200"')
  await waitFor(atBottom)
  assert.equal(await run('window.__uiError || null'), null)

  const layoutCases = []
  for (const theme of ['eyecare', 'light', 'dark']) {
    await run(`document.documentElement.dataset.theme='${theme}'`)
    for (const width of [1440, 1100, 800, 420]) {
      window.setContentSize(width, 900)
      await settled()
      const layout = await run(`(() => {
        const toolbar=document.querySelector('.logs-toolbar');
        const labels=[...toolbar.querySelectorAll('label')];
        const centers=labels.map(el=>{const r=el.getBoundingClientRect();return r.y+r.height/2});
        const fontSizes=labels.map(el=>getComputedStyle(el).fontSize);
        const bounds=document.querySelector('.detail-pane').getBoundingClientRect();
        const controls=[...document.querySelectorAll('.logs-body button,.logs-body select,.logs-body input')].filter(el=>el.getClientRects().length);
        const columns=['.col-state','.col-container','.col-runtime','.col-actions'];
        const head=document.querySelector('.list-head');const row=document.querySelector('.container-row');
        return { aligned:Math.max(...centers)-Math.min(...centers)<1,
          sameFont:new Set(fontSizes).size===1,
          bounded:controls.every(el=>{const r=el.getBoundingClientRect();return r.left>=bounds.left && r.right<=bounds.right+1}),
          columns:columns.every(c=>Math.abs(head.querySelector(c).getBoundingClientRect().left-row.querySelector(c).getBoundingClientRect().left)<1),
          pageOverflow:document.documentElement.scrollWidth>innerWidth };
      })()`)
      assert.ok(layout.aligned && layout.sameFont && layout.bounded && layout.columns && !layout.pageOverflow, `${theme} ${width}: ${JSON.stringify(layout)}`)
      assert.equal(await run(autoScroll), true, 'Resizing preserves automatic scrolling: ' + theme + ' ' + width)
      layoutCases.push({ theme, width })
      if (width === 1440 || (theme === 'eyecare' && width === 800)) await screenshot(`docker-${theme}-${width}.png`)
    }
  }
  window.setContentSize(1440, 900)
  await settled()
  await run('document.querySelector(".logs-scroll").scrollTop=0')
  await waitFor(`!${autoScroll} && !!document.querySelector('.logs-jump-latest')`)
  await run('window.__dockerUi.append(2)')
  await settled()
  assert.equal(await run('document.querySelector(".logs-scroll").scrollTop'), 0, 'Incoming logs preserve the history reading position')
  assert.equal(await run('window.__dockerUi.calls.starts.length'), 1, 'Pausing scrolling keeps the same stream')
  await screenshot('docker-reading-history.png')
  await run('document.querySelector(".logs-jump-latest").click()')
  await waitFor(`${autoScroll} && ${atBottom}`)

  await search('MATCH')
  await waitFor(`!${autoScroll} && !!document.querySelector('.log-line-active')`)
  await run(`document.querySelector('.logs-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`)
  await waitFor('document.querySelector(".logs-match-count").textContent.trim().startsWith("2 /")')
  await run(`document.querySelector('.logs-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true}))`)
  assert.ok(await run('document.querySelector(".logs-match-count").textContent.trim().startsWith("1 /")'), 'Shift+Enter navigates back once')
  await run('window.__dockerUi.append(10)')
  await settled()
  assert.equal(await run('document.querySelector(".log-line-active").dataset.logLine'), '4', 'New arrivals preserve the current search result')
  await run(`document.querySelector('.logs-actions button:last-child').click()`)
  await waitFor('window.__dockerUi.calls.copied.length === 1')
  assert.equal(await run('window.__dockerUi.calls.copied[0].split("\\n").length'), 212, 'Copy includes all buffered logs while searching')
  await run('document.querySelector(".logs-jump-latest").click()')
  await waitFor(`${autoScroll} && ${atBottom}`)
  assert.equal(await run('document.querySelector(".logs-search").value'), '', 'Jumping to latest exits search')

  await run('document.querySelectorAll(".logs-check input")[0].click()')
  await waitFor('document.querySelector(".logs-status").textContent.includes("读取完成")')
  assert.equal(await run('window.__dockerUi.calls.starts[1].follow'), false, 'Receiving and scrolling are independent')
  assert.equal(await run(autoScroll), true)
  await run('document.querySelectorAll(".logs-check input")[0].click()')
  await waitFor('document.querySelector(".logs-status").textContent.includes("接收中")')
  await run('window.__dockerUi.append(10200)')
  await settled()
  await waitFor(atBottom)
  const boundedLength = await run('document.querySelector(".logs-scroll .virtual-list").dataset.itemCount')
  assert.ok(await run('document.querySelectorAll(".log-line").length < 100'), 'Rendered log rows stay bounded at buffer capacity')
  await run('window.__dockerUi.append(1,true)')
  await settled()
  await waitFor(atBottom)
  assert.equal(await run('document.querySelector(".logs-scroll .virtual-list").dataset.itemCount'), boundedLength, 'Auto-scroll still works when the ring buffer stays at capacity')

  await run('document.querySelector(".logs-actions button").click()')
  await waitFor('document.querySelectorAll(".log-line").length === 0')
  assert.equal(await run('window.__dockerUi.calls.starts.length'), 3, 'Clearing the display keeps the receiving stream')
  await run('window.__dockerUi.append(1)')
  await waitFor('document.querySelectorAll(".log-line").length === 1')
  assert.equal(await run('window.__uiError || null'), null)
  console.log(JSON.stringify({ passed: true, layoutCases, artifacts }))
  clearTimeout(watchdog)
  window.destroy()
  app.quit()
}).catch(error => {
  console.error(error, { artifacts })
  clearTimeout(watchdog)
  app.exit(1)
})
