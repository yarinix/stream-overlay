'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const createStorage = require('./storage');

const PORT = process.env.PORT || 3000;
let KEY = process.env.CONTROL_KEY;
if (!KEY) {
  KEY = crypto.randomBytes(6).toString('hex');
  console.warn('CONTROL_KEY не задан. Временный ключ для этого запуска: ' + KEY);
}
const BOOT = crypto.randomBytes(4).toString('hex');
let dirty = false;                     // false, пока никто не менял состояние после запуска
const teams = new Map();               // библиотека команд: id -> { id, name, tag, v, mime, buf }
const TEAM_ID = /^[a-z0-9]{6,16}$/;
const LOGO_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const storage = createStorage({
  token: process.env.GITHUB_TOKEN,
  repo: process.env.GITHUB_REPO || process.env.RENDER_GIT_REPO_SLUG || 'yarinix/stream-overlay',
  branch: process.env.GITHUB_DATA_BRANCH || 'data'
});
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
const keyOk = (s) => crypto.timingSafeEqual(hash(s), hash(KEY));

/* ---------- состояние эфира ---------- */
const state = {
  a: { name: 'Nova Wolves', tag: 'NW', score: 0 },
  b: { name: 'Iron Crown', tag: 'IC', score: 0 },
  bo: 3, map: 1,
  tour: 'BlackSid Invitational', stage: 'Групповой этап',
  cast: 'BlackSid_Co', role: 'Комментатор', social: 'twitch.tv/blacksid_co',
  label: 'До начала драфта',
  lt: false, scene: 'game', accent: 'gold', preset: 'royal', endText: 'Увидимся на следующей трансляции',
  layout: {}, customScenes: [],
  bracket: {
    title: 'Плей-офф', auto: true, fmt: { pi: 3, ubs: 3, ubf: 5, lbs: 3, lbf: 5, gf: 7 },
    m: {
      pi1:  { a: { name: 'Storm Riders', score: 3 }, b: { name: 'Silver Tide', score: 2 } },
      pi2:  { a: { name: 'Night Owls', score: 3 },   b: { name: 'Polar Echo', score: 1 } },
      ubs1: { a: { name: 'Nova Wolves', score: 3 },  b: { name: 'Storm Riders', score: 0 } },
      ubs2: { a: { name: 'Iron Crown', score: 1 },   b: { name: 'Night Owls', score: 3 } },
      ubf:  { a: { name: 'Nova Wolves', score: 3 },  b: { name: 'Night Owls', score: 2 } },
      lbs:  { a: { name: 'Iron Crown', score: 3 },   b: { name: 'Storm Riders', score: 1 } },
      lbf:  { a: { name: 'Night Owls', score: 1 },   b: { name: 'Iron Crown', score: 3 } },
      gf:   { a: { name: 'Nova Wolves', score: 2 },  b: { name: 'Iron Crown', score: 4 } }
    }
  },
  timer: { mins: 5, rem: 300, run: false, endAt: 0 }
};

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MATCH_IDS = ['pi1', 'pi2', 'ubs1', 'ubs2', 'ubf', 'gf', 'lbs', 'lbf'];
for (const t of [state.a, state.b]) t.teamId = '';
for (const id of Object.keys(state.bracket.m)) for (const sd of ['a', 'b']) state.bracket.m[id][sd].teamId = '';
/* автопереход: куда уходит победитель (w) и проигравший (l) каждого матча */
const DEST = {
  pi1: { w: ['ubs1', 'b'] }, pi2: { w: ['ubs2', 'b'] },
  ubs1: { w: ['ubf', 'a'], l: ['lbs', 'a'] }, ubs2: { w: ['ubf', 'b'], l: ['lbs', 'b'] },
  lbs: { w: ['lbf', 'a'] }, ubf: { w: ['gf', 'a'], l: ['lbf', 'b'] }, lbf: { w: ['gf', 'b'] }
};
const STAGE = { pi1: 'pi', pi2: 'pi', ubs1: 'ubs', ubs2: 'ubs', ubf: 'ubf', lbs: 'lbs', lbf: 'lbf', gf: 'gf' };
const STAGE_KEYS = ['pi', 'ubs', 'ubf', 'lbs', 'lbf', 'gf'];
const same = (x, y) => (x.teamId && x.teamId === y.teamId) || (x.name && x.name.trim().toLowerCase() === y.name.trim().toLowerCase());
function propagate(id, depth = 0) {
  const d = DEST[id]; if (!d || depth > 8) return;
  const br = state.bracket, m = br.m[id], need = Math.ceil(br.fmt[STAGE[id]] / 2);
  let w = null;
  if (m.a.score !== m.b.score) {
    const hi = m.a.score > m.b.score ? 'a' : 'b';
    if (m[hi].score >= need && m[hi].name.trim()) w = hi;
  }
  const put = (to, src) => {
    const slot = br.m[to[0]][to[1]];
    if (src) {
      if (!same(slot, src) || slot.name !== src.name) { slot.name = src.name; slot.teamId = src.teamId; slot.score = 0; propagate(to[0], depth + 1); }
    } else {
      for (const t of [m.a, m.b]) if (t.name.trim() && same(slot, t)) { slot.name = ''; slot.teamId = ''; slot.score = 0; propagate(to[0], depth + 1); break; }
    }
  };
  put(d.w, w ? m[w] : null);
  if (d.l) put(d.l, w ? m[w === 'a' ? 'b' : 'a'] : null);
}
const str = (v, max) => String(v).slice(0, max);
const int = (v, lo, hi) => Math.min(hi, Math.max(lo, parseInt(v, 10) || 0));

/* ---------- редактор: правки элементов и свои сцены ---------- */
const ID_RE = /^[a-zA-Z0-9_-]{1,24}$/;
const BUILTIN_SCENES = ['game', 'soon', 'break', 'bracket', 'end', 'cam'];
const numIn = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const hexIn = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : '');
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
function cleanLayout(L) {
  const out = {};
  if (!L || typeof L !== 'object') return out;
  let scenes = 0;
  for (const sk of Object.keys(L)) {
    if (scenes >= 24) break;
    const okScene = BUILTIN_SCENES.includes(sk) || (sk.startsWith('c:') && ID_RE.test(sk.slice(2)));
    if (!okScene || !L[sk] || typeof L[sk] !== 'object') continue;
    const sc = {}; let n = 0;
    for (const ek of Object.keys(L[sk])) {
      if (n >= 40) break;
      if (!ID_RE.test(ek)) continue;
      const o = L[sk][ek]; if (!o || typeof o !== 'object') continue;
      const r = {};
      const dx = numIn(o.dx, -2400, 2400, 0), dy = numIn(o.dy, -1400, 1400, 0), z = numIn(o.sc, 0.2, 4, 1), hue = numIn(o.hue, 0, 360, 0);
      if (dx) r.dx = Math.round(dx * 10) / 10;
      if (dy) r.dy = Math.round(dy * 10) / 10;
      if (z !== 1) r.sc = Math.round(z * 1000) / 1000;
      if (hue) r.hue = Math.round(hue);
      const c = hexIn(o.color); if (c) r.color = c;
      if (o.hide) r.hide = true;
      if (Object.keys(r).length) { sc[ek] = r; n++; }
    }
    if (Object.keys(sc).length) { out[sk] = sc; scenes++; }
  }
  return out;
}
const IMG_SRC = ['mpl', 'm8', 'twitch', 'logoA', 'logoB', 'camframe'];
function cleanItem(it) {
  if (!it || typeof it !== 'object' || !ID_RE.test(String(it.id || ''))) return null;
  const type = oneOf(it.type, ['text', 'panel', 'line', 'img', 'timer'], '');
  if (!type) return null;
  const r = {
    id: it.id, type,
    x: Math.round(numIn(it.x, -600, 2500, 0)), y: Math.round(numIn(it.y, -600, 1500, 0)),
    w: Math.round(numIn(it.w, 1, 2400, 200)), h: Math.round(numIn(it.h, 1, 1400, 60)),
    rot: Math.round(numIn(it.rot, -180, 180, 0)), op: Math.round(numIn(it.op, 0, 1, 1) * 100) / 100,
    hue: Math.round(numIn(it.hue, 0, 360, 0)), hide: !!it.hide, name: str(it.name || '', 28)
  };
  if (type === 'text' || type === 'timer') {
    r.text = str(it.text || '', 160);
    r.font = oneOf(it.font, ['head', 'sub', 'num'], type === 'timer' ? 'num' : 'sub');
    r.size = Math.round(numIn(it.size, 8, 400, 40)); r.weight = Math.round(numIn(it.weight, 300, 900, 600) / 100) * 100;
    r.color = hexIn(it.color) || '#ffffff'; r.align = oneOf(it.align, ['left', 'center', 'right'], 'center');
    r.ls = Math.round(numIn(it.ls, 0, 1, 0) * 100) / 100; r.upper = !!it.upper; r.glow = !!it.glow; r.metal = !!it.metal; r.italic = !!it.italic;
  }
  if (type === 'panel') {
    r.style = oneOf(it.style, ['plate', 'glass', 'solid', 'outline'], 'plate');
    r.fill = hexIn(it.fill); r.border = hexIn(it.border); r.radius = Math.round(numIn(it.radius, 0, 80, 0));
  }
  if (type === 'line') { r.color = hexIn(it.color) || '#c4a265'; r.solid = !!it.solid; }
  if (type === 'img') { r.src = oneOf(it.src, IMG_SRC, 'mpl'); r.fit = oneOf(it.fit, ['contain', 'cover'], 'contain'); }
  return r;
}
function cleanScenes(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [], seen = new Set();
  for (const sc of arr.slice(0, 12)) {
    if (!sc || typeof sc !== 'object' || !ID_RE.test(String(sc.id || '')) || seen.has(sc.id)) continue;
    seen.add(sc.id);
    const bg = ['none', 'soon', 'break', 'end', 'bracket'].includes(sc.bg) ? sc.bg : (hexIn(sc.bg) || 'none');
    const items = []; const ids = new Set();
    for (const it of Array.isArray(sc.items) ? sc.items.slice(0, 80) : []) {
      const c = cleanItem(it); if (c && !ids.has(c.id)) { ids.add(c.id); items.push(c); }
    }
    out.push({ id: sc.id, name: str(sc.name || 'Сцена', 28), bg, cam: sc.cam !== false, items });
  }
  return out;
}

function applyPatch(p) {
  if (!p || typeof p !== 'object') return;
  for (const k of ['a', 'b']) {
    const t = p[k];
    if (t && typeof t === 'object') {
      if ('name' in t) state[k].name = str(t.name, 28);
      if ('tag' in t) state[k].tag = str(t.tag, 5);
      if ('score' in t) state[k].score = int(t.score, 0, 9);
      if ('teamId' in t) state[k].teamId = teams.has(t.teamId) ? t.teamId : '';
    }
  }
  if ('bo' in p && [1, 3, 5].includes(+p.bo)) state.bo = +p.bo;
  if ('map' in p) state.map = int(p.map, 1, 5) || 1;
  if ('tour' in p) state.tour = str(p.tour, 28);
  if ('stage' in p) state.stage = str(p.stage, 28);
  if ('cast' in p) state.cast = str(p.cast, 22);
  if ('role' in p) state.role = str(p.role, 26);
  if ('social' in p) state.social = str(p.social, 36);
  if ('endText' in p) state.endText = str(p.endText, 48);
  if ('label' in p) state.label = str(p.label, 24);
  if ('lt' in p) state.lt = !!p.lt;
  if ('customScenes' in p) { const cs = cleanScenes(p.customScenes); if (cs) state.customScenes = cs; }
  if ('layout' in p) state.layout = cleanLayout(p.layout);
  if ('scene' in p && (BUILTIN_SCENES.includes(p.scene) || (typeof p.scene === 'string' && p.scene.startsWith('c:') && state.customScenes.some((c) => 'c:' + c.id === p.scene)))) state.scene = p.scene;
  if (!BUILTIN_SCENES.includes(state.scene) && !state.customScenes.some((c) => 'c:' + c.id === state.scene)) state.scene = 'game';
  if ('preset' in p && ['royal'].includes(p.preset)) state.preset = p.preset;
  if ('accent' in p && ['gold', 'steel', 'rose', 'amber'].includes(p.accent)) state.accent = p.accent;
  if (p.bracket && typeof p.bracket === 'object') {
    const b = p.bracket;
    if ('title' in b) state.bracket.title = str(b.title, 24);
    let reflow = false;
    if ('auto' in b) { state.bracket.auto = !!b.auto; reflow = true; }
    if (b.fmt && typeof b.fmt === 'object') {
      for (const k of STAGE_KEYS) if (k in b.fmt && [1, 3, 5, 7, 9].includes(+b.fmt[k])) { state.bracket.fmt[k] = +b.fmt[k]; reflow = true; }
    }
    const touched = new Set();
    if (b.reset) {
      for (const id of MATCH_IDS) state.bracket.m[id] = { a: { name: '', score: 0, teamId: '' }, b: { name: '', score: 0, teamId: '' } };
    }
    if (b.m && typeof b.m === 'object') {
      for (const id of MATCH_IDS) {
        const m = b.m[id];
        if (!m || typeof m !== 'object') continue;
        for (const s of ['a', 'b']) {
          const t = m[s];
          if (!t || typeof t !== 'object') continue;
          if ('name' in t) { state.bracket.m[id][s].name = str(t.name, 28); touched.add(id); }
          if ('score' in t) { state.bracket.m[id][s].score = int(t.score, 0, 9); touched.add(id); }
          if ('teamId' in t) state.bracket.m[id][s].teamId = teams.has(t.teamId) ? t.teamId : '';
        }
      }
    }
    if (state.bracket.auto) {
      const order = ['pi1', 'pi2', 'ubs1', 'ubs2', 'lbs', 'ubf', 'lbf'];
      for (const id of order) if (reflow || touched.has(id)) propagate(id);
    }
  }
  if ('swap' in p && p.swap) { const x = state.a; state.a = state.b; state.b = x; }
}

const slotOut = (t) => ({ name: t.name, tag: t.tag, score: t.score, teamId: t.teamId });
function statePatch() {
  const m = {};
  for (const id of MATCH_IDS) m[id] = { a: slotOut(state.bracket.m[id].a), b: slotOut(state.bracket.m[id].b) };
  return {
    a: slotOut(state.a), b: slotOut(state.b), bo: state.bo, map: state.map, tour: state.tour, stage: state.stage,
    cast: state.cast, role: state.role, social: state.social, endText: state.endText, label: state.label, lt: state.lt, scene: state.scene, accent: state.accent, preset: state.preset,
    layout: state.layout, customScenes: state.customScenes,
    bracket: { title: state.bracket.title, auto: state.bracket.auto, fmt: state.bracket.fmt, m }, timerMins: state.timer.mins
  };
}
let saveTimer = null, libTimer = null;
function scheduleSave() {
  if (!storage.enabled) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.saveState(statePatch()), 4000);
}
function scheduleLibrary() {
  if (!storage.enabled) return;
  clearTimeout(libTimer);
  libTimer = setTimeout(() => storage.saveLibrary([...teams.values()]), 1500);
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
  setHeaders: (res, fp) => res.setHeader('Cache-Control', /[\\/](img|fonts)[\\/]/.test(fp) ? 'public, max-age=86400' : 'no-cache')
}));

function authHttp(req, res, next) {
  const k = req.get('x-key');
  if (typeof k === 'string' && keyOk(k)) return next();
  res.status(401).json({ error: 'bad key' });
}
const teamMeta = (t) => ({ id: t.id, name: t.name, tag: t.tag, v: t.v, logo: !!t.buf });
function newId() { return crypto.randomBytes(5).toString('hex'); }
function eachSlot(fn) {
  for (const k of ['a', 'b']) fn(state[k]);
  for (const id of MATCH_IDS) for (const sd of ['a', 'b']) fn(state.bracket.m[id][sd]);
}

app.use('/api', express.json({ limit: '200kb' }));

app.put('/api/team', authHttp, (req, res) => {
  const b = req.body || {};
  let id = typeof b.id === 'string' && TEAM_ID.test(b.id) ? b.id : newId();
  const isNew = !teams.has(id);
  if (isNew && teams.size >= 80) return res.status(400).json({ error: 'too many teams' });
  const t = teams.get(id) || { id, name: '', tag: '', v: '', mime: '', ext: '', buf: null };
  let logo = null, oldExt = t.ext;
  if (typeof b.logo === 'string') {
    const m = LOGO_RE.exec(b.logo);
    if (!m) return res.status(400).json({ error: 'bad logo' });
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 100 * 1024) return res.status(400).json({ error: 'logo too large' });
    logo = { buf, mime: m[1] };
  }
  const name = 'name' in b ? str(b.name, 28) : t.name;
  if (!name.trim()) return res.status(400).json({ error: 'name required' });
  t.name = name;
  if ('tag' in b) t.tag = str(b.tag, 5);
  if (b.clearLogo) { t.buf = null; t.mime = ''; t.ext = ''; t.v = Date.now().toString(36); storage.deleteLogo(id, oldExt); }
  if (logo) {
    t.buf = logo.buf; t.mime = logo.mime; t.ext = EXT[logo.mime]; t.v = Date.now().toString(36);
    if (oldExt && oldExt !== t.ext) storage.deleteLogo(id, oldExt);
    storage.saveLogo(t);
  }
  teams.set(id, t);
  scheduleLibrary();
  eachSlot((slot) => { if (slot.teamId === id) { slot.name = t.name; if ('tag' in slot) slot.tag = t.tag; } });
  dirty = true; broadcast();
  res.json({ ok: true, team: teamMeta(t) });
});

app.delete('/api/team/:id', authHttp, (req, res) => {
  const id = req.params.id;
  const gone = teams.get(id);
  if (!teams.delete(id)) return res.status(404).json({ error: 'not found' });
  if (gone) storage.deleteLogo(id, gone.ext);
  scheduleLibrary();
  eachSlot((slot) => { if (slot.teamId === id) slot.teamId = ''; });
  dirty = true; broadcast();
  res.json({ ok: true });
});

app.get('/logo/:id', (req, res) => {
  const t = teams.get(req.params.id);
  if (!t || !t.buf) return res.sendStatus(404);
  res.set({ 'Content-Type': t.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.send(t.buf);
});

app.use((err, _req, res, _next) => {
  res.status(err.status === 413 ? 413 : 400).json({ error: 'bad request' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

function snapshot() {
  return JSON.stringify({
    type: 'state',
    state: Object.assign({}, state, { teams: [...teams.values()].map(teamMeta) }),
    now: Date.now(), boot: BOOT, fresh: !dirty, store: storage.info()
  });
}
function broadcast() {
  scheduleSave();
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
    dirty = true;
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

/* ---------- загрузка сохранённых данных и запуск ---------- */
function applyLoaded(data, force) {
  for (const t of data.teams) if (force || !teams.has(t.id)) teams.set(t.id, t);
  if (data.state && (force || !dirty)) {
    applyPatch(data.state);
    if (data.state.timerMins) applyTimer(undefined, data.state.timerMins);
  }
  if (data.teams.length || data.state) dirty = true;
}
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('таймаут')), ms))]);
}
async function start() {
  if (storage.enabled) {
    try {
      applyLoaded(await withTimeout(storage.load(), 25000), true);
      console.log('Данные загружены из GitHub: команд ' + teams.size);
    } catch (e) {
      // не затираем сохранённое значениями по умолчанию, пока не получилось прочитать
      console.warn('Не удалось загрузить данные из GitHub: ' + e.message);
      storage.setWriteOK(false);
      storage.reportError(e);
      const retry = setInterval(async () => {
        try {
          applyLoaded(await withTimeout(storage.load(), 25000), false);
          storage.setWriteOK(true); clearInterval(retry); broadcast();
          console.log('Данные из GitHub загружены со второй попытки');
        } catch (err) { storage.reportError(err); }
      }, 30000);
    }
  } else {
    console.warn('GITHUB_TOKEN не задан: данные хранятся только в памяти сервера.');
  }
  server.listen(PORT, () => console.log('Оверлей запущен на порту ' + PORT));
}
start();

process.on('SIGTERM', async () => {
  try {
    clearTimeout(saveTimer); clearTimeout(libTimer);
    if (storage.enabled) {
      await storage.saveState(statePatch());
      await storage.saveLibrary([...teams.values()]);
      await storage.idle();
    }
  } catch (_) { /* уже завершаемся */ }
  process.exit(0);
});
