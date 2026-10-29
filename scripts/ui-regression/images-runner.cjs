const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const artifacts = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'liteconnect-images-ui-'))
app.setPath('userData', path.join(artifacts, 'profile'))
let window, stage = 'loading'
const timeout = setTimeout(() => { console.error('Image UI timed out', { stage, artifacts }); app.exit(1) }, 240_000)
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { contextIsolation: true, backgroundThrottling: false } })
  const run = source => window.webContents.executeJavaScript(source)
  const wait = async expression => {
    const deadline = Date.now() + 15000
    while (!await run(expression)) {
      if (Date.now() > deadline) throw new Error(`Timeout: ${expression}`)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const addImage = (mode = 'paste') => run(`(async () => {
    const canvas=document.createElement('canvas'); canvas.width=160; canvas.height=90;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#174e7b'; ctx.fillRect(0,0,160,90);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const transfer=new DataTransfer(); transfer.items.add(new File([blob],'screenshot.png',{type:'image/png'}));
    if (${JSON.stringify(mode)}==='paste') document.querySelector('.composer-input').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
    else document.querySelector('.ai-image-composer-fixture .ai-sidebar').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
  })()`)
  await window.loadURL(process.env.LITECONNECT_UI_TEST_URL)
  await wait('!!window.__uiRegression')
  await run(`window.LiteConnect.aiKnowledge=async()=>({storagePath:'/fixture/knowledge.sqlite',targets:[{connectionId:'fixture',binding:'fixture',host:'fixture.test',port:22,username:'root',name:'Fixture',enabled:false,count:12}]}); window.__uiRegression.openImageComposer()`)
  await wait('window.__uiRegression.calls.aiCreates.length===1 && !!document.querySelector(".composer-input")')
  await run('window.__uiRegression.setVisionEnabled(true)')
  let layouts = 0
  for (const workspace of [false, true]) for (const theme of ['light', 'dark', 'eyecare']) for (const width of [300, 440]) {
    stage = `checking ${workspace}/${theme}/${width}`
    await run(`(async()=>{await window.__uiRegression.setContextLayout(${workspace});await window.__uiRegression.setTheme('${theme}');document.querySelector('.ai-image-composer-fixture').style.width='${width}px';})()`)
    assert.equal(await run('!!document.querySelector(".composer-add-image, .composer input[type=file], .composer-images")'), false, 'No image button, picker or empty attachment area')
    await addImage()
    await wait('document.querySelectorAll(".composer-images .ai-image-thumbnail").length===1')
    assert.ok(await run(`(() => { const form=document.querySelector('.composer'), strip=form.querySelector('.composer-images'); return !form.querySelector('.send-btn').disabled && strip.scrollWidth<=strip.clientWidth+1 && form.querySelector('.composer-context-strip').scrollWidth<=form.querySelector('.composer-context-strip').clientWidth+1; })()`), 'Image-only drafts can send and fit the composer')
    await click('.composer-images .ai-image-thumbnail')
    await wait('document.querySelector(".ai-image-dialog[open] img")?.naturalWidth===160')
    await click('.ai-image-dialog[open] .ui-icon-btn')
    await click('.composer-images .ai-image-remove')
    await wait('!document.querySelector(".composer-images")')
    layouts++
  }
  stage = 'checking unsupported model and drop/send'
  await run('window.__uiRegression.setVisionEnabled(false)')
  await addImage()
  await wait(`Array.from(document.querySelectorAll('.el-message')).some(el=>el.textContent.includes('图片支持'))`)
  assert.equal(await run('!!document.querySelector(".composer-images")'), false, 'Unsupported image paste only warns')
  assert.equal(await run('window.__uiRegression.calls.aiRequests.length'), 0, 'Unsupported paste never sends a model request')
  await run('window.__uiRegression.setVisionEnabled(true)')
  await addImage('drop')
  await wait('document.querySelectorAll(".composer-images .ai-image-thumbnail").length===1')
  await run(`(async()=>{await window.__uiRegression.setTheme('light');document.querySelector('.ai-image-composer-fixture').scrollIntoView();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`)
  const bounds = await run(`(() => { const r=document.querySelector('.composer').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)} })()`)
  fs.writeFileSync(path.join(artifacts,'composer-image.png'),(await window.webContents.capturePage(bounds)).toPNG())
  await click('.composer .send-btn')
  await wait('window.__uiRegression.calls.aiRequests.length===1 && !document.querySelector(".composer-images")')
  assert.equal(await run('window.__uiRegression.calls.aiRequests[0].at(-1).images.length'), 1, 'The accepted image is included in the request')
  await wait('!!document.querySelector(".chat-row .ai-image-thumbnail")')
  console.log(JSON.stringify({ passed: true, layouts, flows: ['no image button/picker', 'paste', 'preview/remove', 'hide empty attachments', 'unsupported warning', 'drop', 'image-only send and history'], artifacts }))
  clearTimeout(timeout); window.destroy(); app.quit()
}).catch(error => { console.error(error, { stage, artifacts }); clearTimeout(timeout); window?.destroy(); app.exit(1) })
