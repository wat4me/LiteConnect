const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'liteconnect-markdown-stress-'))
app.setPath('userData', path.join(artifacts, 'profile'))
const timeout = setTimeout(() => { console.error('Markdown stress timed out', { artifacts }); app.exit(1) }, 180_000)
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { contextIsolation: true, backgroundThrottling: false } })
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  const run = code => window.webContents.executeJavaScript(code)
  while (!await run('!!window.__uiRegression')) await new Promise(resolve => setTimeout(resolve, 50))
  const rows = []
  for (const [rounds, historyTurns] of [[10, 0], [50, 0], [200, 0], [50, 100], [50, 300]]) {
    const metrics = await run(`(async () => {
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
  fs.writeFileSync(path.join(artifacts, 'metrics.json'), JSON.stringify({ environment: 'Electron development renderer; synthetic Markdown; timing is observational', rows }, null, 2))
  console.log('Markdown stress completed', { artifacts })
  clearTimeout(timeout); app.exit(0)
}).catch(error => { console.error(error, { artifacts }); clearTimeout(timeout); app.exit(1) })
