const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const artifacts = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'liteconnect-dock-ui-'))
app.setPath('userData', path.join(artifacts, 'profile'))
let database, window, stage = 'starting', failSave = false, saveCount = 0
const aiTerminal = new URL(process.env.LITECONNECT_UI_TEST_URL).searchParams.has('aiTerminal')
const timeout = setTimeout(() => { console.error('Dock UI timed out', { stage, artifacts }); app.exit(1) }, 360000)
app.whenReady().then(async () => {
  const bundle = path.join(artifacts, 'runtime.mjs')
  await require('esbuild').build({ stdin: { contents: `
    export { initializeAppDatabase, closeAppDatabase } from './electron/store/appDatabase'
    export { SettingsStore } from './electron/store/settingsStore'
    export { createAiKnowledgeService } from './electron/application/aiKnowledge'
    export { registerAiHandlers } from './electron/ipc/registerAiHandlers'
  `, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle })
  const runtime = await import(pathToFileURL(bundle))
  const preload = path.join(artifacts, 'preload.cjs')
  fs.writeFileSync(preload, `
    const { contextBridge, ipcRenderer } = require('electron')
    contextBridge.exposeInMainWorld('__dockBackend', {
      invoke: (op, value) => ipcRenderer.invoke('dock-settings', op, value),
      knowledge: (id, input) => ipcRenderer.invoke('ai:knowledge', id, input),
      settings: fn => {
        const listener = (_event, value) => fn(value)
        ipcRenderer.on('settings:changed', listener)
        return () => ipcRenderer.removeListener('settings:changed', listener)
      },
    })
  `)
  const store = new runtime.SettingsStore()
  database = await runtime.initializeAppDatabase(path.join(artifacts, 'profile'))
  await store.init()
  if (aiTerminal) {
    const profile = { id: 'production', name: 'Production', host: 'production.test', port: 22, username: 'ops' }
    const knowledge = runtime.createAiKnowledgeService({
      getSessionSnapshot: id => id === 'ai-production' ? { connectionId: profile.id } : undefined,
    }, {
      getConnections: () => [profile],
      getConnection: id => id === profile.id ? profile : undefined,
    })
    runtime.registerAiHandlers(store, { knowledgeAccess: (id, owner) => knowledge.access(id, owner) },
      id => id === 'ai-production' ? 'host-v1:22:production.test' : undefined)
  }
  ipcMain.handle('dock-settings', async (_event, op, value) => {
    if (op === 'get') return store.getAll()
    if (op === 'set') {
      if (failSave) { failSave = false; throw new Error('fixture disk unavailable') }
      assert.deepEqual(Object.keys(value), ['sshWorkspaceLayout'])
      saveCount++
      return store.applyMany(value)
    }
    if (op === 'fail') { failSave = true; return true }
    if (op === 'count') return saveCount
    if (op === 'external') {
      const saved = await store.applyMany({ sshWorkspaceLayout: value })
      window.webContents.send('settings:changed', { settings: saved, changed: ['sshWorkspaceLayout'] })
      return saved
    }
    throw new Error('Unknown fixture operation')
  })
  window = new BrowserWindow({ show: false, frame: false, width: 1200, height: 900, webPreferences: { preload, contextIsolation: true, backgroundThrottling: false, offscreen: aiTerminal } })
  window.webContents.debugger.attach('1.3')
  const run = async source => {
    let raw
    try { raw = await window.webContents.executeJavaScript(`(async()=>{try{return JSON.stringify({ok:true,value:await (${source})})}catch(error){return JSON.stringify({ok:false,error:error.stack||String(error)})}})()`) }
    catch (error) { throw new Error(`${error.message}\nExpression: ${source.slice(0,400)}`) }
    const result = JSON.parse(raw)
    if (!result.ok) throw new Error(`${result.error}\nExpression: ${source.slice(0,400)}`)
    return result.value
  }
  const tick = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const wait = async expression => {
    const deadline = Date.now() + 20000
    while (!await run(expression)) {
      if (Date.now() > deadline) throw new Error(`Timeout ${expression}: ${await run('JSON.stringify({error:window.__dockError,unknown:window.__dock?.calls.unknown,body:document.body.innerText.slice(0,2500)})')}`)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  const click = async (selector, button = 'left') => {
    const point = await run(`(() => {const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button, clickCount: 1 })
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button, clickCount: 1 })
    await tick()
  }
  const tool = id => `.workspace-tool-rail [data-tool-id="${id}"]`
  const move = async (id, edge) => {
    await click(tool(id), 'right'); await wait('!!document.querySelector(".workspace-layout-menu")')
    await click(`[data-move-edge="${edge}"]`)
    await wait(`window.__dock.snapshot().layout.tools.find(tool=>tool.id===${JSON.stringify(id)}).edge===${JSON.stringify(edge)} && !window.__dock.snapshot().saving`)
  }
  const screenshot = async name => {
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8 })
    await run('new Promise(resolve=>setTimeout(resolve,200))'); await tick()
    fs.writeFileSync(path.join(artifacts, name), (await window.webContents.capturePage()).toPNG())
  }
  stage = 'loading real SSH workspace'
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  if (aiTerminal) {
    const composer = '.lite-ai-chat .composer-input'
    const draftInput = '.ai-draft-input'
    const draftTerminalButton = '.ai-draft .ai-open-terminal'
    const terminalButton = '.ai-open-terminal[aria-label="显示终端"]'
    const aiTab = '.ai-workspace-tab'
    const selectAiTab = `${aiTab} .ai-workspace-tab-select`
    const productionTab = '.tab[data-host-drop-id="production"]'
    const dockHost = '.ssh-linked-ai-host'
    const terminal = '.terminal-host .xterm-screen'
    const domClick = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
    const assertProductionLabel = async selector => {
      const label = await run(`(() => {
        const host = document.querySelector(${JSON.stringify(selector)})
        return { text: host.textContent.trim(), title: host.title }
      })()`)
      assert.deepEqual(label, { text: 'Production', title: 'Production (ops@production.test:22)' })
    }
    const fill = (selector, value) => run(`(() => {const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    const openTerminalMenu = () => run(`document.querySelector('.terminal-wrapper').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:500,clientY:120}))`)
    const clickMenuItem = label => run(`[...document.querySelectorAll('.ui-menu-item')].find(item=>item.textContent.trim()===${JSON.stringify(label)}).click()`)
    const useTerminalSelection = async (action = '放入 AI 输入框') => {
      await openTerminalMenu()
      await clickMenuItem('全选')
      await openTerminalMenu()
      await clickMenuItem(action)
    }
    stage = 'clearing selected servers from the connection manager'
    await wait('document.querySelector(\'.smart-item[data-view="all"]\')?.checkVisibility()')
    await domClick('.smart-item[data-view="all"]')
    const productionRow = '.connection-row:has(.conn-name-text[title="Production"])'
    const fleetRow = '.connection-row:has(.conn-name-text[title="Fleet 02"])'
    await wait(`document.querySelector('${productionRow}') && document.querySelector('${fleetRow}')`)
    await domClick(`${productionRow} .select-check`)
    await domClick(`${fleetRow} .select-check`)
    await wait('document.querySelectorAll(".selection-chip").length === 2')
    await domClick('.group-block[data-group-id="fleet"] > .group-item')
    await wait(`!document.querySelector('${productionRow}') && document.querySelector('${fleetRow}')?.classList.contains('selected')`)
    assert.equal(await run('document.querySelector(".clear-connection-selection")?.textContent.trim()'), '清空选择')
    await domClick('.clear-connection-selection')
    await wait('!document.querySelector(".selection-action-bar, .connection-row.selected")')
    await domClick('.smart-item[data-view="all"]')
    await wait(`document.querySelector('${productionRow}')`)
    assert.equal(await run('document.querySelectorAll(".select-check[aria-checked=true]").length'), 0)

    stage = 'connecting a terminal from an unsent AI draft'
    const productionAi = `${productionRow} .action-btn.ai`
    await wait(`document.querySelector(${JSON.stringify(productionAi)})?.checkVisibility()`)
    await domClick(productionAi)
    await wait(`document.querySelector('${draftInput}')?.checkVisibility()`)
    await assertProductionLabel('.ai-draft-header .workspace-target-host')
    await fill(draftInput, '帮我看一下最近的终端输出')
    await run(`window.__savedDraftInput=document.querySelector('${draftInput}')`)
    stage = 'switching between the connection list and a standalone AI tab'
    await wait(`document.querySelector('${aiTab}[data-active-tab="true"]')?.checkVisibility()`)
    await domClick('.ai-back-to-connections')
    await wait(`document.querySelector('.home-btn[aria-pressed="true"]')?.checkVisibility() && document.querySelector('${aiTab}[data-active-tab="false"]')?.checkVisibility() && document.querySelector('${productionRow}')?.checkVisibility()`)
    await domClick(selectAiTab)
    await wait(`document.querySelector('${aiTab}[data-active-tab="true"]')?.checkVisibility() && window.__savedDraftInput.checkVisibility()`)
    assert.ok(await run(`document.querySelector('${draftInput}') === window.__savedDraftInput && window.__savedDraftInput.value === '帮我看一下最近的终端输出'`))

    stage = 'connecting a terminal from an unsent AI draft'
    assert.equal(await run(`document.querySelector('${draftTerminalButton}').textContent.trim()`), '连接终端')
    await domClick(draftTerminalButton)
    await wait('document.querySelector(".host-key-dialog button.ui-btn-primary")?.checkVisibility()')
    await domClick('.host-key-dialog button.ui-btn-primary')
    const x11Notice = '[...document.querySelectorAll(".el-message")].some(message => message.checkVisibility() && message.textContent.includes("首次启动可能需要几秒") && message.textContent.includes("后续连接可复用"))'
    await wait(x11Notice)
    await run('window.__dock.finishX11Preparation()')
    await wait(`document.querySelector('${dockHost} ${draftInput}')?.checkVisibility() && document.querySelector('${terminal}')?.checkVisibility()`)
    assert.equal(await run(`document.querySelector('${dockHost} .ai-draft-state').textContent.trim()`), '终端已连接 · 发送后连接 AI')
    await wait(`!(${x11Notice})`)
    assert.equal(await run(`document.querySelector('${dockHost} ${draftInput}')===window.__savedDraftInput`), true)
    assert.equal(await run('window.__savedDraftInput.value'), '帮我看一下最近的终端输出')
    assert.equal(await run('document.getElementById("dock-content-files")?.checkVisibility()'), false)
    assert.deepEqual(await run('window.__dock.calls.aiWorkspaceConnects'), [])
    assert.deepEqual(await run('window.__dock.calls.terminalConnects'), ['production'])
    await run(`window.__savedTerminal=document.querySelector('${terminal}')`)
    assert.equal(await run(`!!document.querySelector('${aiTab}')`), false, 'A docked AI view has no duplicate top tab')
    await domClick('.home-btn')
    await wait(`document.querySelector('${productionRow}')?.checkVisibility() && !window.__savedDraftInput.checkVisibility()`)
    assert.equal(await run(`!!document.querySelector('${aiTab}')`), false)
    await domClick(productionTab)
    await wait(`document.querySelector('${dockHost} ${draftInput}') === window.__savedDraftInput && window.__savedDraftInput.checkVisibility()`)

    stage = 'changing knowledge mode before an AI SSH connection exists'
    const draftKnowledgeMode = `${dockHost} .ai-draft .knowledge-mode-select`
    const setDraftKnowledgeMode = value => run(`(() => {
      const field = document.querySelector('${draftKnowledgeMode}')
      field.value = ${JSON.stringify(value)}
      field.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await wait(`document.querySelector('${draftKnowledgeMode}:enabled')?.value === 'off'`)
    assert.equal(await run(`document.querySelector('${dockHost} .knowledge-count')`), null)
    await setDraftKnowledgeMode('readonly')
    await wait('document.querySelector(".app-dialog-title")?.textContent.includes("启用本地服务器知识")')
    assert.ok(await run('document.querySelector(".app-dialog-message").textContent.includes("AI 服务") && !document.querySelector(".app-dialog-detail")'))
    await domClick('.app-dialog-actions .ui-btn-primary')
    await wait(`document.querySelector('${draftKnowledgeMode}:enabled')?.value === 'readonly'`)
    await domClick(`${dockHost} .knowledge-trigger`)
    await wait('document.querySelector(".knowledge-panel .knowledge-actions button:nth-of-type(2):enabled")?.checkVisibility()')
    assert.equal(await run('document.querySelector(".knowledge-panel .knowledge-local").textContent'), '文档保存在本机')
    assert.ok(await run('!document.querySelector(".knowledge-panel").textContent.includes(".sqlite") && [...document.querySelectorAll(".knowledge-actions button")].some(button => button.textContent.trim() === "导出 Markdown" && !button.disabled)'))
    await domClick('.knowledge-panel header button')
    await wait('!document.querySelector(".knowledge-panel")')
    await setDraftKnowledgeMode('off')
    await wait(`document.querySelector('${draftKnowledgeMode}:enabled')?.value === 'off'`)
    assert.deepEqual(await run('window.__dock.calls.aiWorkspaceConnects'), [])

    stage = 'returning to the draft and reusing its terminal before the first message'
    await domClick(`${dockHost} ${draftTerminalButton}`)
    await wait(`document.querySelector('.connections-ai-workspace ${draftInput}')===window.__savedDraftInput && !window.__savedTerminal.checkVisibility()`)
    await wait(`document.querySelector('${aiTab}[data-active-tab="true"]')?.checkVisibility()`)
    await domClick(productionTab)
    await wait(`window.__savedTerminal.checkVisibility() && !window.__savedDraftInput.checkVisibility() && document.querySelector('${aiTab}[data-active-tab="false"]')?.checkVisibility()`)
    assert.equal(await run('document.querySelector("#dock-content-ai")?.checkVisibility()'), false, 'Moving the AI view out does not open a blank SSH AI pane')
    await domClick(selectAiTab)
    await wait(`document.querySelector('.connections-ai-workspace ${draftInput}')===window.__savedDraftInput && window.__savedDraftInput.checkVisibility()`)
    await domClick(draftTerminalButton)
    await wait(`document.querySelector('${dockHost} ${draftInput}')===window.__savedDraftInput && window.__savedTerminal.checkVisibility()`)
    await wait(`document.querySelector('${terminal} .xterm-rows')?.textContent.includes('Workspace layout preview')`)
    await useTerminalSelection()
    await wait(`window.__savedDraftInput.value.startsWith(${JSON.stringify('帮我看一下最近的终端输出\n')}) && window.__savedDraftInput.value.includes('Workspace layout preview')`)

    stage = 'sending terminal output while preserving the unsent draft'
    const unsentText = '这段说明我还没写完'
    await fill(`${dockHost} ${draftInput}`, unsentText)
    await run(`import('/src/utils/sftp/sftpListedCwd.ts').then(({ setSftpListedCwd }) => setSftpListedCwd('terminal-production-1', '/home/ops/working'))`)
    await useTerminalSelection('发送给 AI')
    await wait(`document.querySelector('${dockHost} ${composer}')?.checkVisibility() && window.__dock.hasAiReply() && window.__savedTerminal.checkVisibility()`)
    assert.equal(await run(`document.querySelector('${dockHost} ${composer}').value`), unsentText)
    assert.ok(await run(`document.querySelector('${dockHost} .chat-list').textContent.includes('Workspace layout preview') && !document.querySelector('${dockHost} .chat-list').textContent.includes('${unsentText}')`))
    assert.equal(await run('window.__dock.calls.aiCwds.at(-1)'), '/home/ops/working')
    await assertProductionLabel(`${dockHost} .workspace-chat .workspace-target-host`)
    await wait(`document.querySelector('${dockHost} .ai-sidebar .knowledge-mode-select')?.value === 'off' && document.querySelector('${dockHost} .knowledge-count')?.textContent === '1'`)
    assert.deepEqual(await run('window.__dock.calls.aiWorkspaceConnects'), ['production'])
    await run(`window.__savedChatInput=document.querySelector('${composer}')`)
    await domClick(`${dockHost} .ai-open-terminal`)
    await wait(`document.querySelector('.connections-ai-workspace ${composer}')===window.__savedChatInput && !window.__savedTerminal.checkVisibility()`)
    await domClick(terminalButton)
    await wait(`document.querySelector('${dockHost} ${composer}')===window.__savedChatInput && window.__savedTerminal.checkVisibility()`)
    const terminalCommand = 'printf "%s" "Fixture"'
    const codeReply = ['Done', '', '```bash', terminalCommand, '```'].join('\n')
    await run(`window.__dock.finishAiReply(${JSON.stringify(codeReply)})`)
    await wait(`document.querySelector('${dockHost}')?.textContent.includes('Done')`)

    stage = 'routing AI code actions to the visible terminal'
    const fillCode = `${dockHost} .code-action-btn[title="填入终端（不执行）"]`
    const runCode = `${dockHost} .code-action-btn[title="发送到终端并执行"]`
    const dialogConfirm = '.app-dialog-actions button:last-child'
    const commandWrites = () => run(`window.__dock.calls.writes.filter(([, text]) => text.startsWith(${JSON.stringify(terminalCommand)}))`)
    await wait(`document.querySelector('${fillCode}')?.checkVisibility()`)
    await domClick(fillCode)
    await wait(`document.querySelector('${dialogConfirm}')?.checkVisibility()`)
    assert.deepEqual(await commandWrites(), [])
    await domClick(dialogConfirm)
    assert.deepEqual(await commandWrites(), [['terminal-production-1', terminalCommand]])
    await domClick(runCode)
    await wait(`document.querySelector('${dialogConfirm}')?.checkVisibility()`)
    await domClick(dialogConfirm)
    assert.deepEqual(await commandWrites(), [['terminal-production-1', terminalCommand], ['terminal-production-1', terminalCommand + '\n']])
    await domClick(fillCode)
    await wait(`document.querySelector('${dialogConfirm}')?.checkVisibility()`)
    await domClick(`${dockHost} .ai-open-terminal`)
    await wait(`!window.__savedTerminal.checkVisibility() && document.querySelector('.connections-ai-workspace ${composer}')===window.__savedChatInput`)
    await domClick(dialogConfirm)
    assert.equal((await commandWrites()).length, 2, 'Changing the terminal view invalidates an open confirmation')
    assert.equal(await run('document.querySelector(".connections-ai-workspace .code-action-btn[title=\\"填入终端（不执行）\\"]")'), null)
    await domClick(terminalButton)
    await wait(`document.querySelector('${dockHost} ${composer}')===window.__savedChatInput && window.__savedTerminal.checkVisibility()`)
    await openTerminalMenu()
    await clickMenuItem('开启只读模式')
    await wait(`document.querySelector('.read-only-badge')?.checkVisibility() && !document.querySelector('${fillCode}') && !document.querySelector('${runCode}')`)
    await openTerminalMenu()
    await clickMenuItem('关闭只读模式')
    await wait(`document.querySelector('${fillCode}')?.checkVisibility()`)
    await fill(`${dockHost} ${composer}`, '这是刚才的终端输出：')

    stage = 'inserting a terminal selection into the docked draft'
    await useTerminalSelection()
    try {
      await wait(`window.__savedChatInput.value.startsWith(${JSON.stringify('这是刚才的终端输出：\n')}) && window.__savedChatInput.value.includes('Workspace layout preview')`)
    } catch (error) {
      throw new Error(`Unexpected linked draft: ${await run('JSON.stringify(window.__savedChatInput.value)')}`, { cause: error })
    }
    stage = 'checking toolbar icon colors across themes'
    const icons = [
      `${dockHost} .ai-open-terminal svg`, `${dockHost} .ai-execution-history-trigger svg`,
      `${tool('files')} svg`, '.titlebar-icon-btn:not(.active) svg', '.app-module-button[data-module="database"] svg',
    ]
    for (const [theme, color] of [['light', 'rgb(99, 99, 94)'], ['eyecare', 'rgb(138, 127, 112)'], ['dark', 'rgb(210, 207, 198)']]) {
      await run(`window.__dock.theme('${theme}', 'zh-CN')`)
      await wait(`${JSON.stringify(icons)}.every(selector => getComputedStyle(document.querySelector(selector)).stroke === '${color}')`)
    }
    await click(terminal)
    window.webContents.invalidate()
    await screenshot('ai-terminal-alongside.png')

    stage = 'restoring the same conversation and terminal in a narrow window'
    await domClick(`${dockHost} .ai-open-terminal`)
    await wait(`document.querySelector('.connections-ai-workspace ${composer}')===window.__savedChatInput && !window.__savedTerminal.checkVisibility()`)
    window.setContentSize(820, 700)
    await wait('innerWidth < 900')
    await domClick(terminalButton)
    await wait(`document.querySelector('${dockHost} ${composer}')===window.__savedChatInput && window.__savedTerminal.checkVisibility()`)
    assert.ok(await run(`(() => {const term=document.querySelector('.workspace-dock-center').getBoundingClientRect(),ai=document.querySelector('${dockHost}').getBoundingClientRect();return ai.width>=240 && term.width>=240 && (ai.right<=term.left+1 || term.right<=ai.left+1)})()`))
    assert.ok(await run(`(() => {const button=document.querySelector('${dockHost} .ai-open-terminal');return button?.getAttribute('aria-label')==='只显示 AI' && button.title==='只显示 AI' && button.querySelector('svg')?.checkVisibility() && !button.textContent.trim()})()`))
    assert.equal(await run('window.__dock.calls.terminalConnects.length'), 1)
    assert.equal(await run('window.__dock.calls.dataSubscriptions'), 1)
    stage = 'continuing a recent AI conversation from a standalone draft'
    window.setContentSize(1200, 900)
    await wait('innerWidth >= 900')
    await domClick(`${dockHost} .ai-open-terminal`)
    await wait('document.querySelector(".ai-rail-new")?.checkVisibility()')
    await domClick('.ai-rail-new')
    const picker = '.host-picker.is-card-picker'
    const stagingCard = `${picker} .host-picker-item:has(strong[title="Staging"])`
    const productionCard = `${picker} .host-picker-item:has(strong[title="Production"])`
    await wait(`document.querySelector('${productionCard}')?.getAttribute('aria-pressed') === 'true' && document.querySelector('${stagingCard}')?.checkVisibility()`)
    await domClick(productionCard)
    await domClick(stagingCard)
    await domClick(`${picker} footer .ui-btn-primary`)
    const recentThread = '.ai-recent-conversation[title="First staging conversation"]'
    const draftRecent = `.ai-draft ${recentThread}`
    await wait(`document.querySelector('${draftRecent}')?.checkVisibility()`)
    assert.equal(await run('document.querySelector(".ai-draft .ai-recent-conversations h4").textContent.trim()'), '继续最近的对话')
    await domClick(draftRecent)
    const activeTitle = '.connections-ai-workspace .ai-title'
    await wait(`document.querySelector('${activeTitle}')?.textContent.includes('First staging conversation') && document.querySelector(${JSON.stringify(terminalButton)})?.matches(':enabled')`)

    stage = 'switching historical conversations on the same host while the terminal is connecting'
    const historyAction = '.ai-conversation-menu [data-action="history"]'
    const secondHistory = '.ai-history-item-main[title^="Second staging conversation"]'
    await domClick(terminalButton)
    await wait('window.__dock.calls.terminalConnects.at(-1) === "staging"')
    await domClick('.ai-conversation-menu-trigger')
    await domClick(historyAction)
    await wait(`document.querySelector('${secondHistory}')?.matches(':enabled')`)
    await domClick(secondHistory)
    await wait('window.__dock.stagingThreadSwitchPending()')
    await run('window.__dock.finishStagingConnect()')
    await wait('document.querySelector(\'.tab[data-host-drop-id="staging"][data-active-tab="false"]\')?.checkVisibility()')
    await run('window.__dock.finishStagingThreadSwitch()')
    await wait(`document.querySelector('${activeTitle}')?.textContent.includes('Second staging conversation') && document.querySelector(${JSON.stringify(terminalButton)})?.matches(':enabled')`)
    assert.ok(await run(`document.querySelector('${activeTitle}')?.checkVisibility() && document.querySelector('${activeTitle}')?.textContent.includes('Second staging conversation')`))
    assert.equal(await run(`document.querySelector('${dockHost}')?.checkVisibility()`), false)
    await domClick(terminalButton)
    await wait(`document.querySelector('${dockHost} .ai-title')?.textContent.includes('Second staging conversation') && document.querySelector('${dockHost} ${composer}')?.checkVisibility()`)
    assert.deepEqual(await run('window.__dock.calls.terminalConnects'), ['production', 'staging'])

    stage = 'resuming recent history from a draft without hiding its terminal'
    const stagingTab = '.tab[data-host-drop-id="staging"]'
    const visibleStagingTerminal = `[...document.querySelectorAll('${terminal}')].find(screen => screen.checkVisibility())`
    await run(`window.__sshRecentTerminal = ${visibleStagingTerminal}`)
    await domClick(`${dockHost} .ai-open-terminal`)
    const stagingChat = '.ai-rail-row[data-session-id="ai-staging"]'
    await wait(`document.querySelector('${stagingChat} .ai-rail-close')?.checkVisibility()`)
    await domClick(`${stagingChat} .ai-rail-close`)
    await wait(`!document.querySelector('${stagingChat}')`)
    await domClick('.ai-rail-new')
    await wait(`document.querySelector('${stagingCard}')?.checkVisibility()`)
    if (await run(`document.querySelector('${stagingCard}').getAttribute('aria-pressed') !== 'true'`)) await domClick(stagingCard)
    await domClick(`${picker} footer .ui-btn-primary`)
    await wait(`document.querySelector('${draftRecent}')?.checkVisibility()`)
    await fill(draftInput, '保留这条草稿')
    await domClick(draftTerminalButton)
    await wait(`document.querySelector('${dockHost} ${draftRecent}')?.checkVisibility() && window.__sshRecentTerminal.checkVisibility()`)
    await domClick(`${dockHost} ${draftRecent}`)
    await wait(`document.querySelector('${dockHost} .ai-title')?.textContent.includes('First staging conversation') && window.__sshRecentTerminal.checkVisibility()`)
    assert.ok(await run(`window.__sshRecentTerminal === ${visibleStagingTerminal}`))
    assert.deepEqual(await run('window.__dock.calls.terminalConnects'), ['production', 'staging'])

    stage = 'selecting a new AI conversation from responsive server cards'
    await domClick(`${dockHost} .ai-open-terminal`)
    await wait('document.querySelector(".ai-rail-new")?.checkVisibility()')
    await domClick('.ai-rail-draft')
    await wait(`document.querySelector('${draftInput}')?.value === '保留这条草稿'`)
    await domClick('.ai-rail-new')
    const search = `${picker} .host-picker-search`
    const fleetGroup = `${picker} .host-picker-group:has(strong[title="Fleet"])`
    const fleetHeading = `${fleetGroup} .host-picker-group-heading`
    const fleetCard = `${fleetGroup} .host-picker-item:has(strong[title="Fleet 02"])`
    const fleetCards = `${fleetGroup} .host-picker-item`
    const selectedChips = `${picker} .host-picker-selected-host`
    const selectedNames = () => run(`[...document.querySelectorAll('${selectedChips}')].map(chip => chip.textContent.trim())`)
    await wait(`document.querySelector('${search}') === document.activeElement && document.querySelectorAll('${fleetCards}').length === 12`)
    const widePicker = await run(`(() => {
      const dialog = document.querySelector('${picker}')
      const listBottom = dialog.querySelector('.host-picker-list').getBoundingClientRect().bottom
      const cards = [...document.querySelectorAll('${fleetCards}')].map(card => card.getBoundingClientRect())
      return {
        width: dialog.clientWidth,
        columns: cards.filter(card => card.top === cards[0].top).length,
        cardsInView: cards.filter(card => card.bottom <= listBottom + 1).length,
      }
    })()`)
    assert.ok(widePicker.width >= 880 && widePicker.columns >= 3 && widePicker.cardsInView === 12, JSON.stringify(widePicker))
    await domClick(fleetCard)
    await wait(`document.querySelector('${fleetCard}')?.getAttribute('aria-pressed') === 'true'`)
    assert.deepEqual(await selectedNames(), ['Staging', 'Fleet 02'])
    await screenshot('ai-new-conversation-cards.png')
    await domClick(`${fleetCards}:has(strong[title="Fleet 03"])`)
    await domClick(fleetHeading)
    await wait(`!document.querySelector('${fleetCard}')?.checkVisibility()`)
    await fill(search, 'fleet-02.test')
    await wait(`document.querySelector('${fleetCard}')?.checkVisibility() && document.querySelectorAll('${picker} .host-picker-item').length === 1`)
    assert.equal(await run(`document.querySelector('${fleetCard}').getAttribute('aria-pressed')`), 'true')
    assert.deepEqual(await selectedNames(), ['Staging', 'Fleet 02', 'Fleet 03'])
    await run(`(() => { const chip = document.querySelector('${selectedChips}[aria-label="取消选择 Staging"]'); chip.focus(); chip.click() })()`)
    await wait(`document.querySelector('${search}') === document.activeElement && document.querySelectorAll('${selectedChips}').length === 2`)
    assert.deepEqual(await selectedNames(), ['Fleet 02', 'Fleet 03'])
    assert.equal(await run(`document.querySelector('${search}').value`), 'fleet-02.test')
    const clearPicker = `${picker} .host-picker-clear-selection`
    assert.equal(await run(`document.querySelector('${clearPicker}')?.textContent.trim()`), '清空选择')
    await domClick(clearPicker)
    await wait(`document.querySelector('${picker} .host-picker-footer [aria-live]')?.textContent.includes('已选 0 台') && document.querySelector('${picker} footer .ui-btn-primary')?.disabled`)
    assert.equal(await run(`document.querySelector('${search}').value`), 'fleet-02.test')
    assert.equal(await run(`document.querySelector('${fleetCard}').getAttribute('aria-pressed')`), 'false')
    assert.deepEqual(await selectedNames(), [])
    await domClick(fleetCard)
    await fill(search, '')
    await wait(`document.querySelector('${fleetHeading}')?.matches(':enabled')`)
    assert.equal(await run(`document.querySelector('${stagingCard}').getAttribute('aria-pressed')`), 'false')
    assert.equal(await run(`document.querySelector('${fleetCards}:has(strong[title="Fleet 03"])').getAttribute('aria-pressed')`), 'false')
    await domClick(stagingCard)
    await domClick(fleetHeading)
    window.setContentSize(500, 490)
    await wait('innerWidth <= 520 && innerHeight <= 510')
    await wait(`(() => {
      const dialog = document.querySelector('${picker}')
      const list = dialog.querySelector('.host-picker-list')
      const grid = dialog.querySelector('.host-picker-group-items')
      const box = dialog.getBoundingClientRect()
      const footer = dialog.querySelector('footer').getBoundingClientRect()
      return getComputedStyle(grid).gridTemplateColumns.split(' ').length === 1
        && list.scrollHeight > list.clientHeight && list.scrollWidth <= list.clientWidth + 1
        && box.left >= 0 && box.right <= innerWidth && footer.bottom <= innerHeight
    })()`)
    assert.deepEqual(await selectedNames(), ['Fleet 02', 'Staging'])
    await domClick(`${picker} footer .ui-btn-primary`)
    await wait(`!document.querySelector('${picker}') && document.querySelectorAll('.ai-draft .ai-draft-host-chip').length === 2`)
    assert.deepEqual(await run('[...document.querySelectorAll(".ai-draft .ai-draft-host-chip")].map(host => host.textContent.trim()).sort()'), ['Fleet 02', 'Staging'])
    assert.deepEqual(await run('window.__dock.calls.aiWorkspaceConnects'), ['production', 'staging'])

    stage = 'hiding the terminal action for multiple servers'
    assert.equal(await run(`!!document.querySelector('${draftTerminalButton}')`), false, 'A multi-host draft has no terminal action')
    await fill(draftInput, '看看两台服务器的状态')
    await wait('document.querySelector(".ai-draft-send")?.matches(":enabled")')
    await domClick('.ai-draft-send')
    await wait('document.querySelector(".connections-ai-workspace .workspace-scope-details")?.checkVisibility() && window.__dock.hasAiReply()')
    assert.equal(await run('!!document.querySelector(".connections-ai-workspace .ai-open-terminal")'), false, 'A live multi-host conversation has no terminal action')
    await run('window.__dock.finishAiReply()')

    stage = 'continuing a recent AI conversation from an open SSH terminal'
    window.setContentSize(1200, 900)
    await wait(`innerWidth >= 900 && document.querySelector('${stagingTab}')?.checkVisibility()`)
    await domClick(stagingTab)
    await wait(`document.querySelector('${stagingTab}[data-active-tab="true"]')?.checkVisibility() && !!${visibleStagingTerminal}`)
    await run(`window.__sshRecentTerminal = ${visibleStagingTerminal}`)
    const workspaceConnects = await run('window.__dock.calls.aiWorkspaceConnects')
    if (await run(`document.querySelector('${tool('ai')}')?.getAttribute('aria-pressed') !== 'true'`)) await domClick(tool('ai'))
    const sshRecent = `#dock-content-ai ${recentThread}`
    await wait(`document.querySelector('${sshRecent}')?.checkVisibility() && document.querySelector('${sshRecent}')?.matches(':enabled')`)
    assert.equal(await run('document.querySelector("#dock-content-ai .ai-recent-conversations h4").textContent.trim()'), '继续最近的对话')
    await domClick(sshRecent)
    await wait(`[...document.querySelectorAll('#dock-content-ai .ai-sidebar')].some(panel => panel.checkVisibility() && panel.querySelector('.ai-title')?.textContent.includes('First staging conversation') && panel.querySelector('.chat-list')?.textContent.includes('First staging conversation'))`)
    assert.ok(await run(`window.__sshRecentTerminal === ${visibleStagingTerminal}`), 'The original SSH terminal stays visible')
    assert.deepEqual(await run('window.__dock.calls.terminalConnects'), ['production', 'staging'])
    assert.deepEqual(await run('window.__dock.calls.aiWorkspaceConnects'), workspaceConnects)
    stage = 'closing the standalone AI tab while an SSH terminal stays active'
    await wait(`document.querySelector('${aiTab}[data-active-tab="false"]')?.checkVisibility()`)
    await domClick(`${aiTab} .tab-close`)
    await wait(`!document.querySelector('${aiTab}') && document.querySelector('${stagingTab}[data-active-tab="true"]')?.checkVisibility() && window.__sshRecentTerminal.checkVisibility()`)
    assert.equal(await run('window.__dockError || null'), null)
    console.log(JSON.stringify({ passed: true, flows: ['clear connection selection across groups', 'terminal beside an unsent AI draft', 'SSH host-key confirmation', 'X11 startup notice and cleanup', 'knowledge mode changes without an AI SSH connection', 'first send while preserving the unsent draft', 'AI code actions target the visible terminal', 'live AI reply', 'selection and draft retention', 'terminal instance reuse', 'narrow side-by-side layout', 'late SSH connect after a same-host thread switch', 'responsive new conversation cards and selected hosts while filtering', 'terminal action only for a single server', 'resume the same recent AI conversation from standalone AI, docked AI and from SSH'], artifacts }))
    clearTimeout(timeout); window.destroy(); runtime.closeAppDatabase(); app.quit(); return
  }
  await wait('window.__dock?.snapshot().ready && !!document.querySelector(".xterm-screen")')
  await wait('window.__dock.calls.resizes.length>0')
  assert.equal(await run('window.__dockError || null'), null)
  if (process.env.LITECONNECT_DOCK_TASK_FLOAT_ONLY === '1') {
    stage = 'dragging background tasks across the SSH workspace'
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: 1, mobile: false })
    await run('window.__dock.theme("light", "zh-CN")')
    const visibleTasks = '.ai-background-tasks[data-layout="ssh"]:not([style*="display: none"])'
    const trigger = `${visibleTasks} .background-float-trigger`
    const point = () => run(`(() => {const r=document.querySelector('${trigger}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    const mouse = (type, position, buttons) => window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...position, button: 'left', buttons, clickCount: 1 })
    const at = async (expected) => {
      const actual = await point()
      assert.ok(Math.abs(actual.x - expected.x) < 2 && Math.abs(actual.y - expected.y) < 2, JSON.stringify({ actual, expected }))
    }
    const setJobs = (status = 'running') => {
      const jobs = ['one', 'three'].map(sessionId => ({
        sessionId, jobId: sessionId, startedAt: Date.now(),
        command: sessionId === 'one' ? ['fixture-one', 'fixture-token-'.repeat(35), ...Array(24).fill('fixture output line')].join('\n') : 'fixture-three',
        status: sessionId === 'one' ? status : 'running',
        finishedAt: sessionId === 'one' && status === 'completed' ? Date.now() : undefined,
      }))
      return run(`window.__dock.setBackgroundJobs(${JSON.stringify(jobs)})`)
    }
    await setJobs()
    await click(tool('ai'))
    await wait(`document.querySelector('${trigger}')?.checkVisibility({visibilityProperty:true})`)
    const start = await point()
    const terminal = await run(`(() => {const r=document.querySelector('.workspace-dock-center').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await mouse('mousePressed', start, 1)
    await mouse('mouseMoved', terminal, 1)
    await mouse('mouseReleased', terminal, 0)
    await tick()
    await at(terminal)
    assert.ok(await run(`document.elementFromPoint(${terminal.x},${terminal.y})?.closest('${trigger}') && !document.querySelector('.background-popover')`), 'A drop over the terminal stays clickable without opening the popover')
    const glyph = await run(`(() => {const svg=document.querySelector('${trigger} > svg');const width=svg.getBoundingClientRect().width;return {width,stroke:width*parseFloat(getComputedStyle(svg).strokeWidth)/svg.viewBox.baseVal.width}})()`)
    assert.ok(glyph.width >= 18 && glyph.stroke >= 1.6, `The floating SVG has a readable size and stroke at default density: ${JSON.stringify(glyph)}`)
    await screenshot('ssh-task-float.png')

    await click(tool('ai'))
    await wait('!window.__dock.snapshot().panels.ai')
    await at(terminal)
    await click(trigger)
    const taskPanel = `${visibleTasks} .background-popover`
    await wait(`(() => {
      const panel = document.querySelector('${taskPanel}')
      return panel?.textContent.includes('fixture-one') && panel.getAnimations().length === 0
    })()`)
    await click(`${taskPanel} .background-job summary`)
    await wait(`!!document.querySelector('${taskPanel} .tool-run-out')`)
    const typeSizes = () => run(`(() => {
      const panel = document.querySelector('${taskPanel}')
      const query = selector => panel.querySelector(selector)
      const size = selector => parseFloat(getComputedStyle(query(selector)).fontSize)
      const body = query('.background-task-body')
      const blocks = [query('.tool-run-args'), query('.tool-run-out')]
      return {
        heading: size('.background-heading-main'), status: size('.tool-run-state'), time: size('.background-job-elapsed'),
        preview: size('.tool-run-desc'), command: size('.tool-run-args'), output: size('.tool-run-out'),
        wraps: blocks.every(block => block.scrollWidth <= block.clientWidth + 1),
        scrolls: body.scrollHeight > body.clientHeight && getComputedStyle(body).overflowY === 'auto',
      }
    })()`)
    const lightType = await typeSizes()
    assert.ok(lightType.heading >= 12.8 && lightType.command >= 12.8 && lightType.output >= 12.8, JSON.stringify(lightType))
    assert.ok(lightType.status >= 11.9 && lightType.time >= 11.9 && lightType.preview >= 11.9, JSON.stringify(lightType))
    assert.ok(lightType.wraps && lightType.scrolls, JSON.stringify(lightType))
    await screenshot('ssh-task-popover-type.png')
    await run('window.__dock.theme("dark", "zh-CN")')
    const darkType = await typeSizes()
    assert.ok(darkType.command > lightType.command && darkType.time > lightType.time && darkType.wraps && darkType.scrolls, JSON.stringify(darkType))
    await run('window.__dock.theme("light", "zh-CN")')
    await run('window.__dock.session("three")')
    await wait(`!document.querySelector('${trigger}') && !document.querySelector('.background-popover')`)
    await click(tool('ai'))
    await wait(`document.querySelector('${trigger}')?.checkVisibility({visibilityProperty:true})`)
    await at(start)
    await click(trigger)
    await wait(`document.querySelector('${visibleTasks} .background-popover')?.textContent.includes('fixture-three')`)
    await run('window.__dock.session("one")')
    await wait(`!!document.querySelector('${trigger}') && !document.querySelector('.background-popover')`)
    await at(terminal)

    await mouse('mousePressed', terminal, 1)
    await mouse('mouseMoved', { x: terminal.x - 100, y: terminal.y - 100 }, 1)
    await wait(`!!document.querySelector('${visibleTasks}.dragging')`)
    await run('window.__dock.session("three")')
    await mouse('mouseReleased', terminal, 0)
    await at(start)
    await run('window.__dock.session("one")')
    await at(terminal)
    const bottom = await run(`document.querySelector('${visibleTasks}').parentElement.getBoundingClientRect().bottom`)
    await mouse('mousePressed', terminal, 1)
    await mouse('mouseMoved', { x: terminal.x, y: bottom - 1 }, 1)
    await mouse('mouseReleased', { x: terminal.x, y: bottom - 1 }, 0)
    await wait(`document.querySelector('${visibleTasks}[data-edge=bottom] .is-tucked')?.getAnimations().length === 0`)
    const docked = await point()
    assert.ok(Math.abs(docked.y - bottom) < 1, 'The SSH semicircle meets the bottom of the workspace')
    await mouse('mousePressed', { x: docked.x, y: docked.y - 4 }, 1)
    await mouse('mouseMoved', { x: terminal.x, y: terminal.y - 4 }, 1)
    await mouse('mouseReleased', { x: terminal.x, y: terminal.y - 4 }, 0)
    await tick()
    await at(terminal)
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8 })
    await setJobs('completed')
    assert.equal(await run(`!!document.querySelector('${visibleTasks} .is-tucked')`), false, 'Finishing a job does not immediately tuck the icon')
    await wait(`!!document.querySelector('${visibleTasks} .is-tucked')`)
    await setJobs()
    await wait(`!document.querySelector('${visibleTasks} .is-tucked')`)
    await at(terminal)
    assert.equal(await run('window.__dockError || null'), null)
    console.log(JSON.stringify({ passed: true, flow: stage, glyph, artifacts }))
    clearTimeout(timeout); window.destroy(); runtime.closeAppDatabase(); app.quit(); return
  }
  if (process.env.LITECONNECT_DOCK_AI_PERMISSION_ONLY === '1') {
    stage = 'changing the idle SSH chat mode while another chat is running'
    const visiblePanel = '.ai-sidebar:not([style*="display: none"])'
    const permission = `${visiblePanel} .composer-selector`
    await click(tool('ai'))
    await wait(`!!document.querySelector('${visiblePanel} .ai-model-switcher')`)
    await run(`(() => { const input = document.querySelector('${visiblePanel} .composer-input'); input.value = 'Check disk'; input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await wait(`document.querySelector('${visiblePanel} .send-btn')?.disabled === false`)
    await click(`${visiblePanel} .send-btn`)
    await wait(`!!document.querySelector('${visiblePanel} .stop-btn')`)
    await run('window.__dock.session("three")')
    await wait(`!!document.querySelector('${visiblePanel} .send-btn')`)
    assert.equal(await run(`document.querySelector('${permission}').disabled`), false)
    await click(permission)
    await wait('!!document.querySelector(".composer-selector-menu")')
    await run(`document.querySelector('.ai-sidebar[style*="display: none"] .chat-list').dispatchEvent(new Event('scroll'))`)
    assert.equal(await run('!!document.querySelector(".composer-selector-menu")'), true, 'Scrolling another chat must not dismiss the permission menu')
    await click('.composer-selector-menu [role="menuitemradio"]:last-child')
    await wait(`document.querySelector('${permission}').textContent.includes('只读')`)
    await click(permission)
    await wait('!!document.querySelector(".composer-selector-menu")')
    await run('window.__dock.session("one")')
    await wait(`!!document.querySelector('${visiblePanel} .stop-btn')`)
    assert.equal(await run('!!document.querySelector(".composer-selector-menu")'), false, 'The menu closes when its chat is hidden')
    await run('window.__dock.finishAiReply()')
    await wait(`!!document.querySelector('${visiblePanel} .send-btn')`)
    assert.equal(await run('window.__dockError || null'), null)
    console.log(JSON.stringify({ passed: true, flow: stage, artifacts }))
    clearTimeout(timeout); window.destroy(); runtime.closeAppDatabase(); app.quit(); return
  }
  if (process.env.LITECONNECT_DOCK_CWD_ONLY === '1') {
    stage = 'locating after successful and failed cd commands'
    await click(tool('files'))
    await wait('document.querySelector(".file-sidebar .path-display")?.title==="/home/ops"')
    await click('.file-sidebar .navigation-actions button[aria-pressed="true"]')
    await run('window.__dock.enableCwdInputEcho()')
    const input = window.webContents.debugger
    const submit = async (command, checkedPath) => {
      await run('document.querySelector(".xterm-helper-textarea").focus()')
      await input.sendCommand('Input.insertText', { text: command })
      await input.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await input.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await wait(`window.__dock.calls.cwdChecks.includes(${JSON.stringify(checkedPath)})`)
    }
    const locate = '.file-sidebar .navigation-actions > button:first-child'
    await submit('cd /home/v5-automation-servers', '/home/v5-automation-servers')
    await click(locate)
    await wait('document.querySelector(".file-sidebar .path-display")?.title==="/home/v5-automation-servers"')
    await submit('cd ..', '/home')
    await submit('cd tab', '/home/tab')
    await submit('cd bcdd', '/home/bcdd')
    const writes = await run('window.__dock.calls.writes.length')
    await click(locate)
    await wait('document.querySelector(".file-sidebar .path-display")?.title==="/home"')
    assert.equal(await run('window.__dock.calls.writes.length'), writes, 'Locate must not write to the terminal')
    assert.ok(await run('window.__dock.calls.fileLoads.every(path => !/\\/(tab|bcdd)(\\/|$)/.test(path))'), 'Invalid cwd candidates must not be listed')
    console.log(JSON.stringify({ passed: true, flows: ['cd ..', 'consecutive failed cd commands', 'SFTP locate without terminal input'], artifacts }))
    clearTimeout(timeout); window.destroy(); runtime.closeAppDatabase(); app.quit(); return
  }
  const subscriptions = await run('window.__dock.calls.dataSubscriptions')
  if (!process.env.LITECONNECT_DOCK_MATRIX_ONLY) {
  stage = 'moving AI and preserving its composer'
  await click(tool('ai')); await wait('!!document.querySelector(".ai-sidebar .composer textarea")')
  assert.equal(await run('document.querySelectorAll(".workspace-dock-tabs").length'), 0, 'Docking adds no duplicate panel tab bar')
  await run(`(() => {const input=document.querySelector('.ai-sidebar .composer textarea');input.value='Keep this draft while moving';input.dispatchEvent(new Event('input',{bubbles:true}));window.__savedAiInput=input;window.__savedTerminal=document.querySelector('.terminal-host .xterm-screen')})()`)
  await move('ai', 'right')
  await wait('!!document.querySelector(".dock-right .ai-sidebar")')
  assert.ok(await run(`(() => {
    const canvas = document.querySelector('.workspace-dock-canvas').getBoundingClientRect();
    const left = document.querySelector('.workspace-tool-rail[data-dock-edge="left"]').getBoundingClientRect();
    const right = document.querySelector('.workspace-tool-rail[data-dock-edge="right"]').getBoundingClientRect();
    return left.width < 40 && right.width === left.width && Math.abs(canvas.left - left.right) <= 1 && Math.abs(canvas.right - right.left) <= 1;
  })()`), 'Compact tool rails fit exactly beside the canvas')
  assert.equal(await run('getComputedStyle(window.__savedAiInput).fontSize'), '13px', 'AI input keeps its content font at the compact UI scale')
  assert.ok(await run('document.querySelector(".ai-sidebar .composer textarea")===window.__savedAiInput'))
  assert.equal(await run('window.__savedAiInput.value'), 'Keep this draft while moving')
  stage = 'hiding and restoring the terminal without remounting AI or xterm'
  assert.ok(await run(`(() => {const toggle=document.querySelector('.ssh-ai-terminal-toggle');return toggle.getAttribute('aria-label')==='只显示 AI' && toggle.querySelector('svg')?.checkVisibility() && !toggle.textContent.trim()})()`))
  await click('.ssh-ai-terminal-toggle')
  await wait('!!document.querySelector(".workspace-dock.is-panel-focused")')
  assert.ok(await run(`(() => {
    const dock = document.querySelector('.workspace-dock').getBoundingClientRect()
    const ai = document.querySelector('.ai-sidebar').getBoundingClientRect()
    return ai.width === dock.width && !window.__savedTerminal.checkVisibility()
      && window.__savedAiInput === document.querySelector('.ai-sidebar textarea')
      && window.__savedAiInput.value === 'Keep this draft while moving'
  })()`), 'AI fills the workspace while the same terminal and composer stay mounted')
  await click('.ssh-ai-terminal-toggle')
  await wait('!document.querySelector(".workspace-dock.is-panel-focused") && window.__savedTerminal.checkVisibility()')
  assert.equal(await run('document.querySelector(".terminal-host .xterm-screen")===window.__savedTerminal'), true)
  assert.equal(await run('window.__dock.calls.dataSubscriptions'), subscriptions, 'Layout changes do not reconnect the terminal')
  assert.equal(await run('window.__savedAiInput.value'), 'Keep this draft while moving')
  stage = 'simultaneous file and AI panels'
  await click(tool('files')); await wait('!!document.querySelector(".dock-left .file-sidebar")')
  await wait('window.__dock.calls.fileLoads.length>0')
  const editPath = async path => {
    await click('.file-sidebar .path-action-btn')
    await wait('!!document.querySelector(".file-sidebar .path-input")')
    await run(`(() => {const input=document.querySelector('.file-sidebar .path-input');input.value=${JSON.stringify(path)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await click('.file-sidebar .path-action-btn.confirm')
    await wait(`document.querySelector('.file-sidebar .path-display')?.title===${JSON.stringify(path)}`)
  }
  await editPath('/srv/app')
  assert.deepEqual(await run('({ai:window.__dock.snapshot().panels.ai,files:window.__dock.snapshot().panels.files})'), { ai: true, files: true })
  assert.ok(await run(`(() => {const right=document.querySelector('.dock-right');return !right.innerText.includes('批量执行') && !right.innerText.includes('命令片段') && !right.querySelector('[role=tablist]')})()`), 'Opening AI does not advertise unopened batch/snippet tools')
  assert.ok(await run(`['left','right'].every(edge=>{const region=document.querySelector('.dock-'+edge),body=region.querySelector('.workspace-dock-body');return Math.abs(body.getBoundingClientRect().top-region.getBoundingClientRect().top)<=2})`), 'Original panel content starts directly at its dock boundary')
  stage = 'fused panels keep one hairline divider'
  const fused = await run(`(() => {
    const panels = [...document.querySelectorAll('.workspace-dock-region')].filter(region => region.checkVisibility())
    return { count: panels.length, ok: panels.every(region => {
      const s = getComputedStyle(region)
      const towardTerminal = region.classList.contains('dock-left') ? s.borderRightWidth : s.borderLeftWidth
      const outerEdge = region.classList.contains('dock-left') ? s.borderLeftWidth : s.borderRightWidth
      return parseFloat(s.marginLeft) === 0 && parseFloat(s.marginRight) === 0
        && parseFloat(s.borderTopLeftRadius) === 0 && parseFloat(s.borderBottomRightRadius) === 0
        && towardTerminal === '1px' && outerEdge === '0px'
        && s.borderTopWidth === '0px' && s.borderBottomWidth === '0px'
    }) }
  })()`)
  assert.ok(fused.count === 2 && fused.ok, `Docked panels stay edge-to-edge with one hairline toward the terminal: ${JSON.stringify(fused)}`)
  const hotspot = await run(`(() => {const r=document.querySelector('.dock-left .workspace-dock-resize').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  assert.ok(await run(`document.elementFromPoint(${hotspot.x},${hotspot.y})?.classList.contains('workspace-dock-resize')`), 'Resize hotspot stays hit-testable')
  await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hotspot })
  await tick()
  const hotspotBg = await run(`getComputedStyle(document.querySelector('.dock-left .workspace-dock-resize')).backgroundColor`)
  assert.ok(hotspotBg === 'rgba(0, 0, 0, 0)' || hotspotBg === 'transparent', `Resize hotspot must not paint a solid band: ${hotspotBg}`)
  const divider = await run(`(() => {
    const region = document.querySelector('.dock-left')
    return { current: getComputedStyle(region).getPropertyValue('--dock-divider').trim(), accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() }
  })()`)
  assert.equal(divider.current, divider.accent, 'Hover feedback lands on the hairline instead of the hotspot')
  await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8 })
  await run('window.__savedFilePane=document.querySelector(".file-sidebar")')
  await screenshot('dock-files-ai.png')
  stage = 'terminal labels and direct path breadcrumbs'
  const renameTerminal = async (tab, label) => {
    await click(tab, 'right')
    await wait('!!document.querySelector(".terminal-tab-menu")')
    await click('.terminal-tab-menu .ui-menu-item')
    await wait('!!document.querySelector(".app-dialog .ui-input")')
    await run(`(() => {const input=document.querySelector('.app-dialog .ui-input');input.value=${JSON.stringify(label)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await click('.app-dialog-actions .ui-btn-primary')
  }
  await renameTerminal('.sub-tab.active .sub-tab-label', '查看日志')
  await wait('document.querySelector(".sub-tab.active .sub-tab-label")?.textContent==="查看日志"')
  assert.equal(await run('document.querySelector(".dock-left .sftp-binding span")?.textContent'), '查看日志')
  await click('.dock-left .path-crumb[title="/srv"]')
  await wait('document.querySelector(".dock-left .path-display")?.title==="/srv"')
  await editPath('/srv/app')
  stage = 'fixed SFTP font and density across panel widths'
  const fileDensity = await run(`(() => {const row=document.querySelector('.file-sidebar .tree-row');return {font:getComputedStyle(row).fontSize,row:row.getBoundingClientRect().height,icon:row.querySelector('.tree-icon').getBoundingClientRect().width}})()`)
  const originalLeft = await run('window.__dock.snapshot().layout.sizes.left')
  await run(`document.querySelector('.dock-left .workspace-dock-resize').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`)
  await wait('!window.__dock.snapshot().saving && window.__dock.snapshot().layout.sizes.left===240')
  const more = '.dock-left .sftp-toolbar-more .dropdown-trigger'
  await click(more)
  await wait('!!document.querySelector(".dock-left .sftp-toolbar-menu")')
  assert.ok(await run(`(() => {
    const panel = document.querySelector('.dock-left').getBoundingClientRect();
    const menu = document.querySelector('.dock-left .sftp-toolbar-menu').getBoundingClientRect();
    return menu.left >= panel.left && menu.right <= panel.right;
  })()`), 'The SFTP menu fits at the minimum dock width')
  await click(more)
  stage = 'collapsed SFTP breadcrumbs'
  const parent = '/srv/服务日志和归档目录/生产环境应用服务'
  await editPath(`${parent}/logs`)
  await wait('!!document.querySelector(".dock-left .path-overflow .dropdown-trigger")')
  await click('.dock-left .path-overflow .dropdown-trigger')
  await wait('!!document.querySelector(".dock-left .path-ancestor-menu")')
  await click(`.dock-left .path-ancestor-menu [data-value="${parent}"]`)
  await wait(`document.querySelector('.dock-left .path-display')?.title===${JSON.stringify(parent)}`)
  await editPath('/srv/app')
  await run(`document.querySelector('.dock-left .workspace-dock-resize').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`)
  await wait('!window.__dock.snapshot().saving && window.__dock.snapshot().layout.sizes.left===720')
  assert.deepEqual(await run(`(() => {const row=document.querySelector('.file-sidebar .tree-row');return {font:getComputedStyle(row).fontSize,row:row.getBoundingClientRect().height,icon:row.querySelector('.tree-icon').getBoundingClientRect().width}})()`), fileDensity, 'SFTP font, rows and icons stay the same when the panel gets wider')
  await run(`(() => {const layout=window.__dock.snapshot().layout;layout.sizes.left=${originalLeft};return window.__dockBackend.invoke('external',layout)})()`)
  await run(`window.dispatchEvent(new CustomEvent('sftp-font-settings-change',{detail:{fontSize:15}}))`)
  await wait('getComputedStyle(document.querySelector(".file-sidebar .tree-row")).fontSize==="15px"')
  await run(`window.dispatchEvent(new CustomEvent('sftp-font-settings-change',{detail:{fontSize:12}}))`)
  stage = 'original icon toggle and region switching'
  await click(tool('batch')); await wait('window.__dock.snapshot().panels.batch && !window.__dock.snapshot().panels.files')
  await click(tool('snippets')); await wait('window.__dock.snapshot().panels.snippets && !window.__dock.snapshot().panels.batch')
  await click(tool('files')); await wait('window.__dock.snapshot().panels.files && !window.__dock.snapshot().panels.snippets')
  assert.ok(await run('window.__savedAiInput.checkVisibility() && window.__savedAiInput.value==="Keep this draft while moving"'))
  assert.ok(await run(`(() => {const right=document.querySelector('.dock-right');return !right.innerText.includes('批量执行') && !right.innerText.includes('命令片段') && !right.querySelector('.workspace-dock-tabs')})()`), 'Previously opened tools also stay hidden after switching back to AI')
  stage = 'left and right placement without remounting'
  for (const edge of ['left', 'right']) {
    await move('ai', edge)
    await wait(`!!document.querySelector('.dock-${edge} .ai-sidebar')`)
    assert.ok(await run('window.__savedAiInput.checkVisibility()'), 'The moved panel stays expanded even when another tool occupied its destination')
    assert.ok(await run('document.querySelector(".ai-sidebar .composer textarea")===window.__savedAiInput'))
    assert.equal(await run('window.__savedAiInput.value'), 'Keep this draft while moving')
    assert.ok(await run('document.querySelector(".terminal-host .xterm-screen")===window.__savedTerminal'))
  }
  assert.equal(await run('window.__dock.calls.dataSubscriptions'), subscriptions)
  stage = 'close focus and per-session state'
  await click(tool('ai')); await wait('!window.__dock.snapshot().panels.ai')
  await wait('document.activeElement?.classList.contains("xterm-helper-textarea")')
  await click(tool('ai')); await wait('window.__savedAiInput.checkVisibility()')
  await click(tool('files')); await wait('window.__dock.snapshot().panels.files')
  assert.ok(await run('document.querySelector(".file-sidebar")===window.__savedFilePane'))
  assert.equal(await run('window.__savedFilePane.querySelector(".path-display")?.title'), '/srv/app')
  await run('window.__dock.session("two")')
  await wait('document.querySelectorAll(".ai-sidebar").length===2')
  await run('window.__dock.session("one")')
  await wait('window.__savedAiInput.checkVisibility()')
  assert.equal(await run('window.__savedAiInput.value'), 'Keep this draft while moving')
  stage = 'split keeps independent docks open'
  const savedSizes = await run('window.__dock.snapshot().layout.sizes')
  await click('.terminal-layout-actions button:last-child')
  await wait('window.__dock.snapshot().split && window.__dock.snapshot().splitMode==="vertical"')
  assert.equal(await run('document.querySelector(".split-group-tab .sub-tab-label")?.textContent'), '查看日志')
  await renameTerminal('.split-group-tab .sub-tab-label', '')
  await wait('document.querySelector(".split-group-tab .sub-tab-label")?.textContent==="终端 1"')
  assert.deepEqual(await run('({ai:window.__dock.snapshot().panels.ai,files:window.__dock.snapshot().panels.files})'), { ai: true, files: true })
  assert.equal(await run(`document.querySelector('${tool('ai')}').disabled`), false)
  assert.ok(await run('window.__savedAiInput.checkVisibility() && window.__savedAiInput.value==="Keep this draft while moving"'))
  await wait('document.querySelector(".terminal-container").getBoundingClientRect().width>=485')
  assert.ok(await run(`[...document.querySelectorAll('.terminal-pane')].filter(el=>el.checkVisibility()).every(el=>el.getBoundingClientRect().width>=239)`), 'Dock sizes reserve room for both side-by-side panes')
  assert.deepEqual(await run('window.__dock.snapshot().layout.sizes'), savedSizes, 'Split allocation never overwrites saved dock sizes')
  await screenshot('dock-split-files-ai.png')
  stage = 'cross-host split target and manual panel choices'
  await run('window.__dock.split(true,"vertical",true)')
  await wait('document.querySelectorAll(".split-pane-host").length===2')
  assert.ok(await run('window.__savedAiInput.checkVisibility() && window.__savedFilePane.checkVisibility()'))
  assert.ok(await run('document.querySelector(".ssh-ai-target").innerText.includes("Production")'))
  await click('.terminal-pane.is-secondary .terminal-pane-body')
  assert.ok(await run('window.__savedAiInput.checkVisibility() && document.querySelector(".ssh-ai-target").innerText.includes("Production")'), 'Focusing the secondary pane never silently retargets AI')
  await click('.terminal-pane.is-primary .split-pane-actions button:first-child')
  await wait('window.__dock.snapshot().primary==="three"')
  await wait(`[...document.querySelectorAll('.ssh-ai-target')].some(el=>el.checkVisibility() && el.innerText.includes('Staging'))`)
  await click(tool('ai')); await wait('!window.__dock.snapshot().panels.ai')
  await click('.terminal-pane.is-primary .split-pane-actions button:nth-child(3)')
  await wait('!window.__dock.snapshot().split')
  assert.equal(await run('window.__dock.snapshot().panels.ai'), false, 'Leaving a split preserves an explicit close instead of reopening a stale snapshot')
  assert.equal(await run('window.__dock.snapshot().panels.files'), true)
  await run('window.__dock.session("one")')
  await click(tool('ai')); await wait('window.__savedAiInput.checkVisibility()')
  stage = 'stacked split with left and right docks'
  await run('window.__dock.split(true,"horizontal")')
  await wait(`[...document.querySelectorAll('.terminal-pane')].filter(el=>el.checkVisibility()).length === 2`)
  const stackedHeights = await run(`[...document.querySelectorAll('.terminal-pane')].filter(el=>el.checkVisibility()).map(el=>el.getBoundingClientRect().height)`)
  assert.equal(stackedHeights.length, 2)
  assert.ok(stackedHeights.every(height => height >= 154), 'Side docks leave space for both stacked panes')
  assert.ok(await run('window.__savedAiInput.checkVisibility() && window.__savedFilePane.checkVisibility()'))
  await wait(`(() => {const panel=window.__savedAiInput.closest('.ai-sidebar'),target=panel.querySelector('.ssh-ai-target').getBoundingClientRect(),composer=panel.querySelector('.composer-area').getBoundingClientRect(),send=panel.querySelector('.send-btn').getBoundingClientRect();return target.height>0 && target.bottom<=composer.top+1 && send.bottom<=composer.bottom+1})()`)
  await screenshot('dock-stacked-tools.png')
  await run('window.__dock.split(false)')
  assert.equal(await run('window.__dock.calls.dataSubscriptions'), subscriptions)
  stage = 'resizing and committing once'
  const before = await run('window.__dockBackend.invoke("count")')
  const point = await run(`(() => {const r=document.querySelector('.dock-right .workspace-dock-resize').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  assert.ok(await run(`document.elementFromPoint(${point.x},${point.y})?.classList.contains('workspace-dock-resize')`), JSON.stringify(await run(`({point:${JSON.stringify(point)},hit:document.elementFromPoint(${point.x},${point.y})?.outerHTML.slice(0,300),handle:document.querySelector('.dock-right .workspace-dock-resize').outerHTML})`)))
  await run(`(() => {window.__resizeEvents=[];for(const type of ['pointerdown','pointermove','pointerup']) window.addEventListener(type,event=>window.__resizeEvents.push([type,event.pointerId,event.clientX,String(event.target.className?.baseVal ?? event.target.className),document.body.style.cursor]),true)})()`)
  await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 4; i++) await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x - i * 20, y: point.y, button: 'left', buttons: 1 })
  assert.equal(await run('window.__dockBackend.invoke("count")'), before, 'Live resize does not write SQLite on every mousemove')
  await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x - 80, y: point.y, button: 'left', clickCount: 1 })
  await wait('!window.__dock.snapshot().saving')
  assert.equal(await run('window.__dockBackend.invoke("count")'), before + 1, JSON.stringify(await run('window.__resizeEvents')))
  stage = 'keyboard resize and icon order'
  const previousSize = await run('window.__dock.snapshot().layout.sizes.right')
  await run(`document.querySelector('.dock-right .workspace-dock-resize').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`)
  await wait('!window.__dock.snapshot().saving')
  assert.ok(await run('window.__dock.snapshot().layout.sizes.right') > previousSize)
  const panelDestination = await run('window.__dock.snapshot().layout.tools.find(tool=>tool.id==="batch").panelEdge')
  await click(tool('batch'), 'right'); await wait('!!document.querySelector(".workspace-layout-menu")')
  assert.deepEqual(await run(`[...document.querySelectorAll('[data-move-edge]')].map(button=>button.dataset.moveEdge)`), ['left', 'right'])
  await run(`document.querySelector('.workspace-layout-menu button[role="menuitem"]:not([data-move-edge])').click()`)
  await wait('!window.__dock.snapshot().saving')
  assert.equal(await run('window.__dock.snapshot().layout.tools.find(tool=>tool.id==="batch").panelEdge'), panelDestination)
  stage = 'drag drop preview and ordering'
  const startToolDrag = async id => {
    await run(`(() => {
      window.__dragData = new DataTransfer();
      document.querySelector(${JSON.stringify(tool(id))}).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dragData }));
    })()`)
    await wait('document.querySelectorAll(".dock-drop-strip").length === 2')
  }
  const dragAt = (type, selector, y = 0.5) => run(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    const clientX = rect.left + rect.width / 2, clientY = rect.top + rect.height * ${y};
    document.elementFromPoint(clientX, clientY).dispatchEvent(new DragEvent(${JSON.stringify(type)}, {
      bubbles: true, cancelable: true, dataTransfer: window.__dragData, clientX, clientY,
    }));
  })()`)
  const strip = edge => `[data-tool-drop-edge="${edge}"]`
  const saveCountBeforeCancel = await run('window.__dockBackend.invoke("count")')
  await startToolDrag('ai')
  for (const edge of ['left', 'right']) {
    await dragAt('dragover', strip(edge))
    await wait(`document.querySelector('.dock-drop-strip.selected')?.dataset.toolDropEdge === '${edge}'`)
  }
  for (const y of [0.03, 0.97]) {
    await dragAt('dragover', strip('right'))
    await dragAt('dragover', '.workspace-dock-center', y)
    await wait('!document.querySelector(".dock-drop-strip.selected")')
  }
  await dragAt('dragover', strip('left'))
  await wait(`!!document.querySelector('${strip('left')}.selected')`)
  await dragAt('drop', '.workspace-dock-center')
  await wait('!document.querySelector(".workspace-dock-targets")')
  assert.equal(await run('window.__dockBackend.invoke("count")'), saveCountBeforeCancel, 'A center drop cancels even after hovering an edge')

  await startToolDrag('snippets')
  await dragAt('dragover', tool('monitor'), 0.25)
  await wait(`document.querySelector('${tool('monitor')}')?.dataset.dropMarker === 'before'`)
  await dragAt('drop', tool('monitor'), 0.25)
  await wait('!window.__dock.snapshot().saving')
  const leftTools = await run('window.__dock.snapshot().layout.tools.filter(tool => tool.edge === "left").map(tool => tool.id)')
  assert.equal(leftTools[leftTools.indexOf('snippets') + 1], 'monitor', 'The icon is inserted at the marked position')

  await startToolDrag('ai')
  await dragAt('dragover', strip('left'))
  await wait(`!!document.querySelector('${strip('left')}.selected')`)
  await run('window.__dock.theme("light", "zh-CN")')
  await screenshot('dock-drag-preview.png')
  await run('window.__dock.theme("dark", "zh-CN")')
  await dragAt('drop', strip('left'))
  await wait('window.__dock.snapshot().layout.tools.find(tool=>tool.id==="ai").edge==="left" && !window.__dock.snapshot().saving')
  stage = 'layout lock and reset'
  await click('.dock-layout-button'); await click('[data-layout-lock]'); await wait('window.__dock.snapshot().layout.locked && !window.__dock.snapshot().saving')
  assert.equal(await run(`document.querySelector('${tool('ai')}').draggable`), false)
  await click(tool('ai'), 'right')
  assert.ok(await run('Array.from(document.querySelectorAll("[data-move-edge]")).every(button=>button.disabled)'))
  await click('[data-layout-lock]'); await wait('!window.__dock.snapshot().layout.locked && !window.__dock.snapshot().saving')
  stage = 'failed persistence and retry'
  await run('window.__dockBackend.invoke("fail")')
  await move('ai', 'right')
  await wait('window.__dock.snapshot().error')
  await click('.dock-layout-error button'); await wait('!window.__dock.snapshot().error && !window.__dock.snapshot().saving')
  stage = 'persisted reload'
  const expected = await run('window.__dock.snapshot().layout')
  await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.webContents.reload() }); await wait('window.__dock?.snapshot().ready')
  assert.deepEqual(await run('window.__dock.snapshot().layout'), expected)
  stage = 'external window settings notification with legacy edges'
  await run(`(() => {
    const layout=window.__dock.snapshot().layout, ai=layout.tools.find(tool=>tool.id==='ai'), monitor=layout.tools.find(tool=>tool.id==='monitor');
    ai.edge=ai.panelEdge='top'; monitor.edge=monitor.panelEdge='bottom'; layout.sizes.top=600; layout.sizes.bottom=480;
    return window.__dockBackend.invoke('external',layout)
  })()`)
  await wait(`(() => {
    const {tools,sizes}=window.__dock.snapshot().layout, ai=tools.find(tool=>tool.id==='ai'), monitor=tools.find(tool=>tool.id==='monitor');
    return ai.edge==='left' && ai.panelEdge==='left' && monitor.edge==='right' && monitor.panelEdge==='right' && !('top' in sizes) && !('bottom' in sizes);
  })()`)
  await click(tool('monitor'))
  await wait('document.querySelector(".dock-right .monitor-header")?.checkVisibility()')
  await click(tool('monitor'))
  await run('window.__dock.split(true,"horizontal")')
  await click('.split-sync-btn')
  await wait('document.querySelector(".workspace-main .sync-input-bar")?.checkVisibility()')
  await click('.split-sync-btn')
  await run('window.__dock.split(false)')
  } else {
    stage = 'side dock composer and split target visibility'
    await move('ai', 'right')
    await click(tool('ai')); await click(tool('files'))
    await wait('!!document.querySelector(".ai-sidebar .send-btn") && !!document.querySelector(".file-sidebar")')
    await run('window.__dock.split(true,"horizontal")')
    await wait(`(() => {const panel=document.querySelector('.ai-sidebar'),target=panel.querySelector('.ssh-ai-target')?.getBoundingClientRect(),composer=panel.querySelector('.composer-area').getBoundingClientRect(),send=panel.querySelector('.send-btn').getBoundingClientRect();return target?.height>0 && target.bottom<=composer.top+1 && send.bottom<=composer.bottom+1})()`)
    await screenshot('dock-stacked-target.png')
    await run('window.__dock.split(false)'); await click(tool('files'))
  }
  stage = 'narrow windows and display variations'
  let layouts = 0
  for (const theme of ['light', 'dark', 'eyecare']) for (const locale of ['zh-CN', 'en-US']) for (const [w, h, zoom] of [[1200, 900, 1], [440, 700, 1.25]]) {
    stage = `layout ${theme} / ${locale} / ${w}x${h} / ${zoom}`
    window.setSize(w, h); window.webContents.setZoomFactor(zoom)
    await run(`window.__dock.theme('${theme}','${locale}')`)
    if (!await run('window.__dock.snapshot().panels.ai')) await click(tool('ai'))
    await tick()
    await wait(`(() => {const root=document.querySelector('.workspace-dock'),panels=[...document.querySelectorAll('.workspace-dock-region')].filter(panel=>panel.checkVisibility()),b=root.getBoundingClientRect();return panels.length && panels.every(panel=>{const r=panel.getBoundingClientRect();return r.width>0 && r.height>0 && r.left>=b.left-1 && r.right<=b.right+1 && r.top>=b.top-1 && r.bottom<=b.bottom+1})})()`)
    const bounds = await run(`(() => {const root=document.querySelector('.workspace-dock'),panels=[...document.querySelectorAll('.workspace-dock-region')].filter(panel=>panel.checkVisibility());return {root:root.getBoundingClientRect().toJSON(),scroll:root.scrollWidth,client:root.clientWidth,panels:panels.map(panel=>({rect:panel.getBoundingClientRect().toJSON(),style:panel.getAttribute('style')})),state:window.__dock.snapshot()}})()`)
    assert.ok(bounds.panels.length && bounds.panels.every(({rect:r}) => r.width>0 && r.height>0 && r.left>=bounds.root.left-1 && r.right<=bounds.root.right+1 && r.top>=bounds.root.top-1 && r.bottom<=bounds.root.bottom+1) && bounds.scroll<=bounds.client+1, JSON.stringify(bounds))
    assert.equal(await run('window.__dockError || null'), null)
    assert.equal(await run('document.querySelectorAll(".workspace-dock-tabs").length'), 0)
    if (theme === 'dark' && locale === 'zh-CN') await screenshot(w > 1000 ? 'dock-wide.png' : 'dock-narrow.png')
    layouts++
  }
  await click('.dock-layout-button'); await click('[data-layout-reset]'); await wait('window.__dock.snapshot().layout.tools.every(tool=>tool.edge==="left") && !window.__dock.snapshot().saving')
  console.log(JSON.stringify({ passed: true, layouts, flows: process.env.LITECONNECT_DOCK_MATRIX_ONLY ? ['side dock composer', 'layout variations', 'reset'] : ['left/right move', 'composer/file path/xterm identity preserved', 'simultaneous regions', 'terminal label rename and reset', 'direct and collapsed SFTP breadcrumbs', 'fixed SFTP font and density', 'terminal focus', 'session switch', 'same-host and cross-host splits with independent docks', 'explicit AI target and manual close preserved', 'split-aware dock allocation', 'pointer and keyboard resize', 'icon ordering', 'drag preview/drop', 'lock/reset', 'save failure retry', 'SQLite reload', 'cross-window notification and legacy edge migration'], artifacts }))
  clearTimeout(timeout); window.destroy(); runtime.closeAppDatabase(); app.quit()
}).catch(error => { console.error(error, { stage, artifacts }); clearTimeout(timeout); window?.destroy(); database?.close(); app.exit(1) })
