'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
let KEY = process.env.CONTROL_KEY;
if (!KEY) {
  KEY = crypto.randomBytes(6).toString('hex');
  console.warn('CONTROL_KEY не задан. Временный ключ для этого запуска: ' + KEY);
}
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
const keyOk = (s) => crypto.timingSafeEqual(hash(s), hash(KEY));

/* ---------- состояние эфира ---------- */
const state = {
  a: { name: 'Nova Wolves', tag: 'NW', score: 0 },
  b: { name: 'Iron Crown', tag: 'IC', score: 0 },
  bo: 3, map: 1,
  tour: 'BlackSid Invitational', stage: 'Групповой этап',
  cast: 'BlackSid_Co', role: 'Комментатор',
  label: 'До начала драфта',
  lt: false, scene: 'game', accent: 'gold',
  timer: { mins: 5, rem: 300, run: false, endAt: 0 }
};

const str = (v, max) => String(v).slice(0, max);
const int = (v, lo, hi) => Math.min(hi, Math.max(lo, parseInt(v, 10) || 0));

function applyPatch(p) {
  if (!p || typeof p !== 'object') return;
  for (const k of ['a', 'b']) {
    const t = p[k];
    if (t && typeof t === 'object') {
      if ('name' in t) state[k].name = str(t.name, 18);
      if ('tag' in t) state[k].tag = str(t.tag, 3);
      if ('score' in t) state[k].score = int(t.score, 0, 9);
    }
  }
  if ('bo' in p && [1, 3, 5].includes(+p.bo)) state.bo = +p.bo;
  if ('map' in p) state.map = int(p.map, 1, 5) || 1;
  if ('tour' in p) state.tour = str(p.tour, 28);
  if ('stage' in p) state.stage = str(p.stage, 28);
  if ('cast' in p) state.cast = str(p.cast, 22);
  if ('role' in p) state.role = str(p.role, 26);
  if ('label' in p) state.label = str(p.label, 24);
  if ('lt' in p) state.lt = !!p.lt;
  if ('scene' in p && ['game', 'soon', 'break'].includes(p.scene)) state.scene = p.scene;
  if ('accent' in p && ['gold', 'steel', 'rose'].includes(p.accent)) state.accent = p.accent;
  if ('swap' in p && p.swap) { const x = state.a; state.a = state.b; state.b = x; }
}

function applyTimer(action, mins) {
  const t = state.timer, now = Date.now();
  if (mins !== undefined) {
    t.mins = int(mins, 1, 99) || 1;
    if (!t.run) t.rem = t.mins * 60;
  }
  if (action === 'start' && !t.run) {
    if (t.rem <= 0) t.rem = t.mins * 60;
    t.endAt = now + t.rem * 1000; t.run = true;
  } else if (action === 'pause' && t.run) {
    t.rem = Math.max(0, Math.ceil((t.endAt - now) / 1000)); t.run = false;
  } else if (action === 'reset') {
    t.run = false; t.rem = t.mins * 60;
  }
}

/* ---------- сервер ---------- */
const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.type('text').send('ok'));
app.get('/', (_req, res) => res.redirect('/control'));
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

function snapshot() { return JSON.stringify({ type: 'state', state, now: Date.now() }); }
function broadcast() {
  const msg = snapshot();
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}

wss.on('connection', (ws) => {
  ws.authed = false; ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.send(snapshot());

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.type === 'auth') {
      if (typeof m.key === 'string' && keyOk(m.key)) { ws.authed = true; ws.send(JSON.stringify({ type: 'auth', ok: true })); }
      else { ws.send(JSON.stringify({ type: 'auth', ok: false })); ws.close(4401, 'bad key'); }
      return;
    }
    if (!ws.authed) return;
    if (m.type === 'patch') applyPatch(m.patch);
    else if (m.type === 'timer') applyTimer(m.action, m.mins);
    else return;
    broadcast();
  });
});

setInterval(() => {
  const t = state.timer;
  if (t.run && Date.now() >= t.endAt) { t.run = false; t.rem = 0; broadcast(); }
}, 250);

setInterval(() => {
  for (const c of wss.clients) {
    if (!c.alive) { c.terminate(); continue; }
    c.alive = false; c.ping();
  }
}, 25000);

server.listen(PORT, () => console.log('Оверлей запущен на порту ' + PORT));
