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
    const selector = `.titlebar-mode-item[data-mode="${mode}"]`
    await wait(`!!document.querySelector(${JSON.stringify(selector)})`)
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await clickSelector(selector)
  }
  const menuDatabase = () => menuMode('database')
  const edit = (mode, value) => run(`(() => { const el=document.querySelector('[data-field="${mode}"]');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));window.__savedFields ||= {};window.__savedFields['${mode}']=el; })()`)
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await wait('!!window.__navigation')
  const titlebarLabel = () => run('document.querySelector(".titlebar-brand").textContent.trim()')
  assert.equal(await titlebarLabel(), 'SSH')
  assert.equal(await run('document.querySelectorAll("[data-field=database], .mcp-workspace").length'), 0, 'DB and MCP stay lazy until first entry')
  await edit('ssh', 'tail -f /srv/app/current.log')
  await run('document.querySelector(".navigation-scroll").scrollTop=80')
  await click('database'); await wait('window.__navigation.snapshot().mode==="database"')
  await edit('database', 'SELECT * FROM audit_log;')
  assert.equal(await run('document.querySelector("[data-module=ai]")'), null, 'AI chats live on the SSH page, not in the module rail')
  stage = 'opening MCP from the module rail and applying a port'
  await click('mcp')
  await wait('document.querySelector("#mcp-port")?.value === "18765"')
  assert.equal(await run('document.querySelector("[data-module=mcp]").getAttribute("aria-current")'), 'page')
  assert.equal(await run('document.querySelector(".mcp-workspace [role=switch]").getAttribute("aria-checked")'), 'true')
  await run(`(() => {
    const select = document.querySelector('#mcp-client-template');
    select.value = 'geminiCli';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await wait('document.querySelector("#mcp-client-config")?.textContent.includes("httpUrl")')
  await run(`(() => {
    const input = document.querySelector('#mcp-port');
    input.value = '18766';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.nextElementSibling.click();
  })()`)
  await wait('document.querySelector(".mcp-facts dd")?.textContent.endsWith(":18766/mcp")')
  const config = await run('document.querySelector("#mcp-client-config").textContent')
  assert.deepEqual(JSON.parse(config).mcpServers['liteconnect-ssh'], {
    httpUrl: 'http://127.0.0.1:18766/mcp',
    headers: { Authorization: 'Bearer ${LITECONNECT_MCP_TOKEN}' },
  })
  await run(`(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      async writeText(text) { window.__copiedMcpConfig = text; }
    } });
    document.querySelector('#mcp-client-template + button').click();
  })()`)
  assert.equal(await run('window.__copiedMcpConfig'), config)
  stage = 'checking that the applied MCP permission stays visibly selected on hover'
  const approvalTarget = '[data-approval-mode=ask-destructive]'
  const approvalPoint = await run(`(() => {
    const option = document.querySelector('${approvalTarget}')
    option.scrollIntoView({ block: 'nearest' })
    const bounds = option.getBoundingClientRect()
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  })()`)
  await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...approvalPoint })
  await clickSelector(approvalTarget)
  await wait(`document.querySelector('${approvalTarget}').matches('[aria-pressed=true]:hover')`)
  assert.equal(await run('document.querySelectorAll(".mcp-approval-mark svg").length'), 1)
  const approvalAppearance = () => run(`(() => {
    const style = getComputedStyle(document.querySelector('${approvalTarget}'))
    return { background: style.backgroundColor, border: style.borderColor }
  })()`)
  const hoveredApproval = await approvalAppearance()
  await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 })
  await wait(`!document.querySelector('${approvalTarget}').matches(':hover')`)
  assert.deepEqual(await approvalAppearance(), hoveredApproval, 'Hover preserves the applied permission colors')
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
  for (const [mode, text] of [['ssh', 'tail -f /srv/app/current.log'], ['database', 'SELECT * FROM audit_log;']]) {
    assert.ok(await run(`document.querySelector('[data-field="${mode}"]')===window.__savedFields['${mode}']`), 'Switching does not recreate the workspace DOM')
    assert.equal(await run(`document.querySelector('[data-field="${mode}"]').value`), text)
  }
  stage = 'checking titlebar DB entry'
  await menuDatabase(); await wait('window.__navigation.snapshot().mode==="database"')
  assert.equal(await titlebarLabel(), 'DB')
  assert.equal(await run('document.querySelector("[data-field=database]").value'), 'SELECT * FROM audit_log;')
  await menuMode('ssh'); await menuMode('ssh')
  assert.equal(await run('window.__navigation.snapshot().homeSelections'), 0, 'Titlebar SSH reselect also keeps the active terminal')
  stage = 'checking settings close decisions'
  for (const mode of ['ssh', 'database', 'mcp']) {
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
  await run('window.__navigation.settings(true)'); await menuMode('ssh'); await wait('window.__navigation.snapshot().mode==="ssh" && !window.__navigation.snapshot().settings')
  assert.equal(await titlebarLabel(), 'SSH')
  await click('mcp')
  await wait('document.querySelector("#mcp-port")?.value === "18766"')
  assert.equal(await run('document.querySelector(".mcp-approval-option[aria-pressed=true]").dataset.approvalMode'), 'ask-destructive')
  let layouts = 0
  for (const locale of ['zh-CN', 'en-US']) for (const theme of ['light', 'dark', 'eyecare']) for (const width of [700, 1200]) for (const scale of [1, 1.25]) {
    stage = `checking ${locale}/${theme}/${width}/${scale}`
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 720, deviceScaleFactor: 1, mobile: false })
    await run(`window.__navigation.theme('${theme}','${locale}',${scale})`)
    await wait(`innerWidth===${width}`)
    assert.ok(await run(`(() => {
      const rail=document.querySelector('.app-module-rail'), r=rail.getBoundingClientRect(), workspace=document.querySelector('.workspace'), content=workspace.getBoundingClientRect(), header=document.querySelector('.app-titlebar').getBoundingClientRect();
      const buttons=[...rail.querySelectorAll('button')];
      const mcp=document.querySelector('.mcp-workspace'), grid=mcp.querySelector('.mcp-grid');
      const selected=mcp.querySelector('.mcp-approval-option[aria-pressed=true]');
      const inactive=mcp.querySelector('.mcp-approval-option[aria-pressed=false]');
      return Math.abs(r.width-48*${scale})<1 && r.top>=header.bottom && Math.abs(content.left-r.right)<1 && content.right<=innerWidth+1 && content.bottom<=innerHeight+1 && buttons.length===3
        && rail.querySelector('[aria-current=page]')?.dataset.module==='mcp' && parseFloat(getComputedStyle(workspace).borderRadius)>=12
        && mcp.scrollWidth<=mcp.clientWidth+1 && getComputedStyle(grid).gridTemplateColumns.split(' ').length===${width >= 1000 ? 2 : 1}
        && !!selected?.querySelector('.mcp-approval-mark svg') && getComputedStyle(selected).backgroundColor!==getComputedStyle(inactive).backgroundColor
        && buttons.every(el=>{const b=el.getBoundingClientRect();return b.left>=r.left && b.right<=r.right && b.bottom<=r.bottom && el.scrollWidth<=el.clientWidth+1 && el.title.length>0})
        && getComputedStyle(rail).getPropertyValue('-webkit-app-region')==='no-drag';
    })()`), `Persistent rail and content fit: ${locale}/${theme}/${width}/${scale}`)
    layouts++
  }
  stage = 'comparing the selected module across built-in themes'
  await click('ssh')
  await wait('document.querySelector(".app-module-button[aria-current=page]")?.dataset.module === "ssh"')
  await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 100 })
  const snapshotStyles = await window.webContents.insertCSS('.app-module-button { transition: none !important; }')
  const themes = await run('window.__navigation.themes')
  for (const theme of themes) {
    stage = `comparing the selected module in ${theme}`
    await run(`window.__navigation.theme('${theme}','zh-CN',1)`)
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const selection = await run(`(() => {
      const active = document.querySelector('.app-module-button[aria-current=page]')
      const inactive = document.querySelector('.app-module-button:not([aria-current])')
      const fill = getComputedStyle(active).backgroundColor
      const marker = getComputedStyle(active, '::before')
      const luminance = color => {
        const divisor = color.startsWith('color(srgb ') ? 1 : 255
        const channels = color.slice(color.lastIndexOf('(') + 1, -1).replace(/^srgb /, '').split(/[ ,]+/)
        const [red, green, blue] = channels.slice(0, 3).map(value => {
          const channel = Number(value) / divisor
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        })
        return red * 0.2126 + green * 0.7152 + blue * 0.0722
      }
      const contrastWithFill = color => {
        const a = luminance(color) + 0.05, b = luminance(fill) + 0.05
        return Math.max(a, b) / Math.min(a, b)
      }
      return {
        markerContrast: contrastWithFill(marker.borderInlineStartColor),
        textContrast: contrastWithFill(getComputedStyle(active).color),
        colors: [fill, marker.borderInlineStartColor, getComputedStyle(active).color],
        markerWidth: parseFloat(marker.borderInlineStartWidth),
        markerHeight: parseFloat(marker.height),
        inactiveMarker: getComputedStyle(inactive, '::before').content,
      }
    })()`)
    assert.ok(selection.markerWidth >= 3 && selection.markerHeight >= 24 && selection.inactiveMarker === 'none', `${theme} marker geometry ${JSON.stringify(selection)}`)
    assert.ok(selection.markerContrast >= 3 && selection.textContrast >= 4.5, `${theme} selection contrast ${JSON.stringify(selection)}`)
    const rail = await run(`(() => {
      const { x, y, width } = document.querySelector('.app-module-rail').getBoundingClientRect()
      return { x: Math.floor(x), y: Math.floor(y), width: Math.ceil(width), height: 164 }
    })()`)
    const screenshot = await window.webContents.capturePage(rail)
    fs.writeFileSync(path.join(artifacts, 'module-rail-' + theme + '.png'), screenshot.toPNG())
  }
  await window.webContents.removeInsertedCSS(snapshotStyles)
  await run('window.__navigation.dedicated(true)')
  assert.equal(await run('!!document.querySelector(".app-module-rail")'), false)
  await clickSelector('.titlebar-brand-module')
  await wait('!!document.querySelector(".titlebar-mode-item[data-mode=mcp]")')
  assert.equal(await run('document.querySelector(".titlebar-mode-item[data-mode=ai]")'), null, 'The titlebar menu has no separate AI module')
  await clickSelector('.titlebar-brand-module')
  await menuMode('mcp'); await wait('document.querySelector("#mcp-port")?.value === "18766"')
  assert.equal(await titlebarLabel(), 'MCP')
  assert.ok(await run(`(() => {
    const shell = document.querySelector('.app-shell'), content = document.querySelector('.workspace').getBoundingClientRect();
    return Math.abs(content.left-shell.getBoundingClientRect().left-parseFloat(getComputedStyle(shell).paddingLeft))<1;
  })()`), 'Dedicated window layout only reserves the frame inset')
  assert.equal(await run('window.__navigationError || null'), null)
  console.log(JSON.stringify({ passed: true, layouts, themes, flows: ['in-place module switching', 'all titlebar module entries', 'pointer and keyboard', 'lazy mount', 'draft/DOM/scroll retention', 'current SSH reselect', 'settings cancel/close', 'MCP port and permission updates', 'dedicated window layout'], artifacts }))
  clearTimeout(timeout); window.destroy(); app.quit()
}).catch(error => { console.error(error, { stage, artifacts }); clearTimeout(timeout); window?.destroy(); app.exit(1) })
