const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'liteconnect-execution-history-'))
app.setPath('userData', path.join(artifacts, 'profile'))
let window
const timeout = setTimeout(() => { console.error('Execution history UI timed out', { artifacts }); app.exit(1) }, 120_000)
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 1200, height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } })
  const run = source => window.webContents.executeJavaScript(source)
  const wait = async expression => {
    const deadline = Date.now() + 15000
    while (!await run(expression)) {
      if (Date.now() > deadline) throw new Error(`Timeout: ${expression}`)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  const search = async value => {
    await run(`(() => {const input=document.querySelector('.execution-search input');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  }
  const state = () => run(`document.querySelector('.execution-terminal-bar [data-state]').dataset.state`)
  const close = async () => {
    await run(`document.querySelector('.execution-history').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`)
    await wait(`!document.querySelector('.execution-history')`)
  }
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await wait('!!window.__uiRegression')
  await run('window.__uiRegression.openImageComposer()')
  await wait('!!document.querySelector(".ai-image-composer-fixture .composer-input") && window.__uiRegression.calls.aiCreates.length===1')
  const command = (id, payload, extra = {}) => ({ id, name: 'exec', args: JSON.stringify({ command: id }),
    content: JSON.stringify(payload), status: 'done', isError: false, target: 'server-a', ...extra })
  const runs = [
    command('stderr-only', { stdout: '', stderr: 'permission denied\n', exitCode: 2 }),
    command('long-output', { stdout: '"\\\n'.repeat(7000), stderr: 'last error', exitCode: 7 }),
    command('signal-command', { stdout: 'partial result', exitCode: null, signal: 'TERM' }),
    command('background-command', { jobId: 'owned-job', status: 'running' }, { jobIds: ['owned-job'] }),
  ]
  await run(`window.__uiRegression.seedExecutionHistory(${JSON.stringify(runs)})`)
  await run(`document.querySelector('.ai-image-composer-fixture .tool-run summary').click()`)
  await wait('!!document.querySelector(".ai-image-composer-fixture .tool-run-view-execution")')
  await run(`(() => {const button=document.querySelector('.ai-image-composer-fixture .tool-run-view-execution');button.focus();button.click()})()`)
  await wait('!!document.querySelector(".execution-history")')
  assert.equal(await run('document.querySelector(".execution-item.selected code").textContent'), 'stderr-only', 'A command card opens its own record')
  assert.equal(await run('document.querySelectorAll(".execution-stdout").length'), 0, 'stderr is not duplicated into stdout')
  assert.equal(await run('document.querySelector(".execution-stderr").textContent'), 'permission denied\n')
  assert.equal(await state(), 'failed')
  await search('long-output')
  assert.equal(await state(), 'failed', 'Long truncated output keeps the failure outcome')
  assert.ok(await run('document.querySelector(".execution-exit").textContent.includes("7")'))
  assert.ok(await run('!!document.querySelector(".execution-notice")'), 'Clipped output is labelled')
  await search('signal-command')
  assert.equal(await state(), 'stopped')
  assert.ok(await run('document.querySelector(".execution-output").textContent.includes("TERM")'))
  await search('no-such-command')
  assert.equal(await run('document.querySelectorAll(".execution-item").length'), 0)
  await search('server-a')
  assert.equal(await run('document.querySelectorAll(".execution-item").length'), 4, 'Host search includes all its commands')
  await search('background-command')
  assert.equal(await state(), 'started')
  const network = await run('JSON.stringify(window.__uiRegression.backgroundNetworkCalls)')
  const snapshot = { jobId: 'owned-job', sessionId: 'image-fixture', command: 'background-command', status: 'cancelled', startedAt: 1, finishedAt: 2 }
  await run(`window.__uiRegression.setBackgroundJobs(${JSON.stringify([snapshot])})`)
  await wait(`document.querySelector('.execution-terminal-bar [data-state]').dataset.state==='stopped'`)
  assert.equal(await run('JSON.stringify(window.__uiRegression.backgroundNetworkCalls)'), network, 'Live updates reuse events without polling or executing commands')
  await run(`window.__uiRegression.emitCancelledExecution('owned-job')`)
  await run('window.__uiRegression.setBackgroundJobs([])')
  assert.equal(await state(), 'stopped', 'The saved notice preserves cancellation after runtime snapshots disappear')
  await close()
  await wait('document.activeElement?.classList.contains("tool-run-view-execution")')
  await run(`document.querySelector('.ai-image-composer-fixture .ai-execution-history-trigger').click()`)
  await wait('!!document.querySelector(".execution-history")')
  assert.equal(await state(), 'stopped', 'Reopening keeps the recorded cancellation')
  for (const width of [1000, 400]) {
    window.setSize(width, 900)
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert.ok(await run(`(() => {const el=document.querySelector('.execution-history'),r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&el.scrollWidth<=el.clientWidth+1})()`), 'History fits wide and narrow windows')
    await wait(`(() => {const item=document.querySelector('.execution-item.selected').getBoundingClientRect(),list=document.querySelector('.execution-list').getBoundingClientRect();return item.top>=list.top-1&&item.bottom<=list.bottom+1})()`)
    fs.writeFileSync(path.join(artifacts, `execution-history-${width}.png`), (await window.webContents.capturePage()).toPNG())
  }
  await run('window.__uiRegression.setBackgroundLayout(false,false)')
  await wait('!document.querySelector(".execution-history")')
  assert.equal(await run('window.__uiError || null'), null)
  console.log(JSON.stringify({ passed: true, flows: ['card location', 'separate stderr', 'long failure', 'signal termination', 'search', 'live cancellation', 'saved cancellation', 'focus return', 'narrow layout', 'inactive close'], artifacts }))
  clearTimeout(timeout)
  window.destroy()
  app.quit()
}).catch(error => { console.error(error, { artifacts }); clearTimeout(timeout); app.exit(1) })
