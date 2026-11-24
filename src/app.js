(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const {Lines, SerialConnection, hexBytes, numbers, readPreferences, csvEntry, csvHeader, DiskLogger} = BST;
  let preferences = {profiles:[], shortcuts:[]}, logger = null, recordingBusy = false;
  const preferenceKey = 'BrowserSerialTool.preferences.v1';
  const supported = 'serial' in navigator && window.isSecureContext;
  let ports = [], entries = [], samples = [], rx = 0, tx = 0, paused = false, demoTimer = null, busy = false, rendering = false;
  let decoder = new TextDecoder(), history = [], historyIndex = 0, demoStart = 0;
  const colors = ['#bcf47b','#78c7f2','#f6b87a','#d39efa','#f18ea8','#77dec4','#f4df7f','#abb9ff'];
  const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
  const guard = fn => async (...args) => { try { await fn(...args); } catch (e) { if (!['NotFoundError', 'AbortError'].includes(e.name)) status(e.message, true); } };
  const connection = new SerialConnection(receive, error => { flush(); update(); status(error ? `Serial read ended: ${error.message}` : 'Device disconnected.', !!error); refresh(); });
  const lines = new Lines(line => { add('RX', line); const values = numbers(line); if (values) { samples.push({time:new Date().toISOString(), values}); if (samples.length > 500) samples.shift(); } });
  function flush() { lines.push(decoder.decode()); lines.flush(); decoder = new TextDecoder(); }
  function add(direction, text, hex = '') {
    const entry = {time:new Date().toISOString(), direction, text, hex};
    entries.push(entry);
    logger?.append(csvEntry(entry));
    if (entries.length > 10000) entries.shift();
    schedule();
  }
  function receive(bytes) {
    rx += bytes.length;
    // Raw bytes are recorded separately from decoded lines, preserving binary data for hex view/export.
    const hex = Array.from(bytes, b => b.toString(16).padStart(2,'0').toUpperCase()).join(' ');
    add('RAW', '', hex);
    lines.push(decoder.decode(bytes, {stream:true}));
    schedule();
  }
  function update() {
    const live = !!connection.port && !connection.closing, demo = !!demoTimer;
    $('badge').textContent = demo ? 'Demo' : live ? 'Connected' : 'Offline';
    $('badge').classList.toggle('online', live || demo);
    $('activity').classList.toggle('online', live || demo);
    $('sessionLabel').textContent = demo ? 'Simulated data · no hardware connected' : live ? `Serial connected · ${$('baud').value} baud` : 'No active session';
    $('settings').disabled = live || busy || demo;
    $('profileControls').disabled = live || busy || demo;
    updateProfileButtons();
    document.querySelectorAll('.shortcut-send').forEach(button => { button.disabled = (!live && !demo) || busy; });
    for (const id of ['choose','refresh','ports']) $(id).disabled = !supported || live || busy || demo;
    $('connect').disabled = !supported || !ports.length || live || busy || demo;
    $('disconnect').disabled = (!live && !demo) || busy;
    $('send').disabled = (!live && !demo) || busy;
    $('demo').disabled = live || busy;
    $('demo').textContent = demo ? 'Stop demo' : 'Start demo';
    $('dtr').disabled = $('signals').disabled = !live;
    $('rts').disabled = !live || $('flow').value === 'hardware';
  }
  async function refresh() {
    if (!supported) return;
    try {
      const old = ports[Number($('ports').value)];
      ports = await navigator.serial.getPorts();
      $('ports').replaceChildren();
      if (!ports.length) $('ports').add(new Option('No authorized ports', ''));
      ports.forEach((port, i) => { const info = port.getInfo(); const usb = info.usbVendorId === undefined ? 'Serial device' : `USB ${info.usbVendorId.toString(16).padStart(4,'0')}:${info.usbProductId.toString(16).padStart(4,'0')}`; $('ports').add(new Option(`${i + 1} · ${usb}`, String(i))); });
      if (ports.includes(old)) $('ports').value = String(ports.indexOf(old));
      update();
    } catch (error) { status(`Cannot list ports: ${error.message}`, true); }
  }
  $('refresh').onclick = guard(async () => { await refresh(); status('Authorized ports refreshed. Choose a port to find new devices.'); });
  $('choose').onclick = guard(async () => { const port = await navigator.serial.requestPort(); await refresh(); $('ports').value = String(ports.indexOf(port)); status('Port authorized. Check settings, then connect.'); });
  $('connect').onclick = guard(async () => {
    const baudRate = Number($('baud').value);
    if (!Number.isInteger(baudRate) || baudRate < 1 || baudRate > 4000000) throw new Error('Baud rate must be an integer from 1 to 4,000,000.');
    const port = ports[Number($('ports').value)];
    if (!port) throw new Error('Choose a port first.');
    busy = true; update();
    try { await connection.open(port, {baudRate,dataBits:Number($('bits').value),stopBits:Number($('stop').value),parity:$('parity').value,flowControl:$('flow').value,bufferSize:65536}); $('dtr').checked = $('rts').checked = false; status('Connected. Opening a serial port may reset some boards.'); }
    finally { busy = false; update(); }
  });
  async function disconnect() {
    if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
    busy = true; update();
    try { await connection.close(); flush(); status('Disconnected. Buffered data is available for export.'); }
    finally { busy = false; update(); }
  }
  $('disconnect').onclick = guard(disconnect);
  for (const [id, signal] of [['dtr','dataTerminalReady'],['rts','requestToSend']]) $(id).onchange = guard(async () => { try { await connection.port.setSignals({[signal]:$(id).checked}); status(`${id.toUpperCase()} updated.`); } catch(e) { $(id).checked = !$(id).checked; throw e; } });
  $('signals').onclick = guard(async () => { const s = await connection.port.getSignals(); $('signalInfo').textContent = `CTS ${+s.clearToSend} / DSR ${+s.dataSetReady} / DCD ${+s.dataCarrierDetect} / RI ${+s.ringIndicator}`; });
  async function sendCommand(command, mode, ending) {
    if (busy || (!demoTimer && (!connection.port || connection.closing))) throw new Error('Connect a serial port first.');
    const bytes = mode === 'hex' ? hexBytes(command) : new TextEncoder().encode(command + ending.replace(/\\r/g,'\r').replace(/\\n/g,'\n'));
    if (demoTimer) status('Demo command recorded locally; no bytes sent to hardware.'); else await connection.send(bytes);
    tx += bytes.length;
    add('TX', new TextDecoder().decode(bytes), Array.from(bytes,b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' '));
    if (command && history.at(-1) !== command) { history.push(command); if (history.length > 100) history.shift(); }
    historyIndex = history.length;
  }
  $('sendForm').onsubmit = guard(async event => {
    event.preventDefault();
    await sendCommand($('command').value, $('sendMode').value, $('ending').value);
    $('command').value = '';
  });
  $('command').onkeydown = e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); historyIndex = Math.max(0,Math.min(history.length,historyIndex + (e.key === 'ArrowUp' ? -1 : 1))); $('command').value = history[historyIndex] || ''; } };
  $('sendMode').onchange = () => { $('ending').disabled = $('sendMode').value === 'hex'; $('command').placeholder = $('ending').disabled ? 'A0 01 FF' : 'Enter a command…'; };
  function schedule() { if (!rendering) { rendering = true; requestAnimationFrame(() => { rendering = false; render(); }); } }
  function render() {
    $('traffic').textContent = `RX ${rx.toLocaleString()} B · TX ${tx.toLocaleString()} B`;
    $('bufferInfo').textContent = `${entries.length.toLocaleString()} / 10,000 entries`;
    if (paused) return;
    if (!$('terminalView').hidden) {
      const terminal = $('terminal'), scroll = terminal.scrollTop;
      const query = $('search').value.toLowerCase();
      const matches = entry => ($('hexView').checked ? entry.hex : entry.text).toLowerCase().includes(query);
      const candidates = entries.filter(e => ($('hexView').checked ? e.direction !== 'RX' : e.direction !== 'RAW') &&
        ($('direction').value === 'all' || (e.direction === 'RAW' ? 'RX' : e.direction) === $('direction').value));
      $('matchCount').textContent = `${query ? candidates.filter(matches).length.toLocaleString() : 0} matches`;
      const visible = candidates.filter(e => !$('filterOnly').checked || !query || matches(e)).slice(-1500);
      if (visible.length) {
        const fragment = document.createDocumentFragment();
        for (const entry of visible) { const row = document.createElement('div'); row.className = `entry ${entry.direction.toLowerCase()}`; if ($('timestamps').checked) { const time = document.createElement('time'); time.textContent = entry.time.slice(11,23); row.append(time); } const tag = document.createElement('b'); tag.textContent = entry.direction === 'RAW' ? 'RX' : entry.direction; const body = document.createElement('span'); body.className = 'payload'; highlight(body, $('hexView').checked ? entry.hex : entry.text, query); row.append(tag,body); fragment.append(row); }
        terminal.replaceChildren(fragment);
        terminal.scrollTop = $('autoscroll').checked ? terminal.scrollHeight : scroll;
      } else { terminal.replaceChildren(); if (entries.length) { const message = document.createElement('p'); message.className = 'hint'; message.textContent = 'No entries match this view.'; terminal.append(message); } }
    } else drawPlot();
  }
  $('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? 'Resume view' : 'Pause view'; schedule(); };
  $('search').oninput = schedule;
  for (const id of ['filterOnly','direction']) $(id).onchange = schedule;
  for (const id of ['timestamps','hexView','autoscroll']) $(id).onchange = schedule;
  $('clear').onclick = () => { entries = []; samples = []; rx = tx = 0; lines.pending = ''; $('terminal').replaceChildren(); schedule(); status('Buffer and plot cleared.'); };
  function tab(plot) { $('terminalView').hidden = plot; $('plotView').hidden = !plot; $('terminalTab').setAttribute('aria-selected',String(!plot)); $('plotTab').setAttribute('aria-selected',String(plot)); schedule(); }
  $('terminalTab').onclick = () => tab(false); $('plotTab').onclick = () => tab(true);
  for (const id of ['terminalTab','plotTab']) $(id).onkeydown = e => { if (['ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); const plot = id === 'terminalTab'; tab(plot); $(plot ? 'plotTab' : 'terminalTab').focus(); } };
  function drawPlot() {
    const canvas = $('plot'), rect = canvas.getBoundingClientRect(), scale = devicePixelRatio || 1;
    if (!rect.width) return;
    canvas.width = Math.round(rect.width * scale); canvas.height = Math.round(rect.height * scale);
    const ctx = canvas.getContext('2d'); ctx.scale(scale,scale);
    const w = rect.width, h = rect.height, left = 58, right = w - 12, top = 20, bottom = h - 25;
    let lo = Infinity, hi = -Infinity, count = 0;
    for (const s of samples) { count = Math.max(count,s.values.length); for (const v of s.values) { lo = Math.min(lo,v); hi = Math.max(hi,v); } }
    if (!samples.length) { lo = -1; hi = 1; }
    if (lo === hi) { lo -= Math.max(1,Math.abs(lo)*.1); hi += Math.max(1,Math.abs(hi)*.1); }
    const span = hi - lo;
    ctx.font = '10px monospace'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = top + (bottom-top)*i/4; ctx.strokeStyle = '#25303b'; ctx.beginPath(); ctx.moveTo(left,y); ctx.lineTo(right,y); ctx.stroke(); ctx.fillStyle = '#8594a6'; ctx.fillText((hi-span*i/4).toPrecision(4),2,y+3); }
    ctx.fillStyle = '#8594a6'; ctx.fillText('oldest',left,h-5); ctx.fillText('latest',Math.max(left,right-36),h-5);
    for (let channel=0; channel<count; channel++) { ctx.strokeStyle = colors[channel]; ctx.lineWidth=1.5; ctx.beginPath(); let pen=false; samples.forEach((s,i) => { if (s.values[channel] === undefined) { pen=false; return; } const x=left+(right-left)*i/Math.max(1,samples.length-1), y=bottom-(s.values[channel]-lo)/span*(bottom-top); if (pen) ctx.lineTo(x,y); else {ctx.moveTo(x,y); pen=true;} }); ctx.stroke(); }
    $('legend').replaceChildren();
    for (let i=0;i<count;i++) { const label=document.createElement('span'); label.style.color=colors[i]; label.textContent=`● CH ${i+1}  ${samples.at(-1)?.values[i] ?? '—'}`; $('legend').append(label); }
    if (!samples.length) {ctx.fillStyle='#a4b0bd';ctx.fillText('Waiting for numeric lines. Try the demo.',left+10,h/2);}
  }
  new ResizeObserver(schedule).observe($('plot'));
  function download(content, type, extension) { const url=URL.createObjectURL(new Blob([content],{type})); const a=document.createElement('a'); a.href=url; a.download=`BrowserSerialTool-${new Date().toISOString().replace(/[:.]/g,'-')}.${extension}`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); status(`Exported ${extension.toUpperCase()}${demoTimer ? ' (contains demo data)' : ''}.`); }
  $('exportText').onclick=()=>download(entries.filter(e=>e.direction!=='RAW').map(e=>`${e.time} ${e.direction} ${e.text}`).join('\n'),'text/plain;charset=utf-8','txt');
  $('exportCSV').onclick=()=>download(csvHeader+entries.map(csvEntry).join(''),'text/csv;charset=utf-8','csv');
  $('exportPlot').onclick=()=>{ const count=Math.max(0,...samples.map(s=>s.values.length)); download(['timestamp,'+Array.from({length:count},(_,i)=>`channel_${i+1}`).join(','),...samples.map(s=>[s.time,...Array.from({length:count},(_,i)=>s.values[i]??'')].join(','))].join('\r\n'),'text/csv;charset=utf-8','csv'); };
  $('demo').onclick=guard(async()=>{ if(demoTimer) return disconnect(); if(connection.port) return; demoStart=performance.now(); status('Demo mode: simulated numeric data. No serial port is open.'); demoTimer=setInterval(()=>{const t=(performance.now()-demoStart)/1000;receive(new TextEncoder().encode(`${(24+4*Math.sin(t)).toFixed(2)},${(18+3*Math.cos(t*.7)).toFixed(2)},${(12+2*Math.sin(t*1.7)).toFixed(2)}\n`));},100); update(); });
  function highlight(element, text, query) {
    if (!query) { element.textContent = text; return; }
    const lower = text.toLowerCase(); let from = 0, found;
    while ((found = lower.indexOf(query, from)) !== -1) {
      element.append(document.createTextNode(text.slice(from, found)));
      const mark = document.createElement('mark'); mark.textContent = text.slice(found, found + query.length); element.append(mark);
      from = found + query.length;
    }
    element.append(document.createTextNode(text.slice(from)));
  }
  function persist(next) {
    // Commit the in-memory change only after persistent storage succeeds.
    localStorage.setItem(preferenceKey, JSON.stringify(next)); preferences = next;
  }
  function upsert(collection, item) {
    const result = collection.filter(existing => existing.name !== item.name);
    if (result.length >= 50) throw new Error('The limit is 50 saved items. Delete one first.');
    return [...result, item];
  }
  function nameFrom(id) {
    const name = $(id).value.trim(); if (!name) throw new Error('Enter a name first.'); return name;
  }
  function sendSettings() { return {mode:$('sendMode').value, ending:$('ending').value}; }
  function updateProfileButtons() {
    const selected = $('profiles').value !== '';
    $('loadProfile').disabled = $('deleteProfile').disabled = !selected;
  }
  function renderProfiles(selected = '') {
    $('profiles').replaceChildren(new Option('Choose a saved profile', ''));
    preferences.profiles.forEach((p, i) => $('profiles').add(new Option(p.name, String(i))));
    $('profiles').value = selected; updateProfileButtons();
  }
  $('profiles').onchange = () => { updateProfileButtons(); const profile = preferences.profiles[Number($('profiles').value)]; if ($('profiles').value !== '' && profile) $('profileName').value = profile.name; };
  $('saveProfile').onclick = guard(() => {
    const profile = {name:nameFrom('profileName'), baud:Number($('baud').value), bits:Number($('bits').value), stop:Number($('stop').value), parity:$('parity').value, flow:$('flow').value, ...sendSettings()};
    if (!readPreferences(JSON.stringify({profiles:[profile]})).profiles.length) throw new Error('Check the serial settings before saving.');
    const next = upsert(preferences.profiles, profile);
    persist({...preferences, profiles:next}); renderProfiles(String(next.length - 1)); status(`Saved profile “${profile.name}”. Saving the same name replaces it.`);
  });
  $('loadProfile').onclick = guard(() => {
    if (connection.port || demoTimer || busy || $('profiles').value === '') return;
    const p = preferences.profiles[Number($('profiles').value)];
    for (const key of ['baud','bits','stop','parity','flow']) $(key).value = p[key];
    $('sendMode').value = p.mode; $('ending').value = p.ending; $('sendMode').onchange();
    status(`Loaded profile “${p.name}”. Choose a port and connect when ready.`);
  });
  $('deleteProfile').onclick = guard(() => {
    if ($('profiles').value === '') return;
    persist({...preferences, profiles:preferences.profiles.filter((_,i)=>i!==Number($('profiles').value))}); renderProfiles(); status('Profile deleted.');
  });
  function renderShortcuts() {
    $('shortcutList').replaceChildren(); $('shortcutCount').textContent = `(${preferences.shortcuts.length})`;
    preferences.shortcuts.forEach((shortcut, index) => {
      const row = document.createElement('div'); row.className = 'shortcut-row';
      const send = document.createElement('button'); send.className = 'shortcut-send secondary'; send.textContent = `Send ${shortcut.name}`;
      send.title = `${shortcut.mode}: ${shortcut.command}`;
      send.onclick = guard(() => sendCommand(shortcut.command, shortcut.mode, shortcut.ending));
      const load = document.createElement('button'); load.textContent = 'Load'; load.setAttribute('aria-label',`Load ${shortcut.name}`);
      load.onclick = () => { $('command').value = shortcut.command; $('sendMode').value = shortcut.mode; $('ending').value = shortcut.ending; $('sendMode').onchange(); $('shortcutName').value = shortcut.name; $('command').focus(); };
      const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label',`Delete ${shortcut.name}`);
      remove.onclick = guard(() => { persist({...preferences,shortcuts:preferences.shortcuts.filter((_,i)=>i!==index)}); renderShortcuts(); status('Shortcut deleted.'); });
      row.append(send, load, remove); $('shortcutList').append(row);
    });
    update();
  }
  $('saveShortcut').onclick = guard(() => {
    const shortcut = {name:nameFrom('shortcutName'), command:$('command').value, ...sendSettings()};
    if (!shortcut.command) throw new Error('Enter a command in the send field first.');
    if (shortcut.mode === 'hex') hexBytes(shortcut.command);
    persist({...preferences, shortcuts:upsert(preferences.shortcuts,shortcut)}); renderShortcuts(); status(`Saved command “${shortcut.name}”. Saving the same name replaces it.`);
  });
  const canRecord = typeof window.showSaveFilePicker === 'function' && window.isSecureContext;
  function updateRecording() {
    $('startRecording').disabled = !canRecord || !!logger || recordingBusy;
    $('stopRecording').disabled = !logger || recordingBusy;
    $('recordBadge').textContent = recordingBusy ? 'Finalizing…' : logger ? 'Recording' : 'Not recording';
    $('recordBadge').classList.toggle('online', !!logger);
    if (!canRecord) $('recordInfo').textContent = 'Direct file recording is unavailable in this browser/context. Use buffer exports, or desktop Chrome/Edge in a secure context.';
  }
  $('startRecording').onclick = guard(async () => {
    if (logger || recordingBusy) return;
    // Invoke the picker directly in the click gesture; never request access on page load.
    const handle = await window.showSaveFilePicker({suggestedName:`BrowserSerialTool-${new Date().toISOString().replace(/[:.]/g,'-')}.csv`, types:[{description:'Serial CSV log',accept:{'text/csv':['.csv']}}]});
    recordingBusy = true; updateRecording();
    try {
      const writer = await handle.createWritable();
      const active = new DiskLogger(writer, error => {
        $('recordInfo').textContent = `Recording failed: ${error.message} The recording file was not finalized. Buffer exports remain available.`;
        if (logger === active) logger = null; recordingBusy = true; updateRecording();
        active.stop().catch(()=>{}).finally(()=>{recordingBusy=false; updateRecording();}); status(`Recording failed: ${error.message}`, true);
      });
      logger = active;
      logger.append(csvHeader);
      $('recordInfo').textContent = `Recording new traffic to ${handle.name}. Includes raw bytes and decoded lines${demoTimer ? ' (simulated demo data)' : ''}. Stop & save before closing this tab.`;
      status('Continuous recording started. Existing buffer entries are not included.');
    } finally { recordingBusy = false; updateRecording(); }
  });
  $('stopRecording').onclick = guard(async () => {
    if (!logger || recordingBusy) return;
    const active = logger;
    logger = null; recordingBusy = true; updateRecording();
    try { await active.stop(); $('recordInfo').textContent = `Saved ${(active.bytes / 1024).toFixed(1)} KiB of traffic. Recording stopped.`; status('Recording finalized and saved.'); }
    finally { recordingBusy = false; updateRecording(); }
  });
  if (supported) { navigator.serial.addEventListener('connect',refresh); navigator.serial.addEventListener('disconnect',guard(async event=>{if(event.target===connection.port) await disconnect(); await refresh();})); refresh(); }
  $('unsupported').hidden=supported;
  window.addEventListener('beforeunload',event=>{if(connection.port || logger || recordingBusy){event.preventDefault();event.returnValue='';}});
  try { preferences = readPreferences(localStorage.getItem(preferenceKey)); }
  catch { status('Saved settings could not be loaded. Check browser storage permissions if saving fails.', true); }
  renderProfiles(); renderShortcuts(); updateRecording(); update();
})();
