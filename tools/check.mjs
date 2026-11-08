/**
 * Opens the game in headless Chrome, prints every console message and uncaught error, optionally presses
 * demo keys, and saves a screenshot. Exits with code 1 when the page logged an error.
 *
 *   node tools/check.mjs "http://127.0.0.1:3939/?demo=bots&voice=0" shot.png [--wait 15000] [--keys "J,J,C,H,shift+H,G"] [--size 540x960]
 *
 * (The plain `chrome --headless --screenshot --virtual-time-budget` command never finishes here: the page keeps
 * its /events stream open, so virtual time never runs out. This drives Chrome over its DevTools protocol instead.)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 ? args.splice(i, 2)[1] : d; };
const wait = Number(opt('wait', 12000));
const keys = opt('keys', '');
const [w, h] = opt('size', '540x960').split('x').map(Number);
const evalJs = opt('eval', '');
const [url = 'http://127.0.0.1:3939/?demo=bots&voice=0', out = 'shot.png'] = args;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cauca-check-'));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required',
  '--no-first-run', '--no-default-browser-check', `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let errors = 0;

async function target() {
  for (let i = 0; i < 50; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = list.find((t) => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; } catch {}
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

try {
  const ws = new WebSocket(await target());
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result || d); pending.delete(d.id); return; }
    if (d.method === 'Runtime.consoleAPICalled') {
      const text = d.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (d.params.type === 'error') errors++;
      console.log(`[console.${d.params.type}] ${text}`);
    } else if (d.method === 'Runtime.exceptionThrown') {
      errors++;
      const e = d.params.exceptionDetails;
      console.log(`[uncaught] ${e.exception?.description || e.text} (${e.url || ''}:${e.lineNumber + 1}:${e.columnNumber + 1})`);
    } else if (d.method === 'Log.entryAdded') {
      const e = d.params.entry;
      if (e.level === 'error') errors++;
      console.log(`[${e.source}.${e.level}] ${e.text} ${e.url || ''}`);
    }
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(1500);
  for (const k of keys ? keys.split(',') : []) {
    const shift = /^shift\+/i.test(k), key = k.replace(/^shift\+/i, '');
    const code = 'Key' + key.toUpperCase();
    const ch = shift ? key.toUpperCase() : key.toLowerCase();
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, text: ch, modifiers: shift ? 8 : 0, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, modifiers: shift ? 8 : 0, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) });
    await sleep(450);
  }
  await sleep(wait);
  if (evalJs) {
    const r = await send('Runtime.evaluate', { expression: evalJs, returnByValue: true, awaitPromise: true });
    console.log('[eval]', JSON.stringify(r.result?.value ?? r.result?.description ?? r));
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`screenshot ${w}x${h} -> ${out}; ${errors} error(s)`);
  ws.close();
} catch (e) {
  console.error('check failed:', e.message);
  errors++;
} finally {
  chrome.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(errors ? 1 : 0);
}
