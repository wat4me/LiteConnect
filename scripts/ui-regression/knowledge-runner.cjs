const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const artifacts = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'liteconnect-knowledge-ui-'))
app.setPath('userData', path.join(artifacts, 'profile'))
let window, database
let stage = 'starting Electron'
const timeout = setTimeout(() => { console.error('Knowledge UI timed out', { stage, artifacts }); app.exit(1) }, 360_000)
app.whenReady().then(async () => {
  stage = 'building local storage fixture'
  const bundle = path.join(process.cwd(), 'node_modules/.cache/litessh/knowledge-ui/runtime.mjs')
  await require('esbuild').build({ stdin: { contents: "export { AppDatabase } from './electron/store/appDatabase'; export { AiKnowledgeService } from './electron/ai/knowledge/knowledgeService'; export { migrateLegacyKnowledge } from './electron/ai/knowledge/legacyMigration'; export { formatKnowledgeExport } from './shared/aiKnowledge';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle })
  const { AppDatabase, AiKnowledgeService, migrateLegacyKnowledge, formatKnowledgeExport } = await import(pathToFileURL(bundle))
  const storage = path.join(artifacts, 'knowledge.sqlite')
  database = new AppDatabase(storage)
  const targets = ['a', 'b'].map(id => ({ connectionId: id, name: `Server ${id.toUpperCase()}`, host: `${id}.test`, port: 22, username: 'root' }))
  const service = new AiKnowledgeService(session => session==='fixture-b' ? [targets[1]] : session==='fixture-a' ? [targets[0]] : targets, () => database, storage)
  let failNextEnable = false
  const exportPath = path.join(artifacts, 'export.md')
  ipcMain.handle('knowledge-test', async (_event, op, args = {}) => {
    const access = service.access(args.session || 'fixture', 1)
    if (op==='fail-next-enable') { failNextEnable = true; return true }
    if (op==='migrate-legacy') {
      migrateLegacyKnowledge(database, targets[1], [{ id: 'old-host-b', raw: { defaultContextFiles: [{ source: 'local', path: 'C:/legacy/service.md', content: 'Migrated service: /srv/app; update: /srv/update.sh' }] } }])
      return true
    }
    if (op==='manage') {
      if (args.input.action==='enable' && failNextEnable) { failNextEnable=false; throw new Error('Test enable failure') }
      return access.manage(args.input)
    }
    if (op==='import') return { source: 'local', path: '/fixture/deploy.md', content: '# Deployment\n\nRestart with the documented command.' }
    if (op==='export') { const result=await access.manage({ action: 'read', connectionId: args.connectionId, documentId: args.documentId }); fs.writeFileSync(exportPath,formatKnowledgeExport(result.document)); return true }
    if (op==='ai-save') {
      const doc=(await access.manage({ action: 'read', connectionId: 'a', documentId: args.id })).document
      return access.call('knowledge_save',{connectionId:'a',documentId:doc.id,expectedRevision:doc.revision,title:doc.title,content:'# Updated by AI\n\nConfirmed service path: /srv/tomcat'},new AbortController().signal)
    }
    if (op==='legacy-memory') {
      const doc=(await access.manage({action:'read',connectionId:'a',documentId:'memory'})).document
      const binding=(await access.manage({action:'overview'})).targets[0].binding
      return access.manage({action:'save',connectionId:'a',binding,documentId:'memory',expectedRevision:doc.revision,title:'MEMORY.md',content:'Legacy user notes retained as free text.\n'+ 'existing fact '.repeat(30)})
    }
    throw new Error('Unexpected test operation')
  })
  const preload = path.join(artifacts, 'preload.cjs')
  fs.writeFileSync(preload, "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('__knowledgeBackend',{invoke:(op,args)=>ipcRenderer.invoke('knowledge-test',op,args)});")
  window = new BrowserWindow({ show: false, frame: false, width: 1100, height: 900, webPreferences: { preload, contextIsolation: true, backgroundThrottling: false } })
  window.webContents.debugger.attach('1.3')
  const run = source => window.webContents.executeJavaScript(source)
  const wait = async expression => {
    const deadline=Date.now()+15000
    while(!await run(expression)) { if(Date.now()>deadline) throw new Error(`Timeout ${expression}: ${await run('window.__knowledgeError || document.body.innerText')}`); await new Promise(resolve=>setTimeout(resolve,30)) }
  }
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const pointerClick = async selector => {
    const point = await run(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2} })()`)
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  }
  const edit = (selector,value) => run(`(() => {const field=document.querySelector(${JSON.stringify(selector)});field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  const action = index => click(`.knowledge-actions button:nth-child(${index})`)
  const confirm = () => click('.app-dialog-actions button:last-child')
  const cancel = () => click('.app-dialog-actions button:first-child')
  stage = 'loading Vue fixture'
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await wait('!!window.__knowledge')
  stage = 'checking close interactions'
  assert.equal(database.listSingletonKeys('ai-knowledge:').length,0)
  await pointerClick('.knowledge-trigger')
  await wait('!!document.querySelector(".knowledge-panel select option")')
  let closeCases = 0
  for (const [width, height, zoom] of [[1100, 900, 1], [1100, 650, 1.25], [760, 600, 1.5], [380, 600, 1]]) {
    window.setSize(width, height); window.webContents.setZoomFactor(zoom)
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert.ok(await run(`(() => { const button=document.querySelector('.knowledge-panel header button'),panel=button.closest('section'),layer=panel.parentElement,b=button.getBoundingClientRect(),p=panel.getBoundingClientRect(),bar=document.querySelector('.knowledge-fixture-titlebar').getBoundingClientRect();return b.top>=bar.bottom&&p.bottom<=innerHeight&&[button,panel,layer].every(el=>getComputedStyle(el).getPropertyValue('-webkit-app-region')==='no-drag') })()`),'Close button avoids native titlebar dragging and the panel fits the viewport')
    await pointerClick('.knowledge-panel header button')
    await wait('!document.querySelector(".knowledge-panel")')
    await wait('document.activeElement?.classList.contains("knowledge-trigger")')
    await pointerClick('.knowledge-trigger'); await wait('!!document.querySelector(".knowledge-panel select option")')
    closeCases++
  }
  window.webContents.setZoomFactor(1); window.setSize(1100,900)
  stage = 'checking external per-server knowledge switch'
  await pointerClick('.knowledge-panel header button'); await wait('!document.querySelector(".knowledge-panel")')
  await run('window.__knowledge.scope("fixture-a")')
  await wait('!!document.querySelector(".knowledge-usage-switch:not(:disabled)")')
  await pointerClick('.knowledge-usage-switch')
  await wait('!!document.querySelector(".app-dialog")')
  assert.ok(await run(`document.querySelector('.app-dialog').textContent.includes('不会在服务器上创建文件')`))
  await cancel(); await wait('!document.querySelector(".app-dialog")')
  assert.equal(database.listSingletonKeys('ai-knowledge:').length,0,'Cancelling enablement creates no knowledge records')
  await pointerClick('.knowledge-usage-switch'); await wait('!!document.querySelector(".app-dialog")'); await confirm()
  await wait(`document.querySelector('.knowledge-usage-switch').getAttribute('aria-checked')==='true'`)
  assert.equal((await service.access('fixture-a',1).manage({action:'overview'})).targets[0].enabled,true)
  await pointerClick('.knowledge-usage-switch')
  await wait(`document.querySelector('.knowledge-usage-switch').getAttribute('aria-checked')==='false'`)
  assert.equal((await service.access('fixture-a',1).manage({action:'list',connectionId:'a'})).documents.length,1,'Disabling retains documents')
  assert.equal(await service.access('fixture-a',1).prompt(),'','Disabled knowledge contributes no automatic prompt')
  assert.equal((await service.access('fixture-a',1).call('knowledge_read',{documentId:'memory'},new AbortController().signal)).isError,true,'AI reads are blocked when off')
  await pointerClick('.knowledge-trigger'); await wait('!!document.querySelector(".knowledge-panel h3")')
  await pointerClick('.knowledge-panel header button'); await wait('!document.querySelector(".knowledge-panel")')
  await run(`window.__knowledgeBackend.invoke('fail-next-enable')`)
  await pointerClick('.knowledge-usage-switch'); await wait('!!document.querySelector(".el-message--error")')
  assert.equal(await run(`document.querySelector('.knowledge-usage-switch').getAttribute('aria-checked')`),'false','A failed toggle does not show success')
  await wait('!document.querySelector(".knowledge-usage-switch").disabled')
  await pointerClick('.knowledge-usage-switch')
  await wait(`document.querySelector('.knowledge-usage-switch').getAttribute('aria-checked')==='true'`)
  assert.equal(await run('!!document.querySelector(".app-dialog")'),false,'Existing documents can be re-enabled directly')
  await run('window.__knowledge.busy(true)')
  assert.equal(await run('document.querySelector(".knowledge-usage-switch").disabled'),true,'In-flight AI context cannot be toggled')
  await run('window.__knowledge.busy(false)')
  await run('window.__knowledge.scope("fixture-b")'); await wait('!!document.querySelector(".knowledge-usage-switch:not(:disabled)")')
  await pointerClick('.knowledge-usage-switch'); await wait('!!document.querySelector(".app-dialog")')
  await run('window.__knowledge.scope("fixture-a")'); await confirm(); await wait('!document.querySelector(".app-dialog")')
  assert.equal((await service.access('fixture-b',1).manage({action:'overview'})).targets[0].enabled,false,'Stale consent cannot enable another server after a scope change')
  await run('window.__knowledge.scope("fixture")'); await wait('!!document.querySelector(".knowledge-usage-summary")')
  assert.equal(await run('document.querySelector(".knowledge-usage-summary").textContent.trim()'),'知识 1/2')
  await pointerClick('.knowledge-usage-summary'); await wait('!!document.querySelector(".knowledge-panel h3")')
  stage = 'editing source documents and linked memory'
  await wait(`!!document.querySelector('.knowledge-meta') && !document.querySelector('.knowledge-actions button').disabled`)
  await action(1); await wait('!!document.querySelector(".memory-add")'); await click('.memory-add')
  await edit('.memory-entry-text','Production server: confirm before restarting services.')
  await action(1); await wait(`!!document.querySelector('.memory-preview-entry') && !document.querySelector('.memory-entry-text')`)
  assert.equal((await service.access('fixture',1).manage({action:'read',connectionId:'a',documentId:'memory'})).document.memoryEntries[0].documentIds.length,0,'A short memory saves before any source documents exist')
  assert.equal((await service.access('fixture',1).manage({action:'list',connectionId:'a'})).documents.length,1,'No duplicate source document is created')
  await click('.knowledge-create button:last-child'); await wait('!!document.querySelector(".knowledge-panel textarea")')
  assert.equal(await run('document.querySelector(".knowledge-panel input").value'),'deploy.md')
  await action(1); await wait('document.querySelectorAll(".knowledge-doc").length===2 && !document.querySelector(".knowledge-panel textarea")')
  const selected = async () => (await service.access('fixture',1).manage({action:'list',connectionId:'a'})).documents.find(doc=>doc.title==='deploy.md').id
  const id = await selected()
  await click('.knowledge-doc:first-of-type'); await wait(`document.querySelector('.knowledge-panel h3')?.textContent==='MEMORY.md'`)
  await action(1); await wait('!!document.querySelector(".memory-add")')
  await edit('.memory-entry-text','Tomcat deployment precautions; see the source guide.')
  await run(`document.querySelector('.memory-source-picker').open=true`)
  await click('.memory-source-picker input')
  await pointerClick('.knowledge-panel header button'); await wait('!!document.querySelector(".app-dialog")'); await cancel()
  assert.ok(await run(`document.querySelector('.memory-entry-text').value.includes('Tomcat')`),'Cancelling close preserves the memory draft and source association')
  await action(1); await wait(`!!document.querySelector('.memory-preview-entry') && !document.querySelector('.memory-entry-text')`)
  assert.ok((await service.access('fixture',1).manage({action:'read',connectionId:'a',documentId:'memory'})).document.memoryEntries[0].documentIds.includes(id))
  await action(2); await wait(`!document.querySelector('.knowledge-actions button:nth-child(2)').disabled`)
  assert.ok(fs.readFileSync(exportPath,'utf8').includes(id),'Exported memory includes source document IDs')
  await click('.memory-source-links button'); await wait(`document.querySelector('.knowledge-panel h3')?.textContent==='deploy.md'`)
  await action(2); await wait(`!document.querySelector('.knowledge-actions button:nth-child(2)').disabled`)
  assert.ok(fs.readFileSync(exportPath,'utf8').includes('Restart with'))
  stage = 'checking revision conflicts and restoration'
  await action(1); await edit('.knowledge-panel textarea','# My unsaved draft')
  await run(`window.__knowledge.aiSave(${JSON.stringify(id)})`)
  await action(1)
  await wait(`document.querySelector('.knowledge-error')?.textContent.includes('你的编辑已保留')`)
  assert.equal(await run('document.querySelector(".knowledge-panel textarea").value'),'# My unsaved draft')
  await click('.knowledge-toolbar button:last-child'); await wait('!!document.querySelector(".app-dialog")'); await cancel()
  assert.equal(await run('document.querySelector(".knowledge-panel textarea").value'),'# My unsaved draft')
  await click('.knowledge-toolbar button:last-child'); await wait('!!document.querySelector(".app-dialog")'); await confirm()
  await wait(`!document.querySelector('.knowledge-panel textarea') && document.querySelector('.knowledge-panel main').textContent.includes('/srv/tomcat')`)
  await run(`document.querySelector('.knowledge-history').open=true`)
  await click('.knowledge-history article button')
  await wait(`document.querySelector('.knowledge-panel main').textContent.includes('Restart with') && document.querySelector('.knowledge-meta').textContent.includes('版本 3')`)
  await run(`(() => {const el=document.querySelector('.knowledge-toolbar select');el.value='b';el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await wait('document.querySelectorAll(".knowledge-doc").length===0')
  assert.equal((await service.access('fixture',1).manage({action:'overview'})).targets[1].enabled,false)
  await run('document.querySelector(".knowledge-layer").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
  await wait('!document.querySelector(".knowledge-panel")')
  await click('.tool-run-knowledge')
  await wait(`document.querySelector('.knowledge-panel h3')?.textContent==='deploy.md'`)
  await click('.knowledge-toolbar > button')
  await wait(`document.querySelector('.knowledge-toolbar > button').textContent==='启用知识库' && !document.querySelector('.knowledge-actions button').disabled`)
  assert.equal(await run(`document.querySelector('.knowledge-panel h3').textContent`),'deploy.md','Disabling automatic use retains the selected document')
  await action(1); await edit('.knowledge-panel textarea','# Managed while disabled'); await action(1)
  await wait(`!document.querySelector('.knowledge-panel textarea') && document.querySelector('.knowledge-panel main').textContent.includes('Managed while disabled')`)
  assert.equal((await service.access('fixture',1).manage({action:'overview'})).targets[0].enabled,false)
  await action(1); await edit('.knowledge-panel textarea','界'.repeat(12000))
  await wait(`document.querySelector('.knowledge-panel [role="alert"]')?.textContent.includes('32 KiB')`)
  assert.equal(await run(`document.querySelector('.knowledge-actions button').disabled`),true)
  await pointerClick('.knowledge-panel header button'); await wait('!!document.querySelector(".app-dialog")'); await confirm()
  await wait('!document.querySelector(".knowledge-panel")')
  await click('.tool-run-knowledge'); await wait(`document.querySelector('.knowledge-panel h3')?.textContent==='deploy.md'`)
  await wait('!document.querySelector(".knowledge-panel textarea")')
  await action(1); await edit('.knowledge-panel input','Renamed deployment guide'); await action(1)
  await wait(`document.querySelector('.knowledge-panel h3')?.textContent==='Renamed deployment guide'`)
  await action(1); await wait('!!document.querySelector(".knowledge-include-choice input")'); await click('.knowledge-include-choice input'); await action(1)
  await wait(`!document.querySelector('.knowledge-panel textarea')`)
  assert.equal((await service.access('fixture',1).manage({action:'read',connectionId:'a',documentId:id})).document.alwaysInclude,true,'The same record can be included each turn without adding a duplicate memory')
  await click('.knowledge-doc:first-of-type'); await wait(`!!document.querySelector('.memory-preview-entry')`)
  assert.equal(await run(`document.querySelector('.memory-source-links button').textContent.trim()`),'Renamed deployment guide','Renaming source documents retains ID-based links')
  let layouts=0
  stage = 'checking source links across layouts'
  for(const locale of ['zh-CN','en-US']) for(const theme of ['light','dark','eyecare']) for(const width of [380,1100]) {
    window.setSize(width,900)
    await run(`window.__knowledge.theme('${theme}','${locale}')`)
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert.ok(await run(`(() => {const el=document.querySelector('.knowledge-panel'),r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&el.scrollWidth<=el.clientWidth+1})()`),`${locale}/${theme}/${width}`)
    assert.ok(await run(`!document.querySelector('.knowledge-panel').textContent.match(/common\\.[a-z]+|ai\\.knowledge\\.[a-z]+/)`),'No untranslated UI keys')
    layouts++
  }
  await run('window.__knowledge.theme("light","zh-CN")')
  window.setSize(1100,900)
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await window.webContents.capturePage(); await new Promise(resolve=>setTimeout(resolve,100))
  fs.writeFileSync(path.join(artifacts,'knowledge.png'),(await window.webContents.capturePage()).toPNG())
  await click('.memory-source-links button'); await wait(`document.querySelector('.knowledge-panel h3')?.textContent==='Renamed deployment guide'`)
  await action(3); await wait('!!document.querySelector(".app-dialog")'); await confirm()
  await wait(`document.querySelectorAll('.knowledge-doc').length===1 && !!document.querySelector('.memory-preview-entry')`)
  assert.ok(await run(`document.querySelector('.memory-source-links').textContent.includes('来源文档已失效')`),'Deleted sources stay visibly missing instead of silently changing the association')
  await run(`window.__knowledgeBackend.invoke('legacy-memory')`)
  await click('.knowledge-toolbar button:last-child'); await wait(`document.querySelector('.knowledge-panel main').textContent.includes('自由文本记忆')`)
  await action(1); await wait('!!document.querySelector(".knowledge-panel textarea")')
  const legacyText = await run(`document.querySelector('.knowledge-panel textarea').value`)
  assert.ok(legacyText.length>160,'Legacy notes need not fit the structured entry format')
  await click('.knowledge-include-choice input'); await action(1)
  await wait('!document.querySelector(".knowledge-panel textarea")')
  const legacyDoc=(await service.access('fixture',1).manage({action:'read',connectionId:'a',documentId:'memory'})).document
  assert.equal(legacyDoc.content,legacyText,'Changing inclusion preserves the original legacy text')
  assert.equal(legacyDoc.alwaysInclude,false)
  assert.equal(legacyDoc.memoryEntries,undefined,'Legacy notes are not forced into a new format')
  await run('window.__knowledge.scope("fixture-b")')
  await wait('!document.querySelector(".knowledge-panel")')
  await click('.knowledge-trigger')
  await wait('document.querySelectorAll(".knowledge-toolbar select option").length===1')
  assert.ok(await run(`document.querySelector('.knowledge-toolbar select').textContent.includes('Server B')`))
  assert.equal(await run('document.querySelectorAll(".knowledge-doc").length'),0)
  assert.equal(await run('window.__knowledgeError || null'),null)
  await run(`window.__knowledgeBackend.invoke('migrate-legacy')`)
  await click('.knowledge-toolbar button:last-child')
  await wait(`document.querySelector('.knowledge-panel main').textContent.includes('Migrated service: /srv/app')`)
  assert.equal(await run(`document.querySelector('.knowledge-usage-switch').getAttribute('aria-checked')`),'false','Migration keeps the knowledge switch off')
  await pointerClick('.knowledge-panel header button'); await wait('!document.querySelector(".knowledge-panel")')
  await pointerClick('.knowledge-usage-switch')
  await wait(`document.querySelector('.knowledge-usage-switch').getAttribute('aria-checked')==='true'`)
  assert.equal(await run('!!document.querySelector(".app-dialog")'),false,'Imported documents are managed by the same external switch')
  stage = 'checking knowledge counts in the actual sidebar composer'
  await window.loadURL(new URL('index.html', process.env.LITECONNECT_UI_TEST_URL).href)
  await wait('!!window.__uiRegression')
  await run(`window.LiteConnect.aiKnowledge = async (_session, input) => {
    const result = await window.__knowledgeBackend.invoke('manage', { session: 'fixture', input });
    return input.action === 'overview' ? { ...result, targets: result.targets.filter((_target, index) => !window.__knowledgeTriggerSingle || index===0).map((target, index) => ({ ...target, count: index ? 0 : window.__knowledgeTriggerCount })) } : result;
  }; window.__knowledgeTriggerSingle = true; window.__knowledgeTriggerCount = 0; window.__uiRegression.openImageComposer()`)
  await wait('!!document.querySelector(".ai-sidebar .knowledge-trigger")')
  let triggerLayouts = 0
  for (const locale of ['zh-CN', 'en-US']) for (const theme of ['light', 'dark', 'eyecare']) for (const workspace of [false, true]) for (const [width, count] of [[300, 0], [300, 120], [440, 2], [440, 12]]) {
    stage = `checking composer ${locale}/${theme}/${workspace}/${width}/${count}`
    await run(`(async () => { (await import('/src/i18n/index.ts')).setAppLocale('${locale}'); await window.__uiRegression.setTheme('${theme}'); await window.__uiRegression.setContextLayout(${workspace}); document.querySelector('.ai-image-composer-fixture').style.width='${width}px'; window.__knowledgeTriggerSingle=${!workspace}; window.__knowledgeTriggerCount=${count}; await window.__uiRegression.switchImageSession('knowledge-trigger-${triggerLayouts}'); })()`)
    await wait(`document.querySelector('.ai-sidebar .knowledge-trigger').textContent.trim() === '${count ? count > 99 ? '99+' : count : ''}'`)
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert.ok(await run(`(() => {
      const trigger=document.querySelector('.ai-sidebar .knowledge-trigger'), strip=trigger.closest('.composer-context-strip');
      const button=trigger.getBoundingClientRect(), icon=trigger.querySelector('svg').getBoundingClientRect(), badge=trigger.querySelector('.knowledge-count')?.getBoundingClientRect();
      const usage=strip.querySelector('.knowledge-usage-switch, .knowledge-usage-summary').getBoundingClientRect();
      return !strip.querySelector('.composer-context-menu, .composer-context-chips, .composer-add-image, input[type=file]') && icon.left>=button.left && icon.right<=button.right && (!badge || badge.left>=icon.right && badge.right<=button.right-1)
        && usage.left>=button.right+3 && strip.scrollWidth<=strip.clientWidth+1
        && (!${count} || trigger.title.includes('${count}') && trigger.getAttribute('aria-label').includes('${count}'));
    })()`),`Knowledge count stays inside its button, aligned and separate from adjacent controls: ${theme}/${workspace}/${width}/${count}`)
    triggerLayouts++
  }
  await run(`(async () => { (await import('/src/i18n/index.ts')).setAppLocale('zh-CN'); await window.__uiRegression.setTheme('light'); await window.__uiRegression.setContextLayout(false); document.querySelector('.ai-image-composer-fixture').style.width='380px'; window.__knowledgeTriggerSingle=true; window.__knowledgeTriggerCount=2; await window.__uiRegression.switchImageSession('knowledge-trigger-preview'); })()`)
  await wait(`document.querySelector('.ai-sidebar .knowledge-trigger').textContent.trim()==='2'`)
  await run(`document.querySelector('.ai-image-composer-fixture').scrollIntoView()`)
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const composerBounds=await run(`(() => {const r=document.querySelector('.ai-sidebar .composer').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`)
  fs.writeFileSync(path.join(artifacts,'knowledge-trigger.png'),(await window.webContents.capturePage(composerBounds)).toPNG())
  await pointerClick('.ai-sidebar .knowledge-trigger'); await wait('!!document.querySelector(".knowledge-panel")')
  await pointerClick('.knowledge-panel header button'); await wait('!document.querySelector(".knowledge-panel")')
  await wait('document.activeElement?.classList.contains("knowledge-trigger")')
  console.log(JSON.stringify({passed:true,layouts,closeCases,triggerLayouts,flows:['pointer close/titlebar safety/zoom','unsaved close cancel/confirm','enable consent/cancel','local SQLite storage','standalone memory without sources','per-record include choice without duplication','Markdown editing/import/export','optional source navigation/rename/deletion','revision conflict preserves draft','restore','server isolation','AI view locator','scope change','actual sidebar/workspace knowledge icon counts and click/focus'],artifacts}))
  clearTimeout(timeout); window.destroy(); database.close(); app.quit()
}).catch(error=>{console.error(error,{artifacts});clearTimeout(timeout);if(window)window.destroy();database?.close();app.exit(1)})
