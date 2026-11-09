/**
 * Kéo Co Hội Làng Live (08/11/2026): a tug of war for TikTok LIVE, offline on one PC.
 * Phe Trâu 🐃 (left) against Phe Gà 🐓 (right) in a village festival; own characters and art.
 *  - chat "trâu" / "gà" (or 1 / 2) to pick a side; any other comment or a heart joins the smaller side;
 *  - a comment pulls (one a second at most), hearts pull and more hearts lately pull harder (heartBoost),
 *    gifts pull a lot (GIFT_PULLS) and the big ones double a side or brake the other for a few seconds;
 *  - the knot reaching a side's line wins the round; after ROUND_MS the side ahead wins;
 *  - fewer than BOT_UNDER real players: BOT_COUNT 🤖 players, never scored.
 * Server, voice, TikTok, main page, demo and host commands: ports of ../dai-chien-oc-sen.
 * URL options: ?demo=1 (keys), ?demo=bots, ?voice=0, ?safe=1, ?motion=1 / ?motion=0, ?res=1.
 */

// ---------------------------------------------------------------- config
const Q = new URLSearchParams(location.search);
const DEMO = Q.has('demo');
const BOTS = Q.get('demo') === 'bots';
const VOICE_PARAM = Q.get('voice') !== '0';
const REDUCED = Q.get('motion') !== '1' && (Q.get('motion') === '0' || matchMedia('(prefers-reduced-motion: reduce)').matches);
const tabStore = { get(k) { try { return sessionStorage.getItem(k); } catch { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } } };
let PAGE_ID = tabStore.get('keoco.page') || Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
let DATA_QS = '';
function setPageId(id) { PAGE_ID = id; tabStore.set('keoco.page', id); DATA_QS = '?' + (DEMO ? 'demo=1&' : '') + 'page=' + id; }
setPageId(PAGE_ID);

const C = {
  HOOK_KICK: 300_000, MEMBER_PLAY: 60_000, // a comment / heart keeps the place on the rope this long; coming in, a minute
  GIFT_POINTS_PER_COIN: 5, WIN_PTS: 30,
  ROUND_MS: 75_000, RESULT_MS: 9_000, START_MS: 4_000, DRAW_WITHIN: 3,
  CHAT_PULL: 2, CHAT_EVERY: 1_000, HEART_PULL: 0.5, AUTO_PULL: 0.3, CENTER_PULL: 0.995,
  BOT_UNDER: 10, BOT_COUNT: 5, SHOWN: 8,
  DRUM_EVERY: [25_000, 40_000], DRUM_MS: 6_000, DOUBLE_MS: 8_000, BRAKE_MS: 8_000,
  RIGHT_TAB_MS: 10_000,
  RULES_EVERY: 600_000, RULES_FIRST: 20_000,
  VOICE_PER_MIN: 4, VOICE_B_GAP: 30_000, VOICE_C_QUIET: 10_000, VOICE_QUEUE: 6,
  GREET_EVERY: 45_000, QUIET: 120_000, AMBIENCE_EVERY: 180_000, REMIND_FIRST: 300_000, REMIND_EVERY: 600_000,
  ASSIST_FIRST: 120_000, ASSIST_EVERY: 900_000,
  RESUME: 30 * 60_000, RECONNECT_GRACE: 120_000,
  SAVE_EVERY: 10_000, FORGET_CONFIRM: 60_000, BAG_EVERY: 15_000,
  NOTICE_MS: 10_000, CLOSING_BANNER: 25_000, CLOSING_QUIET: 600_000,
};
const SIDES = [
  { id: 0, name: 'Trâu', ic: '🐃', color: '#7fb3d5', bots: ['Trâu Đen', 'Nghé Con', 'Trâu Mộng', 'Trâu Ngố', 'Nghé Mập'] },
  { id: 1, name: 'Gà', ic: '🐓', color: '#e8772e', bots: ['Gà Chọi', 'Gà Ri', 'Gà Tre', 'Gà Mái Mơ', 'Gà Con'] },
];
/** What one gift does, by its coins: pull = units on the rope (a comment is 2); double / brake last a few seconds. */
const GIFT_PULLS = [
  { min: 99, pull: 45, name: 'Thả neo', ic: '⚓', brake: true },
  { min: 30, pull: 28, name: 'Trống trận', ic: '🥁', double: true },
  { min: 10, pull: 16, name: 'Lực sĩ', ic: '💪' },
  { min: 5, pull: 9, name: 'Cơm nắm', ic: '🍙' },
  { min: 1, pull: 4, name: 'Kẹo lạc', ic: '🍬' },
];

// ---------------------------------------------------------------- helpers (ports of ../dua-bi)
const $ = (id) => document.getElementById(id);
const now = () => Date.now();
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('vi-VN');
const secText = (s) => Number(s).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const mmss = (ms) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
const ascii = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
const phraseOf = (s) => ascii(s).toLowerCase().replace(/[^a-z0-9@ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const store = {
  get(k, d) { try { const v = localStorage.getItem('keoco.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('keoco.' + k, JSON.stringify(v)); } catch {} },
};
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const segmenter = window.Intl && Intl.Segmenter ? new Intl.Segmenter('vi', { granularity: 'grapheme' }) : null;
function graphemes(t) { return segmenter ? [...segmenter.segment(String(t))].map((g) => g.segment) : [...String(t)]; }
function shortName(name, max = 14) {
  const wide = (g) => (/\p{Extended_Pictographic}/u.test(g) ? 2 : 1);
  const g = graphemes(name || '');
  if (g.reduce((w, c) => w + wide(c), 0) <= max) return g.join('');
  let w = 0, out = '';
  for (const c of g) { if (w + wide(c) > max - 1) break; w += wide(c); out += c; }
  return out.trimEnd() + '…';
}
const nm = (name) => esc(shortName(name));
function cleanText(t, max = 70) { return graphemes(String(t || '').replace(/\p{C}+/gu, '').replace(/\s+/gu, ' ').trim()).slice(0, max).join(''); }
function cleanName(t) { return graphemes(String(t || '').replace(/[\p{C}<>]+/gu, '').replace(/\s+/gu, ' ').trim()).slice(0, 24).join('').trim(); }
const handleOf = new Map();
function voiceName(name) {
  const read = (t) => String(t || '').normalize('NFKC').replace(/^@+/, '').replace(/[._\-]+/gu, ' ')
    .replace(/[^\p{Script=Latin}\p{M}\p{N} ]+/gu, ' ').replace(/(?<![\p{Script=Latin}\p{M}])\p{M}+/gu, '').replace(/\s+/g, ' ').trim().normalize('NFC');
  const ok = (t) => /\p{Script=Latin}/u.test(t);
  const n = read(name);
  if (ok(n)) return n;
  const h = read(handleOf.get(name));
  return ok(h) ? h : 'bạn';
}
const Profanity = (() => {
  const WORDS = [
    'địt', 'đụ', 'đéo', 'lồn', 'buồi', 'cặc', 'đĩ', 'điếm', 'cứt',
    'địt mẹ', 'đụ má', 'đụ mẹ', 'đù má', 'đù mé', 'vãi lồn', 'vãi cặc', 'óc chó', 'chó đẻ', 'con đĩ',
    'dm', 'đm', 'dmm', 'đmm', 'dcm', 'đcm', 'dkm', 'đkm', 'cmm', 'cmn', 'clm', 'cl', 'cc', 'vcl', 'vkl', 'vl', 'vcc', 'vcđ',
    'dit me', 'ditme', 'djt', 'djtme', 'du ma', 'duma', 'loz', 'lìn', 'cak', 'cax', 'oc cho', 'occho',
    'fuck', 'fck', 'fuk', 'shit', 'bitch', 'dick', 'pussy', 'motherfucker', 'cunt',
  ];
  const MASK = '***', NAME_INFIX_MIN = 3;
  const reEsc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = (w) => [...w].map((c) => '(?:' + reEsc(c) + ')+').join('');
  function tokens(text) {
    const out = [];
    for (const m of text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
      const word = m[0].toLowerCase(), start = m.index, end = start + m[0].length, single = [...word].length === 1;
      const last = out[out.length - 1];
      if (single && last && last.single && start - last.end <= 3) { last.word += word; last.end = end; continue; }
      out.push({ word, start, end, single });
    }
    return out;
  }
  const entries = WORDS.map((w) => {
    const parts = w.normalize('NFC').split(' ');
    return { parts: parts.map((p) => new RegExp('^' + pattern(p) + '$', 'u')), whole: new RegExp('^' + pattern(parts.join('')) + '$', 'u'), infix: new RegExp(pattern(parts.join('')), 'u'), len: [...parts.join('')].length };
  });
  function matchAt(tk, i) {
    let best = 0;
    for (const e of entries) {
      const k = e.parts.length;
      let whole = i + k <= tk.length;
      for (let j = 0; whole && j < k; j++) whole = e.parts[j].test(tk[i + j].word);
      if (whole) best = Math.max(best, k);
      else if (k > 1 && e.whole.test(tk[i].word)) best = Math.max(best, 1);
    }
    return best;
  }
  function mask(text) {
    text = String(text).normalize('NFC');
    const tk = tokens(text), spans = [];
    tk.forEach((t, i) => { const k = matchAt(tk, i); if (k) spans.push([t.start, tk[i + k - 1].end]); });
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const s of spans) { const l = merged[merged.length - 1]; if (l && s[0] <= l[1]) l[1] = Math.max(l[1], s[1]); else merged.push([...s]); }
    for (const [a, b] of merged.reverse()) text = text.slice(0, a) + MASK + text.slice(b);
    return text;
  }
  function inName(name) {
    const tk = tokens(String(name).normalize('NFC'));
    if (tk.some((_, i) => matchAt(tk, i) > 0)) return true;
    const glued = tk.map((t) => t.word).join('');
    return entries.some((e) => e.len >= NAME_INFIX_MIN && e.infix.test(glued));
  }
  return { mask, inName };
})();
function displayName(u) {
  const n = cleanName(u.name);
  if (graphemes(n).length >= 2 && !Profanity.inName(n)) return n;
  const h = cleanName('@' + (u.handle || u.id));
  return Profanity.inName(h) ? 'Người kéo ẩn danh' : h;
}

// ---------------------------------------------------------------- persistent state
let db = {}; // tiktokId -> { name, handle, total, kills, wins, firstSeen, lastSeen, banned }
let dirty = false;
let sess = null; // { id, start, end, updated, board, names, coins, dmg, kills, wins [2], round, pin }
let sessDirty = false;
let host = '', hosts = [];
let liveOn = false, liveAt = 0;
let voiceOn = store.get('voice', true);
let mainPage = false;
let viewerCount = null;
const freshStats = () => ({ turns: 0, rounds: 0, kills: 0, gifts: 0, points: 0, said: 0, dropped: 0, voice: { A: 0, B: 0, C: 0, skipped: 0 } });
let gstats = freshStats();
const sec = () => Math.floor(now() / 1000);
function touch(user) {
  const id = String(user.id), name = displayName(user);
  let r = db[id];
  if (!r) r = db[id] = { name, handle: user.handle || '', total: 0, kills: 0, wins: 0, firstSeen: sec(), lastSeen: sec(), banned: false };
  else { r.name = name; if (user.handle) r.handle = user.handle; r.lastSeen = sec(); }
  if (r.handle) handleOf.set(name, r.handle);
  dirty = true;
  return r;
}
function sessionId(t) { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; }
function newSession() {
  if (sess && !sess.end) { sess.end = now(); saveLive(); }
  const pin = sess ? sess.pin : null;
  sess = { id: sessionId(now()), start: now(), end: null, updated: now(), board: {}, names: {}, coins: {}, dmg: {}, kills: {}, wins: [0, 0], round: 0, pin };
  sessDirty = true; boardsDirty = true; dmgDirty = true;
  drawPin();
}
function ensureSession() { if (!sess) newSession(); return sess; }
let offSoon = 0;
function onLive() {
  clearTimeout(offSoon); offSoon = 0;
  liveOn = true;
  const t = sess ? (sess.end || sess.updated) : 0;
  if (sess && now() - t < C.RESUME) { sess.end = null; sessDirty = true; } else newSession();
  liveAt = sess.start;
  setStatus();
}
function liveOffSoon() { if (!liveOn || offSoon) { setStatus(); return; } offSoon = setTimeout(() => { offSoon = 0; onLiveOff(); }, C.RECONNECT_GRACE); }
function onLiveOff() {
  clearTimeout(offSoon); offSoon = 0;
  if (!liveOn) { setStatus(); return; }
  liveOn = false;
  if (sess && !sess.end) { sess.end = now(); sessDirty = true; saveLive(); }
  setStatus();
}
function addPoints(id, name, pts) {
  if (pts <= 0) return;
  const r = db[id];
  if (r) { r.total += pts; dirty = true; }
  const s = ensureSession();
  s.board[id] = (s.board[id] || 0) + pts;
  s.names[id] = name;
  s.updated = now();
  sessDirty = true; boardsDirty = true;
  gstats.points += pts;
}
function sessionTop(n = 10) {
  if (!sess) return [];
  return Object.entries(sess.board).filter(([id]) => !db[id]?.banned && db[id]).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([id, pts]) => ({ id, name: db[id]?.name || sess.names[id] || '?', pts }));
}
const coinsOf = (id) => (sess && sess.coins && sess.coins[id]) || 0;
async function loadData() {
  try { const r = await fetch('/data' + DATA_QS, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); db = await r.json(); }
  catch (e) { db = store.get(DEMO ? 'demo.players' : 'players', {}) || {}; dirty = true; console.warn('Không đọc được /data, dùng bản dự phòng trong trình duyệt.', e); }
  try {
    const s = await (await fetch('/live-result' + DATA_QS, { cache: 'no-store' })).json();
    if (s && s.id && s.board && now() - (s.end || s.updated || s.start) < C.RESUME) sess = { names: {}, coins: {}, dmg: {}, kills: {}, wins: [0, 0], round: 0, ...s };
  } catch { /* no previous live */ }
}
let savingData = false;
async function saveData() {
  if (!dirty || savingData || !mainPage) return;
  dirty = false; savingData = true;
  const body = JSON.stringify(db);
  store.set(DEMO ? 'demo.players' : 'players', db);
  try { const r = await fetch('/data' + DATA_QS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); if (!r.ok) throw new Error(r.status); }
  catch (e) { dirty = true; console.warn('Lưu /data lỗi, sẽ thử lại.', e); }
  savingData = false;
}
async function saveLive() {
  if (!sess || !mainPage) return;
  sessDirty = false;
  try { const r = await fetch('/live-result' + DATA_QS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...sess, top: sessionTop(10) }) }); if (!r.ok) throw new Error(r.status); }
  catch { sessDirty = true; }
}
function saveSoon() { saveData(); saveLive(); }
setInterval(() => {
  if (!mainPage) { gstats = freshStats(); return; }
  const body = JSON.stringify({ ...gstats, players: players.size, round: sess ? sess.round : 0, voiceQueue: voiceQ.length });
  gstats = freshStats();
  fetch('/stats' + DATA_QS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
}, 60_000);

// ---------------------------------------------------------------- the rope, the two sides
const W = 1000, H = 886, GROUND = 610, KNOT_RANGE = 150;
const players = new Map(); // id -> { id, name, side, lastPlay, chatAt, bot }
const round = { phase: 'start', at: now(), until: now() + C.START_MS, n: 0, endsAt: 0 };
let pos = 0; // -100 (Phe Trâu has won) .. 100 (Phe Gà has won)
let shownPos = 0, drumUntil = 0, nextDrumAt = 0, lastAuto = 0, lastBot = 0, lastBotCheck = 0;
const tugAt = [0, 0], doubleUntil = [0, 0], brakeUntil = [0, 0];
let floats = [], lastPull = null, shownCache = [[], []], shownAt = 0;
const playing = () => (liveOn || DEMO) && !closing();
const sideCount = (side) => [...players.values()].filter((p) => p.side === side).length;
const realCount = () => [...players.values()].filter((p) => !p.bot).length;
/** Crowds pull harder but the rope is the same length: every pull is scaled down as more people play. */
const crowdScale = () => 1 / Math.max(1, Math.sqrt(players.size / 8));
function pull(side, units, id, name, label) {
  if (round.phase !== 'play') return;
  const t = now();
  let d = units * crowdScale();
  if (drumUntil > t) d *= 2;
  if (doubleUntil[side] > t) d *= 2;
  if (brakeUntil[side] > t) d *= 0.5;
  pos = clamp(pos + (side ? d : -d), -100, 100);
  tugAt[side] = t;
  if (id) {
    addPoints(id, name, Math.max(1, Math.round(units)));
    const s = ensureSession(); s.dmg[id] = (s.dmg[id] || 0) + units; sessDirty = true; dmgDirty = true;
  }
  if (label) { lastPull = { side, text: label, at: t }; floatText(label.split(' ').pop(), knotX() + rand(-30, 30), GROUND - 96, 'pull'); }
  if (Math.abs(pos) >= 100) endRound(pos < 0 ? 0 : 1);
}
/** chat / heart / gift: on a side (chosen, or the smaller one), and kept for HOOK_KICK. */
function join(user, name, want, via) {
  const id = String(user.id);
  let p = players.get(id);
  const fresh = !p;
  if (!p) { p = { id, name, side: null, lastPlay: now(), chatAt: 0 }; players.set(id, p); }
  p.lastPlay = now(); p.name = name;
  const before = p.side;
  const side = want ?? (p.side ?? (sideCount(0) <= sideCount(1) ? 0 : 1));
  p.side = side;
  if (before !== side) {
    joinPill(name, SIDES[side], before != null);
    if (via !== 'bot') greet(name, side);
    boardsDirty = true;
  } else if (fresh) boardsDirty = true;
  return p;
}
function kickTick() {
  const t = now();
  for (const p of [...players.values()]) if (!p.bot && t - p.lastPlay > C.HOOK_KICK) { players.delete(p.id); boardsDirty = true; }
}
/** Under BOT_UNDER real players, BOT_COUNT 🤖 players pull along (never scored); they leave when the crowd is there. */
function botTick(t) {
  if (t - lastBotCheck < 1000) return;
  lastBotCheck = t;
  const bots = [...players.values()].filter((p) => p.bot);
  if (realCount() >= C.BOT_UNDER) { for (const b of bots) players.delete(b.id); if (bots.length) boardsDirty = true; return; }
  for (let i = bots.length; i < C.BOT_COUNT; i++) {
    const side = sideCount(0) <= sideCount(1) ? 0 : 1, sd = SIDES[side], used = new Set(bots.map((b) => b.name));
    const name = '🤖 ' + (sd.bots.find((n) => !used.has('🤖 ' + n)) || sd.bots[0]);
    const b = { id: 'bot-' + i + '-' + t, name, side, lastPlay: t, chatAt: 0, bot: true };
    players.set(b.id, b); bots.push(b); boardsDirty = true;
  }
}

// ---------------------------------------------------------------- rounds
function startRound() {
  const s = ensureSession();
  s.round = (s.round || 0) + 1; round.n = s.round; sessDirty = true;
  pos = 0; floats = []; lastPull = null;
  doubleUntil[0] = doubleUntil[1] = brakeUntil[0] = brakeUntil[1] = drumUntil = 0;
  nextDrumAt = now() + rand(...C.DRUM_EVERY);
  round.phase = 'play'; round.endsAt = now() + C.ROUND_MS;
  gstats.rounds++;
  const b = $('banner');
  b.className = 'banner round';
  b.innerHTML = `<div class="t">VÒNG ${round.n}</div><div class="n">🪢 KÉO NÀO!</div><div class="s">🐃 Phe Trâu đấu 🐓 Phe Gà</div>`.replace('🪢', '💪');
  b.hidden = false; setTimeout(() => { if (b.classList.contains('round')) b.hidden = true; }, 2200);
  say(`Vòng ${round.n}! Phe trâu đấu phe gà, kéo nào!`, 'B');
  fanfare();
}
function endRound(win) {
  if (round.phase !== 'play') return;
  round.phase = 'result'; round.until = now() + C.RESULT_MS;
  const s = ensureSession(), b = $('banner');
  b.className = 'banner ' + (win === 1 ? 'cf' : 'ts');
  if (win < 0) {
    b.innerHTML = `<div class="t">VÒNG ${round.n}</div><div class="n">🤝 HOÀ!</div><div class="s">Hai phe ngang sức ngang tài</div>`;
    say(`Vòng ${round.n} hoà! Hai phe ngang sức ngang tài!`, 'A');
  } else {
    s.wins[win] = (s.wins[win] || 0) + 1; sessDirty = true;
    const sd = SIDES[win];
    let k = 0;
    for (const p of players.values()) if (p.side === win && !p.bot) { addPoints(p.id, p.name, C.WIN_PTS); const r = db[p.id]; if (r) { r.wins = (r.wins || 0) + 1; dirty = true; } k++; }
    b.innerHTML = `<div class="t">VÒNG ${round.n}</div><div class="n">${sd.ic} PHE ${sd.name.toUpperCase()} THẮNG!</div><div class="s">${k ? `mỗi người phe ${sd.name} +${C.WIN_PTS} điểm` : 'chat tên phe để cùng kéo nhé'}</div><div class="s">Tỉ số buổi: 🐃 ${s.wins[0]} – ${s.wins[1]} 🐓</div>`;
    fanfare(); if (!REDUCED) flash();
    say(`Phe ${sd.name} thắng vòng ${round.n}! Tỉ số trâu ${s.wins[0]}, gà ${s.wins[1]}.`, 'A');
  }
  b.hidden = false;
  setTimeout(() => { if (b.classList.contains('ts') || b.classList.contains('cf')) b.hidden = true; }, C.RESULT_MS - 1000);
  boardsDirty = true; saveSoon();
}
function roundTick() {
  const t = now();
  if (!playing()) return;
  botTick(t);
  if (round.phase === 'start' || round.phase === 'result') { if (t >= round.until) startRound(); return; }
  if (t >= round.endsAt) { endRound(Math.abs(pos) < C.DRAW_WITHIN ? -1 : pos < 0 ? 0 : 1); return; }
  if (t - lastAuto >= 1000) { // everyone on the rope leans back a little; the middle pulls the rope back a touch
    lastAuto = t;
    for (const side of [0, 1]) pull(side, sideCount(side) * C.AUTO_PULL, null);
    pos *= C.CENTER_PULL;
  }
  if (t - lastBot >= 500) {
    lastBot = t;
    const bots = [...players.values()].filter((p) => p.bot);
    if (bots.length && Math.random() < 0.7) pull(pick(bots).side, C.CHAT_PULL, null);
  }
  if (t >= nextDrumAt) {
    nextDrumAt = t + rand(...C.DRUM_EVERY); drumUntil = t + C.DRUM_MS;
    alertBox(`<span class="ic">🥁</span><span><b>Trống hội!</b><small>${C.DRUM_MS / 1000} giây mọi cú kéo gấp đôi</small></span>`, 'gold');
    say('Trống hội nổi lên, kéo gấp đôi nào!', 'B');
    for (let i = 0; i < 6; i++) tone(120, 0.4, 0.18, 'sine', i * 0.28, 0.7);
  }
}
function step(dt) {
  shownPos += (pos - shownPos) * Math.min(1, dt * 8);
  for (const f of floats) { f.t += dt; f.y += f.vy * dt; if (f.kind === 'dot') { f.x += f.vx * dt; f.vy += 300 * dt; } }
  floats = floats.filter((f) => f.t < f.life);
}
function floatText(text, x, y, cls) { floats.push({ kind: 'text', text, x, y, vy: -50, life: 1.1, t: 0, cls }); }
function puff(x, y, color, n) { if (REDUCED) return; for (let i = 0; i < n; i++) floats.push({ kind: 'dot', x, y, vx: rand(-110, 110), vy: rand(-160, -40), life: 0.6, t: 0, color, r: rand(3, 6) }); }

// ---------------------------------------------------------------- drawing (canvas)
const cv = $('cv'), g = cv.getContext('2d');
let CW = 0, CH = 0, S = 1, bgArt = null;
function resize() {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  CW = Math.max(1, Math.round(r.width * dpr)); CH = Math.max(1, Math.round(r.height * dpr));
  cv.width = CW; cv.height = CH;
  S = CW / W;
}
const knotX = () => W / 2 + (shownPos / 100) * KNOT_RANGE;
/** The village festival behind the rope: painted once. */
function paintVillage() {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, '#8fd0f2'); sky.addColorStop(1, '#fff1cf');
  x.fillStyle = sky; x.fillRect(0, 0, W, GROUND);
  // far hills
  x.fillStyle = '#a7c9a0'; x.beginPath(); x.moveTo(0, 430);
  for (let px = 0; px <= W; px += 20) x.lineTo(px, 400 - 50 * Math.sin(px / 150) - 24 * Math.sin(px / 47));
  x.lineTo(W, GROUND); x.lineTo(0, GROUND); x.fill();
  // the communal house, in the middle
  x.fillStyle = '#b5532f'; x.beginPath(); x.moveTo(250, 380); x.quadraticCurveTo(500, 300, 750, 380); x.lineTo(700, 430); x.lineTo(300, 430); x.fill();
  x.strokeStyle = '#8f3d22'; x.lineWidth = 2; for (let px = 300; px < 700; px += 16) { x.beginPath(); x.moveTo(px, 345 + Math.abs(px - 500) * 0.12); x.lineTo(px - (500 - px) * 0.08, 430); x.stroke(); }
  x.fillStyle = '#e8d3a2'; x.fillRect(320, 430, 360, 110);
  x.fillStyle = '#7a3b22'; for (let px = 345; px < 680; px += 60) x.fillRect(px, 450, 34, 90);
  x.fillStyle = '#6d4c41'; x.fillRect(310, 430, 12, 110); x.fillRect(678, 430, 12, 110);
  // banyan trees at the sides
  for (const tx of [90, 910]) { x.fillStyle = '#6d4c41'; x.fillRect(tx - 18, 400, 36, 190); x.fillStyle = '#4f9a3e'; for (let i = 0; i < 26; i++) { x.beginPath(); x.arc(tx + (Math.sin(i * 2.4) * 80), 370 + Math.cos(i * 1.7) * 62, 34, 0, 7); x.fill(); } }
  // bunting
  const colors = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#fb8c00'];
  for (let i = 0; i <= 26; i++) { const px = 60 + i * 34, py = 230 + Math.sin((i / 26) * Math.PI) * 44; x.fillStyle = colors[i % 5]; x.beginPath(); x.moveTo(px - 11, py); x.lineTo(px + 11, py); x.lineTo(px, py + 24); x.fill(); }
  x.strokeStyle = '#5d4037'; x.lineWidth = 2; x.beginPath(); for (let i = 0; i <= 26; i++) { const px = 60 + i * 34, py = 230 + Math.sin((i / 26) * Math.PI) * 44; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke();
  // yard
  const yard = x.createLinearGradient(0, GROUND - 60, 0, H);
  yard.addColorStop(0, '#c79a63'); yard.addColorStop(1, '#8d6239');
  x.fillStyle = yard; x.fillRect(0, GROUND - 40, W, H - GROUND + 40);
  // the crowd watching, behind the yard's front edge
  for (let i = 0; i < 46; i++) { const px = 12 + i * 22 + Math.sin(i * 3) * 6, py = H - 74 + Math.sin(i * 1.7) * 16; x.fillStyle = colors[i % 5]; x.beginPath(); x.ellipse(px, py + 26, 14, 24, 0, 0, 7); x.fill(); x.fillStyle = '#f2c79b'; x.beginPath(); x.arc(px, py - 6, 11, 0, 7); x.fill(); x.fillStyle = '#3e2723'; x.beginPath(); x.arc(px, py - 11, 11, Math.PI, 0); x.fill(); }
  // the mud in the middle and the two win lines
  x.fillStyle = '#6b4a2b'; x.beginPath(); x.ellipse(W / 2, GROUND + 26, 120, 26, 0, 0, 7); x.fill();
  x.fillStyle = '#8a6540'; x.beginPath(); x.ellipse(W / 2 - 20, GROUND + 22, 60, 10, 0, 0, 7); x.fill();
  for (const lx of [W / 2 - KNOT_RANGE, W / 2 + KNOT_RANGE]) { x.fillStyle = '#fff'; x.fillRect(lx - 3, GROUND - 16, 6, 82); }
  return c;
}
/** Which players stand on the rope: the strongest pullers first, then the bots. */
function shownPlayers(side) {
  const t = now();
  if (t - shownAt > 1000) {
    shownAt = t;
    const d = (sess && sess.dmg) || {};
    for (const sd of [0, 1]) shownCache[sd] = [...players.values()].filter((p) => p.side === sd).sort((a, b) => (a.bot - b.bot) || ((d[b.id] || 0) - (d[a.id] || 0))).slice(0, C.SHOWN);
  }
  return shownCache[side];
}
function drawRope(kx, t) {
  g.lineCap = 'round';
  const y = GROUND - 44, sag = (x) => y + Math.sin(((x - kx + 460) / 920) * Math.PI) * 5;
  g.strokeStyle = '#6d4a2a'; g.lineWidth = 10; g.beginPath(); for (let x = kx - 460; x <= kx + 460; x += 12) (x === kx - 460 ? g.moveTo(x, sag(x)) : g.lineTo(x, sag(x))); g.stroke();
  g.strokeStyle = '#c8a06a'; g.lineWidth = 6; g.setLineDash([9, 7]); g.beginPath(); for (let x = kx - 460; x <= kx + 460; x += 12) (x === kx - 460 ? g.moveTo(x, sag(x)) : g.lineTo(x, sag(x))); g.stroke(); g.setLineDash([]);
  // the cloth tied at the middle of the rope
  g.fillStyle = '#e53935'; g.beginPath(); g.moveTo(kx - 9, y); g.lineTo(kx + 9, y); g.lineTo(kx + 18 + Math.sin(t / 130) * 4, y + 46); g.lineTo(kx - 18 + Math.sin(t / 130) * 4, y + 46); g.closePath(); g.fill();
  g.fillStyle = '#fdd835'; g.beginPath(); g.arc(kx, y, 12, 0, 7); g.fill(); g.strokeStyle = '#b28900'; g.lineWidth = 3; g.stroke();
}
function drawPuller(p, side, i, kx, t) {
  const sd = SIDES[side], dir = side ? 1 : -1, k = clamp(1 - (now() - tugAt[side]) / 240, 0, 1);
  const x = kx + dir * (72 + i * 42) + dir * 7 * k, y = GROUND + (i % 2) * 8;
  g.save(); g.translate(x, y);
  g.scale(side ? 1.3 : -1.3, 1.3); // drawn facing left (towards the knot) for Phe Gà; mirrored for Phe Trâu
  g.rotate(-0.1 - 0.1 * k); // leaning back
  const leg = Math.sin(t / 130 + i) * (k > 0 ? 3 : 1);
  if (side === 0) {
    // a water buffalo, standing up to pull
    g.fillStyle = '#5b6a78';
    g.fillRect(-11, -14, 7, 14 + leg); g.fillRect(3, -14, 7, 14 - leg);
    g.beginPath(); g.ellipse(0, -28, 19, 21, 0, 0, 7); g.fill();
    g.fillStyle = '#8795a3'; g.beginPath(); g.ellipse(-1, -24, 10, 13, 0, 0, 7); g.fill();
    g.strokeStyle = '#5b6a78'; g.lineWidth = 6; g.beginPath(); g.moveTo(-10, -32); g.lineTo(-22, -32); g.stroke();
    g.fillStyle = '#5b6a78'; g.beginPath(); g.ellipse(-8, -52, 15, 13, 0, 0, 7); g.fill();
    g.fillStyle = '#d7b9a0'; g.beginPath(); g.ellipse(-17, -47, 8, 6, 0, 0, 7); g.fill();
    g.strokeStyle = '#efe5cf'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(-2, -61); g.quadraticCurveTo(12, -66, 8, -80); g.moveTo(-14, -62); g.quadraticCurveTo(-26, -70, -18, -82); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(-12, -55, 3.2, 0, 7); g.fill(); g.fillStyle = '#222'; g.beginPath(); g.arc(-13, -55, 1.7, 0, 7); g.fill();
  } else {
    // a rooster
    g.strokeStyle = '#f9a825'; g.lineWidth = 4; g.beginPath(); g.moveTo(-6, -14); g.lineTo(-7, 0 + leg); g.moveTo(5, -14); g.lineTo(6, 0 - leg); g.stroke();
    g.fillStyle = '#2e7d6b'; g.beginPath(); g.moveTo(12, -32); g.quadraticCurveTo(34, -58, 26, -28); g.quadraticCurveTo(36, -34, 24, -18); g.closePath(); g.fill();
    g.fillStyle = '#e8772e'; g.beginPath(); g.ellipse(0, -28, 17, 18, 0, 0, 7); g.fill();
    g.fillStyle = '#ffb74d'; g.beginPath(); g.ellipse(1, -25, 9, 12, 0, 0, 7); g.fill();
    g.strokeStyle = '#e8772e'; g.lineWidth = 5; g.beginPath(); g.moveTo(-8, -32); g.lineTo(-20, -32); g.stroke();
    g.fillStyle = '#e8772e'; g.beginPath(); g.arc(-7, -52, 11, 0, 7); g.fill();
    g.fillStyle = '#e53935'; for (const [cx, cy] of [[-12, -63], [-6, -65], [0, -62]]) { g.beginPath(); g.arc(cx, cy, 4.5, 0, 7); g.fill(); }
    g.fillStyle = '#fdd835'; g.beginPath(); g.moveTo(-17, -55); g.lineTo(-27, -51); g.lineTo(-17, -48); g.fill();
    g.fillStyle = '#e53935'; g.beginPath(); g.ellipse(-15, -44, 3, 5, 0, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(-10, -55, 3, 0, 7); g.fill(); g.fillStyle = '#222'; g.beginPath(); g.arc(-11, -55, 1.6, 0, 7); g.fill();
  }
  g.save(); g.translate(side ? -7 : -8, side ? -67 : -64); drawHat(hash(p.id) % 20, t); g.restore();
  g.restore();
  // name, three staggered rows so that neighbours do not overlap
  const label = shortName(p.name, 8), ny = y - 116 - (i % 3) * 27; // 09/11: bigger, readable at 720p
  g.font = '900 23px "Segoe UI",Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(label, x, ny);
  g.fillStyle = p.bot ? '#e0e0e0' : side ? '#ffcc99' : '#b9e3ff'; g.fillText(label, x, ny);
  if (!p.bot && heartBoost(p.id) > 0.3) g.fillText('❤', x + 4 + g.measureText(label).width / 2 + 6, ny);
}
/**
 * Twenty funny hats, one per player, drawn with (0, 0) at the top of the shell, about 26 wide.
 * 0 nón lá, 1 vương miện, 2 mũ chóp cao, 3 mũ sinh nhật, 4 mũ cánh quạt, 5 mũ đầu bếp, 6 mũ cao bồi, 7 mũ len quả bông,
 * 8 mũ Noel, 9 mũ cướp biển, 10 sừng kỳ lân, 11 mũ cử nhân, 12 vỏ dưa hấu, 13 tai mèo, 14 mũ sừng, 15 mũ nồi,
 * 16 mũ thuyền trưởng, 17 mũ lưỡi trai ngược, 18 bông hoa, 19 mũ phù thuỷ.
 */
const HAT_NAMES = ['Nón lá', 'Vương miện', 'Mũ chóp cao', 'Mũ sinh nhật', 'Mũ cánh quạt', 'Mũ đầu bếp', 'Mũ cao bồi', 'Mũ len', 'Mũ Noel', 'Mũ cướp biển',
  'Sừng kỳ lân', 'Mũ cử nhân', 'Mũ dưa hấu', 'Tai mèo', 'Mũ sừng', 'Mũ nồi', 'Mũ thuyền trưởng', 'Mũ lưỡi trai', 'Bông hoa', 'Mũ phù thuỷ'];
function drawHat(k, t) {
  const P = (pts, fill, stroke) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); } };
  const E = (x, y, rx, ry, fill, a0 = 0, a1 = 7) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, a0, a1); g.fillStyle = fill; g.fill(); };
  const R = (x, y, w, h, fill) => { g.fillStyle = fill; g.fillRect(x, y, w, h); };
  switch (k % 20) {
    case 0: P([[-15, 2], [0, -12], [15, 2]], '#e8d29a', '#b89c5a'); g.strokeStyle = '#b89c5a'; g.beginPath(); g.moveTo(-8, -3); g.lineTo(8, -3); g.stroke(); break; // nón lá
    case 1: P([[-10, 2], [-11, -9], [-5, -4], [0, -12], [5, -4], [11, -9], [10, 2]], '#ffd54f', '#c79a00'); E(0, -6, 2, 2, '#e53935'); E(-6, -1, 1.5, 1.5, '#42a5f5'); E(6, -1, 1.5, 1.5, '#66bb6a'); break; // vương miện
    case 2: E(0, 1, 14, 3, '#212121'); R(-8, -16, 16, 17, '#212121'); R(-8, -4, 16, 3, '#e53935'); break; // chóp cao
    case 3: P([[-8, 2], [0, -18], [8, 2]], '#ab47bc'); g.strokeStyle = '#ffeb3b'; g.lineWidth = 2; g.beginPath(); g.moveTo(-5, -5); g.lineTo(5, -9); g.moveTo(-3, -11); g.lineTo(3, -13); g.stroke(); E(0, -19, 3, 3, '#ff7043'); break; // sinh nhật
    case 4: E(0, 1, 11, 9, '#e53935', Math.PI, 0); R(-1, -12, 2, 5, '#424242'); { const a = t / 90; g.save(); g.translate(0, -13); g.rotate(a); E(0, 0, 10, 2.5, '#ffeb3b'); g.restore(); } break; // cánh quạt
    case 5: R(-7, -6, 14, 8, '#fafafa'); E(-5, -9, 5, 5, '#fafafa'); E(0, -12, 6, 6, '#fafafa'); E(5, -9, 5, 5, '#fafafa'); g.strokeStyle = '#bdbdbd'; g.lineWidth = 1; g.strokeRect(-7, -6, 14, 8); break; // đầu bếp
    case 6: E(0, 1, 16, 4, '#8d6e63'); P([[-8, 1], [-7, -9], [-2, -6], [0, -10], [2, -6], [7, -9], [8, 1]], '#a1887f'); R(-8, -2, 16, 2, '#5d4037'); break; // cao bồi
    case 7: E(0, 1, 11, 10, '#29b6f6', Math.PI, 0); R(-11, -1, 22, 4, '#e3f2fd'); E(0, -11, 4, 4, '#fff'); break; // mũ len
    case 8: P([[-11, 1], [-2, -15], [9, -6], [11, 1]], '#e53935'); R(-12, -1, 24, 4, '#fff'); E(9, -7, 3.5, 3.5, '#fff'); break; // Noel
    case 9: P([[-14, 1], [-9, -10], [0, -6], [9, -10], [14, 1]], '#212121'); g.fillStyle = '#fff'; g.font = '8px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('☠', 0, -3); break; // cướp biển
    case 10: P([[-3, 0], [0, -18], [3, 0]], '#ffd1e8', '#e091b6'); g.strokeStyle = '#e091b6'; g.beginPath(); for (let y = -3; y > -16; y -= 4) { g.moveTo(-2, y); g.lineTo(2, y - 2); } g.stroke(); break; // kỳ lân
    case 11: R(-3, -6, 6, 6, '#263238'); P([[-13, -6], [0, -11], [13, -6], [0, -1]], '#263238'); g.strokeStyle = '#ffca28'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -6); g.lineTo(9, -3); g.lineTo(9, 3); g.stroke(); break; // cử nhân
    case 12: E(0, 1, 12, 11, '#43a047', Math.PI, 0); E(0, 1, 9.5, 8.5, '#e53935', Math.PI, 0); g.fillStyle = '#212121'; for (const [x, y] of [[-4, -3], [0, -6], [4, -3]]) { g.beginPath(); g.ellipse(x, y, 1, 1.6, 0, 0, 7); g.fill(); } break; // dưa hấu
    case 13: P([[-10, 1], [-8, -10], [-3, -1]], '#ff8a65'); P([[10, 1], [8, -10], [3, -1]], '#ff8a65'); P([[-8.5, -1], [-7.5, -6], [-5, -1]], '#ffccbc'); P([[8.5, -1], [7.5, -6], [5, -1]], '#ffccbc'); break; // tai mèo
    case 14: E(0, 1, 10, 9, '#9e9e9e', Math.PI, 0); P([[-9, -3], [-16, -12], [-11, -1]], '#fff8e1', '#bcaaa4'); P([[9, -3], [16, -12], [11, -1]], '#fff8e1', '#bcaaa4'); break; // sừng
    case 15: E(0, -2, 12, 5, '#c62828'); R(-1, -9, 2, 3, '#c62828'); break; // mũ nồi
    case 16: E(0, -4, 11, 6, '#fafafa'); R(-10, -3, 20, 4, '#1a237e'); E(0, 1, 12, 2, '#212121', 0, Math.PI); E(0, -5, 2.5, 2, '#ffca28'); break; // thuyền trưởng
    case 17: E(0, 1, 10, 9, '#ff9800', Math.PI, 0); R(-17, -2, 9, 3, '#ff9800'); E(0, -8, 2, 2, '#e65100'); break; // lưỡi trai ngược
    case 18: { R(-1, -10, 2, 10, '#43a047'); for (let i = 0; i < 6; i++) E(Math.cos(i * 1.05) * 5, -12 + Math.sin(i * 1.05) * 5, 3.5, 3.5, '#f06292'); E(0, -12, 3, 3, '#ffeb3b'); } break; // bông hoa
    default: E(0, 1, 15, 3.5, '#5e35b1'); P([[-8, 1], [-2, -14], [6, -20], [3, -12], [8, 1]], '#5e35b1'); E(2, -2, 2, 2, '#ffeb3b'); break; // phù thuỷ
  }
}
function drawScene(t) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#8fd0f2'; g.fillRect(0, 0, CW, CH);
  if (!bgArt) return;
  g.setTransform(S, 0, 0, S, 0, 0);
  g.drawImage(bgArt, 0, 0);
  const kx = knotX();
  if (drumUntil > now()) { const k = 0.5 + 0.5 * Math.sin(t / 90); g.globalAlpha = 0.18 + 0.15 * k; g.fillStyle = '#ffd54f'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
  // rope behind the players of the back row, then each side from the far end towards the knot
  for (const side of [0, 1]) { const list = shownPlayers(side); for (let i = list.length - 1; i >= 0; i--) drawPuller(list[i], side, i, kx, t); }
  drawRope(kx, t);
  for (const f of floats) {
    const a = 1 - f.t / f.life;
    if (f.kind === 'dot') { g.globalAlpha = a; g.fillStyle = f.color; g.beginPath(); g.arc(f.x, f.y, f.r, 0, 7); g.fill(); g.globalAlpha = 1; continue; }
    g.globalAlpha = a; g.font = '900 26px "Segoe UI",Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 4; g.strokeStyle = '#000'; g.strokeText(f.text, f.x, f.y); g.fillStyle = '#ffd54f'; g.fillText(f.text, f.x, f.y); g.globalAlpha = 1;
  }
}
let lastFrame = 0, lastSim = now();
function frame(t) {
  requestAnimationFrame(frame);
  if (t - lastFrame < 30) return;
  lastFrame = t;
  const n = now(), dt = Math.min(0.1, (n - lastSim) / 1000); lastSim = n;
  step(dt);
  drawScene(t);
}

// ---------------------------------------------------------------- panels and bars
let boardsDirty = true, dmgDirty = true, rightTab = 0, rightTabAt = 0;
const medal = ['🥇', '🥈', '🥉'];
function drawBoards() {
  boardsDirty = false;
  const top = sessionTop(3);
  $('top3').innerHTML = [0, 1, 2].map((i) => {
    const x = top[i];
    if (!x) return `<div class="t3 empty"><span class="md">${medal[i]}</span><span class="nm">còn trống</span></div>`;
    const p = players.get(x.id), side = p && p.side != null ? SIDES[p.side].ic : '';
    return `<div class="t3 r${i}"><span class="md">${medal[i]}</span><span class="nm">${nm(x.name)}</span><span class="pt">${fmt(x.pts)}</span><span class="wp">${side}</span></div>`;
  }).join('');
  const donors = sess ? Object.entries(sess.coins || {}).filter(([id, c]) => c > 0 && !db[id]?.banned).sort((a, b) => b[1] - a[1]).slice(0, 5) : [];
  setHtml('donors', donors.length
    ? donors.map(([id, c], i) => `<li${i === 0 ? ' class="king"' : ''}><span class="rk">${i === 0 ? '👑' : i + 1}</span><span class="nm">${nm(db[id]?.name || sess.names[id] || '?')}</span><span class="c">${fmt(c)} xu</span></li>`).join('')
    : '<li class="empty">Chưa có ai. Tặng quà để kéo cực mạnh cho phe bạn!</li>');
}
function showRightTab(i) {
  rightTab = i; rightTabAt = now();
  $('tabRich').classList.toggle('on', i === 0); $('tabDmg').classList.toggle('on', i === 1);
  $('donors').hidden = i !== 0; $('dmgList').hidden = i !== 1;
  if (i === 1) drawDamage();
}
const shortNum = (n) => (n >= 10_000 ? (n / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + 'k' : fmt(n));
function drawDamage() {
  dmgDirty = false;
  const rows = sess ? Object.entries(sess.dmg || {}).filter(([id, d]) => d > 0 && !db[id]?.banned).sort((a, b) => b[1] - a[1]).slice(0, 15) : [];
  setHtml('dmgList', rows.length
    ? rows.map(([id, d], i) => `<li${i < 3 ? ` class="t${i}"` : ''}><span class="rk">${i < 3 ? medal[i] : i + 1}</span><span class="nm">${nm(db[id]?.name || sess.names[id] || '?')}</span><span class="c">${shortNum(d)}</span></li>`).join('')
    : '<li class="empty">Chưa ai kéo. Chat trâu hoặc gà để vào phe!</li>');
}
function drawWeapons() {
  $('weapons').innerHTML = '<div class="w-t">🎁 TẶNG QUÀ → KÉO MẠNH</div><ol class="w-grid">'
    + [...GIFT_PULLS].reverse().map((r) => `<li class="wt" data-min="${r.min}"><span class="wx">${r.min} xu</span><span class="wi">${r.ic}</span><span class="wn">${esc(r.name)}</span></li>`).join('')
    + `<li class="wt free"><span class="wx">miễn phí</span><span class="wi">❤</span><span class="wn">Tim, chat</span></li></ol>`
    + `<div class="w-s">🥁 kéo gấp đôi 8 giây · ⚓ phe kia yếu nửa 8 giây · +${C.GIFT_POINTS_PER_COIN} điểm mỗi xu</div>`;
}
function weaponHit(min) {
  const el = document.querySelector(`#weapons .wt[data-min="${min}"]`);
  if (!el) return;
  el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
}
function drawHud() {
  const t = now(), s = sess || { wins: [0, 0] };
  for (const sd of SIDES) {
    const share = sd.id ? (100 + pos) / 2 : (100 - pos) / 2, people = sideCount(sd.id);
    setHtml('side' + sd.id, `<div class="sn">${sd.ic} ${sd.name} <em>${s.wins[sd.id] || 0}</em></div><div class="sb"><i style="width:${share}%"></i></div><div class="ss">${Math.round(share)}% · ${people} người kéo</div>`);
  }
  let mid;
  if (!playing()) mid = closing() ? '🌙 Nghỉ' : '⏳ Chờ live';
  else if (round.phase === 'play') mid = `Vòng ${round.n}<b>${drumUntil > t ? '🥁 Trống hội ×2' : '💪 Kéo nào!'}</b>${mmss(Math.max(0, round.endsAt - t))}`;
  else mid = round.phase === 'result' ? `Vòng ${round.n + 1}<b>sắp bắt đầu</b>${Math.max(0, Math.ceil((round.until - t) / 1000))}s` : '<b>Sắp bắt đầu</b>';
  setHtml('roundMid', mid);
  const tc = $('turnChip');
  if (lastPull && t - lastPull.at < 3000 && round.phase === 'play') { tc.hidden = false; setHtml('turnChip', `${SIDES[lastPull.side].ic} ${lastPull.text}`); }
  else tc.hidden = true;
  if (boardsDirty) drawBoards();
  if (t - rightTabAt > C.RIGHT_TAB_MS) showRightTab(1 - rightTab);
  else if (rightTab === 1 && dmgDirty) drawDamage();
}
function setHtml(id, html) { const el = $(id); if (el && el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; } }
function joinPill(name, sd, switched) {
  const box = $('joins'), a = document.createElement('div');
  a.className = 'jp ' + (sd.id ? 'cf' : 'ts'); a.innerHTML = `${sd.ic} <b>${nm(name)}</b> ${switched ? 'chuyển sang' : 'vào'} phe ${sd.name}!`;
  box.appendChild(a);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => { a.classList.add('out'); setTimeout(() => a.remove(), 500); }, 3000);
}
function alertBox(html, cls = '') {
  const box = $('alerts');
  const a = document.createElement('div'); a.className = 'alert ' + cls; a.innerHTML = html;
  box.appendChild(a);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => { a.classList.add('out'); setTimeout(() => a.remove(), 600); }, 4500);
}
let sseUp = false;
function setStatus() {
  const el = $('status');
  el.classList.toggle('on', liveOn); el.classList.toggle('demo', DEMO && !liveOn);
  el.querySelector('span').textContent = liveOn ? 'Đã nối TikTok LIVE' + (host ? ' @' + host : '') : DEMO ? 'Chế độ thử' : sseUp ? (host ? 'Đang chờ @' + host + ' lên live…' : 'Chưa đặt TIKTOK_USERNAME') : 'Mất kết nối với máy chủ…';
}

// ---------------------------------------------------------------- effects and sound
function flash() { const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
function shake() { const a = $('app'); a.classList.remove('shake'); void a.offsetWidth; a.classList.add('shake'); }
let ctx = null, master = null, musicGain = null, sfxGain = null, musicOn = false;
const MUSIC_VOL = 0.5;
function ac() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = MUSIC_VOL; musicGain.connect(master);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 0.8; sfxGain.connect(master);
      ctx.addEventListener('statechange', soundGate);
    } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
function tone(f, gn, d, type = 'sine', at = 0, bend = 1, out) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + at, o = c.createOscillator(), v = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (bend !== 1) o.frequency.exponentialRampToValueAtTime(f * bend, t + d);
  v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(gn, t + 0.01); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(v).connect(out || sfxGain); o.start(t); o.stop(t + d + 0.05);
}
function chime(rank) { [523, 659, 784, 1047, 1319].slice(0, 2 + rank).forEach((f, i) => tone(f, 0.14, 0.5, 'triangle', i * 0.08)); }
function fanfare() { [[523, 0], [659, 0.15], [784, 0.3], [1047, 0.45], [784, 0.7], [1047, 0.85]].forEach(([f, a]) => { tone(f, 0.2, 0.6, 'triangle', a); tone(f / 2, 0.1, 0.6, 'sine', a); }); }
let bgm = null, playlist = [], track = -1;
function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
async function startMusic() {
  const c = ac(); if (!c || musicOn) return;
  musicOn = true;
  let files = [];
  try { files = await (await fetch('/music', { cache: 'no-store' })).json(); } catch { /* none */ }
  if (!Array.isArray(files) || !files.length) return;
  playlist = shuffle(files);
  bgm = new Audio(); bgm.preload = 'auto';
  const gn = c.createGain(); gn.gain.value = 0.55;
  c.createMediaElementSource(bgm).connect(gn).connect(musicGain);
  let fails = 0;
  bgm.addEventListener('ended', nextTrack);
  bgm.addEventListener('playing', () => { fails = 0; soundGate(); });
  bgm.addEventListener('error', () => { console.warn('Không phát được nhạc', bgm.src); if (++fails < playlist.length) nextTrack(); }); // a broken file: the next one
  nextTrack();
}
function nextTrack() { if (!bgm) return; track = (track + 1) % playlist.length; bgm.src = '/audio/' + encodeURIComponent(playlist[track]); bgm.play().catch(() => {}); }
function resumeMusic() { if (bgm && bgm.paused && bgm.src) bgm.play().catch(() => {}); }
function duck(on) { if (musicGain && ctx) musicGain.gain.setTargetAtTime(on ? MUSIC_VOL * 0.3 : MUSIC_VOL, ctx.currentTime, 0.25); }
function soundGate() { $('sound').hidden = !!ctx && ctx.state === 'running' && (!bgm || !bgm.paused); }

// ---------------------------------------------------------------- voice (3 tiers, as in Câu Cá)
const voiceQ = []; let voicing = false;
let voiceMode = ['it', 'vua', 'nhieu'].includes(store.get('voiceMode')) ? store.get('voiceMode') : 'vua';
const voiceLog = []; let lastB = 0, voiceQuietSince = 0;
function canSay(tier) {
  if (!VOICE_PARAM || !voiceOn || !mainPage) return false;
  if (voiceMode === 'nhieu' || tier === 'A') return true;
  const t = now();
  while (voiceLog.length && t - voiceLog[0] > 60_000) voiceLog.shift();
  if (voiceMode === 'it' || voiceLog.length >= C.VOICE_PER_MIN) return false;
  return tier === 'B' ? t - lastB >= C.VOICE_B_GAP : !voicing && !voiceQ.length && t - voiceQuietSince >= C.VOICE_C_QUIET;
}
function say(text, tier = 'C') {
  if (!VOICE_PARAM || !voiceOn || !text || !mainPage) return false;
  if (tier === true) tier = 'A';
  if (!canSay(tier)) { gstats.voice.skipped++; return false; }
  const t = now();
  if (tier === 'B') lastB = t;
  voiceLog.push(t); gstats.voice[tier]++; gstats.said++;
  if (tier === 'A') voiceQ.splice(voiceQ.filter((x) => x.a).length, 0, { text, a: true }); else voiceQ.push({ text });
  while (voiceQ.length > C.VOICE_QUEUE) { const i = voiceQ.findIndex((x) => !x.a); voiceQ.splice(i < 0 ? voiceQ.length - 1 : i, 1); gstats.dropped++; }
  if (!voicing) nextVoice();
  return true;
}
function nextVoice() {
  const item = voiceQ.shift(), text = item && item.text;
  if (!text) { voicing = false; voiceQuietSince = now(); duck(false); return; }
  voicing = true; duck(true);
  const a = new Audio('/tts' + DATA_QS + '&text=' + encodeURIComponent(text));
  const done = () => { a.onended = a.onerror = null; setTimeout(nextVoice, 350); };
  a.onended = done; a.onerror = done;
  a.play().catch(done);
}
const greetWait = [[], []]; let lastGreet = 0, tipTurn = 0, lastActive = 0, lastAmbience = 0, nextRemind = 0, nextAssist = 0;
const TIPS = [
  'Chat trâu hoặc gà là vào phe đó, mỗi lần chat là một lần kéo.',
  'Càng nhiều tim, phe của bạn kéo càng khoẻ.',
  'Tặng quà là kéo cực mạnh cho phe mình, quà lớn còn làm phe kia yếu đi.',
  'Chat túi để xem mình đã góp bao nhiêu lực kéo.',
];
const QUIET_LINES = ['Phe trâu với phe gà đang cần thêm người kéo, chat tên phe là vào ngay!', 'Sợi dây đang căng lắm rồi, chat trâu hoặc gà để góp sức nhé!'];
function greet(name, side) { greetWait[side].push(voiceName(name)); }
const RULES_NOTE = 'Chat trâu hoặc gà là vào phe đó, chat và thả tim là kéo. Tặng quà để kéo cực mạnh!';
setTimeout(function rulesNote() {
  if (mainPage && liveOn) announce(RULES_NOTE);
  setTimeout(rulesNote, C.RULES_EVERY);
}, C.RULES_FIRST);
function flushGreet() {
  if ((!greetWait[0].length && !greetWait[1].length) || closing() || now() - lastGreet < C.GREET_EVERY || !canSay('C')) return;
  const bits = SIDES.filter((sd) => greetWait[sd.id].length).map((sd) => `${greetWait[sd.id].slice(0, 3).join(', ')} vào phe ${sd.name.toLowerCase()}`);
  greetWait[0] = []; greetWait[1] = []; lastGreet = now();
  say(`Chào ${bits.join(', ')}! ${TIPS[tipTurn++ % TIPS.length]}`, 'C');
}
function active() { lastActive = now(); }
function ambience() {
  if (closing() || now() - lastActive < C.QUIET || now() - lastAmbience < C.AMBIENCE_EVERY) return;
  lastAmbience = now();
  const line = pick(QUIET_LINES); alertBox(`<span class="ic">💪</span><span>${esc(line)}</span>`); say(line, 'C');
}
function remind() {
  if ((!liveOn && !DEMO) || closing()) return;
  if (!nextRemind) nextRemind = Math.max((liveOn ? liveAt : bootAt) + C.REMIND_FIRST, bootAt + 60_000);
  if (now() < nextRemind) return;
  nextRemind = now() + C.REMIND_EVERY;
  if (pinText() && speakable(pinText())) say('Thông báo: ' + speakable(pinText()), 'C');
}
const ASSIST_LINES = ['Mình là bình luận viên tự động của hội kéo co. Chủ live đọc bình luận của anh em đó.', 'Giọng này là giọng tự động của game, anh em cứ trò chuyện với chủ live nhé.'];
let assistTurn = 0;
function assist() {
  if (!VOICE_PARAM || !voiceOn || (!liveOn && !DEMO) || closing()) return;
  if (!nextAssist) nextAssist = Math.max((liveOn ? liveAt : bootAt) + C.ASSIST_FIRST, bootAt + 240_000);
  if (now() < nextAssist || voiceQ.length > 1) return;
  nextAssist = now() + C.ASSIST_EVERY;
  say(ASSIST_LINES[assistTurn++ % ASSIST_LINES.length], 'B');
}
function drawBotTag() { $('botTag').hidden = !(VOICE_PARAM && voiceOn); }
let closingAt = 0;
const closing = () => closingAt && now() - closingAt < C.CLOSING_QUIET;
function closeLive() {
  closingAt = now(); greetWait[0] = []; greetWait[1] = [];
  const top = sessionTop(3), s = sess || { wins: [0, 0] }, b = $('banner');
  b.className = 'banner bye';
  b.innerHTML = `<div class="t">🌙 HẾT HỘI KÉO CO 🌙</div><div class="n">🐃 ${s.wins[0]} – ${s.wins[1]} 🐓</div>`
    + (top.length ? `<ol class="rows">${top.map((x, i) => `<li>${medal[i]} ${nm(x.name)} · <b>${fmt(x.pts)}</b> điểm</li>`).join('')}</ol>` : '')
    + '<div class="s">Cảm ơn anh em đã kéo cùng, hẹn gặp lại 💙</div>';
  b.hidden = false;
  setTimeout(() => { b.hidden = true; }, C.CLOSING_BANNER);
  voiceQ.length = 0;
  say('Hội kéo co hôm nay đến đây là kết thúc. Cảm ơn anh em đã kéo cùng!', 'A');
  if (top.length) say(`Chúc mừng ${voiceName(top[0].name)} đứng đầu buổi live với ${top[0].pts} điểm!`, 'A');
  say('Hẹn gặp lại anh em ở buổi sau nhé. Tạm biệt!', 'A');
  saveSoon();
}

// ---------------------------------------------------------------- commands (ports of Bảo Vệ Tổ Dân Phố)
const forgetAsk = new Map();
function forgetCommand(user, text) {
  const phrase = phraseOf(text).replace(/[^a-z ]+/g, '').trim();
  let asking = /^(xoa|xoa toi|xoa em|xoa minh|xoa tai khoan|xoa nick|xoa ten|xoa ten toi|quen toi)$/.test(phrase);
  const confirming = /^((xac|xa|sac|xat|sat|xc) ?nhan|dong y|ok|oke|chac chan|co)( xoa| quen)?$|^xoa luon$/.test(phrase);
  if (!asking && !confirming) return false;
  const id = String(user.id), r = db[id], waiting = (forgetAsk.get(id) || 0) > now();
  if (confirming && !waiting) { if (!/ (xoa|quen)$|^xoa luon$/.test(phrase)) return false; asking = true; }
  if (!r) return true;
  if (asking) { forgetAsk.set(id, now() + C.FORGET_CONFIRM); alertBox(`<span class="ic">🍃</span><span><b>${nm(r.name)}</b> muốn xoá dữ liệu<small>bình luận <kbd>xác nhận xoá</kbd> trong 1 phút để xoá hẳn</small></span>`); return true; }
  forgetAsk.delete(id);
  players.delete(id);
  delete db[id];
  if (sess) { delete sess.board[id]; delete sess.names[id]; delete sess.coins[id]; delete sess.kills[id]; delete sess.dmg[id]; }
  dirty = true; sessDirty = true; boardsDirty = true; dmgDirty = true;
  alertBox('<span class="ic">🍃</span><span>Đã xoá dữ liệu của một người chơi<small>hẹn gặp lại bạn</small></span>');
  saveSoon();
  return true;
}
function isHost(user) { const h = String(user.handle || '').toLowerCase(); return !!h && (h === host || hosts.includes(h)); }
function findPlayer(q) {
  const h = q.toLowerCase(), a = phraseOf(q), entries = Object.entries(db);
  return entries.find(([, r]) => String(r.handle).toLowerCase() === h) || entries.find(([, r]) => r.name.toLowerCase() === h)
    || entries.find(([, r]) => phraseOf(r.name) === a) || entries.find(([, r]) => a.length >= 3 && phraseOf(r.name).startsWith(a)) || null;
}
const NOTICE_MAX = 120, PIN_MAX = 150;
const speakable = (t) => t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ' ').replace(/\s+/g, ' ').trim();
function announce(text) {
  const t = cleanText(text, NOTICE_MAX); if (!t) return;
  const b = $('banner'); b.className = 'banner notice';
  b.innerHTML = `<div class="t">📢 THÔNG BÁO</div><div class="n">${esc(t)}</div>`; b.hidden = false;
  clearTimeout(announce.t); announce.t = setTimeout(() => { if (b.classList.contains('notice')) b.hidden = true; }, C.NOTICE_MS);
  chime(2);
  const v = speakable(t); if (v) say('Thông báo: ' + v, 'A');
}
let defaultPin = '';
const pinText = () => (sess && sess.pin) || defaultPin;
const PIN_EVERY = 60_000;
let pinRun = '', pinThanks = [];
function thankInPin(name) { pinThanks = [name, ...pinThanks.filter((n) => n !== name)].slice(0, 3); }
function pinTick() {
  if (sess && sess.pin) return;
  const bits = [];
  if (defaultPin) bits.push(defaultPin);
  if (sess && (sess.wins[0] || sess.wins[1])) bits.push(`🏆 Tỉ số buổi: 🐃 Trâu ${sess.wins[0]} – ${sess.wins[1]} Gà 🐓`);
  if (pinThanks.length) { bits.push(`🎁 Cảm ơn ${pinThanks.join(', ')} đã tặng quà`); pinThanks = []; }
  if (!bits.length) return;
  pinRun = bits.join('   ·   ');
  drawPin();
  clearTimeout(pinTick.t);
  pinTick.t = setTimeout(() => { pinRun = ''; drawPin(); }, Math.max(8, Math.round(graphemes(pinRun).length / 7)) * 1000);
}
setTimeout(() => { pinTick(); setInterval(pinTick, PIN_EVERY); }, 10_000);
function pinNotice(text) {
  const t = text === null ? null : cleanText(text, PIN_MAX);
  ensureSession().pin = t || null; sessDirty = true; saveLive();
  drawPin();
  if (t) { alertBox('<span class="ic">📌</span><span>Đã ghim thông báo</span>', 'gold'); const v = speakable(t); if (v) say('Thông báo: ' + v, 'A'); }
  else alertBox('<span class="ic">📌</span><span>Đã bỏ ghim thông báo</span>');
}
function drawPin() {
  const el = $('pin'), t = (sess && sess.pin) || pinRun;
  el.hidden = !t; document.body.classList.toggle('pinned', !!t);
  if (!t || el.dataset.t === t) return;
  el.dataset.t = t;
  const one = `<span>${esc(t)}</span><i>✦</i>`;
  el.innerHTML = `<span class="ic">📌</span><span class="mq"><span class="run" style="--d:${Math.max(8, Math.round(graphemes(t).length / 7))}s">${one}${one}</span></span>`;
}
/** Host commands: tb/ghim/bỏ ghim, đọc ít/vừa/nhiều, tắt/bật đọc, đóng live, xoá bảng, đuổi/tha @tên, vòng mới. */
function hostCommand(text) {
  const raw = String(text || '').normalize('NFC').trim();
  const say1 = raw.match(/^(?:thông\s*báo|thong\s*bao|tb)(?:\s*[:：\-–]\s*|\s+)(.+)$/iu);
  if (say1) { announce(say1[1]); return true; }
  const pin1 = raw.match(/^ghim(?:\s*[:：\-–]\s*|\s+)(.+)$/iu);
  if (pin1) { pinNotice(pin1[1]); return true; }
  const t = cleanText(text, 80), ph = phraseOf(t);
  if (/^(bo|go|xoa|tat|huy) ghim$/.test(ph)) { pinNotice(null); return true; }
  if (/^(vong moi|doi map|doi ban do)$/.test(ph)) { if (round.phase === 'play') endRound(Math.abs(pos) < C.DRAW_WITHIN ? -1 : pos < 0 ? 0 : 1); return true; }
  const mode = /^doc (it|vua|nhieu)$/.exec(ph);
  if (mode) { voiceMode = mode[1]; store.set('voiceMode', voiceMode); alertBox(`<span class="ic">🔊</span><span>${{ it: 'Đọc ít', vua: 'Đọc vừa', nhieu: 'Đọc nhiều' }[voiceMode]}</span>`); return true; }
  if (/^(tat|bat) (doc|giong)$/.test(ph)) { voiceOn = ph.startsWith('bat'); store.set('voice', voiceOn); drawBotTag(); if (!voiceOn) voiceQ.length = 0; alertBox(voiceOn ? '<span class="ic">🔊</span><span>Đã bật giọng đọc</span>' : '<span class="ic">🔇</span><span>Đã tắt giọng đọc</span>'); return true; }
  if (/^(dong|tat|ket thuc|het) live$/.test(ph)) { closeLive(); return true; }
  if (/^xoa bang$/.test(ph)) { newSession(); alertBox('<span class="ic">🆕</span><span>Bắt đầu buổi mới<small>bảng buổi live đã xoá</small></span>', 'gold'); saveLive(); return true; }
  const m = t.match(/^(\S+)\s+(.+)$/);
  if (!m) return false;
  const verb = phraseOf(m[1]);
  if (verb !== 'duoi' && verb !== 'tha') return false;
  const q = m[2].trim().replace(/^@/, '').replace(/[\s.,!?]+$/, '');
  const found = q && findPlayer(q);
  if (!found || String(found[1].handle).toLowerCase() === host) { alertBox(`<span class="ic">❔</span><span>Không thấy ai tên <b>${nm(q)}</b></span>`); return true; }
  const [id, r] = found;
  r.banned = verb === 'duoi'; dirty = true; boardsDirty = true;
  if (r.banned) { players.delete(id); alertBox(`<span class="ic">🚪</span><span><b>${nm(r.name)}</b> đã bị mời ra khỏi sân</span>`); }
  else alertBox(`<span class="ic">🙏</span><span><b>${nm(r.name)}</b> được vào sân trở lại</span>`);
  saveSoon();
  return true;
}
const lastBagAt = new Map();
/** "túi": the viewer's numbers. */
function myStats(r, id) {
  if (now() - (lastBagAt.get(id) || 0) < C.BAG_EVERY) return;
  lastBagAt.set(id, now());
  const k = Math.round((sess && sess.dmg[id]) || 0), p = players.get(id);
  alertBox(`<span class="ic">💪</span><span><b>${nm(r.name)}</b> · góp ${fmt(k)} lực kéo${p && p.side != null ? ` · phe ${SIDES[p.side].name}` : ''}<small>${fmt((sess && sess.board[id]) || 0)} điểm buổi này</small></span>`);
  say(`${voiceName(r.name)} đã góp ${k} lực kéo trong buổi này.`, 'C');
}

// ---------------------------------------------------------------- events
/** A side's name anywhere in the comment picks it ("trâu nha", "vào phe gà"); "1" / "2" only on their own. Both names: no choice. */
const TEAM_WORDS = [
  /(^| )(trau|phe trau|buffalo|nghe)( |$)|^1$|^phe 1$/,
  /(^| )(ga|phe ga|chicken)( |$)|^2$|^phe 2$/,
];
function sideOf(ph) {
  const hits = TEAM_WORDS.map((re) => re.test(ph));
  return hits[0] === hits[1] ? -1 : hits[0] ? 0 : 1;
}
// 09/11 (host's choice): coming in puts the viewer on the smaller side for MEMBER_PLAY; a comment / heart keeps them longer
function onMember(user) { if (db[String(user.id)]?.banned || players.has(String(user.id))) return; const r = touch(user), p = join(user, r.name, null, 'member'); p.lastPlay = now() - (C.HOOK_KICK - C.MEMBER_PLAY); }
function onChat(user, text) {
  if (db[String(user.id)]?.banned) return;
  active();
  if (isHost(user) && hostCommand(text)) return;
  if (forgetCommand(user, text)) return;
  const r = touch(user);
  const ph = phraseOf(Profanity.mask(cleanText(text, 70)));
  const want = sideOf(ph);
  const p = join(user, r.name, want >= 0 ? want : null, 'chat');
  if (now() - p.chatAt >= C.CHAT_EVERY) { p.chatAt = now(); pull(p.side, C.CHAT_PULL, p.id, p.name); }
  if (/^(xem )?tui( do| cua (toi|tui|minh|em|anh|chi))?$/.test(ph)) myStats(r, String(user.id));
}
/**
 * 08/11 (host's choice: many likes are not fake reactions): the more hearts someone tapped lately, the stronger they play.
 * Each heart adds to a heat that halves every 30 s; heartBoost is 0..1 (1 heart 0.1, 25 hearts 0.5, 100 hearts or more 1).
 */
const heat = new Map(); // viewer id -> { v, at }
const heatNow = (h) => h.v * 0.5 ** ((now() - h.at) / 30_000);
function addHearts(id, n) { const k = String(id), h = heat.get(k); heat.set(k, { v: (h ? heatNow(h) : 0) + n, at: now() }); }
function heartBoost(id) { const h = heat.get(String(id)); return h ? Math.min(1, Math.sqrt(heatNow(h) / 100)) : 0; }
function onLike(user, n) {
  if (db[String(user.id)]?.banned) return;
  active();
  const r = touch(user);
  const p = join(user, r.name, null, 'like');
  addHearts(user.id, n);
  pull(p.side, n * C.HEART_PULL * (1 + heartBoost(user.id)), p.id, p.name);
}
function onGift(user, gift, count) {
  if (db[String(user.id)]?.banned) return;
  active();
  gstats.gifts++;
  const r = touch(user), id = String(user.id);
  const coins = Math.max(0, Number(gift.coins) || 0);
  const p = join(user, r.name, null, 'gift');
  const s = ensureSession();
  s.coins[id] = coinsOf(id) + coins; s.names[id] = r.name;
  const row = GIFT_PULLS.find((x) => coins >= x.min);
  const pts = Math.max(5, coins * C.GIFT_POINTS_PER_COIN);
  addPoints(id, r.name, pts);
  const gname = cleanText(gift.name || 'quà', 40) + (count > 1 ? ` x${count}` : '');
  alertBox(`<span class="ic">🎁</span><span><b>${nm(r.name)}</b> tặng ${esc(gname)}<small>${row ? `${row.ic} ${esc(row.name)} · ` : ''}+${fmt(pts)} điểm</small></span>`, 'gift');
  if (row) {
    weaponHit(row.min);
    if (row.double) doubleUntil[p.side] = now() + C.DOUBLE_MS;
    if (row.brake) brakeUntil[1 - p.side] = now() + C.BRAKE_MS;
    pull(p.side, row.pull, id, r.name, `${r.name.slice(0, 14)} ${row.ic} +${row.pull}`);
    if (!REDUCED && row.pull >= 16) shake();
    puff(knotX(), GROUND - 40, '#ffd54f', 10);
  }
  let line = `Cảm ơn ${voiceName(r.name)} đã tặng ${cleanText(gift.name || 'quà', 40)}!`;
  const had = s.rich && s.rich.id;
  if (coins && (!s.rich || s.rich.id === id || s.coins[id] > s.rich.coins)) {
    s.rich = { id, name: r.name, coins: s.coins[id] };
    if (had !== id) { alertBox(`<span class="ic">💰</span><span><b>${nm(r.name)}</b> là <b>Đại gia hội làng</b><small>tặng nhiều nhất buổi · ${fmt(s.coins[id])} xu</small></span>`, 'gold'); line += ` ${voiceName(r.name)} trở thành đại gia hội làng!`; }
  }
  sessDirty = true; boardsDirty = true;
  showRightTab(0);
  chime(2);
  say(line, 'A');
  thankInPin(r.name);
  saveSoon();
}
const shareSeen = new Map();
function onSocial(user, kind) {
  if (db[String(user.id)]?.banned) return;
  if (kind === 'share') { if (now() - (shareSeen.get(String(user.id)) || 0) < 120_000) return; shareSeen.set(String(user.id), now()); }
  active();
  const r = touch(user);
  alertBox(kind === 'follow' ? `<span class="ic">➕</span><span><b>${nm(r.name)}</b> vừa theo dõi kênh</span>` : `<span class="ic">↗️</span><span><b>${nm(r.name)}</b> chia sẻ buổi live</span>`);
  say(kind === 'follow' ? `Cảm ơn ${voiceName(r.name)} đã theo dõi!` : `Cảm ơn ${voiceName(r.name)} đã chia sẻ!`, 'C');
}
function onEvent(e) {
  if (e.demo && !DEMO) return;
  try {
    switch (e.type) {
      case 'hello': defaultPin = cleanText(String(e.pin || ''), PIN_MAX); drawPin(); host = String(e.host || '').toLowerCase(); hosts = Array.isArray(e.hosts) ? e.hosts.map((x) => String(x).toLowerCase()) : []; if (e.page) setPageId(e.page); setMain(e.main !== false); if (e.live) onLive(); else liveOffSoon(); setStatus(); break;
      case 'role': if (!e.main) tabStore.set('keoco.page', ''); location.reload(); break;
      case 'hostcmd': if (!!e.demo === !!DEMO && !hostCommand(e.text || '')) alertBox(`<span class="ic">❔</span><span>Lệnh chưa hiểu: <b>${esc(String(e.text || '').slice(0, 40))}</b></span>`); break; // 10/11: dieu-khien.html
      case 'stale': { const el = document.querySelector('#status span'); if (el) { el.textContent = '⚠️ Mất tín hiệu TikTok, đang nối lại…'; clearTimeout(window.staleT); window.staleT = setTimeout(setStatus, 20_000); } break; } // 09/11: the server reconnects a dead link
      case 'status': if (e.live) onLive(); else onLiveOff(); break;
      case 'member': if (e.user) onMember(e.user); break;
      case 'chat': if (e.user) onChat(e.user, e.text || ''); break;
      case 'like': if (e.user) onLike(e.user, e.count || 1); break;
      case 'gift': if (e.user) onGift(e.user, e.gift || {}, e.count || 1); break;
      case 'follow': case 'share': if (e.user) onSocial(e.user, e.type); break;
      case 'viewers': viewerCount = Number(e.n) >= 0 ? Number(e.n) : null; break;
    }
  } catch (err) { console.error('event failed', e, err); }
}
function setMain(on) {
  mainPage = on;
  if (!on) { voiceQ.length = 0; dirty = false; sessDirty = false; }
  document.body.classList.toggle('watch-only', !on);
  $('pageRole').hidden = on;
}
function connect() {
  const es = new EventSource('/events' + DATA_QS);
  es.onopen = () => { sseUp = true; setStatus(); };
  es.onerror = () => { sseUp = false; setStatus(); };
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch (err) { console.error('bad event', err); } };
}

// ---------------------------------------------------------------- demo
const DEMO_NAMES = ['Lan', 'Minh Tuấn', 'Hoa 🌸', 'Bé Na', 'Anh Ba Khía', 'Thuỷ Tiên', 'Quân', 'Mít Ướt 🥭', 'Ngọc Trinh', 'tam.an_88',
  'Hùng', 'Út Mập', 'Chú Tư', 'Linh', 'Khoa Pug', 'Bông', 'Gấu 🐻', 'Hải Đăng', 'Mai Anh', 'Tí Nị', 'Phong Vũ', 'Long', 'Cún con 🐶', 'Trà sữa'];
const demoUsers = DEMO_NAMES.map((name, i) => ({ id: 'demo-' + (i + 1), handle: phraseOf(name).replace(/\s+/g, '_') || 'user' + (i + 1), name }));
const postDemo = (e) => fetch('/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e) }).catch(() => {});
function demoKeys() {
  const box = $('demo'); box.hidden = false;
  box.innerHTML = '<b>Chế độ thử</b><br><kbd>1</kbd> chat trâu · <kbd>2</kbd> chat gà · <kbd>H</kbd> tim<br><kbd>G</kbd> quà 1 xu · <kbd>5</kbd> 5 xu · <kbd>D</kbd> 10 xu · <kbd>K</kbd> 30 xu · <kbd>M</kbd> 99 xu<br><kbd>R</kbd> vòng mới · <kbd>N</kbd> thông báo · <kbd>E</kbd> đóng live';
  addEventListener('keydown', (k0) => {
    if (k0.repeat || k0.ctrlKey || k0.metaKey || k0.altKey) return;
    const k = k0.key.toLowerCase(), u = pick(demoUsers), gift = (c) => postDemo({ type: 'gift', user: u, gift: { name: c >= 30 ? 'Bánh kem' : 'Hoa hồng', coins: c }, count: 1 });
    if (k === '1') postDemo({ type: 'chat', user: u, text: 'trâu' });
    else if (k === '2') postDemo({ type: 'chat', user: u, text: 'gà' });
    else if (k === 'h') postDemo({ type: 'like', user: u, count: 5 });
    else if (k === 'g') gift(1); else if (k === '5') gift(5); else if (k === 'd') gift(10); else if (k === 'k') gift(30); else if (k === 'm') gift(99);
    else if (k === 'r') hostCommand('vòng mới');
    else if (k === 'n') announce('Tối nay 21 giờ có trận chung kết trâu đấu gà! 💪');
    else if (k === 'e') closeLive();
  });
}
function demoBots() {
  demoUsers.forEach((u, i) => setTimeout(() => postDemo({ type: 'chat', user: u, text: pick(['trâu', 'gà', 'phe trâu', 'phe gà', 'hi']) }), 200 + i * 180));
  setInterval(() => { for (const u of demoUsers) if (Math.random() < 0.15) postDemo(Math.random() < 0.5 ? { type: 'like', user: u, count: 3 } : { type: 'chat', user: u, text: pick(['kéo đi', 'cố lên', 'hay quá', 'dô dô']) }); }, 5000);
  setInterval(() => { if (Math.random() < 0.35) { const c = pick([1, 1, 5, 10, 30, 99]); postDemo({ type: 'gift', user: pick(demoUsers), gift: { name: c >= 30 ? 'Bánh kem' : 'Hoa hồng', coins: c }, count: 1 }); } }, 7000);
}

// ---------------------------------------------------------------- boot
const bootAt = now();
function tick() {
  roundTick(); kickTick();
  flushGreet(); ambience(); remind(); assist();
}
async function boot() {
  if (Q.get('safe') === '1') document.body.classList.add('show-safe');
  document.body.classList.toggle('reduced', REDUCED);
  resize(); addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe($('scene'));
  bgArt = paintVillage();
  drawBotTag(); setStatus(); drawWeapons();
  await loadData();
  ensureSession();
  drawBoards(); drawPin(); showRightTab(0);
  connect();
  requestAnimationFrame(frame);
  setInterval(tick, 100);
  setInterval(drawHud, 250);
  setInterval(() => { saveData(); if (sessDirty) saveLive(); }, C.SAVE_EVERY);
  addEventListener('pagehide', () => {
    if (!mainPage) return;
    if (dirty) navigator.sendBeacon?.('/data' + DATA_QS, new Blob([JSON.stringify(db)], { type: 'application/json' }));
    store.set(DEMO ? 'demo.players' : 'players', db);
  });
  ac(); startMusic();
  $('sound').addEventListener('click', () => {
    ac(); startMusic(); resumeMusic(); setTimeout(soundGate, 300);
    if (matchMedia('(pointer: coarse)').matches) document.documentElement.requestFullscreen?.().catch(() => {});
  });
  addEventListener('pointerdown', () => { ac(); resumeMusic(); soundGate(); }, { once: true });
  setTimeout(soundGate, 1200);
  if (DEMO) demoKeys();
  if (BOTS) demoBots();
  window.keoco = { round: () => ({ ...round, pos }), players: () => [...players.values()].map((p) => ({ name: p.name, side: p.side, bot: !!p.bot })), hostCommand, onEvent, session: () => sess, C, main: () => mainPage };
}
boot();

if (Q.get('res') === '1') {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:50%;top:40%;transform:translateX(-50%);z-index:99;background:#000d;color:#fff;font:700 28px/1.3 sans-serif;padding:10px 16px;border-radius:10px;text-align:center;pointer-events:none';
  document.body.append(el);
  const show = () => { const d = window.devicePixelRatio || 1, w = Math.round(innerWidth * d), h = Math.round(innerHeight * d); el.innerHTML = `${innerWidth}×${innerHeight} × ${d}<br>= ${w}×${h} px<br><span style="color:${w >= 1080 ? '#7f7' : '#f77'}">${w >= 1080 ? 'đủ nét' : 'nhỏ hơn 1080: sẽ mờ'}</span>`; };
  show(); addEventListener('resize', show);
}
