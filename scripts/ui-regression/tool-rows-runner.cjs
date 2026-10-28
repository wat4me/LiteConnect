const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const artifacts = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'liteconnect-tool-rows-'))
app.setPath('userData', path.join(artifacts, 'profile'))
let window
const timeout = setTimeout(() => { console.error('Tool row UI timed out', { artifacts }); app.exit(1) }, 120_000)
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
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await wait('!!window.__uiRegression')
  const rows = [
    { id: 'exec', name: 'exec', content: JSON.stringify({ exitCode: 0, stdout: 'partial output', truncated: true }) },
    { id: 'glob', name: 'glob', content: JSON.stringify({ files: ['/opt/app/ImportZipWorkflowFile.java', '/opt/app/config.xml'] }) },
    { id: 'grep', name: 'grep', content: JSON.stringify({ matchCount: 0, content: '' }) },
    { id: 'target', name: 'exec', target: 'production-server-'.repeat(10), content: JSON.stringify({ exitCode: 2, stderr: 'missing file' }) },
  ].map(row => ({ status: 'done', isError: false, args: JSON.stringify({ command: 'inspect ImportZipWorkflowFile '.repeat(10) }), reason: '查看 ImportZipWorkflowFile 方法和配置文件 '.repeat(10), ...row }))
  await run(`window.__uiRegression.aiTools(${JSON.stringify(rows)})`)
  await wait(`document.querySelectorAll('.ai-fixture .tool-run').length===4`)
  let cases = 0
  for (const locale of ['zh-CN', 'en-US']) {
    await run(`import('/src/i18n/index.ts').then(module=>module.setAppLocale('${locale}'))`)
    await wait(`document.querySelector('.ai-fixture .tool-run-state').textContent.trim()===${JSON.stringify(locale==='zh-CN' ? '执行成功' : 'Succeeded')}`)
    for (const theme of ['light', 'dark', 'eyecare']) {
      await run(`window.__uiRegression.setTheme('${theme}')`)
      for (const width of [280, 330, 440]) {
        for (const open of [false, true]) {
          await run(`(() => {const fixture=document.querySelector('.ai-fixture');fixture.style.width='${width}px';fixture.style.height='700px';fixture.scrollIntoView({block:'start'});fixture.querySelectorAll('.tool-run').forEach(row=>row.open=${open})})()`)
          await wait(`Array.from(document.querySelectorAll('.ai-fixture .tool-run')).every(row=>row.open===${open} && ${open ? '!row.querySelector(".tool-run-desc")' : '!!row.querySelector(".tool-run-desc")'})`)
          const layout = await run(`Array.from(document.querySelectorAll('.ai-fixture .tool-run-head')).map(head=>{
            const rect=head.getBoundingClientRect(), state=head.querySelector('.tool-run-state'), detail=head.querySelector('.tool-run-detail');
            const a=state.getBoundingClientRect(), b=detail?.getBoundingClientRect();
            return {fits:head.scrollWidth<=head.clientWidth+1&&a.left>=rect.left&&a.right<=rect.right+1, height:rect.height, sameLine:!b||Math.abs(a.top-b.top)<1, stateVisible:state.scrollWidth<=state.clientWidth+1, title:head.querySelector('.tool-run-outcome').title}
          })`)
          for (const row of layout) assert.ok(row.fits && row.height<=26 && row.sameLine && row.stateVisible && row.title, `${locale}/${theme}/${width}/${open}: ${JSON.stringify(row)}`)
          const details = await run(`Array.from(document.querySelectorAll('.ai-fixture .tool-run-detail')).map(node=>node.textContent.trim())`)
          assert.equal(details.length, 3, 'Truncation and search counts remain available')
          assert.ok(details[1].includes('2') && details[2].includes('0'), 'File and match counts are preserved')
          cases++
        }
      }
    }
  }
  // A ticking tool timer must not rebuild the whole message/tool list.
  await run(`(() => {
    const root=document.querySelector('.ai-fixture .chat-shell');
    let view=root.__vueParentComponent;
    while(view && view.type.__name!=='AiChatView') view=view.parent;
    if(!view) throw new Error('Chat view not found');
    window.__toolChatRenders=0;
    (view.bu || (view.bu=[])).push(()=>window.__toolChatRenders++);
  })()`)
  const before = await run(`document.querySelector('.ai-fixture .activity-elapsed').textContent`)
  await wait(`document.querySelector('.ai-fixture .activity-elapsed').textContent!==${JSON.stringify(before)}`)
  assert.equal(await run('window.__toolChatRenders'), 0, 'Elapsed-time ticks update only the activity indicator')
  await run(`window.__uiRegression.aiTools(${JSON.stringify(rows.map(row=>({...row, reason:'updated operation'})))})`)
  await wait('window.__toolChatRenders>0')
  assert.equal(await run('window.__uiError || null'), null)
  console.log(JSON.stringify({ passed: true, cases, artifacts }))
  clearTimeout(timeout)
  window.destroy()
  app.quit()
}).catch(error => { console.error(error, { artifacts }); clearTimeout(timeout); if (window) window.destroy(); app.exit(1) })
