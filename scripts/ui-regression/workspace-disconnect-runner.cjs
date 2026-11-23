const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'liteconnect-workspace-disconnect-'))
app.setPath('userData', path.join(artifacts, 'profile'))
let action = 'load'
const timeout = setTimeout(() => { console.error('Workspace disconnect UI timed out', { action, artifacts }); app.exit(1) }, 150_000)
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1320, height: 1000, webPreferences: { contextIsolation: true, backgroundThrottling: false } })
  const run = code => { action = code.slice(0, 200); return window.webContents.executeJavaScript(code) }
  const wait = async expression => {
    const start = Date.now()
    while (!await run(expression)) {
      if (Date.now() - start > 10_000) throw new Error(`Timeout: ${expression}`)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  const root = '.lite-ai-workspace-fixture'
  const row = id => `${root} .ai-rail-row[data-session-id="${id}"]`
  const rowIds = () => run(`[...document.querySelectorAll('${root} .ai-rail-row[data-session-id]')].map(node=>node.dataset.sessionId)`)
  const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const screenshot = async name => {
    await frames()
    const rect = await run(`(() => {const r=document.querySelector('${root}').getBoundingClientRect();return {x:Math.max(0,Math.floor(r.x)),y:Math.max(0,Math.floor(r.y)),width:Math.floor(r.width),height:Math.floor(r.height)}})()`)
    fs.writeFileSync(path.join(artifacts, name), (await window.webContents.capturePage(rect)).toPNG())
  }
  /** Starts a conversation the way the connections page does: draft first, connect on send. */
  const startChat = async ids => {
    const before = await rowIds()
    const requests = await run('window.__uiRegression.calls.aiRequests.length')
    await run(`window.__uiRegression.openAiHosts(${JSON.stringify(ids)})`)
    await wait(`!!document.querySelector('${root} .ai-draft-input')`)
    await run(`(()=>{const input=document.querySelector('${root} .ai-draft-input');input.value='检查服务状态';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await wait(`!document.querySelector('${root} .ai-draft-send').disabled`)
    await run(`document.querySelector('${root} .ai-draft-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`)
    await wait(`!document.querySelector('${root} .ai-draft') && !!document.querySelector('${root} .lite-ai-chat .composer-input')`)
    await wait(`window.__uiRegression.calls.aiRequests.length===${requests + 1}`)
    await wait(`document.querySelectorAll('${root} .ai-rail-row[data-session-id]').length===${before.length + 1}`)
    await wait(`!document.querySelector('${root} .lite-ai-chat .message.streaming, ${root} .lite-ai-chat .composer-stop')`)
    return (await rowIds()).find(id => !before.includes(id))
  }
  const openDisconnect = async () => {
    await run(`document.querySelector('${root} .ai-conversation-menu-trigger').click()`)
    await wait(`!!document.querySelector('.ai-conversation-menu [data-action="disconnect"]:not(:disabled)')`)
    await run(`document.querySelector('.ai-conversation-menu [data-action="disconnect"]').click()`)
    await wait(`!!document.querySelector('.app-dialog')`)
  }
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await wait('!!window.__uiRegression')
  await run('window.__uiRegression.openLiteAi()')
  await wait(`!!document.querySelector('${root} .connections-ai-workspace')`)
  assert.equal(await run(`document.querySelectorAll('${root} .ai-rail-row').length`), 0, 'No conversation exists before a first message')
  assert.equal(await run('window.__uiRegression.workspaceCloses.length'), 0)

  const secondSession = await startChat(['two'])
  const firstSession = await startChat(['one'])
  assert.equal(await run(`document.querySelectorAll('${root} .ai-rail-dot.connected').length`), 2)
  assert.ok(await run(`document.querySelector('${row(firstSession)}').classList.contains('active')`), 'The newest conversation is the one on screen')
  await openDisconnect()
  assert.ok(await run(`document.querySelector('.app-dialog-message').textContent.includes('应用服务器') && !document.querySelector('.app-dialog-message').textContent.includes('数据库服务器')`), 'Confirmation identifies only the host of this conversation')
  await run(`document.querySelector('.app-dialog-actions button').click()`)
  await wait(`!document.querySelector('.app-dialog')`)
  assert.equal(await run('window.__uiRegression.workspaceCloses.length'), 0, 'Cancel preserves the live connection')
  assert.deepEqual((await rowIds()).sort(), [firstSession, secondSession].sort(), 'Cancel keeps both conversations')
  await openDisconnect()
  await run(`document.querySelector('.app-dialog-actions .ui-btn-danger-solid').click()`)
  await wait(`!document.querySelector('.app-dialog') && !document.querySelector('${row(firstSession)}')`)
  assert.deepEqual(await run('window.__uiRegression.workspaceCloses'), [firstSession], 'Only the reviewed AI connection is closed')
  assert.ok(await run(`!!document.querySelector('${row(secondSession)} .ai-rail-dot.connected') && document.querySelector('${root} .ai-rail').checkVisibility()`), 'The other conversation stays connected and reachable')

  const scopeId = await startChat(['one', 'two'])
  const scopeHeader = `${root} .workspace-scope-details summary`
  await wait(`document.querySelector('${scopeHeader}')?.textContent.trim()==='已连接 2/2'`)
  assert.equal(await run(`document.querySelector('${scopeHeader}').parentElement.open`), false)
  assert.ok(await run(`document.querySelector('${row(scopeId)}').classList.contains('active') && !!document.querySelector('${row(scopeId)} .ai-rail-badge')`), 'The rail marks the collaborative conversation')
  await run('window.__uiRegression.disconnectScopedHost()')
  await wait(`document.querySelector('${scopeHeader}')?.textContent.trim()==='已连接 1/2'`)
  const disconnectedNotice = await run(`document.querySelector('${root} .workspace-error').textContent`)
  assert.ok(disconnectedNotice.includes('应用服务器') && !disconnectedNotice.includes('数据库服务器'), 'The closed header identifies the offline host in its warning')
  assert.ok(await run(`!document.querySelector('${row(scopeId)} .ai-rail-dot.connected')`), 'The rail shows the conversation as partly offline')

  let layoutCases = 0
  for (const theme of ['light', 'dark', 'eyecare']) {
    await run(`window.__uiRegression.setTheme('${theme}')`)
    for (const width of [520, 780, 1050]) {
      await run(`Object.assign(document.querySelector('${root}').style,{width:'${width}px',height:'760px'});document.querySelector('${root}').scrollIntoView({block:'center'})`)
      await frames()
      await wait(`document.querySelector('${root} .ai-rail').checkVisibility()===${width >= 760}`)
      assert.ok(await run(`(() => {
        const box = document.querySelector('${root}').getBoundingClientRect()
        return ['${scopeHeader}', '${root} .workspace-error', '${root} .workspace-retry'].every(selector => {
          const node = document.querySelector(selector), r = node?.getBoundingClientRect()
          return !!r && r.width > 0 && r.left >= box.left - 1 && r.right <= box.right + 1
        })
      })()`), `${theme}/${width}: scope status, warning and retry stay inside the workspace`)
      await screenshot(`disconnect-${theme}-${width}.png`)
      layoutCases++
    }
  }
  await run(`window.__uiRegression.setTheme('light')`)
  await run(`document.querySelector('${scopeHeader}').click()`)
  assert.deepEqual(await run(`[...document.querySelectorAll('${root} .workspace-scope-status')].map(node=>node.textContent.trim())`), ['未连接', '已连接'])
  await run(`document.querySelector('${root} .workspace-retry').click()`)
  await wait(`document.querySelector('${scopeHeader}')?.textContent.trim()==='已连接 2/2' && !document.querySelector('${root} .workspace-error')`)
  assert.equal(await run('window.__uiError || null'), null)
  console.log(JSON.stringify({ passed: true, layoutCases, flows: ['connect on first message', 'confirmation and cancel', 'single-host disconnect', 'other conversation retention', 'scope connection ratio and named offline hosts', 'scope retry'], artifacts }))
  clearTimeout(timeout); window.destroy(); app.quit()
}).catch(error => { console.error(error, { action, artifacts }); clearTimeout(timeout); app.exit(1) })
