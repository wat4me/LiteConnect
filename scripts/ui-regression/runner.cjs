const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'liteconnect-ui-'))
app.setPath('userData', path.join(artifacts, 'profile'))
const watchdog = setTimeout(() => {
  console.error('UI regression timed out after 60 seconds')
  app.exit(1)
}, 60_000)

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false, width: 1200, height: 1000,
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
  })
  const run = async (source) => {
    const result = await window.webContents.executeJavaScript(`(async () => {
      try { return { ok: true, value: await (${source}) }; }
      catch (error) { return { ok: false, error: error.stack || String(error) }; }
    })()`)
    if (!result.ok) throw new Error(`${result.error}\nRenderer expression: ${source.slice(0, 180)}`)
    return result.value
  }
  const waitFor = async (expression) => {
    const deadline = Date.now() + 15_000
    while (!await run(`Boolean(${expression})`)) {
      if (Date.now() > deadline) {
        const state = await run(`({
          error:window.__uiError,
          bookmarkWidth:document.querySelector('.bookmark-menu')?.getBoundingClientRect().width,
          sidebarWidth:document.querySelector('.file-sidebar')?.getBoundingClientRect().width,
          activity:document.querySelector('.activity-status')?.textContent,
          scroll:document.querySelector('.ai-fixture .chat-list')?.scrollTop,
          focused:document.activeElement?.outerHTML.slice(0,400),
        })`)
        throw new Error(`Timed out waiting for ${expression}: ${JSON.stringify(state)}`)
      }
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  const saveScreenshot = async (name) => {
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await window.webContents.capturePage()
    await new Promise(resolve => setTimeout(resolve, 100))
    fs.writeFileSync(path.join(artifacts, name), (await window.webContents.capturePage()).toPNG())
  }
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await waitFor('window.__uiRegression && document.querySelector(".connection-row")')
  assert.equal(await run('window.__uiError || null'), null)
  assert.equal(await run('document.querySelectorAll(".group-connections").length'), 0, 'Groups start collapsed')
  for (const zoom of [0.92, 1, 1.08]) {
    window.webContents.setZoomFactor(zoom)
    await window.webContents.capturePage()
    for (const label of ['默认分组', 'Production', '生产环境 Production '.repeat(12)]) {
      const heading = await run(`(() => {
        const title=document.querySelector('.page-title');const pill=document.querySelector('.page-group-pill');
        pill.textContent=${JSON.stringify(label)};
        const marker=()=>{const el=document.createElement('span');el.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';return el};
        const a=marker(),b=marker();title.append(a);pill.append(b);
        const result={gap:Math.abs(a.getBoundingClientRect().top-b.getBoundingClientRect().top),
          overflow:pill.getBoundingClientRect().right>document.querySelector('.page-title-row').getBoundingClientRect().right+1,
          ellipsis:getComputedStyle(pill).textOverflow};
        a.remove();b.remove();return result;
      })()`)
      assert.ok(heading.gap < 1 && !heading.overflow && heading.ellipsis === 'ellipsis', `Heading label baseline at ${zoom}: ${JSON.stringify(heading)}`)
    }
  }
  window.webContents.setZoomFactor(1)
  await run('document.querySelector(".page-group-pill").textContent="默认分组"')
  assert.equal(await run('(() => {const label=document.querySelector(".group-name");return label.scrollWidth <= label.clientWidth})()'), true, 'Short default group name is fully visible')
  await run('document.querySelector(".toolbar-more-button").click()')
  await waitFor('document.querySelector(".toolbar-menu")')
  await waitFor('document.querySelector(".toolbar-menu").contains(document.activeElement)')
  assert.equal(await run('document.querySelectorAll(".toolbar-menu button").length'), 3, 'Secondary toolbar actions remain available')
  const dropdownStyle = `(() => {const style=getComputedStyle(document.querySelector('.dropdown-menu'));return {background:style.backgroundColor,border:style.border,radius:style.borderRadius,shadow:style.boxShadow,padding:style.padding}})()`
  const actionMenuStyle = await run(dropdownStyle)
  await run('(() => {const button=document.querySelector(".toolbar-menu button:not(:disabled)");button.focus();button.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))})()')
  await waitFor('!document.querySelector(".toolbar-menu")')
  await waitFor('document.activeElement === document.querySelector(".toolbar-more-button")')
  await run('document.querySelector(".search-scope .dropdown-trigger").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true}))')
  await waitFor('document.querySelector(".scope-menu")?.contains(document.activeElement)')
  assert.deepEqual(await run(dropdownStyle), actionMenuStyle, 'Scope and action menus share the same themed surface')
  await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))')
  await waitFor('!document.querySelector(".scope-menu") && document.activeElement === document.querySelector(".search-scope .dropdown-trigger")')
  const themeCases = [
    ['dark'], ['light'], ['eyecare'],
    ['custom', {fontColor:'#ead9f5', bgColor:'#291a34'}],
    ['custom', {fontColor:'#3c2449', bgColor:'#f5e9fa'}],
  ]
  for (const [theme, colors] of themeCases) {
    await run(`window.__uiRegression.setTheme(${JSON.stringify(theme)},${JSON.stringify(colors) || 'undefined'})`)
    await run('(() => {const row=document.querySelector(".connection-row");row.style.transition="none";row.classList.add("keyboard-active")})()')
    const state = await run(`(() => {
      const root=document.documentElement;
      const row=document.querySelector('.connection-row'); row.classList.add('keyboard-active');
      const chip=document.querySelector('.tag-filter-chip.active');
      const probe=document.createElement('span'); probe.style.background='var(--accent-bg)'; document.body.append(probe);
      const result={ background:getComputedStyle(row).backgroundColor, expected:getComputedStyle(probe).backgroundColor,
        tag:getComputedStyle(row).borderLeftColor, chipText:getComputedStyle(chip).color, text:getComputedStyle(root).getPropertyValue('--text-primary').trim() };
      probe.remove(); return result;
    })()`)
    assert.equal(state.background, state.expected, `${theme} selection follows its theme token`)
    assert.notEqual(state.tag, state.background, 'Connection tag remains distinct from selected background')
    assert.ok(state.chipText, 'Selected filter retains theme text')
    const actions = await run(`Array.from(document.querySelectorAll('.connection-row .secondary-action')).map(el => ({opacity:getComputedStyle(el).opacity,pointerEvents:getComputedStyle(el).pointerEvents}))`)
    assert.equal(actions.length, 3, 'Copy, edit and more actions remain discoverable')
    assert.ok(actions.every(action => action.opacity === '1' && action.pointerEvents !== 'none'), `${theme} row actions are visible and clickable without hover`)
    if (theme === 'custom') {
      await run('document.documentElement.style.setProperty("--accent", "#ae49e1")')
      await new Promise(resolve => setTimeout(resolve, 160))
      const dynamic = await run(`(() => {const row=document.querySelector('.connection-row');const probe=document.createElement('span');probe.style.background='var(--accent-bg)';document.body.append(probe);const result={row:getComputedStyle(row).backgroundColor,expected:getComputedStyle(probe).backgroundColor};probe.remove();return result})()`)
      assert.equal(dynamic.row, dynamic.expected, 'Runtime accent overrides update selected rows')
    }
  }
  await run('window.__uiRegression.setTheme("dark")')
  const resizeBefore = await run('Number(document.querySelector(".group-panel-resizer").getAttribute("aria-valuenow"))')
  await run('document.querySelector(".group-panel-resizer").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,cancelable:true}))')
  assert.equal(await run('Number(document.querySelector(".group-panel-resizer").getAttribute("aria-valuenow"))'), resizeBefore + 10, 'Sidebar width adjusts with the keyboard')
  await run('document.querySelector(".group-panel-resizer").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true,cancelable:true}))')
  const grip = await run('(() => {const r=document.querySelector(".group-panel-resizer").getBoundingClientRect();return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+40)}})()')
  window.webContents.sendInputEvent({type:'mouseMove', ...grip})
  window.webContents.sendInputEvent({type:'mouseDown', ...grip, button:'left', clickCount:1})
  window.webContents.sendInputEvent({type:'mouseMove', x:grip.x+30, y:grip.y})
  window.webContents.sendInputEvent({type:'mouseUp', x:grip.x+30, y:grip.y, button:'left', clickCount:1})
  await waitFor(`Number(document.querySelector('.group-panel-resizer').getAttribute('aria-valuenow')) === ${resizeBefore + 30}`)
  await run('document.querySelector(".group-panel-resizer").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",shiftKey:true,bubbles:true,cancelable:true}))')
  window.setSize(740, 1000)
  await window.webContents.capturePage()
  await waitFor('window.innerWidth < 800')
  assert.equal(await run('document.querySelector(".connections-page").scrollWidth <= document.querySelector(".connections-page").clientWidth + 1'), true, 'Narrow window does not overflow horizontally')
  await saveScreenshot('connections-narrow.png')
  window.setSize(1200, 1000)
  await window.webContents.capturePage()
  await waitFor('window.innerWidth > 1000')
  await saveScreenshot('connections-dark.png')
  await run('window.__uiRegression.setTheme("light")')
  await saveScreenshot('connections-light.png')
  await run('document.querySelector(".search-scope .dropdown-trigger").click()')
  await waitFor('document.querySelector(".scope-menu")?.contains(document.activeElement)')
  await saveScreenshot('scope-menu-light.png')
  await run('(() => {const button=document.querySelector(".toolbar-more-button");button.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));button.click()})()')
  await waitFor('document.querySelector(".toolbar-menu") && !document.querySelector(".scope-menu")')
  await saveScreenshot('action-menu-light.png')
  await run('document.querySelector(".toolbar-more-button").click()')
  await run('window.__uiRegression.setTheme("dark")')

  assert.equal(await run('document.querySelector(".sort-label").tabIndex'), -1, 'Sort description is not an interactive control')
  for (const label of ['最近使用', '最常使用', '手动排序']) {
    await run(`Array.from(document.querySelectorAll('.sort-option')).find(button=>button.textContent.trim()===${JSON.stringify(label)}).click()`)
    await waitFor(`document.querySelector('.sort-option[aria-pressed=true]')?.textContent.trim()===${JSON.stringify(label)}`)
    assert.equal(await run('document.querySelectorAll(".sort-option[aria-pressed=true]").length'), 1, 'Exactly one sort option is selected')
  }

  await run(`(() => {
    const input = document.querySelector('.search-input');
    input.value = 'Server'; input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  await waitFor('document.querySelectorAll(".connection-row").length === 1')
  await run('document.querySelector(".search-scope .dropdown-trigger").click()')
  await waitFor('document.querySelector(".scope-menu [aria-checked=true]")')
  assert.equal(await run('document.querySelector(".scope-menu [aria-checked=true]").dataset.value'), 'group', 'Scope menu marks the current selection')
  await waitFor('document.querySelector(".scope-menu").contains(document.activeElement)')
  await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true}))')
  assert.equal(await run('document.activeElement.dataset.value'), 'all', 'Arrow keys move through scope options')
  await run('document.activeElement.click()')
  await waitFor('document.querySelectorAll(".connection-row").length === 2')
  assert.equal(await run('document.querySelectorAll(".conn-group").length'), 2, 'Global results show their groups')

  await run(`(() => {
    const input = document.querySelector('.search-input'); input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true}));
  })()`)
  assert.deepEqual(await run('window.__uiRegression.calls.connects'), ['one'], 'Enter connects the first result')

  const dragResult = await run(`(() => {
    const row = document.querySelector('.connection-row');
    const name = row.querySelector('.conn-name');
    name.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
    const transfer = new DataTransfer();
    name.dispatchEvent(new DragEvent('dragstart', {bubbles:true,cancelable:true,dataTransfer:transfer}));
    const id = transfer.getData('application/x-lite-connect-conn');
    const target = document.querySelectorAll('.group-item')[1];
    target.dispatchEvent(new DragEvent('dragover', {bubbles:true,cancelable:true,dataTransfer:transfer}));
    target.dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:transfer}));
    row.dispatchEvent(new DragEvent('dragend', {bubbles:true,dataTransfer:transfer}));
    return id;
  })()`)
  assert.equal(dragResult, 'one', 'The card text starts a connection drag')
  await waitFor('window.__uiRegression.calls.moves.length === 1')
  assert.deepEqual(await run('window.__uiRegression.calls.moves'), ['one:prod'], 'Searching allows moves to a collapsed group')
  assert.equal(await run('window.__uiRegression.calls.reorders'), 0, 'Moving global results does not reorder connections')

  assert.equal(await run(`(() => {
    const row = document.querySelector('.connection-row');
    row.querySelector('.action-btn').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
    return row.dispatchEvent(new DragEvent('dragstart', {bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}));
  })()`), false, 'Dragging from action buttons is prevented')
  await run('document.querySelector(".group-item").click()')
  await waitFor('document.querySelector(".search-scope").dataset.value === "group"')

  await run('window.__uiRegression.openBookmarks()')
  await waitFor('document.querySelector(".bookmark-menu.ready")')
  await run('document.querySelector(".bookmark-more").click()')
  await waitFor('document.querySelector(".bookmark-row-menu")')
  await run('document.querySelector(".bookmark-row-menu .ui-menu-item").click()')
  await waitFor('document.querySelector(".bookmark-name")?.textContent.startsWith("重命名后的")')

  let layoutCases = 0
  for (const zoom of [0.92, 1, 1.08]) {
    window.webContents.setZoomFactor(zoom)
    for (const width of [220, 260, 320]) {
      await run(`window.__uiRegression.setWidth(${width})`)
      await window.webContents.capturePage()
      await waitFor(`Math.abs(document.querySelector('.bookmark-menu').getBoundingClientRect().width - ${Math.min(320, Math.max(200, width - 12))}) < 2`)
      for (const name of ['logs', '服务器日志', 'Production 生产环境', '很长的重命名书签'.repeat(15)]) {
        await run(`window.__uiRegression.setName(${JSON.stringify(name)})`)
        const rows = await run(`Array.from(document.querySelectorAll('.bookmark-row')).map(row => {
          const name = row.querySelector('.bookmark-name');
          const path = row.querySelector('.bookmark-path');
          const textRect = el => { const range=document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect(); };
          return {
            gap: Math.abs(textRect(name).bottom - textRect(path).bottom),
            pathWidth: path.getBoundingClientRect().width,
            height: row.getBoundingClientRect().height,
            overflow: row.querySelector('.bookmark-more').getBoundingClientRect().right > row.getBoundingClientRect().right + 1,
            nowrap: getComputedStyle(name).whiteSpace === 'nowrap',
          };
        })`)
        for (const row of rows) {
          assert.ok(row.gap <= 2 && row.pathWidth > 0 && row.height <= 34 && !row.overflow && row.nowrap,
            `Bookmark layout failed: ${JSON.stringify({zoom,width,name,...row})}`)
          layoutCases++
        }
      }
    }
  }
  const label = await run(`(() => {
    const box = document.querySelector('.label-fixture');
    const count = box.querySelector('.fixture-count').getBoundingClientRect();
    const text = box.querySelector('.inline-label-text');
    return {overflow:count.right > box.getBoundingClientRect().right + 1,truncated:text.scrollWidth > text.clientWidth};
  })()`)
  assert.ok(!label.overflow && label.truncated, 'Long labels truncate while counts remain visible')
  await run('window.__uiRegression.closeBookmarks()')
  for (const [phase, label] of [['requesting','正在请求模型'],['reasoning','正在接收思考'],['tool','正在执行工具'],['approval','等待你审批']]) {
    await run(`window.__uiRegression.aiPhase('${phase}')`)
    await waitFor(`document.querySelector('.activity-line')?.textContent.includes('${label}')`)
    assert.equal(await run('document.querySelector(".activity-delay") !== null'), false, 'Active stages do not show a false delay')
  }
  await run("window.__uiRegression.aiPhase('reasoning', 31000)")
  await waitFor('document.querySelector(".activity-line")?.textContent.includes("等待模型") && document.querySelector(".activity-delay")')
  assert.equal(await run('document.querySelector(".reasoning-title")?.textContent.trim()'), '深度思考', 'Stale reasoning is no longer labelled as live')
  await run('window.__uiRegression.finishAi()')
  await waitFor('!document.querySelector(".activity-status")')
  await run('window.__uiRegression.longAiReply()')
  await waitFor(`(() => {const list=document.querySelector('.ai-fixture .chat-list');return list.scrollHeight > list.clientHeight && list.scrollHeight-list.scrollTop-list.clientHeight < 2})()`)
  await run('window.__uiRegression.delayAiReply()')
  await waitFor(`(() => {const list=document.querySelector('.ai-fixture .chat-list');return !!list.querySelector('.activity-delay') && list.scrollHeight-list.scrollTop-list.clientHeight < 2})()`)
  await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
  await run(`(() => {const list=document.querySelector('.ai-fixture .chat-list');list.scrollTop=0;list.dispatchEvent(new Event('scroll'))})()`)
  await run('window.__uiRegression.resumeAiReply()')
  await waitFor('document.querySelector(".activity-line")?.textContent.includes("正在请求模型")')
  assert.equal(await run('document.querySelector(".ai-fixture .chat-list").scrollTop'), 0, 'Activity changes respect manual scrollback')
  await run('window.__uiRegression.finishAi()')

  await run('window.__uiRegression.openEditor()')
  await waitFor('document.querySelector(".editor-textarea")?.value === "original content"')
  await run(`(() => {
    const area = document.querySelector('.editor-textarea'); area.value = 'local draft'; area.dispatchEvent(new Event('input',{bubbles:true}));
    window.__uiRegression.changeRemote();
  })()`)
  await waitFor('!document.querySelector(".editor-header .editor-save-btn").disabled')
  await run('document.querySelector(".editor-header .editor-save-btn").click()')
  await waitFor('document.querySelector(".editor-error[role=alert]")')
  await saveScreenshot('editor-conflict.png')
  assert.equal(await run('document.querySelector(".editor-textarea").value'), 'local draft', 'Remote changes preserve the local draft')
  assert.equal(await run('window.__uiRegression.calls.editorSaves.length'), 1, 'Conflicting saves do not retry automatically')
  await run(`(() => {
    const backup = document.querySelector('.editor-footer input'); backup.click();
    document.querySelector('.editor-error[role=alert] .editor-save-btn').click();
  })()`)
  await waitFor('document.querySelector(".app-dialog-overlay")')
  assert.equal(await run('window.__uiRegression.calls.editorSaves.length'), 1, 'Overwrite waits for explicit confirmation')
  await run(`Array.from(document.querySelectorAll('.app-dialog button')).find(button => button.textContent.includes('覆盖')).click()`)
  await waitFor('window.__uiRegression.calls.editorSaves.length === 2 && !document.querySelector(".editor-error[role=alert]")')
  assert.equal(await run('window.__uiRegression.calls.editorSaves[1].options.backup'), true, 'Optional backup is requested on the confirmed overwrite')
  await run('document.querySelector(".editor-actions .ui-icon-btn-close").click()')
  await waitFor('!document.querySelector(".editor-overlay")')

  await run('window.__uiRegression.openSync()')
  await waitFor('document.querySelectorAll(".sync-row").length === 4')
  await saveScreenshot('directory-preview.png')
  assert.deepEqual(await run('Array.from(document.querySelectorAll(".sync-row input")).map(input => ({checked:input.checked,disabled:input.disabled}))'),
    [{checked:true,disabled:false},{checked:false,disabled:true},{checked:false,disabled:true},{checked:false,disabled:true}], 'Only new files are selected; changes and blocked entries are protected')
  await run(`(() => {
    window.__uiRegression.failPreview();
    document.querySelector('.sync-modal footer button').click();
  })()`)
  await waitFor('document.querySelector(".sync-modal [role=alert]")')
  assert.equal(await run('Array.from(document.querySelectorAll(".sync-modal footer button")).find(button=>button.textContent.includes("上传")).disabled'), true, 'A failed refresh invalidates the previous upload selection')
  assert.equal(await run('window.__uiRegression.calls.uploads.length'), 0)
  await run(`(() => {
    window.__uiRegression.restorePreview();
    document.querySelector('.sync-modal footer button').click();
  })()`)
  await waitFor('document.querySelectorAll(".sync-row").length === 4')
  await run(`Array.from(document.querySelectorAll('.sync-modal footer button')).find(button => button.textContent.includes('上传')).click()`)
  await waitFor('window.__uiRegression.calls.uploads.length === 1')
  assert.equal(await run('window.__uiRegression.calls.uploads[0][3]'), 'new.txt', 'Sync only queues the explicitly selected new file')
  assert.equal(await run('window.__uiRegression.calls.uploads[0][5].conflict'), 'skip', 'Default sync never overwrites a newly conflicting target')
  assert.equal(await run('window.__uiError || null'), null)
  window.webContents.setZoomFactor(1)
  await run('window.__uiRegression.setWidth(320)')
  await saveScreenshot('ui-regression.png')
  console.log(JSON.stringify({passed:true,layoutCases,themeCases:themeCases.length,flows:['collapsed groups','toolbar menu and Escape','sidebar pointer and keyboard resize','narrow window layout','theme selection and color tags','global search','keyboard connection','whole-card drag','button protection','bookmark rename','AI stages and stalled output','SFTP conflict and confirmed backup','directory upload selection'],artifacts}))
  clearTimeout(watchdog)
  window.destroy()
  app.quit()
}).catch(error => {
  console.error(error)
  clearTimeout(watchdog)
  app.exit(1)
})
