const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'liteconnect-questions-ui-'))
app.setPath('userData', path.join(artifacts, 'profile'))
let window
const timeout = setTimeout(() => { console.error('Question UI timed out', { artifacts }); app.exit(1) }, 120_000)
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { nodeIntegration: false, contextIsolation: true } })
  const run = script => window.webContents.executeJavaScript(script)
  const wait = async expression => {
    const start = Date.now()
    while (!await run(expression)) {
      if (Date.now() - start > 10_000) throw new Error(`Timeout: ${expression}`)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  const fixtureUrl = new URL(process.env.LITECONNECT_UI_TEST_URL)
  fixtureUrl.searchParams.set('questions', '1')
  await window.loadURL(fixtureUrl.href)
  await wait('!!window.__uiRegression && !!document.querySelector(".ai-question-card")')
  for (const theme of ['light', 'dark', 'eyecare']) {
    await run(`window.__uiRegression.setTheme('${theme}')`)
    for (const width of [300, 440]) {
      await run(`window.__uiRegression.resetQuestion(false); document.querySelector('.ai-question-fixture').style.width='${width}px'; document.querySelector('.ai-question-fixture').scrollIntoView({block:'start'})`)
      await wait(`document.querySelector('.ai-question-card button[type="submit"]').disabled`)
      assert.equal(await run(`document.querySelectorAll('.ai-question-card input:checked').length`), 0, 'No option is selected for the user')
      assert.ok(await run(`(() => {const card=document.querySelector('.ai-question-card');return card.scrollWidth<=card.clientWidth+1&&[...card.querySelectorAll('label,textarea,button')].every(node=>node.getBoundingClientRect().right<=card.getBoundingClientRect().right+1)})()`), `${theme}/${width}: question content fits`)
      await run(`document.querySelectorAll('.ai-question-card input')[1].click()`)
      await wait(`!document.querySelector('.ai-question-card button[type="submit"]').disabled`)
      assert.equal(await run(`document.querySelectorAll('.ai-question-card input:checked').length`), 1, 'Single-choice remains exclusive')
      await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
      const rect = await run(`(() => {const r=document.querySelector('.ai-question-fixture').getBoundingClientRect();return {x:Math.max(0,Math.floor(r.x)),y:Math.max(0,Math.floor(r.y)),width:Math.floor(r.width),height:Math.floor(r.height)}})()`)
      fs.writeFileSync(path.join(artifacts, `question-${theme}-${width}.png`), (await window.webContents.capturePage(rect)).toPNG())
    }
  }
  await run(`window.__uiRegression.resetQuestion(true); document.querySelector('.ai-question-fixture').style.width='300px'`)
  await wait(`document.querySelectorAll('.ai-question-card fieldset').length===3`)
  await run(`(() => {const card=document.querySelector('.ai-question-card'); card.querySelectorAll('fieldset')[0].querySelectorAll('input')[1].click();card.querySelectorAll('fieldset')[1].querySelectorAll('input')[0].click();card.querySelectorAll('fieldset')[1].querySelectorAll('input')[1].click();const text=card.querySelectorAll('textarea')[2];text.value='重点关注昨晚的异常';text.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await wait(`!document.querySelector('.ai-question-card button[type="submit"]').disabled`)
  await run(`document.querySelector('.ai-question-card button[type="submit"]').click()`)
  await wait(`window.__uiRegression.getQuestionAnswers().length===1`)
  assert.deepEqual(await run('window.__uiRegression.getQuestionAnswers()[0]'), { cancelled: false, answers: [
    { id: 'scope', selected: ['生产环境 Production'], text: '' }, { id: 'checks', selected: ['服务状态', '日志异常'], text: '' }, { id: 'note', selected: [], text: '重点关注昨晚的异常' },
  ] }, 'Choice, multiple choice and free text are submitted together')
  await run('window.__uiRegression.resetQuestion(false, true)')
  await wait(`document.querySelectorAll('.ai-question-card fieldset').length===1`)
  await run(`(() => {const text=document.querySelector('.ai-question-card textarea');text.value='自己的方案';text.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await wait(`!document.querySelector('.ai-question-card button[type="submit"]').disabled`)
  await run(`document.querySelector('.ai-question-card button[type="submit"]').click()`)
  await wait(`document.querySelector('.ai-question-error')?.textContent.includes('提交未成功')`)
  assert.equal(await run(`document.querySelector('.ai-question-card textarea').value`), '自己的方案', 'A failed submission preserves the answer')
  await run('window.__uiRegression.resetQuestion(false)')
  await run(`new Promise(resolve=>requestAnimationFrame(resolve))`)
  await run(`document.querySelector('.ai-question-actions button[type="button"]').click()`)
  await wait(`window.__uiRegression.getQuestionAnswers().length===1`)
  assert.deepEqual(await run('window.__uiRegression.getQuestionAnswers()[0]'), { cancelled: true, answers: [] }, 'Skip supplies no fabricated answer')
  console.log(JSON.stringify({ passed: true, layoutCases: 6, flows: ['single choice', 'multiple choice', 'free text', 'skip', 'failed-submit retention'], artifacts }))
  clearTimeout(timeout)
  window.destroy()
  app.quit()
}).catch(error => { console.error(error, { artifacts }); clearTimeout(timeout); if (window) window.destroy(); app.exit(1) })
