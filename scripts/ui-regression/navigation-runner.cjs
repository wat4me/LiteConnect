const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const artifacts = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'liteconnect-navigation-ui-'))
app.setPath('userData', path.join(artifacts, 'profile'))
let window, stage = 'loading'
const timeout = setTimeout(() => { console.error('Navigation UI timed out', { stage, artifacts }); app.exit(1) }, 180_000)
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, frame: false, width: 1100, height: 760, webPreferences: { contextIsolation: true, backgroundThrottling: false } })
  window.webContents.debugger.attach('1.3')
  const run = source => window.webContents.executeJavaScript(source)
  const wait = async expression => {
    const deadline = Date.now() + 15000
    while (!await run(expression)) {
      if (Date.now() > deadline) throw new Error(`Timeout: ${expression}`)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  const clickSelector = async selector => {
    const point = await run(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2} })()`)
    for (const type of ['mousePressed', 'mouseReleased']) await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
  }
  const click = mode => clickSelector(`[data-module="${mode}"]`)
  const menuMode = async mode => {
    await clickSelector('.titlebar-brand-module')
    await wait('!!document.querySelector(".titlebar-mode-item:nth-child(2)")')
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await clickSelector(`.titlebar-mode-item:nth-child(${['ssh', 'database', 'ai'].indexOf(mode) + 1})`)
  }
  const menuDatabase = () => menuMode('database')
  const edit = (mode, value) => run(`(() => { const el=document.querySelector('[data-field="${mode}"]');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));window.__savedFields ||= {};window.__savedFields['${mode}']=el; })()`)
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await wait('!!window.__navigation')
  assert.equal(await run('document.querySelectorAll("[data-field=database], [data-field=ai]").length'), 0, 'DB/AI stay lazy until first entry')
  await edit('ssh', 'tail -f /srv/app/current.log')
  await run('document.querySelector(".navigation-scroll").scrollTop=80')
  await click('database'); await wait('window.__navigation.snapshot().mode==="database"')
  await edit('database', 'SELECT * FROM audit_log;')
  await click('ai'); await wait('window.__navigation.snapshot().mode==="ai"')
  await edit('ai', 'Find the update script')
  stage = 'checking keyboard activation'
  window.webContents.focus()
  await run('document.querySelector("[data-module=ssh]").focus()')
  assert.equal(await run('document.activeElement?.dataset.module'), 'ssh', 'Module buttons can receive keyboard focus')
  await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'char', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
  await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await wait('window.__navigation.snapshot().mode==="ssh"')
  await click('ssh')
  assert.equal(await run('window.__navigation.snapshot().homeSelections'), 0, 'Returning to or reselecting SSH keeps the active terminal view')
  assert.equal(await run('document.querySelector(".navigation-scroll").scrollTop'), 80)
  for (const [mode, text] of [['ssh', 'tail -f /srv/app/current.log'], ['database', 'SELECT * FROM audit_log;'], ['ai', 'Find the update script']]) {
    assert.ok(await run(`document.querySelector('[data-field="${mode}"]')===window.__savedFields['${mode}']`), 'Switching does not recreate the workspace DOM')
    assert.equal(await run(`document.querySelector('[data-field="${mode}"]').value`), text)
  }
  stage = 'checking titlebar DB entry'
  await menuDatabase(); await wait('window.__navigation.snapshot().mode==="database"')
  assert.equal(await run('document.querySelector("[data-field=database]").value'), 'SELECT * FROM audit_log;')
  await menuMode('ssh'); await menuMode('ssh')
  assert.equal(await run('window.__navigation.snapshot().homeSelections'), 0, 'Titlebar SSH reselect also keeps the active terminal')
  stage = 'checking settings close decisions'
  for (const mode of ['ssh', 'database', 'ai']) {
    await run('window.__navigation.settings(false)'); await menuMode(mode)
    assert.equal(await run('window.__navigation.snapshot().settings'), true)
    assert.equal(await run('window.__navigation.snapshot().mode'), 'ssh')
  }
  stage = 'checking global jump and notification side effects'
  for (const index of [1, 3, 4]) {
    await run('window.__navigation.settings(false);window.__navigation.jump()')
    await wait('!!document.querySelector(".jump-item")')
    await run(`document.querySelector('.jump-item:nth-child(${index})').click()`)
    await wait('!document.querySelector(".jump-item")')
    assert.equal(await run('window.__navigation.actions().length'), 0, 'Cancelled global jump must not execute its action')
  }
  await run('window.__navigation.notify()')
  assert.equal(await run('window.__navigation.actions().length'), 0, 'Cancelled notification must not reveal another conversation')
  await run('window.__navigation.settings(true);window.__navigation.jump()')
  await wait('!!document.querySelector(".jump-item")')
  await run('document.querySelector(".jump-item:nth-child(4)").click()')
  await wait('window.__navigation.actions().length===1')
  await run('window.__navigation.settings(true)'); await menuMode('ai'); await wait('window.__navigation.snapshot().mode==="ai" && !window.__navigation.snapshot().settings')
  assert.ok(await run(`(() => { const button=document.querySelector('[data-module=ai]');const marker=getComputedStyle(button,'::before');return getComputedStyle(button).color===marker.backgroundColor })()`), 'Active module keeps its accent color while hovered')
  let layouts = 0
  for (const locale of ['zh-CN', 'en-US']) for (const theme of ['light', 'dark', 'eyecare']) for (const width of [700, 1200]) for (const scale of [1, 1.25]) {
    stage = `checking ${locale}/${theme}/${width}/${scale}`
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 720, deviceScaleFactor: 1, mobile: false })
    await run(`window.__navigation.theme('${theme}','${locale}',${scale})`)
    await wait(`innerWidth===${width}`)
    assert.ok(await run(`(() => {
      const rail=document.querySelector('.app-module-rail'), r=rail.getBoundingClientRect(), content=document.querySelector('.workspace').getBoundingClientRect(), header=document.querySelector('.app-titlebar').getBoundingClientRect();
      const buttons=[...rail.querySelectorAll('button')];
      return Math.abs(r.width-48*${scale})<1 && r.top>=header.bottom && Math.abs(content.left-r.right)<1 && content.right<=innerWidth+1 && content.bottom<=innerHeight+1 && buttons.length===3
        && rail.querySelector('[aria-current=page]')?.dataset.module==='ai'
        && buttons.every(el=>{const b=el.getBoundingClientRect();return b.left>=r.left && b.right<=r.right && b.bottom<=r.bottom && el.scrollWidth<=el.clientWidth+1 && el.title.length>0})
        && getComputedStyle(rail).getPropertyValue('-webkit-app-region')==='no-drag';
    })()`), `Persistent rail and content fit: ${locale}/${theme}/${width}/${scale}`)
    layouts++
  }
  await run(`window.__navigation.theme('light','zh-CN',1)`)
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const rail = await run(`(() => {const r=document.querySelector('.app-module-rail').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:180}})()`)
  fs.writeFileSync(path.join(artifacts,'module-rail.png'),(await window.webContents.capturePage(rail)).toPNG())
  await run('window.__navigation.dedicated(true)')
  assert.equal(await run('!!document.querySelector(".app-module-rail")'), false)
  assert.equal(await run('document.querySelector(".workspace").getBoundingClientRect().left'), 0, 'Dedicated window layout has no empty rail gutter')
  assert.equal(await run('window.__navigationError || null'), null)
  console.log(JSON.stringify({ passed: true, layouts, flows: ['in-place module switching', 'all titlebar module entries', 'pointer and keyboard', 'lazy mount', 'draft/DOM/scroll retention', 'current SSH reselect', 'settings cancel/close', 'dedicated window layout'], artifacts }))
  clearTimeout(timeout); window.destroy(); app.quit()
}).catch(error => { console.error(error, { stage, artifacts }); clearTimeout(timeout); window?.destroy(); app.exit(1) })
