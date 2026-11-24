const {test} = require('node:test');
const assert = require('node:assert/strict');
const {hexBytes,numbers,Lines,SerialConnection} = require('../src/core.js');
test('hex sending validates complete bytes without silently dropping invalid input',()=>{
  assert.deepEqual([...hexBytes('00 ff\nA1')],[0,255,161]);
  for(const invalid of ['','a','0xFF','GG','12 zz']) assert.throws(()=>hexBytes(invalid));
});
test('plot accepts numeric telemetry but rejects partial numbers and non-finite values',()=>{
  assert.deepEqual(numbers('1, -2.5; 3e2'),[1,-2.5,300]);
  for(const invalid of ['', 'temp:12', '1x,2','NaN','1e999',Array(10).fill('1').join(',')]) assert.equal(numbers(invalid),null);
});
test('line parser preserves fragmented CRLF and bounds unterminated input',()=>{
  const output=[];const lines=new Lines(x=>output.push(x),8);
  lines.push('one\r'); lines.push('\ntwo\nthree\rfour'); lines.flush();
  assert.deepEqual(output,['one','two','three','four']);
  lines.push('123456789');assert.equal(lines.pending,'9');assert.equal(output.at(-1),'12345678');
});
function fakePort(){let controller; const sent=[];return {sent, readable:new ReadableStream({start(c){controller=c;}}),writable:new WritableStream({write(b){sent.push([...b]);}}),async open(options){this.options=options;},async close(){this.closed=true;},push(bytes){controller.enqueue(Uint8Array.from(bytes));},end(){controller.close();}};}
test('serial reads fragmented UTF-8, sends bytes and releases locks on manual close',async()=>{
  const port=fakePort(),decoder=new TextDecoder();let text='';
  const serial=new SerialConnection(b=>text+=decoder.decode(b,{stream:true}),()=>assert.fail('Manual close must not report unexpected disconnect'));
  await serial.open(port,{baudRate:115200});port.push([0xe2,0x82]);port.push([0xac,10]);
  await serial.send(Uint8Array.of(1,2));await new Promise(r=>setImmediate(r));
  assert.equal(text,'€\n');assert.deepEqual(port.sent,[[1,2]]);
  await serial.close();assert.equal(port.closed,true);assert.equal(port.readable.locked,false);assert.equal(port.writable.locked,false);
  await assert.rejects(serial.send(Uint8Array.of(3)));
});
test('unexpected EOF closes the device and allows reconnect',async()=>{
  let ended; const done=new Promise(r=>ended=r); const serial=new SerialConnection(()=>{},ended);
  const first=fakePort();await serial.open(first,{baudRate:9600});first.end();await done;
  assert.equal(first.closed,true);assert.equal(serial.port,null);
  const second=fakePort();await serial.open(second,{baudRate:115200});await serial.close();assert.equal(second.closed,true);
});

const {readPreferences, csvEntry, csvHeader, DiskLogger} = require('../src/core.js');
test('preferences validate persisted settings and preserve exact send endings',()=>{
  const profile={name:'Instrument',baud:9600,bits:7,stop:2,parity:'even',flow:'hardware',mode:'text',ending:'\\r\\n'};
  const shortcut={name:'Read',command:'READ?',mode:'text',ending:'\\r'};
  assert.deepEqual(readPreferences(JSON.stringify({profiles:[profile],shortcuts:[shortcut]})),{profiles:[profile],shortcuts:[shortcut]});
  assert.deepEqual(readPreferences(JSON.stringify({profiles:[{...profile,baud:-1},{...profile,ending:'INVALID'}],shortcuts:[{...shortcut,mode:'script'},null]})),{profiles:[],shortcuts:[]});
  assert.throws(()=>readPreferences('{broken'));
  assert.equal(readPreferences(JSON.stringify({shortcuts:Array(60).fill(shortcut)})).shortcuts.length,50);
});
test('CSV logs quote embedded newlines/quotes and neutralize formula prefixes',()=>{
  assert.equal(csvEntry({time:'now',direction:'RX',text:'=1+1\n"quoted"',hex:''}),'"now","RX","\'=1+1\n""quoted""",""\r\n');
});
test('continuous logger retains order beyond terminal buffer and commits once on stop',async()=>{
  const written=[];let closed=0;
  const logger=new DiskLogger({async write(chunk){await Promise.resolve();written.push(new TextDecoder().decode(chunk));},async close(){closed++;}},error=>assert.fail(error));
  logger.append(csvHeader);
  for(let i=0;i<12000;i++) logger.append(`${i}\n`);
  await Promise.all([logger.stop(),logger.stop()]);
  assert.equal(closed,1);assert.equal(written.length,12001);assert.equal(written.at(-1),'11999\n');
  logger.append('late');assert.equal(written.length,12001);
});
test('disk write failure is reported, stops accepting data, and aborts the file',async()=>{
  let reported,aborted=false;
  const logger=new DiskLogger({async write(){throw new Error('Disk full');},async abort(){aborted=true;}},e=>reported=e);
  logger.append('data');await assert.rejects(logger.stop(),/Disk full/);
  assert.equal(reported.message,'Disk full');assert.equal(aborted,true);assert.equal(logger.accepting,false);
});
test('slow disk bounds pending memory and reports overflow instead of dropping data silently',async()=>{
  let release,reported,aborted=false;const blocked=new Promise(r=>release=r);
  const logger=new DiskLogger({async write(){await blocked;},async abort(){aborted=true;}},e=>reported=e,8);
  logger.append('123456');logger.append('789');assert.ok(reported);release();
  await assert.rejects(logger.stop(),/pending-write limit/);assert.equal(aborted,true);
});
test('finalization errors are reported and abort attempted',async()=>{
  let reported,aborted=false;const logger=new DiskLogger({async write(){},async close(){throw new Error('Cannot finalize');},async abort(){aborted=true;}},e=>reported=e);
  logger.append('data');await assert.rejects(logger.stop(),/Cannot finalize/);assert.equal(reported.message,'Cannot finalize');assert.equal(aborted,true);
});
