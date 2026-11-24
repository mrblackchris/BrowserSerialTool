/* Optional development checks: npm ci && npx playwright install chromium && npm run test:browser */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {createServer} = require('node:http');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
(async () => {
  const html = readFileSync(resolve(__dirname, '../index.html'));
  const server = createServer((_, res) => {res.setHeader('Content-Type','text/html');res.end(html);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try {
    browser = await chromium.launch({headless:true, ...(process.env.BST_CHROME ? {executablePath:process.env.BST_CHROME} : {}),args:['--no-sandbox']});
    const page = await browser.newPage({viewport:{width:1440,height:1100}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.sent=[];window.recorded=[];window.fileClosed=0;window.fileAborted=0;window.failWrite=false;window.failClose=false;window.cancelPicker=false;
      let controller;
      const port={getInfo:()=>({usbVendorId:0x1234,usbProductId:0x5678}),async open(options){window.openOptions=options;this.readable=new ReadableStream({start(c){controller=c;}});this.writable=new WritableStream({write(bytes){window.sent.push([...bytes]);}});},async close(){},async setSignals(){},async getSignals(){return {};}};
      window.receiveText=text=>controller.enqueue(new TextEncoder().encode(text));
      const serial=new EventTarget();serial.getPorts=async()=>[port];serial.requestPort=async()=>port;
      Object.defineProperty(navigator,'serial',{value:serial,configurable:true});
      window.showSaveFilePicker=async()=>{if(window.cancelPicker)throw new DOMException('Cancelled','AbortError');return {name:'capture.csv',async createWritable(){return {async write(bytes){if(window.failWrite)throw new Error('Disk full');window.recorded.push(new TextDecoder().decode(bytes));},async close(){if(window.failClose)throw new Error('Cannot finalize');window.fileClosed++;},async abort(){window.fileAborted++;}};}};};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#profileDetails summary').click();
    await page.fill('#baud','19200');await page.selectOption('#bits','7');await page.selectOption('#stop','2');await page.selectOption('#parity','even');await page.selectOption('#ending','\\r\\n');
    await page.fill('#profileName','Instrument');await page.click('#saveProfile');
    await page.locator('.shortcuts summary').click();await page.fill('#command','READ?');await page.fill('#shortcutName','Read measurement');await page.click('#saveShortcut');
    await page.selectOption('#sendMode','hex');await page.fill('#command','00 FF A1');await page.fill('#shortcutName','Binary query');await page.click('#saveShortcut');
    await page.reload();await page.locator('#profileDetails summary').click();await page.selectOption('#profiles','0');await page.click('#loadProfile');
    assert.equal(await page.inputValue('#baud'),'19200');assert.equal(await page.inputValue('#bits'),'7');assert.equal(await page.inputValue('#parity'),'even');assert.equal(await page.inputValue('#ending'),'\\r\\n');
    await page.locator('.shortcuts summary').click();assert.equal(await page.locator('.shortcut-send').count(),2);assert.equal(await page.locator('.shortcut-send').first().isDisabled(),true);
    await page.click('#connect');assert.equal(await page.locator('#profileName').isDisabled(),true);
    await page.getByRole('button',{name:'Send Read measurement',exact:true}).click();await page.getByRole('button',{name:'Send Binary query',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.sent),[[82,69,65,68,63,13,10],[0,255,161]]);
    await page.evaluate(()=>window.receiveText('ok\nERROR <script>alert(1)</script>\n'));
    await page.fill('#search','error');await page.check('#filterOnly');await page.waitForTimeout(100);
    assert.equal(await page.locator('.entry').count(),1);assert.equal(await page.locator('mark').textContent(),'ERROR');assert.equal(await page.locator('#terminal script').count(),0);
    await page.selectOption('#direction','TX');await page.waitForTimeout(50);assert.equal(await page.locator('.entry').count(),0);
    await page.selectOption('#direction','all');await page.uncheck('#filterOnly');await page.fill('#search','');
    // Recording starts fresh, remains independent of display filters and buffer eviction.
    await page.click('#startRecording');await page.waitForFunction(()=>window.recorded.length===1);
    await page.fill('#search','absent');await page.check('#filterOnly');await page.click('#pause');
    await page.evaluate(()=>{for(let i=0;i<5100;i++)window.receiveText(`${i},2,3\n`);});
    await page.waitForFunction(()=>window.recorded.length===10201);
    await page.click('#clear');await page.evaluate(()=>window.receiveText('AFTER CLEAR\n'));
    await page.waitForFunction(()=>window.recorded.length===10203);
    await page.click('#stopRecording');await page.waitForFunction(()=>window.fileClosed===1);
    const recorded=await page.evaluate(()=>window.recorded.join(''));
    assert.ok(recorded.includes('"0,2,3"'));assert.ok(recorded.includes('"5099,2,3"'));assert.ok(recorded.includes('AFTER CLEAR'));assert.ok(!recorded.includes('ERROR <script>'));
    // Both write failures and finalization failures must surface and release the recording state.
    await page.evaluate(()=>{window.failWrite=true;});await page.click('#startRecording');
    await page.waitForFunction(()=>window.fileAborted===1);assert.ok((await page.textContent('#recordInfo')).includes('Recording failed'));assert.equal(await page.locator('#stopRecording').isDisabled(),true);
    await page.evaluate(()=>{window.failWrite=false;window.failClose=true;});await page.click('#startRecording');await page.waitForFunction(()=>document.getElementById('recordBadge').textContent==='Recording');await page.click('#stopRecording');await page.waitForFunction(()=>window.fileAborted===2);
    assert.ok((await page.textContent('#recordInfo')).includes('Cannot finalize'));
    await page.evaluate(()=>{window.failClose=false;window.cancelPicker=true;});await page.click('#startRecording');assert.equal(await page.locator('#stopRecording').isDisabled(),true);
    await page.click('#disconnect');await page.click('#pause');await page.uncheck('#filterOnly');await page.fill('#search','');
    await page.click('#demo');await page.waitForTimeout(300);await page.click('#plotTab');await page.waitForTimeout(100);assert.ok((await page.textContent('#legend')).includes('CH 3'));
    const downloading=page.waitForEvent('download');await page.click('#exportCSV');assert.ok((await downloading).suggestedFilename().endsWith('.csv'));
    await page.click('#disconnect');await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    const restricted = await browser.newPage();
    await restricted.addInitScript(()=>{
      Object.defineProperty(window,'showSaveFilePicker',{value:undefined});
      Storage.prototype.setItem=()=>{throw new DOMException('Storage blocked','SecurityError');};
    });
    await restricted.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await restricted.locator('#startRecording').isDisabled(),true);
    await restricted.locator('#profileDetails summary').click();await restricted.fill('#profileName','Blocked');await restricted.click('#saveProfile');
    assert.ok((await restricted.textContent('#status')).includes('Storage blocked'));
    assert.equal(await restricted.locator('#profiles option').count(),1);await restricted.close();
    console.log('Browser checks passed: saved profiles/shortcuts, exact text/hex writes, safe search highlighting, filters, >10,000 recorded entries, clear/pause independence, disk errors, cancellation, demo/plot/download, and 390px layout.');
  } finally {await browser?.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
