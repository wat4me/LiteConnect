const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const artifacts = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'liteconnect-tabs-ui-'))
app.setPath('userData', path.join(artifacts, 'profile'))
let stage = 'starting', window
const timeout = setTimeout(() => { console.error('Tabs UI timed out', { stage, artifacts }); app.exit(1) }, 120000)

const measureStrip = (selector) => `(() => {
  const wrapper = document.querySelector('${selector}')
  const strip = wrapper?.querySelector('.tabs-scroll')
  const active = strip?.querySelector('[data-active-tab="true"]')
  if (!strip || !active) return null
  const c = strip.getBoundingClientRect(), t = active.getBoundingClientRect()
  const curve = parseFloat(getComputedStyle(active).getPropertyValue('--window-tab-curve'))
  return {
    scrollLeft: strip.scrollLeft,
    maxScroll: strip.scrollWidth - strip.clientWidth,
    fits: t.left - curve >= c.left - 1 && t.right + curve <= c.right + 1,
    activeText: active.querySelector('.tab-name, .sub-tab-label')?.textContent,
    arrows: [...wrapper.querySelectorAll('.tabs-overflow-btn:not(:disabled)')].map(button => button.dataset.tabsScroll),
  }
})()`

const measure = measureStrip('.tabs-wrap')
const measureSubTabs = measureStrip('.sub-tabs-wrap')
const fitsExpression = `(${measure})?.fits === true`

app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 1100, height: 700, webPreferences: { backgroundThrottling: false, offscreen: true } })
  const run = async source => {
    const raw = await window.webContents.executeJavaScript(`(async()=>{try{return JSON.stringify({ok:true,value:await (${source})})}catch(error){return JSON.stringify({ok:false,error:error.stack||String(error)})}})()`)
    const result = JSON.parse(raw)
    if (!result.ok) throw new Error(`${result.error}\nExpression: ${source.slice(0, 300)}`)
    return result.value
  }
  const wait = async expression => {
    const deadline = Date.now() + 10000
    while (!await run(expression)) {
      if (Date.now() > deadline) throw new Error(`Timeout ${expression}: ${await run('JSON.stringify({error:window.__tabsError,state:window.__tabs?.state()})')}`)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  const tick = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')

  stage = 'loading tab bar with 14 hosts'
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await wait(`document.querySelectorAll('.tabs-scroll .tab').length === 14`)
  await tick()
  assert.equal(await run('window.__tabsError || null'), null)

  stage = 'active last host is revealed on first render'
  let state = await run(measure)
  assert.ok(state && state.maxScroll > 0, `Strip must overflow: ${JSON.stringify(state)}`)
  assert.ok(state.scrollLeft > 0, `Active host must be scrolled into view: ${JSON.stringify(state)}`)
  assert.ok(state.fits, `Active host must be fully visible: ${JSON.stringify(state)}`)
  assert.deepEqual(state.activeText, '10.2.5.83')
  assert.ok(state.arrows.includes('left') && !state.arrows.includes('right'), `Only the left arrow should show: ${JSON.stringify(state.arrows)}`)

  stage = 'left arrow scrolls back'
  const beforeArrow = state.scrollLeft
  await run(`document.querySelector('.tabs-wrap [data-tabs-scroll="left"]').click()`)
  await tick()
  state = await run(measure)
  assert.ok(state.scrollLeft < beforeArrow, `Left arrow must scroll left: ${JSON.stringify(state)}`)
  assert.ok(state.arrows.includes('right'), `Right arrow should appear after scrolling back: ${JSON.stringify(state.arrows)}`)

  stage = 'switching to the first host reveals it'
  await run(`window.__tabs.setActive('host-0')`)
  await wait(`document.querySelector('.tabs-scroll [data-active-tab="true"] .tab-name')?.textContent === '10.2.5.70'`)
  await wait(fitsExpression)
  state = await run(measure)
  assert.ok(state.fits && state.scrollLeft <= 1, `First host must be visible at the start: ${JSON.stringify(state)}`)

  stage = 'switching back to the last host reveals it again'
  await run(`window.__tabs.setActive('host-13')`)
  await wait(`document.querySelector('.tabs-scroll [data-active-tab="true"] .tab-name')?.textContent === '10.2.5.83'`)
  await wait(fitsExpression)
  state = await run(measure)
  assert.ok(state.fits && state.scrollLeft > 0, `Last host must be visible at the end: ${JSON.stringify(state)}`)

  stage = 'wheel scrolls the strip horizontally'
  const beforeWheel = state.scrollLeft
  await run(`document.querySelector('.tabs-scroll').dispatchEvent(new WheelEvent('wheel',{deltaY:-160,bubbles:true,cancelable:true}))`)
  await tick()
  assert.ok((await run(measure)).scrollLeft < beforeWheel, 'Mouse wheel must scroll the strip')

  stage = 'window resize keeps the active host visible'
  await run(`window.__tabs.setActive('host-0')`)
  await wait(fitsExpression)
  await run(`window.__tabs.setActive('host-13')`)
  await wait(fitsExpression)
  window.setSize(620, 700)
  await wait('innerWidth < 700')
  await wait(fitsExpression)
  state = await run(measure)
  assert.ok(state.fits, `Active host must stay visible after resize: ${JSON.stringify(state)}`)

  stage = 'connecting a new host after the strip is already full'
  const newHostSession = await run(`window.__tabs.connect('host-14')`)
  assert.equal(newHostSession, 'host-14-new-1')
  await wait(`window.__tabs.state().session === 'host-14-new-1' && (${measure})?.activeText === '10.2.5.84' && ${fitsExpression}`)
  await wait(`[...document.querySelectorAll('.terminal-pane:not(.is-hidden-session) .xterm')].some(el => el.getBoundingClientRect().width > 0)`)
  await wait(`document.querySelectorAll('.sub-tabs-wrap .sub-tab').length === 1 && !!document.querySelector('.sub-tabs-wrap + .sub-tab-add')`)
  const hostWidth = () => run(`document.querySelector('[data-host-drop-id=host-14]').getBoundingClientRect().width`)
  const singleHostWidth = await hostWidth()

  stage = 'adding a terminal on a host with many existing sessions'
  await run(`window.__tabs.setActive('host-13')`)
  await wait(`document.querySelectorAll('.sub-tabs-wrap .sub-tab').length === 14`)
  assert.equal(await hostWidth(), singleHostWidth, 'Switching an active single-terminal host keeps its tab width stable')
  assert.ok((await run(measureSubTabs)).maxScroll > 0)
  await run(`document.querySelector('.sub-tab-add').click()`)
  await wait(`window.__tabs.state().session === 'host-13-new-2' && document.querySelectorAll('.sub-tabs-wrap .sub-tab').length === 15 && (${measureSubTabs})?.fits`)
  const subTabsEnd = await run(measureSubTabs)
  assert.ok(subTabsEnd.scrollLeft > 0)
  await run(`document.querySelector('.sub-tabs-wrap [data-tabs-scroll="left"]').click()`)
  await tick()
  const subTabsAfterArrow = await run(measureSubTabs)
  assert.ok(subTabsAfterArrow.scrollLeft < subTabsEnd.scrollLeft, JSON.stringify({ subTabsEnd, subTabsAfterArrow }))
  const beforeTrackpad = (await run(measureSubTabs)).scrollLeft
  await run(`document.querySelector('.sub-tabs-wrap .tabs-scroll').dispatchEvent(new WheelEvent('wheel', {deltaX: 160, bubbles: true, cancelable: true}))`)
  await tick()
  assert.ok((await run(measureSubTabs)).scrollLeft > beforeTrackpad)
  await run(`document.querySelector('.sub-tabs-wrap [data-tabs-scroll="right"]').click()`)
  await tick()
  assert.ok((await run(measureSubTabs)).fits)
  assert.equal(await run('window.__tabsError || null'), null)

  stage = 'selected tabs curve into the bottom of their strip'
  await run('window.__tabs.showAiTab()')
  const readTab = selector => run(`(() => {
    const tab = document.querySelector(${JSON.stringify(selector)})
    const style = getComputedStyle(tab)
    return {
      surface: style.backgroundColor,
      corners: ['::before', '::after'].map(side => getComputedStyle(tab, side).backgroundImage),
      topRadius: parseFloat(style.borderTopLeftRadius),
      bottomRadius: parseFloat(style.borderBottomLeftRadius),
      bottomEdge: style.borderBottomColor,
      bottomGap: tab.closest('.tab-bar, .sub-tab-bar').getBoundingClientRect().bottom - tab.getBoundingClientRect().bottom,
    }
  })()`)
  const assertConnectedTab = tab => {
    assert.ok(tab.corners.every(corner => corner.startsWith('radial-gradient(')), JSON.stringify(tab))
    assert.equal(tab.bottomEdge, 'rgba(0, 0, 0, 0)')
    assert.ok(tab.topRadius > 0 && tab.bottomRadius === 0 && Math.abs(tab.bottomGap) <= 1, JSON.stringify(tab))
  }
  for (const theme of ['dark', 'nord', 'catppuccin-mocha', 'light', 'eyecare', 'solarized-light']) {
    await run(`window.__tabs.setTheme('${theme}')`)
    await tick()
    const ssh = await readTab('.tabs-wrap .tab[data-active-tab="true"]')
    const terminal = await readTab('.sub-tabs-wrap .sub-tab[data-active-tab="true"]')
    const idle = await readTab('.tabs-wrap .ai-workspace-tab')
    assertConnectedTab(ssh)
    assertConnectedTab(terminal)
    assert.notEqual(ssh.surface, idle.surface)
    assert.deepEqual(idle.corners, ['none', 'none'])
  }
  await run(`window.__tabs.setTheme('nord')`)
  const captureTabs = async name => {
    await run('new Promise(resolve => setTimeout(resolve, 350))')
    window.webContents.invalidate()
    await tick()
    const width = await run('innerWidth')
    const screenshot = await window.webContents.capturePage({ x: 0, y: 0, width, height: 68 })
    fs.writeFileSync(path.join(artifacts, name), screenshot.toPNG())
  }
  await captureTabs('nord-terminal-tabs.png')
  await run(`window.__tabs.setTheme('eyecare')`)
  await captureTabs('eyecare-terminal-tabs.png')
  await run(`window.__tabs.setActive('host-0')`)
  await wait(fitsExpression)
  assert.ok(await run(`!!document.querySelector('[data-host-drop-id=host-0] > .tab-name ~ .tab-latency + .tab-close')`))
  const actionCenterOffset = (add, close) => run(`(() => {
    const centerY = selector => {
      const { top, height } = document.querySelector(selector).getBoundingClientRect()
      return top + height / 2
    }
    return Math.abs(centerY('${add}') - centerY('${close}'))
  })()`)
  assert.ok(await actionCenterOffset('.tab-add-btn', '[data-host-drop-id=host-0] .tab-close') <= 1)
  assert.ok(await actionCenterOffset('.sub-tab-add', '.sub-tab[data-active-tab=true] .sub-tab-close') <= 1)
  await captureTabs('eyecare-ssh-tab-actions.png')
  await run(`window.__tabs.setTheme('nord')`)
  await run(`document.querySelector('.ai-workspace-tab-select').click()`)
  await wait(`document.querySelector('.ai-workspace-tab[data-active-tab="true"]') && ${fitsExpression}`)
  assert.equal(await run(`document.querySelectorAll('.tabs-wrap [data-active-tab="true"]').length`), 1)
  const ai = await readTab('.tabs-wrap .ai-workspace-tab')
  assertConnectedTab(ai)
  await captureTabs('nord-ai-tab.png')

  stage = 'using the same plus button for single and multiple terminals'
  await run(`window.__tabs.setActive('host-14')`)
  await wait(`document.querySelectorAll('.sub-tabs-wrap .sub-tab').length === 1`)
  await run(`document.querySelector('.sub-tabs-wrap + .sub-tab-add').click()`)
  await wait(`window.__tabs.state().session === 'host-14-new-3' && document.querySelectorAll('.sub-tabs-wrap .sub-tab').length === 2`)
  assert.ok(await run(`!!document.querySelector('.sub-tabs-wrap + .sub-tab-add')`))

  stage = 'opening quick connect from the same slot with and without host tabs'
  const quickConnect = '.tabs-wrap + .quick-connect-wrapper [data-onboarding=quick-connect]'
  for (const withHosts of [true, false]) {
    if (!withHosts) await run('window.__tabs.clearHosts()')
    assert.equal(await run(`!!document.querySelector('[data-host-drop-id]')`), withHosts)
    assert.equal(await run(`document.querySelectorAll('[data-onboarding=quick-connect]').length`), 1)
    await run(`document.querySelector('${quickConnect}').click()`)
    await wait(`document.activeElement?.matches('.quick-connect-search-input')`)
    await run(`document.querySelector('${quickConnect}').click()`)
    await wait(`!document.querySelector('.quick-connect-dropdown')`)
  }

  console.log(JSON.stringify({ passed: true, flows: ['overflow and resize', 'new connection shows its tab and terminal', 'single and multiple terminal actions', 'quick connect with and without host tabs', 'arrows and wheel on both tab strips', 'active AI, SSH and terminal tabs meet the strip edge'], artifacts }))
  clearTimeout(timeout)
  app.quit()
}).catch(error => {
  console.error('Tabs UI failed', { stage, error: error.stack || String(error) })
  app.exit(1)
})
