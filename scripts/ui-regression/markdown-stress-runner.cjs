const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'liteconnect-markdown-stress-'))
app.setPath('userData', path.join(artifacts, 'profile'))
const timeout = setTimeout(() => { console.error('Markdown stress timed out', { artifacts }); app.exit(1) }, 180_000)
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { contextIsolation: true, backgroundThrottling: false, offscreen: true } })
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  const run = code => window.webContents.executeJavaScript(code)
  while (!await run('!!window.__uiRegression')) await new Promise(resolve => setTimeout(resolve, 50))
  const scrolling = await run(`(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
    await window.__uiRegression.aiMarkdownStress(30, 100)
    await frame(); await frame()
    const list = document.querySelector('.ai-fixture .chat-list')
    list.scrollTop = Math.min(3000, list.scrollHeight - list.clientHeight)
    await frame(); await frame()
    const start = list.scrollTop
    const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop')
    let offsetReads = 0
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      ...offset,
      get() {
        if (this.classList.contains('chat-row')) offsetReads++
        return offset.get.call(this)
      },
    })
    const intervals = []
    let previous = await frame()
    try {
      for (let index = 0; index < 36; index++) {
        list.scrollTop -= 24
        await window.__uiRegression.appendAiMarkdownStress()
        const now = await frame()
        intervals.push(now - previous)
        previous = now
      }
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetTop', offset)
    }
    return { offsetReads, movedUp: start - list.scrollTop, followLatest: list.classList.contains('follows-latest'),
      frameP95Ms: intervals.sort((a, b) => a - b)[Math.floor(intervals.length * .95)] }
  })()`)
  assert.equal(scrolling.followLatest, false)
  assert.ok(scrolling.movedUp >= 700, 'Reading position keeps moving up while messages stream')
  assert.ok(scrolling.offsetReads <= 25, 'Scrolling reuses timeline geometry while only the last reply grows')
  console.log(JSON.stringify({ scenario: 'scroll while streaming', ...scrolling }))
  const rows = []
  for (const [rounds, historyTurns] of [[10, 0], [50, 0], [200, 0], [50, 100], [50, 300]]) {
    const metrics = await run(`(async () => {
      await window.__uiRegression.setAiConversationKey('stress-' + ${rounds} + '-' + ${historyTurns});
      const start = performance.now();
      await window.__uiRegression.aiMarkdownStress(${rounds}, ${historyTurns});
      const mountMs = performance.now() - start;
      await new Promise(resolve => setTimeout(resolve, 180));
      const root = document.querySelector('.ai-fixture');
      const stable = root.querySelector('table');
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const updateMs = [], snapshotMs = [], frames = [];
      for (let i = 0; i < 12; i++) {
        await frame();
        const before = performance.now();
        await window.__uiRegression.appendAiMarkdownStress(i % 4 === 3);
        const elapsed = performance.now() - before;
        (i % 4 === 3 ? snapshotMs : updateMs).push(elapsed);
        await frame(); frames.push(performance.now() - before);
        await new Promise(resolve => setTimeout(resolve, 130));
      }
      const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
      return {rounds:${rounds},historyTurns:${historyTurns},mountMs,updateMedianMs:median(updateMs),snapshotMedianMs:median(snapshotMs),updateMaxMs:Math.max(...updateMs,...snapshotMs),nextFrameMedianMs:median(frames),mountedUserTurns:root.querySelectorAll('.chat-row.user').length,hasEarlier:!!root.querySelector('.chat-load-earlier'),domNodes:root.querySelectorAll('*').length,htmlChars:root.innerHTML.length,stableTableRetained:root.querySelector('table')===stable,heapBytes:performance.memory?.usedJSHeapSize,error:window.__uiError||null};
    })()`)
    assert.equal(metrics.error, null)
    assert.equal(metrics.stableTableRetained, true, 'Older tables keep their DOM nodes while the live segment grows')
    assert.ok(metrics.mountedUserTurns <= 5, 'Long history initially mounts at most five user turns')
    assert.equal(metrics.hasEarlier, historyTurns > 5)
    const rounded = Object.fromEntries(Object.entries(metrics).map(([key,value]) => [key, typeof value === 'number' && key.endsWith('Ms') ? +value.toFixed(2) : value]))
    rows.push(rounded)
    console.log(JSON.stringify(rounded))
  }
  fs.writeFileSync(path.join(artifacts, 'metrics.json'), JSON.stringify({ environment: 'Electron development renderer; synthetic Markdown; timing is observational', scrolling, rows }, null, 2))
  console.log('Markdown stress completed', { artifacts })
  clearTimeout(timeout); app.exit(0)
}).catch(error => { console.error(error, { artifacts }); clearTimeout(timeout); app.exit(1) })
