/* BrowserSerialTool core. No dependencies; also exercised by Node tests. */
(function (root) {
  'use strict';
  function hexBytes(text) {
    const compact = text.replace(/\s+/g, '');
    if (!compact || compact.length % 2 || !/^[\da-f]+$/i.test(compact)) throw new Error('Enter complete hexadecimal byte pairs, for example: A0 01 FF');
    return Uint8Array.from(compact.match(/../g), x => parseInt(x, 16));
  }
  function numbers(line) {
    const parts = line.trim().split(/[,;\s]+/);
    if (!parts.length || parts.length > 8 || parts.some(x => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(x))) return null;
    const values = parts.map(Number);
    return values.every(Number.isFinite) ? values : null;
  }
  class Lines {
    constructor(emit, limit = 16384) { this.emit = emit; this.limit = limit; this.pending = ''; this.cr = false; }
    push(text) {
      for (const char of text) {
        if (char === '\n' && this.cr) { this.cr = false; continue; }
        this.cr = char === '\r';
        if (char === '\r' || char === '\n') { this.emit(this.pending); this.pending = ''; }
        else { this.pending += char; if (this.pending.length >= this.limit) { this.emit(this.pending); this.pending = ''; } }
      }
    }
    flush() { if (this.pending) this.emit(this.pending); this.pending = ''; this.cr = false; }
  }
  class SerialConnection {
    constructor(onData, onEnd) { this.onData = onData; this.onEnd = onEnd; this.port = null; this.closing = false; }
    async open(port, options) {
      if (this.port) throw new Error('A port is already open.');
      await port.open(options);
      this.port = port;
      this.closing = false;
      try { this.writer = port.writable.getWriter(); this.reader = port.readable.getReader(); }
      catch (error) { await this.close(); throw error; }
      this.readTask = this.readLoop();
    }
    async readLoop() {
      let failure;
      try { while (!this.closing) { const {value, done} = await this.reader.read(); if (done) break; this.onData(value); } }
      catch (error) { if (!this.closing) failure = error; }
      finally { this.reader.releaseLock(); this.reader = null; }
      if (!this.closing) queueMicrotask(() => this.close().then(() => this.onEnd(failure)));
    }
    async send(bytes) {
      if (!this.writer || this.closing) throw new Error('Connect a serial port first.');
      await this.writer.write(bytes);
    }
    async close() {
      if (this.closing) return this.closeTask;
      this.closing = true;
      this.closeTask = (async () => {
        try { await this.reader?.cancel(); } catch {}
        await this.readTask;
        if (this.writer) { try { await this.writer.abort(); } catch {} this.writer.releaseLock(); this.writer = null; }
        try { await this.port?.close(); } finally { this.port = null; }
      })();
      return this.closeTask;
    }
  }
  const endings = ['\\n', '\\r\\n', '\\r', ''];
  function validSend(value) {
    return value && ['text', 'hex'].includes(value.mode) && endings.includes(value.ending);
  }
  function readPreferences(raw) {
    const data = JSON.parse(raw || '{}');
    if (!data || typeof data !== 'object') throw new Error('Invalid saved preferences.');
    const named = item => item && typeof item.name === 'string' && item.name.trim() && item.name.length <= 60;
    return {
      profiles: (Array.isArray(data.profiles) ? data.profiles : []).filter(p => named(p) && validSend(p) &&
        Number.isInteger(p.baud) && p.baud >= 1 && p.baud <= 4000000 && [7, 8].includes(p.bits) &&
        [1, 2].includes(p.stop) && ['none', 'even', 'odd'].includes(p.parity) && ['none', 'hardware'].includes(p.flow)).slice(0, 50),
      shortcuts: (Array.isArray(data.shortcuts) ? data.shortcuts : []).filter(p => named(p) && validSend(p) &&
        typeof p.command === 'string' && p.command.length <= 65536).slice(0, 50)
    };
  }
  // CSV cells are quoted and formula prefixes neutralized for spreadsheet imports.
  function csvCell(value) {
    let s = String(value);
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  }
  function csvEntry(entry) { return [entry.time, entry.direction, entry.text, entry.hex].map(csvCell).join(',') + '\r\n'; }
  const csvHeader = 'timestamp,direction,text,hex\r\n';
  class DiskLogger {
    constructor(writer, onError, limit = 8 * 1024 * 1024) {
      this.writer = writer; this.onError = onError; this.limit = limit;
      this.queue = []; this.pending = 0; this.bytes = 0; this.accepting = true;
    }
    append(text) {
      if (!this.accepting || this.error) return;
      const bytes = new TextEncoder().encode(text);
      if (this.pending + bytes.length > this.limit) {
        this.fail(new Error('Disk cannot keep up: recording stopped at the 8 MiB pending-write limit.')); return;
      }
      this.queue.push(bytes); this.pending += bytes.length;
      if (!this.task) this.task = this.drain();
    }
    async drain() {
      try {
        while (this.queue.length && !this.error) {
          const chunk = this.queue.shift();
          await this.writer.write(chunk);
          this.pending -= chunk.length; this.bytes += chunk.length;
        }
      } catch (error) { this.fail(error); }
      finally { this.task = null; }
    }
    fail(error) {
      if (this.error) return;
      this.error = error; this.accepting = false; this.queue = [];
      this.onError(error);
    }
    async stop() {
      if (this.stopTask) return this.stopTask;
      this.accepting = false;
      this.stopTask = (async () => {
        await this.task;
        if (this.error) { try { await this.writer.abort(); } catch {} throw this.error; }
        try { await this.writer.close(); } catch (error) { this.fail(error); try { await this.writer.abort(); } catch {} throw error; }
      })();
      return this.stopTask;
    }
  }
  const api = {hexBytes, numbers, Lines, SerialConnection, readPreferences, csvCell, csvEntry, csvHeader, DiskLogger};
  root.BST = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
