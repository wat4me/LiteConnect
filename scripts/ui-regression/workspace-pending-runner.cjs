const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'liteconnect-workspace-pending-'))
app.setPath('userData', path.join(artifacts, 'profile'))
let action = 'load'
const timeout = setTimeout(() => { console.error('Workspace pending UI timed out', { action, artifacts }); app.exit(1) }, 120_000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1320, height: 1000, webPreferences: { contextIsolation: true, backgroundThrottling: false } })
  const run = code => { action = code.slice(0, 200); return win.webContents.executeJavaScript(code) }
  const wait = async code => {
    const start = Date.now()
    while (!await run(code)) {
      if (Date.now() - start > 10_000) throw new Error(`Timeout: ${code}`)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  const root = '.lite-ai-workspace-fixture'
  const row = id => `${root} .ai-rail-row[data-session-id="${id}"]`
  const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await win.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await wait('!!window.__uiRegression')
  await run('window.__uiRegression.openLiteAi()')
  await wait(`!!document.querySelector('${root} .connections-ai-workspace')`)
  // A conversation exists once its first message connects the host.
  const sessions = []
  for (const [id, kind] of [['one', 'question'], ['two', 'approval']]) {
    await run(`window.__uiRegression.openAiHosts(['${id}'])`)
    await wait(`!!document.querySelector('${root} .ai-draft-input')`)
    await run(`(()=>{const input=document.querySelector('${root} .ai-draft-input');input.value='检查 ${id}';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await wait(`!document.querySelector('${root} .ai-draft-send').disabled`)
    await run(`document.querySelector('${root} .ai-draft-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`)
    await wait(`!document.querySelector('${root} .ai-draft') && !!document.querySelector('${root} .lite-ai-chat .composer-input')`)
    await wait(`document.querySelectorAll('${root} .ai-rail-row[data-session-id]').length===${sessions.length + 1}`)
    const sessionId = await run(`[...document.querySelectorAll('${root} .ai-rail-row[data-session-id]')].map(node=>node.dataset.sessionId).find(id=>!${JSON.stringify(sessions)}.includes(id))`)
    sessions.push(sessionId)
    await wait(`window.__uiRegression.calls.aiRequests.length===${sessions.length}`)
    await wait(`!document.querySelector('${root} .lite-ai-chat .message.streaming, ${root} .lite-ai-chat .composer-stop')`)
    await run(`window.__uiRegression.seedWorkspacePending('${sessionId}','${kind}')`)
    await wait(`!!document.querySelector('${row(sessionId)} .ai-rail-bell')`)
  }
  const [question, approval] = sessions
  const requests = await run('window.__uiRegression.calls.aiRequests.length')
  assert.equal(await run(`document.querySelectorAll('${root} .ai-rail-bell').length`), 2)
  assert.ok(await run(`document.querySelector('${row(question)} .ai-rail-item').title.includes('等待你回答问题') && document.querySelector('${row(approval)} .ai-rail-item').title.includes('等待你确认操作')`), 'One unified bell keeps specific question and approval descriptions')
  assert.deepEqual(await run(`['${question}','${approval}'].map(id=>document.querySelector('.lite-ai-workspace-fixture .ai-rail-row[data-session-id="'+id+'"] .ai-rail-bell').getAttribute('aria-label'))`), ['等待你回答问题', '等待你确认操作'])
  assert.ok(await run(`document.querySelector('${root} .ai-rail-pending').textContent.includes('2')`))
  assert.equal(await run(`document.querySelectorAll('${root} .ai-rail-dot.connected').length`), 2, 'Connection and pending states remain independent')
  let layouts = 0
  for (const theme of ['light', 'dark', 'eyecare']) {
    await run(`window.__uiRegression.setTheme('${theme}')`)
    for (const width of [780, 1050]) {
      await run(`Object.assign(document.querySelector('${root}').style,{width:'${width}px',height:'720px'});document.querySelector('${root}').scrollIntoView({block:'center'})`)
      await frames()
      await wait(`document.querySelector('${root} .ai-rail').checkVisibility()`)
      assert.ok(await run(`Array.from(document.querySelectorAll('${root} .ai-rail-bell')).every(bell=>{const r=bell.getBoundingClientRect(),p=bell.closest('.ai-rail-row').getBoundingClientRect();return r.width>0 && r.left>=p.left && r.right<=p.right})`), `${theme}/${width}: pending bells fit the rail`)
      const rect = await run(`(()=>{const r=document.querySelector('${root}').getBoundingClientRect();return {x:Math.max(0,Math.floor(r.x)),y:Math.max(0,Math.floor(r.y)),width:Math.floor(r.width),height:Math.floor(r.height)}})()`)
      fs.writeFileSync(path.join(artifacts, `pending-${theme}-${width}.png`), (await win.webContents.capturePage(rect)).toPNG())
      layouts++
    }
  }
  await run(`window.__uiRegression.setTheme('light');document.querySelector('${root}').style.width='700px'`)
  await wait(`!document.querySelector('${root} .ai-rail').checkVisibility() && !!document.querySelector('${root} .ai-rail-toggle-dot')?.checkVisibility()`)
  await run(`document.querySelector('${root} .ai-rail-toggle').click()`)
  await wait(`document.querySelector('${root} .ai-rail').checkVisibility()`)
  await run(`document.querySelector('${row(question)} .ai-rail-item').click()`)
  await wait(`!document.querySelector('${root} .ai-rail').checkVisibility() && !!document.querySelector('${root} .ai-question-card textarea')`)
  await run(`document.querySelector('${root}').style.width='1050px'`)
  await wait(`document.querySelector('${root} .ai-rail').checkVisibility()`)
  await run(`(()=>{const input=document.querySelector('${root} .ai-question-card textarea');input.value='保留这份回答草稿';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('${root} .ai-conversation-menu-trigger').click()})()`)
  await wait(`!!document.querySelector('.ai-conversation-menu [data-action="history"]')`)
  await run(`document.querySelector('.ai-conversation-menu [data-action="history"]').click()`)
  await wait(`!!document.querySelector('${root} .ai-history-page')`)
  await run(`document.querySelector('${row(question)} .ai-rail-item').click()`)
  await wait(`!document.querySelector('${root} .ai-history-page')`)
  assert.equal(await run(`document.querySelector('${root} .ai-question-card textarea').value`), '保留这份回答草稿')
  await run(`document.querySelector('${row(approval)} .ai-rail-item').click()`)
  await wait(`!!document.querySelector('${root} .tool-approval-btn.primary')`)
  await run(`document.querySelector('${root} .tool-approval-btn.primary').click()`)
  await wait(`!document.querySelector('${row(approval)} .ai-rail-bell')`)
  assert.equal(await run(`document.querySelectorAll('${root} .ai-rail-bell').length`), 1, 'Approving a command does not clear another conversation question')
  await run(`window.__uiRegression.seedWorkspacePending('${question}','mixed')`)
  await wait(`document.querySelector('${row(question)} .ai-rail-item').title.includes('等待你回答问题并确认操作')`)
  await run(`window.__uiRegression.seedWorkspacePending('${question}','done')`)
  await wait(`!document.querySelector('${root} .ai-rail-bell') && !document.querySelector('${root} .ai-rail-pending')`)
  assert.equal(await run(`document.querySelectorAll('${root} .ai-rail-row[data-session-id]').length`), 2, 'Revealing work never creates a new conversation')
  assert.equal(await run('window.__uiRegression.calls.aiRequests.length'), requests, 'Revealing work never resubmits a chat request')
  assert.equal(await run('window.__uiError || null'), null)
  console.log(JSON.stringify({ passed: true, layouts, flows: ['connect on first message', 'shared pending bells', 'question and approval hints', 'mixed state', 'floating rail indicator', 'exact pending navigation', 'draft preservation', 'approval cleanup', 'offscreen completion cleanup'], artifacts }))
  clearTimeout(timeout); win.destroy(); app.quit()
}).catch(error => { console.error(error, { action, artifacts }); clearTimeout(timeout); app.exit(1) })
