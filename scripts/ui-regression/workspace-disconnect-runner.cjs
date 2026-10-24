const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'liteconnect-workspace-disconnect-'))
app.setPath('userData', path.join(artifacts, 'profile'))
const timeout = setTimeout(() => { console.error('Workspace disconnect UI timed out', { artifacts }); app.exit(1) }, 150_000)
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1320, height: 1000, webPreferences: { contextIsolation: true, backgroundThrottling: false } })
  const run = code => window.webContents.executeJavaScript(code)
  const wait = async expression => {
    const start = Date.now()
    while (!await run(expression)) {
      if (Date.now() - start > 10_000) throw new Error(`Timeout: ${expression}`)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  const root = '.lite-ai-workspace-fixture'
  const card = id => `${root} .workspace-card[data-connection-id="${id}"]`
  const button = id => `${card(id)} .workspace-disconnect-host`
  const selectedIds = () => run(`Array.from(document.querySelectorAll('${root} .workspace-host-checkbox:checked')).map(input=>input.closest('.workspace-card').dataset.connectionId)`)
  const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const screenshot = async name => {
    await frames()
    const rect = await run(`(() => {const r=document.querySelector('${root}').getBoundingClientRect();return {x:Math.max(0,Math.floor(r.x)),y:Math.max(0,Math.floor(r.y)),width:Math.floor(r.width),height:Math.floor(r.height)}})()`)
    fs.writeFileSync(path.join(artifacts, name), (await window.webContents.capturePage(rect)).toPNG())
  }
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await wait('!!window.__uiRegression')
  await run('window.__uiRegression.openLiteAi()')
  await run(`document.querySelector('${root} .titlebar-brand-module').click()`)
  await wait(`!!document.querySelector('.titlebar-mode-menu')`)
  await run(`document.querySelector('.titlebar-mode-menu .titlebar-mode-item:last-child').click()`)
  await wait(`document.querySelectorAll('${root} .workspace-card').length===2`)
  assert.equal(await run(`document.querySelectorAll('${root} .workspace-disconnect-host').length`), 0, 'Disconnected hosts offer no disconnect action')
  const firstSession = await run(`window.LiteConnect.aiOpenWorkspaceConnection('one')`)
  await wait(`!!document.querySelector('${button('one')}')`)
  assert.equal(await run(`document.querySelectorAll('${root} .workspace-disconnect-host').length`), 1, 'Only the connected host has an action')
  assert.ok(await run(`document.querySelector('${button('one')}').getAttribute('aria-label').includes('应用服务器')`), 'The action names its own server')
  await run(`document.querySelector('${card('one')} .workspace-host-checkbox').click()`)
  const beforeSelection = await selectedIds()
  await run(`document.querySelector('${button('one')}').click();document.querySelector('${button('one')}').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}))`)
  await wait(`!!document.querySelector('.app-dialog')`)
  assert.equal(await run('window.__uiRegression.workspaceScopes.length'), 0, 'Clicking or double-clicking disconnect never starts a conversation')
  assert.deepEqual(await selectedIds(), beforeSelection, 'The disconnect action does not toggle server selection')
  assert.ok(await run(`document.querySelector('.app-dialog-message').textContent.includes('应用服务器') && !document.querySelector('.app-dialog-message').textContent.includes('数据库服务器')`), 'Confirmation identifies only the clicked host')
  await run(`document.querySelector('.app-dialog-actions button').click()`)
  await wait(`!document.querySelector('.app-dialog') && !document.querySelector('${button('one')}').disabled`)
  assert.equal(await run('window.__uiRegression.workspaceCloses.length'), 0, 'Cancel preserves the live connection')
  const secondSession = await run(`window.LiteConnect.aiOpenWorkspaceConnection('two')`)
  await wait(`document.querySelectorAll('${root} .workspace-disconnect-host').length===2`)

  let layoutCases = 0
  for (const theme of ['light', 'dark', 'eyecare']) {
    await run(`window.__uiRegression.setTheme('${theme}')`)
    for (const view of ['cards', 'list']) {
      await run(`document.querySelector('${root} [data-view="${view}"]').click()`)
      for (const width of [520, 780, 1150]) {
        await run(`Object.assign(document.querySelector('${root}').style,{width:'${width}px',height:'760px'});document.querySelector('${root}').scrollIntoView({block:'center'})`)
        await frames()
        assert.ok(await run(`(() => {const pane=document.querySelector('${root} .workspace-host-scroll');return pane.scrollWidth<=pane.clientWidth+1 && [...pane.querySelectorAll('.workspace-disconnect-host')].every(node=>{const r=node.getBoundingClientRect(),card=node.closest('.workspace-card').getBoundingClientRect();return r.left>=card.left && r.right<=card.right+1 && r.top>=card.top && r.bottom<=card.bottom+1 && node.scrollWidth<=node.clientWidth+1 && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.workspace-disconnect-host')===node})})()`), `${theme}/${view}/${width}: actions remain visible and clickable without hovering`)
        if (view === 'list' && width === 1150) assert.equal(await run(`document.querySelector('${root} .workspace-list-heading').children.length`), 4, 'Desktop lists have an explicit actions column')
        await screenshot(`disconnect-${theme}-${view}-${width}.png`)
        layoutCases++
      }
    }
  }
  await run(`window.__uiRegression.setTheme('light');document.querySelector('${button('one')}').click()`)
  await wait(`!!document.querySelector('.app-dialog')`)
  await run(`document.querySelector('.app-dialog-actions .ui-btn-danger-solid').click()`)
  await wait(`!document.querySelector('${button('one')}') && !!document.querySelector('${button('two')}')`)
  assert.deepEqual(await run('window.__uiRegression.workspaceCloses'), [firstSession], 'Only the reviewed AI connection is closed')
  assert.equal(await run(`document.querySelectorAll('${root} .workspace-card').length`), 2, 'The browser remains open after disconnecting')
  assert.deepEqual(await selectedIds(), beforeSelection, 'Disconnecting preserves the chosen server list')
  await run(`document.querySelector('${root} [data-filter="connected"]').click()`)
  await wait(`document.querySelectorAll('${root} .workspace-card').length===1 && !!document.querySelector('${card('two')}')`)
  await run(`document.querySelector('${button('two')}').click()`)
  await wait(`!!document.querySelector('.app-dialog')`)
  await run(`document.querySelector('.app-dialog-actions .ui-btn-danger-solid').click()`)
  await wait(`!!document.querySelector('${root} .workspace-empty') && !document.querySelector('.app-dialog')`)
  assert.deepEqual(await run('window.__uiRegression.workspaceCloses'), [firstSession, secondSession])
  assert.equal(await run('window.__uiError || null'), null)
  console.log(JSON.stringify({ passed: true, layoutCases, flows: ['visible connected-only action', 'confirmation and cancel', 'selection and double-click isolation', 'single-host disconnect', 'browser retention', 'connected filter'], artifacts }))
  clearTimeout(timeout); window.destroy(); app.quit()
}).catch(error => { console.error(error, { artifacts }); clearTimeout(timeout); app.exit(1) })
