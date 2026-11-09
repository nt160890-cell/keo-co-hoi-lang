/**
 * Kéo Co Hội Làng Live: the local "pipe and disk" for the game page (copied from ../bao-ve-to-dan-pho/server.mjs, 07/11).
 *
 * - Follows the creator's TikTok LIVE (unofficial tiktok-live-connector) and pushes
 *   comments, likes, gifts, follows, shares and joins to the page over Server-Sent Events (GET /events).
 * - GET /tts?text=… returns a Vietnamese MP3 (Microsoft Edge read-aloud), cached by sentence.
 * - GET/POST /data reads/writes data/players.json; GET/POST /live-result keeps one file per live in data/lives/.
 *   With ?demo=1 both use data/demo/ instead, so trying the game never touches the real board.
 * - POST /demo injects a fake event (?demo=1 on the page); real and demo events both go through handleEvent().
 * - GET /music lists the background tracks in public/audio/.
 * - Only the first page open (per mode: live or ?demo) is the "main" page: it alone may save (/data, /live-result,
 *   /stats) and speak (/tts). Pages opened later only watch; when the main page closes the next one is promoted.
 * - Serves public/. Listens on 127.0.0.1 only.
 *
 * All game rules live in public/game.js. Config comes from .env or the environment:
 *   TIKTOK_USERNAME (no @), PORT (default 3946), TTS_VOICE (default vi-VN-HoaiMyNeural), EULER_API_KEY (optional).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { ControlEvent, TikTokLiveConnection, UserOfflineError, WebcastEvent } from 'tiktok-live-connector';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(ROOT, '.env'));

const USERNAME = (process.env.TIKTOK_USERNAME || '').trim().replace(/^@/, '');
// A pinned line the page shows as a ticker until the host pins another (06/11), at most 150 characters
// 06/11 night: a PIN_TEXT from before "chat to play" ("Chat vào …", cúp mỗi 10 vòng) is out of date: phones keep their
// old .env when a new zip is unpacked, so such a line is replaced by the current rules.
const PIN_OLD = /viên bi|[Vv]òng vàng|zombie|trà sữa|matcha|chú ốc/; // a pin copied from another game's .env
const PIN_RAW = String(process.env.PIN_TEXT || '').trim().slice(0, 400);
const PIN_TEXT = PIN_OLD.test(PIN_RAW) ? '💪 Chat trâu hoặc gà là vào phe đó · chat và thả tim là kéo · 🎁 Tặng quà kéo cực mạnh · Chat túi xem lực kéo' : PIN_RAW; // the page cuts it to 150 characters (graphemes)
// Other accounts allowed to give host commands (comma separated, no @), e.g. the host's phone account (06/11)
const HOSTS = [USERNAME, ...String(process.env.HOST_HANDLES || '').split(',')].map((s) => s.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
const PORT = Number(process.env.PORT || 3946);
const TTS_VOICE = process.env.TTS_VOICE || 'vi-VN-HoaiMyNeural';
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');

/**
 * Phone on the home Wi-Fi (07/11, host's choice, same as Câu Cá): with LAN=1 in .env the server also listens on the
 * PC's Wi-Fi address, so a phone can open the game and go live with TikTok's screen share. This PC is always let in;
 * any other device must bring the key once (?key=…, printed at start) and then keeps it in a cookie. The key is shared
 * by every game in htdocs (../lan-key.txt), and so is the cookie (cookies do not depend on the port), so one link
 * with the key on the phone opens all of them. Without LAN=1 nothing changes: 127.0.0.1 only.
 */
const LAN = /^(1|true|yes|on)$/i.test(String(process.env.LAN || '').trim());
const LAN_KEY_FILE = path.join(ROOT, '..', 'lan-key.txt');
const LAN_KEY = LAN ? lanKey() : '';
function lanKey() {
  try { const k = fs.readFileSync(LAN_KEY_FILE, 'utf8').trim(); if (/^[a-z0-9]{6,32}$/.test(k)) return k; } catch { /* first run */ }
  const k = Array.from(crypto.randomBytes(6), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join(''); // easy to type on a phone
  fs.writeFileSync(LAN_KEY_FILE, k);
  return k;
}
const sameKey = (a) => typeof a === 'string' && a.length === LAN_KEY.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(LAN_KEY));
const fromThisPc = (req) => /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress || '');
/** This PC always; another device only with the key (in the link once, then in the cookie). */
function letIn(req, url, res) {
  if (fromThisPc(req)) return true;
  if (!LAN) return false;
  if (sameKey(url.searchParams.get('key'))) {
    res.setHeader('Set-Cookie', `cauca_key=${LAN_KEY}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
    return true;
  }
  const c = /(?:^|;\s*)cauca_key=([a-z0-9]+)/.exec(req.headers.cookie || '');
  return !!c && sameKey(c[1]);
}
/** The PC's addresses on the home network, for the phone link. */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
  }
  return out;
}
/** Real data in data/, the ?demo page's in data/demo/ so tests never touch the real leaderboard. */
const store = (demo) => {
  const dir = demo ? path.join(DATA, 'demo') : DATA;
  return { players: path.join(dir, 'players.json'), lives: path.join(dir, 'lives'), backups: path.join(dir, 'backup'), logs: path.join(dir, 'logs'), records: path.join(dir, 'records') };
};

const OFFLINE_RETRY_MS = 60_000; // creator not live: check again every minute
// Without EULER_API_KEY the sign server allows only a few connections an hour (05/11 16:17: rate_limit_account_hour).
// Every connect attempt costs one, so after a rate limit wait long, and after "live ended" back off 1 → 2 → 4 → 5 min.
const RATE_LIMIT_MS = [10 * 60_000, 20 * 60_000, 30 * 60_000];
const ENDED_MAX_MS = 5 * 60_000;
const RECONNECT_MS = 15_000; // dropped mid-stream: come back soon, but not hammering TikTok
const LIKE_FLUSH_MS = 1_500; // likes from one viewer are summed over this window
const MEMBER_AGAIN_MS = 60_000; // the same viewer re-entering within this window is not a new arrival
const BACKUP_DAYS = 7;
const LOG_DAYS = 30;
const BODY_MAX = 8 * 1024 * 1024;

const log = (...a) => {
  console.log(new Date().toTimeString().slice(0, 8), ...a);
  journal(false, { kind: 'note', msg: a.map((x) => (typeof x === 'string' ? x : String(x?.message ?? x))).join(' ') });
};

function loadEnv(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

for (const d of [false, true]) for (const k of ['lives', 'backups', 'logs']) fs.mkdirSync(store(d)[k], { recursive: true });

// ---- journal: data/logs/YYYY-MM-DD.log, one JSON object per line ----
// Only counts and connection notes: comment text and names are never written (CLAUDE.md, mục 5).
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const journalChain = { false: Promise.resolve(), true: Promise.resolve() };
function journal(demo, entry) {
  const line = JSON.stringify({ t: new Date().toTimeString().slice(0, 8), ...entry }) + '\n';
  const file = path.join(store(demo).logs, localDay() + '.log');
  journalChain[demo] = journalChain[demo].then(() => fsp.appendFile(file, line)).catch(() => {});
}
for (const d of [false, true]) {
  // Keep a month of journals.
  const dir = store(d).logs, cut = localDay(new Date(Date.now() - LOG_DAYS * 86_400_000));
  for (const f of fs.readdirSync(dir)) if (/^\d{4}-\d{2}-\d{2}\.log$/.test(f) && f.slice(0, 10) < cut) fs.rmSync(path.join(dir, f), { force: true });
}

/** Per-minute counters, written as one "min" line. Sets hold user ids only, for "how many people". */
const freshMinute = () => ({
  like: 0, likeUsers: new Set(), chat: 0, chatUsers: new Set(), cmd: { phe: 0, tui: 0, xoa: 0, other: 0 }, hostChat: 0,
  member: 0, gift: 0, coins: 0, giftUsers: new Set(), follow: 0, share: 0, active: new Set(), game: null,
});
const minute = { false: freshMinute(), true: freshMinute() };
let viewers = null;
const plain = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
function chatKind(text) {
  const t = plain(text);
  if (/(^| )(trau|ga)( |$)|^[12]$/.test(t.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim())) return 'phe';
  if (/^(xem )?tui\b/.test(t)) return 'tui';
  if (/^(xoa toi|xac nhan)/.test(t)) return 'xoa';
  return 'other';
}
function countEvent(e) {
  const m = minute[!!e.demo], id = e.user?.id;
  if (e.type === 'like') { m.like += e.count; m.likeUsers.add(id); }
  else if (e.type === 'chat') {
    m.chat++; m.chatUsers.add(id); m.cmd[chatKind(e.text)]++;
    if (HOSTS.includes(String(e.user?.handle || '').toLowerCase())) m.hostChat++; // the host's own comments (commands)
  }
  else if (e.type === 'member') m.member++;
  else if (e.type === 'gift') { m.gift++; m.coins += e.gift.coins; m.giftUsers.add(id); }
  else if (e.type === 'follow') m.follow++;
  else if (e.type === 'share') m.share++;
  else if (e.type === 'status') journal(!!e.demo, { kind: 'live', on: e.live });
  if (id && e.type !== 'member') m.active.add(id);
}
function flushMinute(demo) {
  const m = minute[demo];
  const any = m.like || m.chat || m.member || m.gift || m.follow || m.share || m.game;
  if (any || (!demo && isLive)) {
    journal(demo, {
      kind: 'min', live: demo ? undefined : isLive, viewers: demo ? undefined : viewers ?? undefined, pages: clients.size,
      like: m.like, likeUsers: m.likeUsers.size, chat: m.chat, chatUsers: m.chatUsers.size, cmd: m.cmd, hostChat: m.hostChat,
      member: m.member, gift: m.gift, coins: m.coins, giftUsers: m.giftUsers.size, follow: m.follow, share: m.share,
      active: m.active.size, game: m.game ?? undefined,
    });
  }
  minute[demo] = freshMinute();
}
// Aligned to the clock minute so lines read 07:12:00, 07:13:00…
setTimeout(() => { const f = () => { flushMinute(false); flushMinute(true); }; f(); setInterval(f, 60_000); }, 60_000 - (Date.now() % 60_000));

// ---- events to the page (SSE) ----
const clients = new Set();
let isLive = false;

function send(res, event) { res.write(`data: ${JSON.stringify(event)}\n\n`); }
function broadcast(event) { for (const res of clients) send(res, event); }
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20_000);

/**
 * One main page per mode. Two pages (OBS + LIVE Studio, or a stray tab) each run their own game; if both saved,
 * they would overwrite each other's board and double every voice request. A main page that drops its connection
 * keeps the role for PAGE_GRACE_MS so a reload or a network blip does not hand it to another page.
 */
const PAGE_GRACE_MS = 5_000;
const pages = { false: { list: [], lost: null }, true: { list: [], lost: null } };
const mainPage = (demo) => { const P = pages[demo]; return P.lost ? P.lost.id : P.list[0]?.id ?? null; };
function pageJoin(demo, id, res) {
  const P = pages[demo];
  if (P.lost && P.lost.id === id) { clearTimeout(P.lost.timer); P.lost = null; P.list.unshift({ id, res }); }
  else P.list.push({ id, res });
  return mainPage(demo) === id;
}
function pageLeave(demo, res) {
  const P = pages[demo];
  const i = P.list.findIndex((x) => x.res === res);
  if (i < 0) return;
  const [gone] = P.list.splice(i, 1);
  if (i !== 0 || P.lost) return;
  P.lost = { id: gone.id, timer: setTimeout(() => { P.lost = null; const next = P.list[0]; if (next) send(next.res, { type: 'role', main: true }); }, PAGE_GRACE_MS) };
}
/** Saving and speaking are for the main page only. */
const fromMain = (url) => { const id = url.searchParams.get('page'); return !!id && id === mainPage(url.searchParams.has('demo')); };

/** The one entry point for every event, real (from TikTok) or fake (POST /demo). */
function handleEvent(event) {
  if (!event || typeof event.type !== 'string') return false;
  const out = { type: event.type, at: Date.now() };
  if (event.user) {
    const u = event.user;
    const id = String(u.id || '').slice(0, 64);
    if (!id) return false;
    out.user = { id, handle: String(u.handle || '').slice(0, 64), name: String(u.name || u.handle || '').slice(0, 64) };
  }
  if (event.type === 'chat') out.text = String(event.text || '').slice(0, 200);
  if (event.type === 'like') out.count = Math.max(1, Math.min(500, Number(event.count) || 1));
  if (event.type === 'gift') {
    out.gift = { name: String(event.gift?.name || '').slice(0, 60), coins: Math.max(0, Number(event.gift?.coins) || 0) };
    out.count = Number(event.count) || 1;
  }
  if (event.type === 'status') out.live = !!event.live;
  if (event.demo) out.demo = true;
  countEvent(out);
  broadcast(out);
  return true;
}

// ---- voice: one sentence at a time, cached by text (memory, then data/tts-cache/ on disk) ----
let ttsChain = Promise.resolve();
const ttsCache = new Map(); // text -> Promise<Buffer>
const TTS_CACHE_MAX = 300;
const TTS_DIR = path.join(DATA, 'tts-cache');
const TTS_DISK_MAX = 2000; // ~40 MB; the oldest files go first
const TTS_GAP_MS = 400; // breathing room between two requests to Microsoft
const TTS_STALE_MS = 15_000; // a line that waited this long in the queue is no longer news: skip it
const TTS_TRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(TTS_DIR, { recursive: true });

/**
 * Microsoft answers 429 when we ask too often. Then every request waits out a growing pause
 * (1.5 s, 3 s, 6 s … up to 30 s), and a line that would wait more than 8 s fails at once so the page moves on.
 */
let ttsPauseUntil = 0, ttsBackoff = 0, ttsBusyLogAt = 0, ttsBusyCount = 0;
async function synthesizeRetry(text) {
  for (let i = 1; ; i++) {
    const wait = ttsPauseUntil - Date.now();
    if (wait > 8_000) throw new Error('tts paused (429)');
    if (wait > 0) await sleep(wait);
    try {
      const mp3 = await synthesize(text);
      ttsBackoff = 0;
      return mp3;
    } catch (e) {
      if (!/429/.test(e?.message || '')) throw e;
      ttsBackoff = Math.min(30_000, ttsBackoff ? ttsBackoff * 2 : 1_500);
      ttsPauseUntil = Date.now() + ttsBackoff;
      ttsBusyCount++;
      if (Date.now() - ttsBusyLogAt > 60_000) { log(`giọng đọc bị giới hạn (429) ${ttsBusyCount} lần, chờ ${ttsBackoff / 1000} giây rồi thử lại`); ttsBusyLogAt = Date.now(); ttsBusyCount = 0; }
      if (i >= TTS_TRIES) throw e;
    }
  }
}

async function pruneTtsDisk() {
  const files = (await fsp.readdir(TTS_DIR).catch(() => [])).filter((f) => f.endsWith('.mp3'));
  if (files.length <= TTS_DISK_MAX) return;
  const aged = await Promise.all(files.map(async (f) => ({ f, t: (await fsp.stat(path.join(TTS_DIR, f)).catch(() => ({ mtimeMs: 0 }))).mtimeMs })));
  aged.sort((a, b) => a.t - b.t);
  for (const { f } of aged.slice(0, files.length - TTS_DISK_MAX)) await fsp.unlink(path.join(TTS_DIR, f)).catch(() => {});
}
pruneTtsDisk(); setInterval(pruneTtsDisk, 3_600_000);

async function synthesize(text) {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text.replace(/[&<>]/g, ' '));
    const chunks = [];
    const read = (async () => { for await (const c of audioStream) chunks.push(c); })();
    await Promise.race([read, new Promise((_, no) => setTimeout(() => no(new Error('tts timeout')), 20_000))]);
    if (!chunks.length) throw new Error('no audio');
    return Buffer.concat(chunks);
  } finally {
    tts.close();
  }
}

function speech(text) {
  let job = ttsCache.get(text);
  if (job) { ttsCache.delete(text); ttsCache.set(text, job); return job; } // keep recent lines fresh
  const file = path.join(TTS_DIR, crypto.createHash('sha1').update(TTS_VOICE + '|' + text).digest('hex') + '.mp3');
  const queuedAt = Date.now();
  job = fsp.readFile(file).catch(() => {
    const made = ttsChain.then(() => {
      if (Date.now() - queuedAt > TTS_STALE_MS) throw new Error('tts stale');
      return synthesizeRetry(text);
    });
    ttsChain = made.catch(() => {}).then(() => sleep(TTS_GAP_MS));
    return made.then((mp3) => { fsp.writeFile(file, mp3).catch(() => {}); return mp3; });
  });
  job.catch(() => ttsCache.delete(text));
  ttsCache.set(text, job);
  while (ttsCache.size > TTS_CACHE_MAX) ttsCache.delete(ttsCache.keys().next().value);
  return job;
}

// ---- files ----
/** Write to file.tmp, then rename over the file; writes to one file wait for each other. */
const writeChains = new Map();
function writeAtomic(file, text) {
  const job = (writeChains.get(file) || Promise.resolve()).catch(() => {}).then(() => writeNow(file, text));
  writeChains.set(file, job);
  job.finally(() => { if (writeChains.get(file) === job) writeChains.delete(file); }).catch(() => {});
  return job;
}
async function writeNow(file, text) {
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, text);
  for (let i = 0; ; i++) {
    try { await fsp.rename(tmp, file); return; } catch (e) {
      // Windows: an antivirus or backup tool may hold the file for a moment.
      if (i >= 5) throw e;
      await new Promise((r) => setTimeout(r, 100 * (i + 1)));
    }
  }
}

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** Once a day, before the first write, keep a copy of players.json; drop copies older than a week. */
async function dailyBackup(st) {
  const copy = path.join(st.backups, `players-${today()}.json`);
  if (fs.existsSync(copy) || !fs.existsSync(st.players)) return;
  await fsp.copyFile(st.players, copy);
  const cutoff = Date.now() - BACKUP_DAYS * 86_400_000;
  for (const f of await fsp.readdir(st.backups)) {
    const m = f.match(/^players-(\d{4}-\d{2}-\d{2})\.json$/);
    if (m && new Date(m[1]).getTime() < cutoff) await fsp.unlink(path.join(st.backups, f)).catch(() => {});
  }
}

let saving = Promise.resolve();
function savePlayers(st, text) {
  // Chained so two quick saves never race on the same .tmp file.
  saving = saving.catch(() => {}).then(async () => {
    await dailyBackup(st).catch((e) => log('backup failed:', e.message));
    await writeAtomic(st.players, text);
  });
  return saving;
}

async function latestLive(st) {
  const files = (await fsp.readdir(st.lives)).filter((f) => /^\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(f)).sort();
  if (!files.length) return '{}';
  return fsp.readFile(path.join(st.lives, files.at(-1)), 'utf8');
}

// ---- http ----
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > BODY_MAX) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, code, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(text);
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const ext = path.extname(file).toLowerCase();
    // Pictures: "no-cache" + Last-Modified, so a page reload shows a picture replaced on disk at once (06/11: new
    // sprites stayed hidden behind a 1-hour cache) and an unchanged one costs only a 304. Music keeps its 1-hour cache.
    const audio = ['.mp3', '.m4a', '.ogg', '.wav'].includes(ext);
    const modified = (await fsp.stat(file)).mtime.toUTCString();
    if (!audio && !req.headers.range && req.headers['if-modified-since'] === modified) { res.writeHead(304, { 'Last-Modified': modified, 'Cache-Control': 'no-cache' }).end(); return; }
    const data = await fsp.readFile(file);
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': audio ? 'max-age=3600' : 'no-cache',
      'Last-Modified': modified,
      'Accept-Ranges': 'bytes',
    };
    // Audio players ask for byte ranges to learn the length and to seek.
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, data.length - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
      if (start > end || start >= data.length) { res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }).end(); return; }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 })
        .end(req.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': data.length }).end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Không tìm thấy');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  if (!letIn(req, url, res)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Cần mã: mở đúng link có ?key=… hiện trong cửa sổ game trên máy tính.');
    return;
  }
  const st = store(url.searchParams.has('demo'));
  try {
    if (p === '/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      clients.add(res);
      const demo = url.searchParams.has('demo');
      let id = (url.searchParams.get('page') || '').slice(0, 40);
      if (!id) id = crypto.randomUUID();
      // The same id still connected: a reload or a new address in the same tab whose old stream has not closed yet
      // (05/11: that page came up as "Trang phụ"), or a duplicated tab. The newest page takes the old one's place;
      // the old one, if it is still open, is told to start again with an id of its own.
      const same = pages[demo].list.find((x) => x.id === id);
      let main;
      if (same) { const old = same.res; same.res = res; send(old, { type: 'role', main: false }); main = mainPage(demo) === id; }
      else main = pageJoin(demo, id, res);
      send(res, { type: 'hello', host: USERNAME, hosts: HOSTS, pin: PIN_TEXT, live: isLive, tiktok: !!USERNAME, main, page: id, at: Date.now() });
      req.on('close', () => { clients.delete(res); pageLeave(demo, res); });
      return;
    }
    if (['/tts', '/data', '/live-result', '/stats', '/record-card'].includes(p) && req.method !== 'GET' || p === '/tts') {
      if (!fromMain(url)) { json(res, 409, { ok: false, error: 'not the main page' }); return; }
    }
    if (p === '/tts' && req.method === 'GET') {
      const text = (url.searchParams.get('text') || '').replace(/\s+/g, ' ').trim().slice(0, 400);
      if (!text) { res.writeHead(400).end(); return; }
      try {
        const mp3 = await speech(text);
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': mp3.length, 'Cache-Control': 'max-age=86400' }).end(mp3);
      } catch (e) {
        if (!/429|stale|paused/.test(e.message)) log('tts failed:', e.message);
        res.writeHead(/stale|paused|429/.test(e.message) ? 503 : 502).end();
      }
      return;
    }
    if (p === '/data') {
      if (req.method === 'GET') {
        json(res, 200, fs.existsSync(st.players) ? await fsp.readFile(st.players, 'utf8') : '{}');
        return;
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const data = JSON.parse(body); // reject anything that is not JSON before touching the file
        if (!data || typeof data !== 'object' || Array.isArray(data)) { json(res, 400, { ok: false }); return; }
        await savePlayers(st, JSON.stringify(data, null, 1));
        json(res, 200, { ok: true });
        return;
      }
    }
    if (p === '/live-result') {
      if (req.method === 'GET') { json(res, 200, await latestLive(st)); return; }
      if (req.method === 'POST') {
        const data = JSON.parse(await readBody(req));
        if (!/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(String(data?.id || ''))) { json(res, 400, { ok: false }); return; }
        await writeAtomic(path.join(st.lives, data.id + '.json'), JSON.stringify(data, null, 1));
        json(res, 200, { ok: true });
        return;
      }
    }
    if (p === '/record-card' && req.method === 'POST') {
      // A picture of a record moment, drawn by the page, for the host's videos: data/records/<day>/<time>-<kind>-<item>.jpg
      const data = JSON.parse(await readBody(req));
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(data?.img || ''));
      const kind = String(data?.kind || '');
      const img = m ? Buffer.from(m[1], 'base64') : null;
      if (!img || img[0] !== 0xff || img[1] !== 0xd8 || !['ky-luc', 'cup', 'chuoi-thang'].includes(kind)) { json(res, 400, { ok: false }); return; }
      const d = new Date(), two = (n) => String(n).padStart(2, '0');
      const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
      const item = String(data.item || '').replace(/[^a-z0-9-]/g, '').slice(0, 40);
      const file = `${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}-${kind}${item ? '-' + item : ''}.jpg`;
      await fsp.mkdir(path.join(st.records, day), { recursive: true });
      await fsp.writeFile(path.join(st.records, day, file), img);
      json(res, 200, { ok: true, file: `${day}/${file}` });
      return;
    }
    if (p === '/music' && req.method === 'GET') {
      // Background music: every audio file dropped into public/audio/.
      const files = await fsp.readdir(path.join(PUBLIC, 'audio')).catch(() => []);
      json(res, 200, files.filter((f) => /\.(mp3|m4a|ogg|wav)$/i.test(f)).sort());
      return;
    }
    if (p === '/stats' && req.method === 'POST') {
      // The page's own numbers for the journal (seats, catches, voice), merged into this minute's line.
      const g = JSON.parse(await readBody(req));
      if (!g || typeof g !== 'object' || Array.isArray(g)) { json(res, 400, { ok: false }); return; }
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, num(o?.[k])]));
      minute[url.searchParams.has('demo')].game = {
        ...pick(g, ['registered', 'racers', 'races', 'finished', 'unstuck', 'treasures', 'accidents', 'powerups', 'quizAsked', 'quizRight', 'points', 'said', 'dropped', 'voiceQueue']),
        voice: pick(g.voice, ['A', 'B', 'C', 'skipped']),
      };
      json(res, 200, { ok: true });
      return;
    }
    if (p === '/host-cmd' && req.method === 'POST') {
      // 10/11: the control page (dieu-khien.html). TikTok did not pass on the host's own comments from LIVE Studio
      // (Lớp Học 00:00–00:23, hostChat 0 while viewers' chat came through), so the host can send the same commands here.
      const data = JSON.parse(await readBody(req));
      const text = String(data?.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) { json(res, 400, { ok: false }); return; }
      const demo = url.searchParams.has('demo');
      const list = pages[demo].list;
      for (const x of list) send(x.res, { type: 'hostcmd', text, demo, at: Date.now() });
      json(res, 200, { ok: true, pages: list.length, live: isLive });
      return;
    }
    if (p === '/demo' && req.method === 'POST') {
      const event = JSON.parse(await readBody(req));
      json(res, handleEvent({ ...event, demo: true }) ? 200 : 400, { ok: true });
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') { await serveStatic(req, res, p); return; }
    res.writeHead(405).end();
  } catch (e) {
    log(`${req.method} ${p} failed:`, e.message);
    if (!res.headersSent) json(res, 500, { ok: false, error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') log(`Cổng ${PORT} đang bận: có thể game đã chạy ở một cửa sổ khác.`);
  else log('server error:', e.message);
  process.exit(1);
});
server.listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  if (LAN) {
    const ips = lanAddresses();
    log(ips.length
      ? `Điện thoại cùng Wi-Fi mở: ${ips.map((ip) => `http://${ip}:${PORT}/?key=${LAN_KEY}`).join('  hoặc  ')}`
      : 'LAN=1 nhưng máy tính chưa có địa chỉ Wi-Fi (chưa nối mạng nhà?).');
  }
  log(`Trang điều khiển (nút bấm thay lệnh chat): http://localhost:${PORT}/dieu-khien.html${LAN && lanAddresses()[0] ? `  · điện thoại: http://${lanAddresses()[0]}:${PORT}/dieu-khien.html?key=${LAN_KEY}` : ''}`);
  log(`Kéo Co Hội Làng: http://localhost.game:${PORT}/ (dán vào LIVE Studio; cần dòng "127.0.0.1 localhost.game" trong file hosts) · trên máy: http://localhost:${PORT}/ · thử: http://localhost:${PORT}/?demo=1`);
});

// ---- TikTok LIVE (same flow as ../di-chua/bridge/tiktok-bridge.mjs, delivered to handleEvent instead of HTTP) ----
function viewer(u) {
  if (!u) return null;
  const handle = u.uniqueId || u.displayId || '';
  const id = String(u.userId || u.id || handle || '');
  if (!id || id === '0') return null;
  return { id, handle, name: u.nickname || handle };
}

function giftOf(d) {
  const g = d.giftDetails || d.gift || d.extendedGiftInfo || {};
  return {
    type: g.giftType ?? g.type ?? 0,
    name: g.giftName || g.name || '',
    diamonds: Number(g.diamondCount ?? g.diamond_count ?? 0),
  };
}

// TikTok sometimes delivers the same message twice: drop repeats by message id,
// or by who + what within a few seconds when there is no id.
const seenMsgs = new Map();
const DUP_MS = 5000;
function repeated(type, d, user, extra = '') {
  const now = Date.now();
  if (seenMsgs.size > 500) seenMsgs.forEach((t, k) => { if (now - t > 60_000) seenMsgs.delete(k); });
  const id = d?.common?.msgId ? 'id:' + d.common.msgId : null;
  const key = `${type}:${user.id}:${extra}`;
  const dup = (id && seenMsgs.has(id)) || now - (seenMsgs.get(key) ?? -Infinity) < DUP_MS;
  if (id) seenMsgs.set(id, now);
  seenMsgs.set(key, now);
  return dup;
}

function startTikTok() {
  const stats = { events: 0, members: 0 };
  const likes = new Map();
  setInterval(() => {
    for (const { user, count } of likes.values()) { handleEvent({ type: 'like', user, count }); stats.events++; }
    likes.clear();
  }, LIKE_FLUSH_MS);
  const emit = (e) => { stats.events++; limitedTimes = 0; endedTimes = 0; handleEvent(e); };

  const lastMember = new Map();

  const conn = new TikTokLiveConnection(USERNAME, {
    signApiKey: process.env.EULER_API_KEY || undefined,
    enableExtendedGiftInfo: false,
    // The batch sent on connect replays the room's last comments. 05/11 18:25: an ended room (the 16:51 live) still
    // accepted the connection and replayed 5 old comments on every connect, which seated and scored people for nothing.
    processInitialData: false,
  });
  let timer = null;
  let lastWait = '';
  let limitedTimes = 0, endedTimes = 0; // reset once the live really delivers events
  let leaving = false; // we closed a room that is not live: no "Mất kết nối" line, no quick reconnect

  const setLive = (on) => { if (on === isLive) return; isLive = on; handleEvent({ type: 'status', live: on }); };
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(connect, ms); };

  async function connect() {
    timer = null;
    if (conn.isConnecting || conn.isConnected) return;
    try {
      const state = await conn.connect();
      // TikTok room status: 2 = live. The library only refuses status 4. 05/11 18:45 the ended 16:51 room still connected:
      // its room info came back as an error (status_code 4003110, no status) and fetchIsLive() said false.
      const ri = conn.roomInfo, status = ri?.data?.status;
      let notLive = Number.isFinite(status) && status !== 2;
      if (!notLive && ri && ri.status_code !== 0 && !Number.isFinite(status)) {
        try { notLive = (await conn.fetchIsLive()) === false; } catch { /* unknown: keep the connection */ }
      }
      if (notLive) {
        leaving = true;
        try { await conn.disconnect(); } catch { /* already closed */ }
        setLive(false);
        const msg = `phòng ${state.roomId} đã kết thúc, ${Number.isFinite(status) ? 'trạng thái ' + status : 'mã ' + ri?.status_code}`;
        if (msg !== lastWait) log(`@${USERNAME} chưa live (${msg}), một phút thử lại một lần`);
        lastWait = msg;
        schedule(OFFLINE_RETRY_MS);
        return;
      }
      log(`Đã nối TikTok LIVE @${USERNAME}, phòng ${state.roomId}${status != null ? ` (trạng thái ${status})` : ''}`);
      lastWait = '';
      lastWire = Date.now();
      setLive(true);
    } catch (e) {
      setLive(false);
      const full = e?.message || String(e);
      const msg = full.trim().split(/\r?\n/)[0].trim(); // the sign server appends a boxed banner: keep the first line
      const offline = e instanceof UserOfflineError || /offline|not.*live|room id|live status/i.test(msg);
      const limited = /rate.?limit|too many connections/i.test(msg);
      const ended = /illegal secret key/i.test(msg); // the room has closed (seen right after "Buổi live đã kết thúc")
      if (limited) {
        const wait = RATE_LIMIT_MS[Math.min(limitedTimes++, RATE_LIMIT_MS.length - 1)];
        log(`Sign server giới hạn số lần nối trong giờ (${msg}). Chờ ${wait / 60_000} phút rồi thử lại. Muốn hết giới hạn: lấy API key miễn phí ở eulerstream.com, đặt EULER_API_KEY trong .env rồi chạy lại server.`);
        lastWait = msg;
        schedule(wait);
        return;
      }
      if (msg !== lastWait) log(offline ? `@${USERNAME} chưa live, một phút thử lại một lần (${msg})` : ended ? `Phòng live đã đóng, chờ live mới (${msg})` : `Nối TikTok lỗi: ${msg}`);
      lastWait = msg;
      schedule(offline ? OFFLINE_RETRY_MS : ended ? endedWait() : RECONNECT_MS * 2);
    }
  }

  conn.on(ControlEvent.DISCONNECTED, ({ code, reason } = {}) => {
    if (leaving) { leaving = false; return; }
    log(`Mất kết nối (${code ?? '-'}${reason ? ': ' + reason : ''})`);
    setLive(false);
    if (!timer) schedule(RECONNECT_MS);
  });
  const endedWait = () => Math.min(ENDED_MAX_MS, OFFLINE_RETRY_MS * 2 ** endedTimes++);
  conn.on(WebcastEvent.STREAM_END, () => { log('Buổi live đã kết thúc'); setLive(false); schedule(endedWait()); });
  conn.on(ControlEvent.ERROR, (err) => { if (isLive) log('error:', err?.info || err?.exception?.message || err); });

  conn.on(WebcastEvent.CHAT, (d) => {
    const user = viewer(d.user); const text = (d.comment || d.content || '').trim();
    if (user && text && !repeated('chat', d, user, text)) emit({ type: 'chat', user, text });
  });
  conn.on(WebcastEvent.LIKE, (d) => {
    const user = viewer(d.user); if (!user) return;
    const n = Number(d.likeCount ?? d.count ?? 1) || 1;
    const cur = likes.get(user.id);
    likes.set(user.id, { user, count: (cur ? cur.count : 0) + n });
  });
  conn.on(WebcastEvent.GIFT, (d) => {
    const user = viewer(d.user); if (!user) return;
    const g = giftOf(d);
    // Streakable gifts (type 1) fire on every tap; only the final event carries the full count.
    if (g.type === 1 && !d.repeatEnd) return;
    const count = Number(d.repeatCount) || 1;
    if (repeated('gift', d, user, `${g.name}:${count}`)) return;
    emit({ type: 'gift', user, gift: { name: g.name, coins: g.diamonds * count }, count });
  });
  conn.on(WebcastEvent.FOLLOW, (d) => { const user = viewer(d.user); if (user && !repeated('follow', d, user)) emit({ type: 'follow', user }); });
  conn.on(WebcastEvent.SHARE, (d) => { const user = viewer(d.user); if (user && !repeated('share', d, user)) emit({ type: 'share', user }); });
  conn.on(WebcastEvent.MEMBER, (d) => {
    const user = viewer(d.user); if (!user) return;
    const now = Date.now(); if (now - (lastMember.get(user.id) || 0) < MEMBER_AGAIN_MS) return;
    lastMember.set(user.id, now); stats.members++;
    if (lastMember.size > 2000) for (const [id, t] of lastMember) if (now - t > MEMBER_AGAIN_MS) lastMember.delete(id);
    emit({ type: 'member', user });
  });
  conn.on(WebcastEvent.ROOM_USER, (d) => {
    const n = Number(d.viewerCount ?? d.total ?? d.totalUser);
    if (n >= 0 && n !== viewers) { viewers = n; broadcast({ type: 'viewers', n }); } // 07/11: shown in the HUD ("132 xem")
  });

  // 09/11 (Đào Vàng 21:57–22:05: "connected" for 8 minutes after a DEVICE_BLOCKED, yet only 6 events and no viewer
  // count came in): while live, nothing at all from TikTok for STALE_MS (no viewer count, chat, heart, join, gift)
  // means a dead link. Drop it and connect again, and tell the page (the host sees it on the status line).
  const STALE_MS = 120_000;
  let lastWire = Date.now(), staleTimes = 0;
  for (const ev of [WebcastEvent.CHAT, WebcastEvent.LIKE, WebcastEvent.GIFT, WebcastEvent.MEMBER, WebcastEvent.ROOM_USER, WebcastEvent.FOLLOW, WebcastEvent.SHARE, WebcastEvent.SOCIAL].filter(Boolean)) {
    conn.on(ev, () => { lastWire = Date.now(); });
  }
  setInterval(async () => {
    if (!isLive || !conn.isConnected || timer || Date.now() - lastWire < STALE_MS) return;
    staleTimes++;
    log(`${Math.round((Date.now() - lastWire) / 1000)} giây không nhận được gì từ TikTok: nối lại (lần ${staleTimes})`);
    handleEvent({ type: 'stale' });
    lastWire = Date.now();
    leaving = true; // our own drop: no "Mất kết nối" line, no live-off
    try { await conn.disconnect(); } catch { /* already closed */ }
    setTimeout(() => { leaving = false; }, 3000);
    schedule(2000);
  }, 15_000);

  setInterval(() => {
    if (stats.events) log(`${stats.events} sự kiện, ${stats.members} người vào${viewers !== null ? `, ${viewers} người xem` : ''}, ${clients.size} trang đang mở`);
    stats.events = stats.members = 0;
  }, 60_000);

  const shutdown = async () => {
    clearTimeout(timer);
    try { await conn.disconnect(); } catch {}
    handleEvent({ type: 'status', live: false });
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  log(`Theo dõi TikTok LIVE @${USERNAME}`);
  connect();
}

if (USERNAME) startTikTok();
else log('Chưa đặt TIKTOK_USERNAME trong .env: chỉ chạy chế độ thử (?demo=1).');
