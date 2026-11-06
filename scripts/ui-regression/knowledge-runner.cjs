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
  let extraProfiles = []
  const service = new AiKnowledgeService(session => session==='fixture-b' ? [targets[1]] : session==='fixture-a' ? [targets[0]] : targets, () => database, storage, () => [...targets,...extraProfiles])
  let failNextEnable = false
  const exportPath = path.join(artifacts, 'export.md')
  ipcMain.handle('knowledge-test', async (_event, op, args = {}) => {
    const access = service.access(args.session || 'fixture', 1)
    if (op==='groups') return service.groups.manage(args.input)
    if (op==='large-profiles') { extraProfiles=Array.from({length:5000},(_,i)=>({connectionId:`bulk-${String(i).padStart(4,'0')}`,name:`Bulk ${String(i).padStart(4,'0')}`,host:`bulk-${i}.test`,port:22,username:'ops'}));return true }
    if (op==='group-manage') return service.groupAccess(args.groupId).manage(args.input)
    if (op==='group-export') { const result=await service.groupAccess(args.groupId).manage({action:'read',documentId:args.documentId});fs.writeFileSync(exportPath,formatKnowledgeExport(result.document));return true }
    if (op==='fail-next-enable') { failNextEnable = true; return true }
    if (op==='migrate-legacy') {
      migrateLegacyKnowledge(database, targets[1], [{ id: 'old-host-b', raw: { defaultContextFiles: [{ source: 'local', path: 'C:/legacy/service.md', content: 'Migrated service: /srv/app; update: /srv/update.sh' }] } }])
      return true
    }
    if (op==='manage') {
      if (['enable','setMode'].includes(args.input.action) && failNextEnable) { failNextEnable=false; throw new Error('Test enable failure') }
      return access.manage(args.input)
    }
    if (op==='import') return { source: 'local', path: '/fixture/deploy.md', content: '# Deployment\n\nRestart with the documented command.' }
    if (op==='export') { const result=await access.manage({ action: 'read', connectionId: args.connectionId, documentId: args.documentId }); fs.writeFileSync(exportPath,formatKnowledgeExport(result.document)); return true }
    if (op==='group-ai-save') {
      const doc=(await access.manage({action:'read',groupId:args.groupId,documentId:args.id})).document
      return access.call('knowledge_save',{groupId:args.groupId,documentId:doc.id,expectedRevision:doc.revision,title:doc.title,content:doc.content+'\n共同发布约定：发布前先检查目标环境。'},new AbortController().signal)
    }
    if (op==='system-reset') {
      for (const group of service.groups.list()) service.groups.manage({action:'delete',groupId:group.id,expectedRevision:group.revision})
      if (targets.length===2) targets.push(...['c','d'].map(id=>({connectionId:id,name:`Server ${id.toUpperCase()}`,host:`${id}.test`,port:22,username:'root'})))
      return true
    }
    if (op==='system-retarget') { targets[0]={...targets[0],host:args.reset?'a.test':'replacement.test'};return true }
    if (op==='system-ai') {
      const meta=(await access.manage({action:'overview'})).groups.find(group=>group.groupId===args.groupId)
      const doc=(await access.manage({action:'read',groupId:args.groupId,documentId:'system'})).document
      const system={description:'订单系统：网关对外提供入口，业务服务访问数据库与缓存。发布顺序：数据库 → 业务服务 → 网关。',nodes:meta.systemMembers.map((member,index)=>({id:`service-${index}`,connectionId:member.connectionId,binding:member.binding,role:['网关','订单服务','数据库','缓存'][index],note:['对外 HTTP 入口','订单业务逻辑','持久化订单数据','缓存用途待核实'][index],status:index===3?'unconfirmed':'confirmed'})),dependencies:[{from:'service-0',to:'service-1',label:'HTTP',status:'confirmed'},{from:'service-1',to:'service-2',label:'SQL',status:'confirmed'},{from:'service-1',to:'service-3',label:'Redis',status:'unconfirmed'}]}
      return access.call('knowledge_save',{groupId:args.groupId,documentId:'system',title:'SYSTEM.md',system,alwaysInclude:true,expectedRevision:doc.revision},new AbortController().signal)
    }
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
  const knowledgeGroupsEnabled = /export const KNOWLEDGE_GROUPS_ENABLED = true\b/.test(fs.readFileSync(path.join(process.cwd(), 'shared', 'aiKnowledgeGroups.ts'), 'utf8'))
  async function checkLargeMembers() {
    if (!knowledgeGroupsEnabled) return 0
    stage='checking 5000-server searchable virtual member list'
    await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
    await wait('!!window.__knowledge')
    await run(`window.__knowledgeBackend.invoke('large-profiles')`)
    await run(`window.__knowledge.show()`)
    await wait('!!document.querySelector(".knowledge-panel .knowledge-mode-select:not(:disabled)")')
    await click('.knowledge-group-create')
    await wait('!!document.querySelector(".knowledge-group-dialog input:not(:disabled)")')
    await edit('.knowledge-group-field input','Large fleet selection')
    await wait('!!document.querySelector(".knowledge-group-members input[value=bulk-0000]")')
    while (await run('!!document.querySelector(".knowledge-group-members input[type=checkbox]:checked")')) {
      await click('.knowledge-group-members input[type=checkbox]:checked')
      await run('new Promise(resolve=>requestAnimationFrame(resolve))')
    }
    assert.ok(await run('document.querySelectorAll(".knowledge-group-members input[type=checkbox]").length<60'),'5000 profiles render only visible rows')
    await click('.knowledge-group-members input[value=bulk-0000]')
    await edit('.knowledge-group-search','bulk-4999.test')
    await wait('!!document.querySelector(".knowledge-group-members input[value=bulk-4999]")')
    assert.equal(await run('document.querySelectorAll(".knowledge-group-members input[type=checkbox]").length'),1)
    await click('.knowledge-group-members input[value=bulk-4999]')
    await edit('.knowledge-group-search','no matching server')
    await wait('document.querySelectorAll(".knowledge-group-members input[type=checkbox]").length===0')
    await edit('.knowledge-group-search','')
    await wait('document.querySelector(".knowledge-group-members input[value=bulk-0000]")?.checked')
    window.setSize(500,720);window.webContents.setZoomFactor(1.25)
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert.ok(await run('document.querySelectorAll(".knowledge-group-members input[type=checkbox]").length<60'))
    fs.writeFileSync(path.join(artifacts,'knowledge-large-members.png'),(await window.webContents.capturePage()).toPNG())
    await click('.knowledge-group-save')
    await wait('!document.querySelector(".knowledge-group-dialog")')
    const group=service.groups.list().find(group=>group.name==='Large fleet selection')
    assert.deepEqual(group.members.map(member=>member.connectionId),['bulk-0000','bulk-4999'])
    await wait('!!document.querySelector(".knowledge-panel .knowledge-mode-select:not(:disabled)")')
    await click('.knowledge-panel header button')
    await wait('!document.querySelector(".knowledge-panel")')
    service.groups.manage({action:'delete',groupId:group.id,expectedRevision:group.revision})
    extraProfiles=[]
    return 5000
  }
  async function checkGroupEntry() {
    await window.loadURL(new URL('index.html', process.env.LITECONNECT_UI_TEST_URL).href)
    await wait('!!window.__uiRegression')
  stage = 'checking the LiteAI server-list group entry'
  await run(`window.LiteConnect.aiKnowledgeGroups = input => window.__knowledgeBackend.invoke('groups', { input }); window.LiteConnect.aiGroupKnowledge = (groupId,input) => window.__knowledgeBackend.invoke('group-manage',{groupId,input}); window.LiteConnect.aiExportGroupKnowledge = (groupId,documentId) => window.__knowledgeBackend.invoke('group-export',{groupId,documentId}); window.__uiRegression.setWorkspacePreview(${JSON.stringify(targets.map(server => ({id:server.connectionId,name:server.name,host:server.host,port:server.port,username:server.username,password:'',group:'dev',createdAt:1,updatedAt:1})))}, []); window.__uiRegression.openLiteAi(); true`)
  await wait('!!document.querySelector(".lite-ai-workspace-fixture .titlebar-brand-module")')
  await click('.lite-ai-workspace-fixture .titlebar-brand-module')
  await wait('document.querySelectorAll(".titlebar-mode-menu .titlebar-mode-item").length===3')
  await click('.titlebar-mode-menu .titlebar-mode-item:last-child')
  await wait('document.querySelectorAll(".workspace-host-checkbox").length===2')
  if (!knowledgeGroupsEnabled) {
    assert.equal(await run('document.querySelector(".workspace-knowledge-group")'), null, 'LiteAI server list hides knowledge group creation')
    return 0
  }
  await click('.workspace-host-checkbox'); await click('.workspace-card:nth-child(2) .workspace-host-checkbox')
  const openedBeforeGroup = await run('window.__uiRegression.workspaceOpens.length')
  await click('.workspace-knowledge-group'); await wait('document.querySelectorAll(".knowledge-group-members input:checked").length===2')
  await edit('.knowledge-group-field input','从服务器列表创建的组')
  await click('.knowledge-group-save'); await wait('!document.querySelector(".knowledge-group-dialog")')
  assert.equal(service.groups.list().length,1)
  await wait('!!document.querySelector(".knowledge-panel main textarea")')
  await edit('.knowledge-panel main input:not([type="checkbox"])','公共发布流程')
  await edit('.knowledge-panel main textarea','离线维护的发布步骤：检查目标机器后运行已确认的发布脚本。')
  await action(1); await wait('!document.querySelector(".knowledge-panel main textarea") && !!document.querySelector(".knowledge-panel h3")')
  await action(2); await wait('!document.querySelector(".knowledge-actions button:nth-child(2)").disabled')
  assert.ok(fs.readFileSync(exportPath,'utf8').includes('离线维护的发布步骤'),'Groups can be edited and exported without an SSH conversation')
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  fs.writeFileSync(path.join(artifacts,'knowledge-group-offline.png'),(await window.webContents.capturePage()).toPNG())
  await click('.knowledge-panel header button'); await wait('!document.querySelector(".knowledge-panel")')
  assert.equal(await run('window.__uiRegression.workspaceOpens.length'),openedBeforeGroup,'Creating a group never opens remote sessions or expands the operation scope')
  let groupEntryLayouts = 0
  for (const width of [720,1100]) {
    window.setSize(width,900); await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert.ok(await run(`(() => { const panel=document.querySelector('.workspace-browser').getBoundingClientRect(),button=document.querySelector('.workspace-knowledge-group').getBoundingClientRect();return button.left>=panel.left-1&&button.right<=panel.right+1&&button.bottom<=panel.bottom+1 })()`),'Knowledge group entry fits the server browser')
    groupEntryLayouts++
  }
    return groupEntryLayouts
  }
  async function checkSystem() {
    if (!knowledgeGroupsEnabled) {
      await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
      await wait('!!window.__knowledge')
      await click('.knowledge-trigger')
      await wait('!!document.querySelector(".knowledge-panel")')
      assert.equal(await run('document.querySelector(".knowledge-group-create")'), null, 'Knowledge group creation stays hidden')
      assert.equal(await run('document.querySelector(".knowledge-group-guide")'), null, 'Knowledge group guide stays hidden')
      return 0
    }
    stage = 'checking composite business systems'
    await run(`window.__knowledgeBackend.invoke('system-reset')`)
    await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
    await wait('!!window.__knowledge')
    await click('.knowledge-trigger'); await wait('!!document.querySelector(".knowledge-group-create:not(:disabled)")')
    await click('.knowledge-group-create'); await wait('!!document.querySelector(".knowledge-group-dialog input:not(:disabled)")')
    assert.equal(await run('document.querySelectorAll(".knowledge-group-members input:checked").length'),4)
    await edit('.knowledge-group-field input','订单业务系统')
    await click('.knowledge-group-business input')
    await edit('.knowledge-group-field textarea','四台服务器分工协作，对外提供订单服务。')
    await click('.knowledge-group-save'); await wait('!!document.querySelector(".knowledge-system-view") && !document.querySelector(".knowledge-group-dialog")')
    const group=service.groups.list()[0]
    assert.equal((await service.groupAccess(group.id).manage({action:'read',documentId:'system'})).document.system.nodes.length,0)
    await run(`(() => {const field=document.querySelector('.knowledge-toolbar .knowledge-mode-select');field.value='readwrite';field.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await wait('document.querySelector(".knowledge-toolbar .knowledge-mode-select").value==="readwrite"&&!document.querySelector(".knowledge-toolbar .knowledge-mode-select").disabled')
    await run(`window.__knowledge.mapSystem('${group.id}')`)
    await wait('!!document.querySelector(".knowledge-panel .knowledge-warning")')
    await click('.knowledge-panel header button'); await wait('!document.querySelector(".knowledge-panel")')
    await click('.tool-run-knowledge'); await wait('document.querySelectorAll(".system-graph-node").length===4')
    assert.equal(await run('document.querySelectorAll(".system-graph-node.unconfirmed").length'),1)
    assert.equal(await run('document.querySelectorAll(".system-graph-scroll svg > path[stroke-dasharray]").length'),1)
    assert.equal((await service.groupAccess(group.id).manage({action:'read',documentId:'system'})).document.author,'ai')
    let systemLayouts=0
    for(const locale of ['zh-CN','en-US']) for(const theme of ['light','dark','eyecare']) for(const width of [380,1100]) {
      window.setSize(width,900);await run(`window.__knowledge.theme('${theme}','${locale}')`)
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      assert.ok(await run(`(() => {const p=document.querySelector('.knowledge-panel'),g=document.querySelector('.system-graph-scroll'),r=p.getBoundingClientRect(),gr=g.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&p.scrollWidth<=p.clientWidth+1&&gr.right<=r.right&&g.clientWidth<=g.parentElement.clientWidth})()`),`System graph fits ${locale}/${theme}/${width}`)
      assert.ok(await run(`Array.from(document.querySelectorAll('.system-graph-node text')).every(text=>text.getBBox().x+text.getBBox().width<=170)`),'Node labels stay inside their cards')
      systemLayouts++
    }
    window.setSize(1100,900);await run('window.__knowledge.theme("light","zh-CN")')
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await window.webContents.capturePage();await new Promise(resolve=>setTimeout(resolve,100))
    fs.writeFileSync(path.join(artifacts,'knowledge-system.png'),(await window.webContents.capturePage()).toPNG())
    await action(1);await wait('document.querySelectorAll(".system-node-form").length===4')
    await click('.system-add-node');await wait('document.querySelectorAll(".system-node-form").length===5')
    assert.equal(await run('document.querySelector(".knowledge-actions button").disabled'),true,'An unnamed role cannot be saved')
    await edit('.system-node-form:nth-of-type(5) input','异步任务')
    await click('.system-add-edge');await wait('document.querySelectorAll(".system-edge-form").length===4')
    assert.equal(await run('document.querySelector(".knowledge-actions button").disabled'),true,'Duplicate dependencies cannot be saved')
    await run(`(() => {const row=document.querySelectorAll('.system-edge-form')[3],field=row.querySelectorAll('select')[1];field.value=Array.from(field.options).find(option=>option.textContent==='异步任务').value;field.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await wait('!document.querySelector(".knowledge-actions button").disabled')
    await action(1);await wait('document.querySelectorAll(".system-graph-node").length===5')
    const saved=(await service.groupAccess(group.id).manage({action:'read',documentId:'system'})).document
    assert.equal(saved.system.dependencies.length,4)
    assert.equal(saved.system.nodes[4].status,'unconfirmed')
    await run('document.querySelector(".knowledge-history").open=true')
    await click('.knowledge-history article:first-of-type button');await wait('document.querySelectorAll(".system-graph-node").length===4')
    await action(2);await wait('!document.querySelector(".knowledge-actions button:nth-child(2)").disabled')
    assert.ok(fs.readFileSync(exportPath,'utf8').includes('service-3')&&fs.readFileSync(exportPath,'utf8').includes('unconfirmed'),'System exports retain identity and verification data')
    await run('window.__knowledge.scope("fixture-a")')
    await run(`window.__knowledge.show('knowledge-group:${group.id}','system')`)
    await wait('document.querySelectorAll(".system-graph-node").length===4')
    assert.equal(await run(`Array.from(document.querySelectorAll('.system-graph-node')).filter(node=>node.textContent.includes('会话外成员')).length`),3,'Reference roles never become selected operation targets')
    await run(`window.__knowledgeBackend.invoke('system-retarget')`)
    await run('window.__knowledge.scope("fixture-b")')
    await run(`window.__knowledge.show('knowledge-group:${group.id}','system')`)
    await wait('document.querySelectorAll(".system-graph-node.stale").length===1')
    assert.ok(await run(`document.querySelector('.system-warning').textContent.includes('身份已变化')`),'Changed endpoints remain visibly stale until explicitly rebound')
    return systemLayouts
  }
  stage = 'loading Vue fixture'
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await wait('!!window.__knowledge')
  if (process.env.LITECONNECT_KNOWLEDGE_LARGE_ONLY === '1') {
    const largeMembers=await checkLargeMembers()
    console.log(JSON.stringify({passed:true,largeMembers,artifacts}))
    clearTimeout(timeout);window.destroy();database.close();app.quit();return
  }
  if (process.env.LITECONNECT_KNOWLEDGE_SYSTEM_ONLY === '1') {
    const systemLayouts=await checkSystem()
    console.log(JSON.stringify({passed:true,systemLayouts,artifacts}))
    clearTimeout(timeout);window.destroy();database.close();app.quit();return
  }
  if (process.env.LITECONNECT_KNOWLEDGE_ENTRY_ONLY === '1') {
    const groupEntryLayouts = await checkGroupEntry()
    console.log(JSON.stringify({passed:true,groupEntryLayouts,artifacts}))
    clearTimeout(timeout); window.destroy(); database.close(); app.quit(); return
  }
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
  const changeMode = mode => run(`(() => {const field=document.querySelector('.knowledge-mode-select');field.value='${mode}';field.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  const modeIs = mode => wait(`document.querySelector('.knowledge-mode-select').value==='${mode}'&&!document.querySelector('.knowledge-mode-select').disabled`)
  stage = 'checking per-server knowledge modes'
  await pointerClick('.knowledge-panel header button'); await wait('!document.querySelector(".knowledge-panel")')
  await run('window.__knowledge.scope("fixture-a")')
  await wait('!!document.querySelector(".knowledge-mode-select:not(:disabled)")')
  await changeMode('readonly'); await wait('!!document.querySelector(".app-dialog")')
  assert.ok(await run(`document.querySelector('.app-dialog').textContent.includes('不会在服务器上创建文件')`))
  await cancel(); await wait('!document.querySelector(".app-dialog")'); await modeIs('off')
  assert.equal(database.listSingletonKeys('ai-knowledge:').length,0,'Cancelling mode enablement creates no records')
  await changeMode('readwrite'); await wait('!!document.querySelector(".app-dialog")'); await confirm(); await modeIs('readwrite')
  assert.equal((await service.access('fixture-a',1).manage({action:'overview'})).targets[0].mode,'readwrite')
  await changeMode('readonly'); await modeIs('readonly')
  const readOnly = service.access('fixture-a',1)
  assert.deepEqual(await readOnly.tools(),['knowledge_search','knowledge_read'])
  assert.ok((await readOnly.prompt()).includes('"mode":"readonly"'),'Read-only mode keeps automatic knowledge context')
  assert.equal((await readOnly.call('knowledge_read',{documentId:'memory'},new AbortController().signal)).isError,false)
  assert.equal((await readOnly.call('knowledge_save',{title:'Should not save',content:'Unwanted',expectedRevision:0},new AbortController().signal)).structuredContent.code,'KNOWLEDGE_READ_ONLY')
  await pointerClick('.knowledge-trigger'); await wait('!!document.querySelector(".knowledge-panel h3")')
  assert.ok(await run(`!document.querySelector('.knowledge-actions button').disabled&&document.querySelector('.knowledge-notice').textContent`),'Users can still edit in read-only mode')
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  fs.writeFileSync(path.join(artifacts,'knowledge-readonly.png'),(await window.webContents.capturePage()).toPNG())
  if (process.env.LITECONNECT_KNOWLEDGE_MODE_ONLY === '1') {
    console.log(JSON.stringify({ passed:true, mode:'readonly', artifacts }))
    clearTimeout(timeout); window.destroy(); database.close(); app.quit(); return
  }
  await pointerClick('.knowledge-panel header button'); await wait('!document.querySelector(".knowledge-panel")')
  await changeMode('off'); await modeIs('off')
  assert.equal((await readOnly.manage({action:'list',connectionId:'a'})).documents.length,1,'Turning knowledge off retains documents')
  assert.equal(await readOnly.prompt(),'','Off contributes no automatic prompt')
  assert.equal((await readOnly.call('knowledge_read',{documentId:'memory'},new AbortController().signal)).isError,true,'Off blocks AI reads')
  await run(`window.__knowledgeBackend.invoke('fail-next-enable')`)
  await changeMode('readwrite'); await wait('!!document.querySelector(".el-message--error")'); await modeIs('off')
  assert.equal((await readOnly.manage({action:'overview'})).targets[0].mode,'off','A failed mode change does not show success')
  await changeMode('readonly'); await modeIs('readonly')
  assert.equal(await run('!!document.querySelector(".app-dialog")'),false,'Existing documents can be enabled directly')
  await changeMode('readwrite'); await modeIs('readwrite')
  await run('window.__knowledge.busy(true)')
  assert.equal(await run('document.querySelector(".knowledge-mode-select").disabled'),true,'In-flight AI context cannot be changed')
  await run('window.__knowledge.busy(false)')
  await run('window.__knowledge.scope("fixture-b")'); await wait('!!document.querySelector(".knowledge-mode-select:not(:disabled)")')
  await changeMode('readonly'); await wait('!!document.querySelector(".app-dialog")')
  await run('window.__knowledge.scope("fixture-a")'); await confirm(); await wait('!document.querySelector(".app-dialog")')
  assert.equal((await service.access('fixture-b',1).manage({action:'overview'})).targets[0].mode,'off','Stale consent cannot change another server after a scope change')
  stage = 'setting knowledge modes directly in the multi-server picker'
  await run('window.__knowledge.scope("fixture")'); await wait('!!document.querySelector(".knowledge-usage-summary")')
  assert.equal(await run('document.querySelector(".knowledge-usage-summary").textContent.trim()'),'知识 已启用 1/2 台')
  await pointerClick('.knowledge-usage-summary')
  await wait('document.querySelector(".knowledge-mode-picker")?.checkVisibility()')
  await run('new Promise(resolve=>setTimeout(resolve,250))')
  assert.equal(await run('document.querySelector(".knowledge-mode-picker").contains(document.activeElement)'), false, 'Opening with a pointer does not focus a mode selector')
  await pointerClick('.knowledge-usage-summary')
  await wait('!document.querySelector(".knowledge-mode-picker")')
  window.webContents.focus()
  await run('document.querySelector(".knowledge-usage-summary").focus()')
  await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'char', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
  await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await wait('document.activeElement === document.querySelector(".knowledge-mode-row select")')
  const pickerModes = () => run(`[...document.querySelectorAll('.knowledge-mode-row select')].map(field=>field.value)`)
  const changePickerMode = (index, mode) => run(`(() => {const field=document.querySelectorAll('.knowledge-mode-row select')[${index}];field.value='${mode}';field.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  assert.deepEqual(await pickerModes(), ['readwrite', 'off'])
  assert.ok(await run(`[...document.querySelectorAll('.knowledge-mode-row')].every(row => {
    const chevron = row.querySelector('.knowledge-mode-chevron');
    if (!chevron?.checkVisibility()) return false;
    const { x, y, width, height } = chevron.getBoundingClientRect();
    return width > 0 && height > 0 && document.elementFromPoint(x + width / 2, y + height / 2) === row.querySelector('select');
  })`), 'Every mode selector shows a chevron that lets clicks reach the native select')
  assert.equal(await run('!!document.querySelector(".knowledge-panel")'), false)
  await changePickerMode(1, 'readonly'); await wait('!!document.querySelector(".app-dialog")')
  await pointerClick('.app-dialog-actions button:first-child')
  await wait('document.querySelector(".knowledge-mode-row:last-child select")?.value === "off"')
  assert.deepEqual(await pickerModes(), ['readwrite', 'off'], 'Cancelling first-use consent keeps the picker and the two independent modes')
  await changePickerMode(0, 'off')
  await wait('document.querySelector(".knowledge-usage-summary").textContent.trim() === "知识 已启用 0/2 台"')
  assert.equal(await run('document.querySelector(".knowledge-trigger").textContent.trim()'), '1', 'Document count stays visible while all servers are off')
  await changePickerMode(0, 'readwrite')
  await wait('document.querySelector(".knowledge-usage-summary").textContent.trim() === "知识 已启用 1/2 台"')
  assert.deepEqual(await pickerModes(), ['readwrite', 'off'])
  await run('window.__knowledge.busy(true)')
  await wait(`[...document.querySelectorAll('.knowledge-mode-row select')].every(field=>field.disabled)`)
  await run('window.__knowledge.busy(false)')
  await wait('!document.querySelector(".knowledge-mode-row select").disabled')
  await run(`document.querySelector('.knowledge-mode-row select').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
  await wait('!document.querySelector(".knowledge-mode-picker") && document.activeElement?.classList.contains("knowledge-usage-summary")')
  await pointerClick('.knowledge-trigger'); await wait('!!document.querySelector(".knowledge-panel h3")')
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
  await changeMode('off'); await modeIs('off')
  await wait(`!document.querySelector('.knowledge-actions button').disabled`)
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
  await wait('document.querySelectorAll(".knowledge-toolbar > select option").length===1')
  assert.ok(await run(`document.querySelector('.knowledge-toolbar select').textContent.includes('Server B')`))
  assert.equal(await run('document.querySelectorAll(".knowledge-doc").length'),0)
  assert.equal(await run('window.__knowledgeError || null'),null)
  await run(`window.__knowledgeBackend.invoke('migrate-legacy')`)
  await click('.knowledge-toolbar button:last-child')
  await wait(`document.querySelector('.knowledge-panel main').textContent.includes('Migrated service: /srv/app')`)
  assert.equal(await run(`document.querySelector('.knowledge-mode-select').value`),'off','Migration keeps knowledge off')
  await pointerClick('.knowledge-panel header button'); await wait('!document.querySelector(".knowledge-panel")')
  await changeMode('readonly'); await modeIs('readonly')
  assert.equal(await run('!!document.querySelector(".app-dialog")'),false,'Imported documents are managed by the same external switch')
  let groupLayouts = 0
  if (knowledgeGroupsEnabled) {
  stage = 'creating and maintaining shared knowledge groups'
  await run('window.__knowledge.scope("fixture")')
  await click('.knowledge-trigger'); await wait('!!document.querySelector(".knowledge-group-create")')
  assert.ok(await run(`!!document.querySelector('.knowledge-group-guide')`),'Multi-server knowledge offers a contextual sharing guide')
  await click('.knowledge-group-guide .ui-icon-btn')
  assert.equal(await run(`localStorage.getItem('liteconnect-knowledge-group-hint')`),'dismissed')
  stage = 'opening group creation dialog'
  await click('.knowledge-group-create'); await wait('!!document.querySelector(".knowledge-group-dialog input:not(:disabled)")')
  assert.equal(await run(`document.querySelectorAll('.knowledge-group-members input:checked').length`),2)
  await edit('.knowledge-group-field input','订单服务 · 生产环境')
  await edit('.knowledge-group-field textarea','应用目录：/opt/orders\n日志目录：/var/log/orders\n发布前检查目标机器，单机例外按本机知识处理。')
  for (const locale of ['zh-CN','en-US']) for (const theme of ['light','dark','eyecare']) for (const width of [380,1100]) {
    window.setSize(width,800); await run(`window.__knowledge.theme('${theme}','${locale}')`)
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert.ok(await run(`(() => { const p=document.querySelector('.knowledge-group-dialog'),r=p.getBoundingClientRect(); return r.left>=0&&r.right<=innerWidth+1&&r.top>=36&&r.bottom<=innerHeight&&p.scrollWidth<=p.clientWidth+1 })()`),`Group creation fits ${locale}/${theme}/${width}`)
    groupLayouts++
  }
  await run('window.__knowledge.theme("light","zh-CN")'); window.setSize(1100,800)
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  fs.writeFileSync(path.join(artifacts,'knowledge-group-create.png'),(await window.webContents.capturePage()).toPNG())
  stage = 'saving a new shared group'
  await click('.knowledge-group-save'); await wait('!document.querySelector(".knowledge-group-dialog") && !!document.querySelector(".knowledge-group-scope")')
  await wait(`document.querySelector('.knowledge-panel main').textContent.includes('/opt/orders')`)
  let group = service.groups.manage({action:'overview'}).groups[0]
  assert.equal(group.members.length,2)
  const sharedPrompt = await service.access('fixture',1).prompt()
  assert.equal(sharedPrompt.split('/opt/orders').length-1,1,'Shared content is attached once for multiple members')
  assert.ok((await service.access('fixture-a',1).prompt()).includes('/opt/orders'),'A single member inherits group knowledge without enabling its own knowledge')
  assert.equal(await run(`!!document.querySelector('.knowledge-toolbar .knowledge-mode-select option[value="readwrite"]')`),true,'Group knowledge supports explicit AI updates')
  await changeMode('readwrite'); await modeIs('readwrite')
  const groupDoc=(await service.access('fixture',1).manage({action:'list',groupId:group.id})).documents[0]
  await run(`window.__knowledge.aiSaveGroup('${group.id}','${groupDoc.id}')`)
  await wait(`!!document.querySelector('.knowledge-panel .knowledge-warning')`)
  assert.equal((await service.access('fixture',1).manage({action:'read',groupId:group.id,documentId:groupDoc.id})).document.author,'ai')
  await wait('!!document.querySelector(".knowledge-panel .knowledge-mode-select:not(:disabled)")')
  await pointerClick('.knowledge-panel header button'); await wait('!document.querySelector(".knowledge-panel")')
  await click('.tool-run-knowledge'); await wait(`document.querySelector('.knowledge-toolbar > select').value==='knowledge-group:${group.id}'`)
  await wait(`document.querySelector('.knowledge-panel main').textContent.includes('共同发布约定')`)
  await wait('!!document.querySelector(".knowledge-panel .knowledge-mode-select:not(:disabled)")')
  await changeMode('readonly'); await modeIs('readonly')
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  fs.writeFileSync(path.join(artifacts,'knowledge-group.png'),(await window.webContents.capturePage()).toPNG())
  await run(`window.__knowledge.show('a','memory')`)
  await wait('!!document.querySelector(".knowledge-copy-group")')
  const original = (await service.access('fixture',1).manage({action:'read',connectionId:'a',documentId:'memory'})).document
  await click('.knowledge-copy-group'); await wait('!!document.querySelector(".app-dialog")'); await confirm()
  await wait('!!document.querySelector(".knowledge-panel textarea") && !!document.querySelector(".knowledge-group-scope")')
  assert.equal((await service.access('fixture',1).manage({action:'list',groupId:group.id})).documents.length,1,'Copying opens a reviewable draft without immediately writing shared knowledge')
  await edit('.knowledge-panel input:not([type="checkbox"])','经过检查的公共说明')
  await action(1); await wait('!document.querySelector(".knowledge-panel textarea")')
  assert.equal((await service.access('fixture',1).manage({action:'list',groupId:group.id})).documents.length,2)
  assert.deepEqual((await service.access('fixture',1).manage({action:'read',connectionId:'a',documentId:'memory'})).document,original,'Sharing retains original server knowledge')
  await wait('!!document.querySelector(".knowledge-group-manage:not(:disabled)")')
  await click('.knowledge-group-manage'); await wait('!!document.querySelector(".knowledge-group-dialog input:not(:disabled)")')
  await edit('.knowledge-group-field input','订单服务 · 公共知识')
  await click('.knowledge-group-save'); await wait('!document.querySelector(".knowledge-group-dialog")')
  group=service.groups.manage({action:'overview'}).groups[0]
  assert.equal(group.name,'订单服务 · 公共知识')
  await wait('!!document.querySelector(".knowledge-group-manage:not(:disabled)")')
  await click('.knowledge-group-manage'); await wait('!!document.querySelector(".knowledge-group-dialog input:not(:disabled)")')
  await click('.knowledge-group-dialog footer button:first-child'); await wait('!!document.querySelector(".app-dialog")'); await cancel()
  assert.equal(service.groups.manage({action:'overview'}).groups.length,1,'Cancelling group deletion retains shared knowledge')
  await click('.knowledge-group-dialog footer button:first-child'); await wait('!!document.querySelector(".app-dialog")'); await confirm()
  await wait('!document.querySelector(".knowledge-group-dialog") && !document.querySelector(".knowledge-group-scope")')
  assert.equal(service.groups.manage({action:'overview'}).groups.length,0)
  assert.deepEqual((await service.access('fixture',1).manage({action:'read',connectionId:'a',documentId:'memory'})).document,original,'Deleting a group retains member knowledge')
  }
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
    const modeControl = workspace ? '.knowledge-usage-summary' : '.knowledge-mode-field select:not(:disabled)'
    await wait(`document.querySelector('.ai-sidebar .knowledge-trigger').textContent.trim() === '${count ? count > 99 ? '99+' : count : ''}' && !!document.querySelector('.ai-sidebar ${modeControl}')`)
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert.ok(await run(`(() => {
      const trigger=document.querySelector('.ai-sidebar .knowledge-trigger'), strip=trigger.closest('.composer-context-strip');
      const button=trigger.getBoundingClientRect(), icon=trigger.querySelector('svg').getBoundingClientRect(), badge=trigger.querySelector('.knowledge-count')?.getBoundingClientRect();
      const usageControl=strip.querySelector('${modeControl}'), usage=usageControl.getBoundingClientRect();
      const docStyle=getComputedStyle(trigger), modeStyle=getComputedStyle(usageControl);
      return !strip.querySelector('.composer-context-menu, .composer-context-chips, .composer-add-image, input[type=file]') && icon.left>=button.left && icon.right<=button.right && (!badge || badge.left>=icon.right && badge.right<=button.right-1)
        && usage.left>=button.right+3 && strip.scrollWidth<=strip.clientWidth+1
        && Math.abs(usage.height-button.height)<=1 && Math.abs(usage.top-button.top)<=1
        && docStyle.borderTopWidth===modeStyle.borderTopWidth && docStyle.borderTopLeftRadius===modeStyle.borderTopLeftRadius
        && (!${count} || trigger.title.includes('${count}') && trigger.getAttribute('aria-label').includes('${count}'));
    })()`),`Knowledge controls align and share a border style: ${theme}/${workspace}/${width}/${count}`)
    triggerLayouts++
  }
  await run(`(async () => { (await import('/src/i18n/index.ts')).setAppLocale('zh-CN'); await window.__uiRegression.setTheme('light'); await window.__uiRegression.setContextLayout(false); document.querySelector('.ai-image-composer-fixture').style.width='380px'; window.__knowledgeTriggerSingle=true; window.__knowledgeTriggerCount=2; await window.__uiRegression.switchImageSession('knowledge-trigger-preview'); })()`)
  await wait(`document.querySelector('.ai-sidebar .knowledge-trigger').textContent.trim()==='2'`)
  await run(`document.querySelector('.ai-image-composer-fixture').scrollIntoView()`)
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const composerBounds=await run(`(() => {const r=document.querySelector('.ai-sidebar .composer').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`)
  fs.writeFileSync(path.join(artifacts,'knowledge-trigger.png'),(await window.webContents.capturePage(composerBounds)).toPNG())
  await pointerClick('.ai-sidebar .knowledge-trigger'); await wait('!!document.querySelector(".knowledge-panel")')
  await wait('!!document.querySelector(".knowledge-panel .knowledge-mode-select:not(:disabled)")')
  await pointerClick('.knowledge-panel header button'); await wait('!document.querySelector(".knowledge-panel")')
  await wait('document.activeElement?.classList.contains("knowledge-trigger")')
  stage = 'previewing the mode picker in the LiteAI composer'
  await run(`(async () => {
    window.__knowledgeTriggerSingle=false;
    await window.__uiRegression.setContextLayout(true);
    await window.__uiRegression.switchImageSession('knowledge-mode-picker-preview');
  })()`)
  await wait('!!document.querySelector(".ai-sidebar .knowledge-usage-summary")')
  await pointerClick('.ai-sidebar .knowledge-usage-summary')
  await wait('document.querySelector(".knowledge-mode-picker")?.checkVisibility()')
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await new Promise(resolve => setTimeout(resolve, 200))
  const pickerBounds = await run(`(() => {
    const composer = document.querySelector('.ai-sidebar .composer').getBoundingClientRect();
    const popover = document.querySelector('.knowledge-mode-popover').getBoundingClientRect();
    const x = Math.max(0, Math.floor(Math.min(composer.left, popover.left) - 12));
    const y = Math.max(0, Math.floor(Math.min(composer.top, popover.top) - 12));
    return { x, y, width: Math.min(innerWidth, Math.ceil(Math.max(composer.right, popover.right) + 12)) - x,
      height: Math.min(innerHeight, Math.ceil(Math.max(composer.bottom, popover.bottom) + 12)) - y };
  })()`)
  fs.writeFileSync(path.join(artifacts, 'knowledge-mode-picker.png'), (await window.webContents.capturePage(pickerBounds)).toPNG())
  await pointerClick('.knowledge-mode-heading button'); await wait('!document.querySelector(".knowledge-mode-picker")')
  if (knowledgeGroupsEnabled) {
  stage = 'checking saved group document navigation in the real sidebar'
  const locatorGroup=service.groups.manage({action:'create',name:'Shared locator group',connectionIds:['a','b'],initialContent:'AI_GROUP_LINK: /opt/shared'}).group
  const locatorDoc=(await service.access('fixture',1).manage({action:'list',groupId:locatorGroup.id})).documents[0]
  await run(`(async()=>{const {useAiChat}=await import('/src/composables/ai/useAiChat.ts');useAiChat().getSessionState('knowledge-trigger-preview').messages.push({id:'group-result-link',role:'assistant',content:'',createdAt:Date.now(),status:'completed',toolRuns:[{id:'group-result',name:'knowledge_save',args:'{}',status:'done',isError:false,content:JSON.stringify({groupId:'${locatorGroup.id}',documentId:'${locatorDoc.id}',saved:true})}]})})()`)
  await wait('!!document.querySelector(".ai-sidebar .tool-run-knowledge")')
  await click('.ai-sidebar .tool-run-knowledge')
  await wait(`document.querySelector('.knowledge-toolbar > select')?.value==='knowledge-group:${locatorGroup.id}'`)
  await wait(`document.querySelector('.knowledge-panel main').textContent.includes('AI_GROUP_LINK')`)
  await wait('!!document.querySelector(".knowledge-panel .knowledge-mode-select:not(:disabled)")')
  await click('.knowledge-panel header button'); await wait('!document.querySelector(".knowledge-panel")')
  service.groups.manage({action:'delete',groupId:locatorGroup.id,expectedRevision:1})
  }
  const groupEntryLayouts = await checkGroupEntry()
  const systemLayouts = await checkSystem()
  const largeMembers = await checkLargeMembers()
  console.log(JSON.stringify({passed:true,largeMembers,systemLayouts,layouts,groupLayouts,closeCases,triggerLayouts,groupEntryLayouts,flows:['pointer close/titlebar safety/zoom','unsaved close cancel/confirm','three modes, consent/cancel and read-only enforcement','local SQLite storage','standalone memory without sources','per-record include choice without duplication','Markdown editing/import/export','optional source navigation/rename/deletion','revision conflict preserves draft','restore','server isolation','AI view locator','scope change','knowledge group creation/copy/rename/delete and deduplication','server-list group entry without connecting','actual sidebar/workspace knowledge icon counts and click/focus'],artifacts}))
  clearTimeout(timeout); window.destroy(); database.close(); app.quit()
}).catch(error=>{console.error(error,{stage,artifacts}); if(window) console.error('Renderer failure captured at stage',stage);clearTimeout(timeout);if(window)window.destroy();database?.close();app.exit(1)})
