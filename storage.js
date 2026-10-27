'use strict';
/*
 * Хранилище данных оверлея в отдельной ветке GitHub («data»).
 * Пуши в эту ветку не запускают повторную сборку на Render, потому что он следит только за main.
 * Нужны переменные окружения GITHUB_TOKEN (доступ к содержимому репозитория на чтение и запись)
 * и, по желанию, GITHUB_REPO вида «владелец/репозиторий».
 */
const crypto = require('crypto');
const API = 'https://api.github.com';

function createStorage(opts) {
  const token = opts.token, repo = opts.repo, branch = opts.branch || 'data';
  const doFetch = opts.fetch || fetch;
  const log = opts.log || console;
  const enabled = !!(token && repo);
  const shas = new Map();      // путь -> sha файла в ветке
  const last = new Map();      // путь -> хеш последнего записанного содержимого
  const status = { ok: true, saved: 0, error: '' };
  let chain = Promise.resolve();
  let writeOK = true;

  async function httpError(r) {
    let msg = '';
    try { msg = (await r.json()).message || ''; } catch (_) { /* тела нет */ }
    return new Error('GitHub ' + r.status + (msg ? ': ' + msg : ''));
  }
  const enqueue = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

  function gh(method, path, body) {
    return doFetch(API + path, {
      method,
      headers: Object.assign({
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'stream-overlay'
      }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
  }

  async function ensureBranch() {
    let r = await gh('GET', `/repos/${repo}/branches/${branch}`);
    if (r.ok) return;
    if (r.status !== 404) throw await httpError(r);
    r = await gh('GET', `/repos/${repo}`);
    if (!r.ok) throw await httpError(r);
    const def = (await r.json()).default_branch;
    r = await gh('GET', `/repos/${repo}/git/ref/heads/${def}`);
    if (!r.ok) throw await httpError(r);
    const sha = (await r.json()).object.sha;
    r = await gh('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
    if (!r.ok && r.status !== 422) throw await httpError(r);
  }

  async function getFile(path) {
    const r = await gh('GET', `/repos/${repo}/contents/${encPath(path)}?ref=${encodeURIComponent(branch)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw await httpError(r);
    const j = await r.json();
    shas.set(path, j.sha);
    const buf = Buffer.from(j.content || '', 'base64');
    last.set(path, crypto.createHash('sha1').update(buf).digest('hex'));
    return { sha: j.sha, buf };
  }

  function fail(e) { status.ok = false; status.error = String(e.message || e); log.warn('Хранилище GitHub: ' + status.error); }
  function good() { status.ok = true; status.error = ''; status.saved = Date.now(); }

  function put(path, buf, message) {
    if (!enabled || !writeOK) return Promise.resolve();
    const h = crypto.createHash('sha1').update(buf).digest('hex');
    return enqueue(async () => {
      if (last.get(path) === h) return;
      for (let attempt = 0; attempt < 2; attempt++) {
        let sha = shas.get(path);
        if (sha === undefined) { const cur = await getFile(path); sha = cur ? cur.sha : null; }
        const body = { message, content: buf.toString('base64'), branch };
        if (sha) body.sha = sha;
        const r = await gh('PUT', `/repos/${repo}/contents/${encPath(path)}`, body);
        if (r.ok) { const j = await r.json(); shas.set(path, j.content.sha); last.set(path, h); good(); return; }
        if (r.status === 409 || r.status === 422) { shas.delete(path); continue; }
        throw await httpError(r);
      }
      throw new Error('GitHub: конфликт версий');
    }).catch(fail);
  }

  function remove(path, message) {
    if (!enabled || !writeOK) return Promise.resolve();
    return enqueue(async () => {
      let sha = shas.get(path);
      if (sha === undefined) { const cur = await getFile(path); sha = cur ? cur.sha : null; }
      if (!sha) return;
      const r = await gh('DELETE', `/repos/${repo}/contents/${encPath(path)}`, { message, sha, branch });
      if (r.ok || r.status === 404) { shas.delete(path); last.delete(path); good(); return; }
      throw await httpError(r);
    }).catch(fail);
  }

  async function load() {
    await ensureBranch();
    const out = { teams: [], state: null };
    const lib = await getFile('data/library.json');
    if (lib) {
      const list = (JSON.parse(lib.buf.toString('utf8')).teams) || [];
      let i = 0;
      async function worker() {
        while (i < list.length) {
          const t = list[i++];
          let buf = null;
          if (t.ext) { const f = await getFile(`data/logos/${t.id}.${t.ext}`); buf = f ? f.buf : null; }
          out.teams.push({ id: t.id, name: t.name, tag: t.tag, v: t.v || '', mime: t.mime || '', ext: t.ext || '', buf });
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()]);
    }
    const st = await getFile('data/state.json');
    if (st) out.state = JSON.parse(st.buf.toString('utf8'));
    return out;
  }

  return {
    enabled,
    info: () => ({ mode: enabled ? 'github' : 'memory', ok: status.ok, saved: status.saved, error: status.error, writes: writeOK }),
    setWriteOK(v) { writeOK = !!v; },
    reportError(e) { fail(e); },
    reportOk() { good(); },
    load,
    saveState: (obj) => put('data/state.json', Buffer.from(JSON.stringify(obj, null, 1)), 'Состояние эфира'),
    saveLibrary: (teams) => put('data/library.json', Buffer.from(JSON.stringify({
      teams: teams.map((t) => ({ id: t.id, name: t.name, tag: t.tag, v: t.v, mime: t.mime, ext: t.ext }))
    }, null, 1)), 'Список команд'),
    saveLogo: (t) => (t.buf && t.ext) ? put(`data/logos/${t.id}.${t.ext}`, t.buf, 'Логотип: ' + t.name) : Promise.resolve(),
    deleteLogo: (id, ext) => ext ? remove(`data/logos/${id}.${ext}`, 'Удалён логотип') : Promise.resolve(),
    idle: () => chain
  };
}
module.exports = createStorage;
