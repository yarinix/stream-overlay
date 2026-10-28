/* Редактор элементов: работает внутри /overlay?edit, управляется из пульта (editor.js) */
(function(){
'use strict';
var O = window.__ov, edl = document.getElementById('edl'), cv = O.cv;
var sel = [], grid = { on: true, size: 20, snap: true, safe: true }, guides = [], drag = null, raf = 0;
function ui(){ try { return parent.EditorUI || null; } catch (e) { return null; } }
function S(){ return O.st; }
function scn(){ var s = S(); if (!s || String(s.scene).indexOf('c:') !== 0) return null; var id = s.scene.slice(2); return (s.customScenes || []).filter(function(c){ return c.id === id; })[0] || null; }
function lay(){ var s = S(); if (!s) return {}; s.layout = s.layout || {}; return s.layout[s.scene] || (s.layout[s.scene] = {}); }
function ent(id){ var L = lay(); return L[id] || (L[id] = {}); }
function item(id){ var c = scn(); return c ? c.items.filter(function(i){ return i.id === id; })[0] : null; }
function r1(v){ return Math.round(v * 10) / 10; }
function pt(e){ var cr = cv.getBoundingClientRect(), k = O.k; return { x: (e.clientX - cr.left) / k, y: (e.clientY - cr.top) / k }; }

function rect(key){
  var t = key.charAt(0), id = key.slice(2);
  if (t === 'i'){ var it = item(id); return it ? { x: it.x, y: it.y, w: it.w, h: it.h, rot: it.rot || 0 } : null; }
  var e = O.elx[id]; if (!e || !e.el) return null;
  var cr = cv.getBoundingClientRect(), k = O.k, r;
  if (id === 'bgrid'){
    var ch = e.el.querySelectorAll('.bh,.bm'), x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
    for (var i = 0; i < ch.length; i++){ var q = ch[i].getBoundingClientRect(); x1 = Math.min(x1, q.left); y1 = Math.min(y1, q.top); x2 = Math.max(x2, q.right); y2 = Math.max(y2, q.bottom); }
    r = { left: x1, top: y1, width: x2 - x1, height: y2 - y1 };
  } else if (e.tight){
    var rg = document.createRange(); rg.selectNodeContents(e.el); r = rg.getBoundingClientRect();
  } else r = e.el.getBoundingClientRect();
  return { x: (r.left - cr.left) / k, y: (r.top - cr.top) / k, w: r.width / k, h: r.height / k, rot: 0 };
}
function allKeys(){
  var ks = []; if (!S()) return ks;
  O.els.forEach(function(e){ if (O.isVis(e)){ var r = rect('b:' + e.id); if (r && r.w > 1 && r.h > 1) ks.push('b:' + e.id); } });
  var c = scn(); if (c) c.items.forEach(function(i){ ks.push('i:' + i.id); });
  return ks;
}
function name(key){
  var id = key.slice(2);
  if (key.charAt(0) === 'b') return O.elx[id].name;
  var it = item(id); return it ? (it.name || ({ text: 'Текст', panel: 'Плашка', line: 'Линия', img: 'Картинка', timer: 'Таймер' }[it.type]) + ' ' + id) : id;
}
function isOff(key){ var id = key.slice(2); return key.charAt(0) === 'b' ? !!(lay()[id] && lay()[id].hide) : !!(item(id) && item(id).hide); }

/* ---------- отрисовка рамок ---------- */
function draw(){
  if (!S()) return;
  var keys = allKeys(); sel = sel.filter(function(k){ return keys.indexOf(k) >= 0; });
  var h = '';
  if (grid.safe) h += '<div class="safe"></div><div class="cx" style="left:959px;top:0;bottom:0;width:calc(1px*var(--inv))"></div><div class="cx" style="top:539px;left:0;right:0;height:calc(1px*var(--inv))"></div>';
  edl.className = grid.on ? 'grid' : ''; edl.style.setProperty('--g', grid.size + 'px');
  keys.forEach(function(k){
    var r = rect(k); if (!r) return;
    var on = sel.indexOf(k) >= 0, single = on && sel.length === 1;
    h += '<div class="eh' + (on ? ' on' : '') + (k.charAt(0) === 'b' ? ' grp' : '') + (isOff(k) ? ' off' : '') + '" data-k="' + k + '" style="left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;height:' + r.h + 'px' + (r.rot ? ';transform:rotate(' + r.rot + 'deg)' : '') + '"><span class="el">' + name(k).replace(/</g, '&lt;') + '</span>';
    if (single){
      var hs = k.charAt(0) === 'b' ? ['nw','ne','se','sw'] : ['nw','n','ne','e','se','s','sw','w'];
      hs.forEach(function(x){ h += '<i class="rh" data-h="' + x + '"></i>'; });
    }
    h += '</div>';
  });
  guides.forEach(function(g){ h += g.v != null ? '<div class="gd v" style="left:' + g.v + 'px"></div>' : '<div class="gd h" style="top:' + g.h + 'px"></div>'; });
  if (drag && drag.mq){ var m = drag.mq; h += '<div class="mq" style="left:' + Math.min(m.x1, m.x2) + 'px;top:' + Math.min(m.y1, m.y2) + 'px;width:' + Math.abs(m.x2 - m.x1) + 'px;height:' + Math.abs(m.y2 - m.y1) + 'px"></div>'; }
  edl.innerHTML = h;
}
function redraw(){ if (raf) return; raf = requestAnimationFrame(function(){ raf = 0; draw(); }); }
function notify(){ var u = ui(); if (u && u.onSelect) u.onSelect(sel.slice()); }
function live(){ var u = ui(); if (u && u.live) u.live(); }
function changed(kind){ var u = ui(); if (u && u.changed) u.changed(kind); }
function apply(){ O.render(); draw(); }

/* ---------- привязки ---------- */
function targets(skip){
  var xs = [0, 960, 1920], ys = [0, 540, 1080];
  if (grid.safe){ xs.push(96, 1824); ys.push(54, 1026); }
  allKeys().forEach(function(k){
    if (skip.indexOf(k) >= 0 || isOff(k)) return;
    var r = rect(k); if (!r) return;
    xs.push(r.x, r.x + r.w / 2, r.x + r.w); ys.push(r.y, r.y + r.h / 2, r.y + r.h);
  });
  return { xs: xs, ys: ys };
}
function best(vals, tg, thr){
  var bd = thr + 1, bc = 0, bt = null;
  vals.forEach(function(v){ tg.forEach(function(t){ var d = t - v; if (Math.abs(d) < bd){ bd = Math.abs(d); bc = d; bt = t; } }); });
  return bd <= thr ? { d: bc, t: bt } : null;
}
function snapMove(B, d, tg, off){
  guides = []; if (off) return d;
  var thr = 8 / O.k, nx = d.x, ny = d.y;
  var mx = [B.x + d.x, B.x + B.w / 2 + d.x, B.x + B.w + d.x], my = [B.y + d.y, B.y + B.h / 2 + d.y, B.y + B.h + d.y];
  var bx = best(mx, tg.xs, thr), by = best(my, tg.ys, thr);
  if (bx){ nx += bx.d; guides.push({ v: bx.t }); } else if (grid.snap){ nx += Math.round(mx[0] / grid.size) * grid.size - mx[0]; }
  if (by){ ny += by.d; guides.push({ h: by.t }); } else if (grid.snap){ ny += Math.round(my[0] / grid.size) * grid.size - my[0]; }
  return { x: nx, y: ny };
}
function snapVal(v, ts, off, axis){
  if (off) return v;
  var thr = 8 / O.k, b = best([v], ts, thr);
  if (b){ guides.push(axis === 'x' ? { v: b.t } : { h: b.t }); return b.t; }
  return grid.snap ? Math.round(v / grid.size) * grid.size : v;
}

/* ---------- перемещение ---------- */
function snapshot(keys){
  var m = {};
  keys.forEach(function(k){
    var id = k.slice(2), r = rect(k);
    if (k.charAt(0) === 'b'){ var e = ent(id); m[k] = { r: r, dx: e.dx || 0, dy: e.dy || 0, sc: e.sc || 1 }; }
    else { var it = item(id); m[k] = { r: r, x: it.x, y: it.y, w: it.w, h: it.h }; }
  });
  return m;
}
function bounds(m){
  var x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  Object.keys(m).forEach(function(k){ var r = m[k].r; x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); });
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
function applyMove(m, d){
  Object.keys(m).forEach(function(k){
    var s = m[k], id = k.slice(2);
    if (k.charAt(0) === 'b'){ var e = ent(id); e.dx = r1(s.dx + d.x); e.dy = r1(s.dy + d.y); }
    else { var it = item(id); it.x = Math.round(s.x + d.x); it.y = Math.round(s.y + d.y); }
  });
}
/* ---------- изменение размера ---------- */
function resize(p, e){
  var k = drag.keys[0], s = drag.snap[k], hd = drag.h, id = k.slice(2), off = e.altKey;
  guides = [];
  if (k.charAt(0) === 'b'){
    var r = s.r, sx = hd.indexOf('e') >= 0 ? 1 : -1, sy = hd.indexOf('s') >= 0 ? 1 : -1;
    var ax = sx > 0 ? r.x : r.x + r.w, ay = sy > 0 ? r.y : r.y + r.h;
    var cx = sx > 0 ? r.x + r.w : r.x, cy = sy > 0 ? r.y + r.h : r.y;
    var vx = cx - ax, vy = cy - ay, L2 = vx * vx + vy * vy || 1;
    var q = ((p.x - ax) * vx + (p.y - ay) * vy) / L2;
    var ns = Math.min(4, Math.max(0.2, s.sc * q));
    var bc = { x: r.x + r.w / 2, y: r.y + r.h / 2 }, f = 1 - ns / s.sc;
    var en = ent(id);
    en.sc = Math.round(ns * 1000) / 1000;
    en.dx = r1(s.dx + (ax - bc.x) * f); en.dy = r1(s.dy + (ay - bc.y) * f);
  } else {
    var it = item(id), rot = (it.rot || 0) * Math.PI / 180, co = Math.cos(rot), si = Math.sin(rot);
    var ddx = p.x - drag.p0.x, ddy = p.y - drag.p0.y;
    var lx = ddx * co + ddy * si, ly = -ddx * si + ddy * co;
    var hx = hd.indexOf('e') >= 0 ? 1 : hd.indexOf('w') >= 0 ? -1 : 0, hy = hd.indexOf('s') >= 0 ? 1 : hd.indexOf('n') >= 0 ? -1 : 0;
    if (!rot){
      var tg = drag.tg;
      if (hx > 0) lx = snapVal(s.x + s.w + lx, tg.xs, off, 'x') - (s.x + s.w);
      if (hx < 0) lx = snapVal(s.x + lx, tg.xs, off, 'x') - s.x;
      if (hy > 0) ly = snapVal(s.y + s.h + ly, tg.ys, off, 'y') - (s.y + s.h);
      if (hy < 0) ly = snapVal(s.y + ly, tg.ys, off, 'y') - s.y;
    }
    var nw = s.w + hx * lx, nh = s.h + hy * ly;
    if (e.shiftKey && hx && hy){ var ratio = s.w / s.h, a = nw / s.w, b = nh / s.h, m = Math.max(a, b); nw = s.w * m; nh = nw / ratio; }
    nw = Math.max(4, nw); nh = Math.max(4, nh);
    var ow = nw - s.w, oh = nh - s.h;
    var shx = hx ? hx * ow / 2 : 0, shy = hy ? hy * oh / 2 : 0;
    var gcx = s.x + s.w / 2 + shx * co - shy * si, gcy = s.y + s.h / 2 + shx * si + shy * co;
    it.w = Math.round(nw); it.h = Math.round(nh); it.x = Math.round(gcx - nw / 2); it.y = Math.round(gcy - nh / 2);
  }
}

edl.addEventListener('pointerdown', function(e){
  if (e.button !== 0) return;
  try { edl.setPointerCapture(e.pointerId); } catch (_) {}
  window.focus();
  var p = pt(e), h = e.target.closest ? e.target.closest('.rh') : null, b = e.target.closest ? e.target.closest('.eh') : null;
  if (h && sel.length === 1){
    drag = { mode: 'resize', h: h.dataset.h, keys: sel.slice(), p0: p };
    drag.snap = snapshot(drag.keys); drag.tg = targets(drag.keys);
  } else if (b){
    var k = b.dataset.k;
    if (e.shiftKey){ var i = sel.indexOf(k); if (i >= 0) sel.splice(i, 1); else sel.push(k); }
    else if (sel.indexOf(k) < 0) sel = [k];
    drag = { mode: 'move', keys: sel.slice(), p0: p, moved: false };
    drag.snap = snapshot(drag.keys); drag.B = bounds(drag.snap); drag.tg = targets(drag.keys);
  } else {
    if (!e.shiftKey) sel = [];
    drag = { mode: 'mq', mq: { x1: p.x, y1: p.y, x2: p.x, y2: p.y }, base: sel.slice() };
  }
  notify(); draw();
});
edl.addEventListener('pointermove', function(e){
  if (!drag) return;
  var p = pt(e);
  if (drag.mode === 'move'){
    var d = { x: p.x - drag.p0.x, y: p.y - drag.p0.y };
    if (!drag.moved && Math.abs(d.x) + Math.abs(d.y) < 3 / O.k) return;
    drag.moved = true;
    if (e.shiftKey){ if (Math.abs(d.x) > Math.abs(d.y)) d.y = 0; else d.x = 0; }
    d = snapMove(drag.B, d, drag.tg, e.altKey);
    applyMove(drag.snap, d); O.render(); redraw(); live();
  } else if (drag.mode === 'resize'){
    resize(p, e); O.render(); redraw(); live();
  } else if (drag.mode === 'mq'){
    var m = drag.mq; m.x2 = p.x; m.y2 = p.y;
    var x1 = Math.min(m.x1, m.x2), x2 = Math.max(m.x1, m.x2), y1 = Math.min(m.y1, m.y2), y2 = Math.max(m.y1, m.y2);
    var hit = allKeys().filter(function(k){ var r = rect(k); return r && r.x < x2 && r.x + r.w > x1 && r.y < y2 && r.y + r.h > y1; });
    sel = drag.base.concat(hit.filter(function(k){ return drag.base.indexOf(k) < 0; }));
    redraw();
  }
});
function end(e){
  if (!drag) return;
  var d = drag; drag = null; guides = [];
  if ((d.mode === 'move' && d.moved) || d.mode === 'resize') changed(d.mode);
  notify(); draw();
}
edl.addEventListener('pointerup', end); edl.addEventListener('pointercancel', end);

/* ---------- выравнивание ---------- */
function moveBy(k, dx, dy){
  var id = k.slice(2);
  if (k.charAt(0) === 'b'){ var e = ent(id); e.dx = r1((e.dx || 0) + dx); e.dy = r1((e.dy || 0) + dy); }
  else { var it = item(id); it.x = Math.round(it.x + dx); it.y = Math.round(it.y + dy); }
}
function align(mode){
  if (!sel.length) return;
  var rs = sel.map(function(k){ return rect(k); });
  var B = sel.length > 1 ? bounds(snapshot(sel)) : { x: 0, y: 0, w: 1920, h: 1080 };
  sel.forEach(function(k, i){
    var r = rs[i], dx = 0, dy = 0;
    if (mode === 'left') dx = B.x - r.x; else if (mode === 'hcenter') dx = B.x + B.w / 2 - (r.x + r.w / 2); else if (mode === 'right') dx = B.x + B.w - (r.x + r.w);
    else if (mode === 'top') dy = B.y - r.y; else if (mode === 'vcenter') dy = B.y + B.h / 2 - (r.y + r.h / 2); else if (mode === 'bottom') dy = B.y + B.h - (r.y + r.h);
    moveBy(k, dx, dy);
  });
  apply(); changed('align'); live();
}
function distribute(axis){
  if (sel.length < 3) return;
  var a = sel.map(function(k){ return { k: k, r: rect(k) }; });
  var X = axis === 'h';
  a.sort(function(p, q){ return X ? p.r.x - q.r.x : p.r.y - q.r.y; });
  var first = a[0].r, last = a[a.length - 1].r;
  var total = X ? (last.x + last.w - first.x) : (last.y + last.h - first.y), sum = 0;
  a.forEach(function(o){ sum += X ? o.r.w : o.r.h; });
  var gap = (total - sum) / (a.length - 1), pos = X ? first.x : first.y;
  a.forEach(function(o){
    var cur = X ? o.r.x : o.r.y; if (X) moveBy(o.k, pos - cur, 0); else moveBy(o.k, 0, pos - cur);
    pos += (X ? o.r.w : o.r.h) + gap;
  });
  apply(); changed('distribute'); live();
}
var nudT = 0;
function onKey(e){
  var t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return false;
  var st = e.shiftKey ? 10 : (grid.snap && e.ctrlKey ? grid.size : 1), dx = 0, dy = 0;
  if (e.key === 'ArrowLeft') dx = -st; else if (e.key === 'ArrowRight') dx = st; else if (e.key === 'ArrowUp') dy = -st; else if (e.key === 'ArrowDown') dy = st;
  else if (e.key === 'Escape'){ sel = []; notify(); draw(); return true; }
  else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')){ sel = allKeys().filter(function(k){ return !isOff(k); }); notify(); draw(); return true; }
  else return false;
  if (!sel.length) return true;
  sel.forEach(function(k){ moveBy(k, dx, dy); });
  apply(); live(); clearTimeout(nudT); nudT = setTimeout(function(){ changed('nudge'); }, 350);
  return true;
}
document.addEventListener('keydown', function(e){ if (onKey(e)) e.preventDefault(); });
window.addEventListener('resize', function(){ redraw(); });

window.EDIT = {
  draw: draw, redraw: redraw, apply: apply, align: align, distribute: distribute, onKey: onKey,
  select: function(keys){ sel = keys.slice(); notify(); draw(); },
  getSel: function(){ return sel.slice(); }, keys: allKeys, name: name, isOff: isOff, rect: rect,
  setGrid: function(o){ for (var k in o) grid[k] = o[k]; draw(); }, getGrid: function(){ return grid; }
};
(function wait(){ if (!O.ready()) return setTimeout(wait, 80); draw(); var u = ui(); if (u && u.ready) u.ready(); })();
})();
