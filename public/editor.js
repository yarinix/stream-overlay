/* Редактор оверлея в пульте: сетка, выравнивание, свои сцены */
(function(){
'use strict';
var BUILTIN = [['game','Игра'],['soon','Скоро начнём'],['break','Перерыв'],['bracket','Сетка'],['end','Финал'],['cam','Только вебка']];
var $ = function(id){ return document.getElementById(id); };
var zoom = 1, tab = 'l', pan = false, root, frame, D = null, scene = 'game', undo = [], redo = [], lastSnap = '', dirty = false, ready = false, selKeys = [], insT = 0, nid = 1;
var T = { text: 'Текст', panel: 'Плашка', line: 'Линия', img: 'Картинка', timer: 'Таймер' };
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function esc(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
function OV(){ try { return frame.contentWindow.__ov || null; } catch (e) { return null; } }
function ED(){ try { return frame.contentWindow.EDIT || null; } catch (e) { return null; } }
function curCS(){ for (var i = 0; i < D.customScenes.length; i++) if ('c:' + D.customScenes[i].id === scene) return D.customScenes[i]; return null; }
function lay(){ return D.layout[scene] || (D.layout[scene] = {}); }
function item(id){ var c = curCS(); if (!c) return null; for (var i = 0; i < c.items.length; i++) if (c.items[i].id === id) return c.items[i]; return null; }
function snap(){ return JSON.stringify([D.layout, D.customScenes]); }

function ico(p){ return '<svg viewBox="0 0 16 16">' + p + '</svg>'; }
var ICONS = {
  left: ico('<path d="M2 1v14"/><rect x="4" y="3" width="9" height="4"/><rect x="4" y="9" width="5" height="4"/>'),
  hcenter: ico('<path d="M8 1v14"/><rect x="3" y="3" width="10" height="4"/><rect x="5" y="9" width="6" height="4"/>'),
  right: ico('<path d="M14 1v14"/><rect x="3" y="3" width="9" height="4"/><rect x="7" y="9" width="5" height="4"/>'),
  top: ico('<path d="M1 2h14"/><rect x="3" y="4" width="4" height="9"/><rect x="9" y="4" width="4" height="5"/>'),
  vcenter: ico('<path d="M1 8h14"/><rect x="3" y="3" width="4" height="10"/><rect x="9" y="5" width="4" height="6"/>'),
  bottom: ico('<path d="M1 14h14"/><rect x="3" y="3" width="4" height="9"/><rect x="9" y="7" width="4" height="5"/>'),
  dh: ico('<path d="M2 1v14M14 1v14"/><rect x="6" y="4" width="4" height="8"/>'),
  dv: ico('<path d="M1 2h14M1 14h14"/><rect x="4" y="6" width="8" height="4"/>')
};

/* ---------- каркас ---------- */
function build(){
  root = document.createElement('div'); root.id = 'ed'; root.className = 'ed'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Редактор оверлея');
  root.innerHTML =
    '<div class="ed-bar">' +
      '<div class="grp"><b style="letter-spacing:.14em;text-transform:uppercase;font-size:12px">Редактор</b></div>' +
      '<div class="grp"><select id="edScene" aria-label="Сцена"></select><button class="eb" id="edNew" type="button" title="Создать свою сцену">+ Сцена</button></div>' +
      '<div class="sep"></div>' +
      '<div class="grp"><button class="eb" id="edUndo" type="button" title="Отменить (Ctrl+Z)">↶</button><button class="eb" id="edRedo" type="button" title="Повторить (Ctrl+Y)">↷</button></div>' +
      '<div class="sep"></div>' +
      '<div class="grp"><button class="eb on" id="edGrid" type="button" title="Показать сетку">Сетка</button><select id="edGs" aria-label="Шаг сетки"><option>10</option><option selected>20</option><option>40</option><option>60</option><option>80</option></select>' +
      '<label class="ck"><input type="checkbox" id="edSnap" checked>Привязка</label><label class="ck"><input type="checkbox" id="edSafe" checked>Безопасная зона</label></div>' +
      '<div class="sep"></div>' +
      '<div class="grp" id="edAl"></div>' +
      '<div style="flex:1"></div>' +
      '<span class="ed-dirty" id="edDirty"></span>' +
      '<div class="grp"><button class="eb" id="edLive" type="button" title="Применить и показать эту сцену на стриме">В эфир</button><button class="eb p" id="edSave" type="button">Сохранить</button><button class="eb" id="edClose" type="button">Закрыть</button></div>' +
    '</div>' +
    '<div class="ed-main"><div class="ed-l" id="edL"></div><div class="ed-sw"><div class="ed-stage" id="edStage"><iframe id="edFrame" title="Редактор"></iframe></div>' +
      '<div class="ed-zm"><button class="eb" id="edZo" type="button" aria-label="Уменьшить">−</button><button class="eb" id="edZf" type="button" aria-label="Вписать">⤢</button><button class="eb" id="edZi" type="button" aria-label="Увеличить">+</button><button class="eb" id="edPan" type="button" aria-label="Двигать вид">✋</button></div></div>' +
      '<div class="ed-tabs" id="edTabs"><button type="button" data-tab="l">Элементы</button><button type="button" data-tab="i">Свойства</button><button type="button" data-tab="a">Выровнять</button></div>' +
      '<div class="ed-ins" id="edI"></div><div class="ed-a" id="edA"></div></div>';
  root.setAttribute('data-tab', tab);
  document.body.appendChild(root);
  frame = $('edFrame');
  var al = $('edAl'), h = '';
  [['left','По левому краю'],['hcenter','По центру по горизонтали'],['right','По правому краю'],['top','По верхнему краю'],['vcenter','По центру по вертикали'],['bottom','По нижнему краю']].forEach(function(a){
    h += '<button class="eb" type="button" data-al="' + a[0] + '" title="' + a[1] + '">' + ICONS[a[0]] + '</button>';
  });
  h += '<button class="eb" type="button" data-di="h" title="Распределить по горизонтали (от 3 элементов)">' + ICONS.dh + '</button><button class="eb" type="button" data-di="v" title="Распределить по вертикали (от 3 элементов)">' + ICONS.dv + '</button>';
  al.innerHTML = h;
  var pad = '<div class="pad"><i></i><button class="eb" type="button" data-nu="0,-1">↑</button><i></i><button class="eb" type="button" data-nu="-1,0">←</button><button class="eb" type="button" data-nu="0,1">↓</button><button class="eb" type="button" data-nu="1,0">→</button></div>';
  $('edA').innerHTML = '<h4>Выровнять</h4><div class="als">' + h + '</div><h4>Сдвиг на 1 px</h4><label class="ck"><input type="checkbox" id="edStep10">шаг 10 px</label>' + pad +
    '<div class="addg"><button class="eb" type="button" data-act="dup">Дублировать</button><button class="eb" type="button" data-act="rm">Удалить / скрыть</button></div>' +
    '<p class="hint">Выбери элемент на сцене или в списке. Для одного элемента выравнивание идёт по кадру, для нескольких — по рамке выделения.</p>';
  function onAl(e){
    var b = e.target.closest('button'); if (!b) return; var E = ED(); if (!E) return;
    if (b.dataset.al) E.align(b.dataset.al); else if (b.dataset.di) E.distribute(b.dataset.di);
    else if (b.dataset.nu){ var v = b.dataset.nu.split(','), st = $('edStep10') && $('edStep10').checked ? 10 : 1; E.nudge(v[0] * st, v[1] * st); }
    else if (b.dataset.act === 'dup') dupSel(); else if (b.dataset.act === 'rm') delSel();
  }
  al.onclick = onAl; $('edA').onclick = onAl;
  $('edTabs').onclick = function(e){ var b = e.target.closest('button'); if (b) setTab(b.dataset.tab); };
  $('edZo').onclick = function(){ setZoom(zoom / 1.4); }; $('edZi').onclick = function(){ setZoom(zoom * 1.4); }; $('edZf').onclick = function(){ setZoom(1); };
  $('edPan').onclick = function(){ pan = !pan; this.classList.toggle('on', pan); var E = ED(); if (E) E.setPan(pan); };
  $('edScene').onchange = function(){ setScene(this.value); };
  $('edNew').onclick = newSceneDialog;
  $('edUndo').onclick = doUndo; $('edRedo').onclick = doRedo;
  $('edGrid').onclick = function(){ this.classList.toggle('on'); pushGrid(); };
  $('edGs').onchange = pushGrid; $('edSnap').onchange = pushGrid; $('edSafe').onchange = pushGrid;
  $('edSave').onclick = save;
  $('edLive').onclick = function(){ save(); if (window.CTL) window.CTL.patch({ scene: scene }); };
  $('edClose').onclick = close;
  window.addEventListener('resize', fitStage);
  document.addEventListener('keydown', function(e){ if (!root.classList.contains('on')) return; onKey(e, false); });
}
function pushGrid(){
  var E = ED(); if (!E) return;
  E.setGrid({ on: $('edGrid').classList.contains('on'), size: +$('edGs').value, snap: $('edSnap').checked, safe: $('edSafe').checked });
}
function fitStage(){
  var st = $('edStage'); if (!st) return;
  var w = st.clientWidth - 16, h = st.clientHeight - 16, k = Math.min(w / 1920, h / 1080) * zoom;
  if (k <= 0) return;
  frame.style.width = Math.floor(1920 * k) + 'px'; frame.style.height = Math.floor(1080 * k) + 'px';
}
function setZoom(z){
  var st = $('edStage'), fx = (st.scrollLeft + st.clientWidth / 2) / Math.max(1, st.scrollWidth), fy = (st.scrollTop + st.clientHeight / 2) / Math.max(1, st.scrollHeight);
  zoom = Math.max(1, Math.min(5, z)); fitStage();
  st.scrollLeft = fx * st.scrollWidth - st.clientWidth / 2; st.scrollTop = fy * st.scrollHeight - st.clientHeight / 2;
  var E = ED(); if (E) E.redraw();
}
function setTab(t){ tab = t; root.setAttribute('data-tab', t); fitStage(); }

/* ---------- открыть / закрыть / сохранить ---------- */
function open(){
  var C = window.CTL; if (!C || !C.st) return;
  if (!root) build();
  D = { layout: clone(C.st.layout || {}), customScenes: clone(C.st.customScenes || []) };
  scene = C.st.scene; if (scene !== 'game' && !isScene(scene)) scene = 'game';
  undo = []; redo = []; lastSnap = snap(); dirty = false; selKeys = []; ready = false; zoom = 1; pan = false; tab = 'l'; root.setAttribute('data-tab', tab); $('edPan').classList.remove('on');
  root.classList.add('on'); document.body.style.overflow = 'hidden';
  frame.onload = function(){ attachFrame(); };
  frame.src = '/overlay?edit&_=' + Date.now();
  fillScenes(); renderLeft(); renderIns(); updBar(); fitStage();
}
function isScene(k){ return BUILTIN.some(function(b){ return b[0] === k; }) || !!(D && D.customScenes.some(function(c){ return 'c:' + c.id === k; })); }
function attachFrame(){
  try { frame.contentDocument.addEventListener('keydown', function(e){ onKey(e, true); }); } catch (e) {}
}
function close(){
  if (dirty && !confirm('Есть несохранённые изменения. Закрыть без сохранения?')) return;
  root.classList.remove('on'); document.body.style.overflow = ''; frame.src = 'about:blank';
}
function save(){
  if (!window.CTL) return;
  window.CTL.patch({ customScenes: D.customScenes, layout: D.layout });
  dirty = false; updBar();
}
function updBar(){
  $('edUndo').disabled = !undo.length; $('edRedo').disabled = !redo.length;
  $('edDirty').textContent = dirty ? 'Есть несохранённые изменения' : ''; $('edSave').textContent = dirty ? 'Сохранить •' : 'Сохранить';
  [$('edAl'), $('edA')].forEach(function(c){ c.querySelectorAll('button').forEach(function(b){ if (b.dataset.al || b.dataset.di || b.dataset.nu || b.dataset.act) b.disabled = !selKeys.length || (b.dataset.di && selKeys.length < 3) || (b.dataset.act === 'dup' && !curCS()); }); });
}
function preview(){
  var o = OV(); if (!o) return;
  o.override({ scene: scene, layout: D.layout, customScenes: D.customScenes });
  var E = ED(); if (E) E.draw();
}
function commit(){
  var s = snap(); if (s === lastSnap) return;
  undo.push(lastSnap); if (undo.length > 80) undo.shift(); redo = []; lastSnap = s; dirty = true; updBar();
}
function restore(s){
  var a = JSON.parse(s); D.layout = a[0]; D.customScenes = a[1]; lastSnap = s; dirty = true;
  if (!isScene(scene)) scene = 'game';
  fillScenes(); preview(); renderLeft(); renderIns(); updBar();
}
function doUndo(){ if (!undo.length) return; redo.push(snap()); restore(undo.pop()); }
function doRedo(){ if (!redo.length) return; undo.push(snap()); restore(redo.pop()); }

/* ---------- сцены ---------- */
function fillScenes(){
  var h = '<optgroup label="Встроенные">';
  BUILTIN.forEach(function(b){ h += '<option value="' + b[0] + '"' + (scene === b[0] ? ' selected' : '') + '>' + b[1] + '</option>'; });
  h += '</optgroup>';
  if (D.customScenes.length){
    h += '<optgroup label="Свои">';
    D.customScenes.forEach(function(c){ h += '<option value="c:' + c.id + '"' + (scene === 'c:' + c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; });
    h += '</optgroup>';
  }
  $('edScene').innerHTML = h;
}
function setScene(k){ scene = k; selKeys = []; fillScenes(); preview(); renderLeft(); renderIns(); updBar(); var E = ED(); if (E) E.select([]); }
function uid(prefix, list){
  var ids = {}; list.forEach(function(x){ ids[x.id] = 1; });
  var id; do { id = prefix + (nid++).toString(36) + Math.random().toString(36).slice(2, 4); } while (ids[id]);
  return id;
}
function mk(type, o){
  var base = { type: type, x: 760, y: 420, w: 400, h: 80, rot: 0, op: 1, hue: 0, hide: false, name: '' };
  if (type === 'text' || type === 'timer'){
    base.text = type === 'timer' ? '{timer}' : 'Новый текст'; base.font = type === 'timer' ? 'num' : 'sub'; base.size = type === 'timer' ? 120 : 40; base.weight = type === 'timer' ? 500 : 600;
    base.color = '#ffffff'; base.align = 'center'; base.ls = 0.1; base.upper = false; base.glow = false; base.metal = false; base.italic = false;
    if (type === 'timer'){ base.w = 400; base.h = 150; base.ls = 0.02; }
  } else if (type === 'panel'){ base.w = 500; base.h = 90; base.style = 'plate'; base.fill = ''; base.border = ''; base.radius = 0; }
  else if (type === 'line'){ base.w = 500; base.h = 3; base.color = '#c4a265'; base.solid = false; }
  else if (type === 'img'){ base.w = 200; base.h = 200; base.src = 'mpl'; base.fit = 'contain'; }
  for (var k in o) base[k] = o[k];
  return base;
}
var TPL = [
  { id: 'empty', name: 'Пустая', desc: 'Прозрачный фон и вебка — добавляйте всё сами', build: function(){ return { bg: 'none', cam: true, items: [] }; } },
  { id: 'title', name: 'Заставка с заголовком', desc: 'Королевский фон, заголовок, подзаголовок и таймер', build: function(){ return { bg: 'soon', cam: false, items: [
    mk('text', { name: 'Заголовок', text: 'Заголовок', font: 'head', size: 130, weight: 700, upper: false, ls: 0.04, metal: true, x: 160, y: 300, w: 1600, h: 170 }),
    mk('line', { name: 'Линия', x: 680, y: 490, w: 560, h: 3 }),
    mk('text', { name: 'Подзаголовок', text: '{tour}', size: 30, weight: 500, ls: 0.4, upper: true, glow: true, x: 160, y: 520, w: 1600, h: 60 }),
    mk('timer', { name: 'Таймер', x: 560, y: 640, w: 800, h: 200, size: 190, metal: true })
  ] }; } },
  { id: 'match', name: 'Анонс матча', desc: 'Логотипы и названия команд, VS, стадия турнира', build: function(){ return { bg: 'break', cam: false, items: [
    mk('img', { name: 'Логотип A', src: 'logoA', x: 300, y: 330, w: 320, h: 320 }),
    mk('img', { name: 'Логотип B', src: 'logoB', x: 1300, y: 330, w: 320, h: 320 }),
    mk('text', { name: 'Команда A', text: '{teamA}', font: 'head', size: 64, weight: 700, x: 160, y: 690, w: 600, h: 90, metal: true }),
    mk('text', { name: 'Команда B', text: '{teamB}', font: 'head', size: 64, weight: 700, x: 1160, y: 690, w: 600, h: 90, metal: true }),
    mk('text', { name: 'VS', text: 'VS', font: 'head', size: 120, weight: 700, x: 760, y: 420, w: 400, h: 140, color: '#f4e5b8' }),
    mk('text', { name: 'Стадия', text: '{stage} · {bo}', size: 26, ls: 0.3, upper: true, x: 460, y: 120, w: 1000, h: 50 })
  ] }; } },
  { id: 'lower', name: 'Ведущие', desc: 'Вебка и нижняя плашка с ником и ролью', build: function(){ return { bg: 'none', cam: true, items: [
    mk('panel', { name: 'Плашка', style: 'plate', x: 60, y: 880, w: 640, h: 120 }),
    mk('text', { name: 'Ник', text: '{cast}', font: 'head', size: 50, weight: 700, align: 'left', ls: 0.02, x: 100, y: 892, w: 560, h: 60 }),
    mk('text', { name: 'Роль', text: '{role}', size: 16, weight: 600, ls: 0.28, upper: true, align: 'left', color: '#f4e5b8', x: 100, y: 952, w: 560, h: 30 })
  ] }; } }
];
function newSceneDialog(){
  if (D.customScenes.length >= 12){ alert('Можно создать не больше 12 своих сцен.'); return; }
  var m = document.createElement('div'); m.className = 'ed-modal';
  var h = '<div><h3>Новая сцена</h3><div class="fld"><label for="nsName">Название</label><input id="nsName" maxlength="28" value="Моя сцена"></div><div class="tpl">';
  TPL.forEach(function(t){ h += '<button type="button" data-t="' + t.id + '"><b>' + t.name + '</b><small>' + t.desc + '</small></button>'; });
  h += '</div><button class="eb" type="button" id="nsX">Отмена</button></div>';
  m.innerHTML = h; document.body.appendChild(m);
  $('nsName').focus(); $('nsName').select();
  m.onclick = function(e){
    if (e.target === m || e.target.id === 'nsX'){ m.remove(); return; }
    var b = e.target.closest('button[data-t]'); if (!b) return;
    var t = TPL.filter(function(x){ return x.id === b.dataset.t; })[0], d = t.build();
    var id = uid('s', D.customScenes);
    d.items.forEach(function(it, i){ it.id = 'e' + (i + 1); });
    D.customScenes.push({ id: id, name: ($('nsName').value || 'Сцена').slice(0, 28), bg: d.bg, cam: d.cam, items: d.items });
    m.remove(); commit(); setScene('c:' + id);
  };
}
function delScene(){
  var c = curCS(); if (!c || !confirm('Удалить сцену «' + c.name + '»?')) return;
  D.customScenes = D.customScenes.filter(function(x){ return x !== c; }); delete D.layout[scene];
  commit(); setScene('game');
}

/* ---------- элементы ---------- */
function addItem(type){
  var c = curCS(); if (!c) return;
  if (c.items.length >= 80){ alert('Слишком много элементов (максимум 80).'); return; }
  var it = mk(type, { id: uid('i', c.items) });
  c.items.push(it); commit(); preview(); renderLeft(); selectKeys(['i:' + it.id]);
}
function selectKeys(k){ var E = ED(); if (E) E.select(k); else { selKeys = k; renderLeft(); renderIns(); } }
function delSel(){
  var c = curCS(), L = lay(), any = false;
  selKeys.forEach(function(k){
    var id = k.slice(2);
    if (k.charAt(0) === 'i' && c){ c.items = c.items.filter(function(i){ return i.id !== id; }); any = true; }
    else if (k.charAt(0) === 'b'){ (L[id] || (L[id] = {})).hide = true; any = true; }
  });
  if (!any) return; selKeys = []; commit(); preview(); renderLeft(); var E = ED(); if (E) E.select([]); renderIns();
}
function dupSel(){
  var c = curCS(); if (!c) return; var ns = [];
  selKeys.forEach(function(k){
    if (k.charAt(0) !== 'i' || c.items.length >= 80) return;
    var it = clone(item(k.slice(2))); it.id = uid('i', c.items); it.x += 24; it.y += 24; c.items.push(it); ns.push('i:' + it.id);
  });
  if (!ns.length) return; commit(); preview(); renderLeft(); selectKeys(ns);
}
function order(dir){
  var c = curCS(); if (!c) return;
  selKeys.forEach(function(k){
    if (k.charAt(0) !== 'i') return; var id = k.slice(2), i = -1;
    c.items.forEach(function(x, n){ if (x.id === id) i = n; }); if (i < 0) return;
    var it = c.items.splice(i, 1)[0];
    if (dir === 'front') c.items.push(it); else if (dir === 'back') c.items.unshift(it);
    else c.items.splice(Math.max(0, Math.min(c.items.length, i + dir)), 0, it);
  });
  commit(); preview(); renderLeft();
}
function onKey(e, fromFrame){
  var t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  var ctrl = e.ctrlKey || e.metaKey, k = e.key;
  if (ctrl && (k === 'z' || k === 'Z' || k === 'я')){ e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
  else if (ctrl && (k === 'y' || k === 'Y')){ e.preventDefault(); doRedo(); }
  else if (ctrl && (k === 'd' || k === 'D')){ e.preventDefault(); dupSel(); }
  else if (k === 'Delete' || k === 'Backspace'){ e.preventDefault(); delSel(); }
  else if (!fromFrame){ var E = ED(); if (E && E.onKey(e)) e.preventDefault(); }
}

/* ---------- панели ---------- */
function renderLeft(){
  var E = ED(), L = $('edL'), c = curCS(), h = '';
  var keys = E ? E.keys() : [];
  h += '<h4>Элементы сцены</h4>';
  var bk = keys.filter(function(k){ return k.charAt(0) === 'b'; }), ik = keys.filter(function(k){ return k.charAt(0) === 'i'; });
  function row(k){
    var nm = E.name(k), off = E.isOff(k), on = selKeys.indexOf(k) >= 0;
    return '<div class="ly' + (on ? ' on' : '') + (off ? ' off' : '') + '" data-k="' + k + '"><span title="' + esc(nm) + '">' + esc(nm) + '</span><button type="button" data-eye="' + k + '" title="' + (off ? 'Показать' : 'Скрыть') + '">' + (off ? '◌' : '●') + '</button></div>';
  }
  if (ik.length){ for (var i = ik.length - 1; i >= 0; i--) h += row(ik[i]); }
  if (bk.length){ if (ik.length) h += '<h4>Встроенные</h4>'; bk.forEach(function(k){ h += row(k); }); }
  if (!ik.length && !bk.length) h += '<p class="hint">' + (E ? 'На этой сцене нет редактируемых элементов.' : 'Загружаю…') + '</p>';
  if (c){
    h += '<h4>Добавить</h4><div class="addg">';
    ['text','panel','line','img','timer'].forEach(function(t){ h += '<button class="eb" type="button" data-add="' + t + '">+ ' + T[t] + '</button>'; });
    h += '</div>';
  } else h += '<p class="hint">Чтобы добавлять свои текст, плашки и картинки — создайте свою сцену («+ Сцена»).</p>';
  L.innerHTML = h;
  L.onclick = function(e){
    var eye = e.target.closest('[data-eye]'), add = e.target.closest('[data-add]'), r = e.target.closest('.ly');
    if (add){ addItem(add.dataset.add); return; }
    if (eye){ toggleHide(eye.dataset.eye); e.stopPropagation(); return; }
    if (r){ if (e.shiftKey){ var s = selKeys.slice(), i = s.indexOf(r.dataset.k); if (i >= 0) s.splice(i, 1); else s.push(r.dataset.k); selectKeys(s); } else selectKeys([r.dataset.k]); }
  };
}
function toggleHide(k){
  var id = k.slice(2);
  if (k.charAt(0) === 'i'){ var it = item(id); if (it) it.hide = !it.hide; }
  else { var e = lay()[id] || (lay()[id] = {}); e.hide = !e.hide; }
  commit(); preview(); renderLeft(); renderIns();
}
function fld(label, inner, one){ return '<div class="fld"' + (one ? ' style="grid-column:1/-1"' : '') + '><label>' + label + '</label>' + inner + '</div>'; }
function numI(key, v, min, max, step){ return '<input type="number" data-p="' + key + '" value="' + (v == null ? '' : v) + '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '">'; }
function colI(key, v, def){ return '<div class="row"><input type="color" data-p="' + key + '" value="' + (v || def) + '"></div>'; }
function selI(key, v, opts){ return '<select data-p="' + key + '">' + opts.map(function(o){ return '<option value="' + o[0] + '"' + (String(v) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; }
function chk(key, v, label){ return '<label class="ck" style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" data-p="' + key + '"' + (v ? ' checked' : '') + '>' + label + '</label>'; }
function renderIns(){
  var I = $('edI'); if (!I) return;
  var h = '', c = curCS();
  if (!selKeys.length){
    if (c){
      h += '<h4>Сцена</h4><div class="fr one">' + fld('Название', '<input data-s="name" maxlength="28" value="' + esc(c.name) + '">') +
        fld('Фон', selI('bg', /^#/.test(c.bg) ? 'color' : c.bg, [['none', 'Прозрачный'], ['soon', 'Королевский 1'], ['break', 'Королевский 2'], ['end', 'Королевский 3'], ['bracket', 'Королевский 4'], ['color', 'Свой цвет']]).replace('data-p=', 'data-s=')) +
        (/^#/.test(c.bg) ? fld('Цвет фона', '<div class="row"><input type="color" data-s="bgc" value="' + c.bg + '"></div>') : '') +
        '<div class="fld">' + chk('cam', c.cam, 'Показывать рамку вебки').replace('data-p=', 'data-s=') + '</div></div>' +
        '<button class="eb" type="button" id="edDel" style="width:100%">Удалить сцену</button>';
    } else {
      h += '<h4>Сцена</h4><p class="hint">Выберите элемент на сцене или в списке слева. Перетаскивайте, тяните за маркеры, нажимайте стрелки для сдвига (Shift — по 10 px).</p><button class="eb" type="button" id="edReset" style="width:100%">Сбросить правки этой сцены</button>';
    }
    h += '<h4>Подсказки</h4><p class="hint">Shift — выделить несколько или держать ось. Alt — без привязки. Рамкой по пустому месту — выделить группу. Ctrl+Z / Ctrl+Y — отмена / повтор.</p>';
  } else if (selKeys.length > 1){
    h += '<h4>Выбрано: ' + selKeys.length + '</h4><p class="hint">Выравнивание и распределение — на верхней панели. Относительно рамки выделения (для одного элемента — относительно кадра).</p><div class="addg"><button class="eb" type="button" id="edDup">Дублировать</button><button class="eb" type="button" id="edRm">Удалить / скрыть</button></div>';
  } else {
    var k = selKeys[0], id = k.slice(2), E = ED(), r = E && E.rect(k) || {};
    if (k.charAt(0) === 'b'){
      var en = lay()[id] || {}, nm = E.name(k);
      h += '<h4>' + esc(nm) + '</h4><div class="fr">' +
        fld('Сдвиг X', numI('dx', en.dx || 0, -2400, 2400, 1)) + fld('Сдвиг Y', numI('dy', en.dy || 0, -1400, 1400, 1)) +
        fld('Масштаб, %', numI('sc', Math.round((en.sc || 1) * 100), 20, 400, 1)) + fld('Оттенок', numI('hue', en.hue || 0, 0, 360, 5)) +
        fld('Цвет текста', '<div class="row">' + chk('colorOn', !!en.color, 'свой').replace('data-p=', 'data-p=') + '<input type="color" data-p="color" value="' + (en.color || '#ffffff') + '"></div>', true) +
        '<div class="fld" style="grid-column:1/-1">' + chk('hide', en.hide, 'Скрыть элемент') + '</div></div>' +
        '<p class="hint">Положение: ' + Math.round(r.x || 0) + ', ' + Math.round(r.y || 0) + ' · ' + Math.round(r.w || 0) + '×' + Math.round(r.h || 0) + '</p>' +
        '<button class="eb" type="button" id="edRst" style="width:100%">Сбросить элемент</button>';
    } else {
      var it = item(id); if (!it){ I.innerHTML = ''; return; }
      h += '<h4>' + T[it.type] + '</h4><div class="fr one">' + fld('Название в списке', '<input data-p="name" maxlength="28" value="' + esc(it.name) + '">') + '</div>';
      if (it.type === 'text' || it.type === 'timer'){
        h += '<div class="fr one">' + fld('Текст', '<textarea data-p="text" rows="2" maxlength="160" style="resize:vertical">' + esc(it.text) + '</textarea><div class="chips">' +
          ['teamA','teamB','scoreA','scoreB','score','tour','stage','cast','role','bo','map','timer','social'].map(function(t){ return '<button type="button" data-tk="{' + t + '}">{' + t + '}</button>'; }).join('') + '</div>') + '</div>' +
          '<div class="fr">' + fld('Шрифт', selI('font', it.font, [['head', 'Заголовочный'], ['sub', 'Основной'], ['num', 'Цифры']])) + fld('Размер', numI('size', it.size, 8, 400)) +
          fld('Толщина', selI('weight', it.weight, [[300, 'Тонкий'], [400, 'Обычный'], [500, 'Средний'], [600, 'Полужирный'], [700, 'Жирный'], [800, 'Очень жирный'], [900, 'Чёрный']])) + fld('Выравнивание', selI('align', it.align, [['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']])) +
          fld('Разрядка', numI('ls', it.ls, 0, 1, 0.02)) + fld('Цвет', colI('color', it.color, '#ffffff')) + '</div>' +
          '<div class="fr">' + chk('upper', it.upper, 'ЗАГЛАВНЫЕ') + chk('italic', it.italic, 'Курсив') + chk('glow', it.glow, 'Свечение') + chk('metal', it.metal, 'Металл') + '</div>';
      } else if (it.type === 'panel'){
        h += '<div class="fr">' + fld('Стиль', selI('style', it.style, [['plate', 'Фирменная'], ['glass', 'Стекло'], ['solid', 'Сплошная'], ['outline', 'Контур']]), true) +
          fld('Заливка', '<div class="row">' + chk('fillOn', !!it.fill, 'своя') + '<input type="color" data-p="fill" value="' + (it.fill || '#0a1530') + '"></div>') +
          fld('Рамка', '<div class="row">' + chk('borderOn', !!it.border, 'своя') + '<input type="color" data-p="border" value="' + (it.border || '#c4a265') + '"></div>') +
          fld('Скругление', numI('radius', it.radius, 0, 80)) + '</div>';
      } else if (it.type === 'line'){
        h += '<div class="fr">' + fld('Цвет', colI('color', it.color, '#c4a265')) + '<div class="fld" style="justify-content:end">' + chk('solid', it.solid, 'Сплошная') + '</div></div>';
      } else if (it.type === 'img'){
        h += '<div class="fr">' + fld('Картинка', selI('src', it.src, [['mpl', 'MPL'], ['m8', 'M8'], ['twitch', 'Twitch'], ['logoA', 'Логотип команды A'], ['logoB', 'Логотип команды B'], ['camframe', 'Рамка вебки']]), true) + fld('Вписывание', selI('fit', it.fit, [['contain', 'Целиком'], ['cover', 'Заполнить']]), true) + '</div>';
      }
      h += '<h4>Положение</h4><div class="fr">' + fld('X', numI('x', it.x, -600, 2500)) + fld('Y', numI('y', it.y, -600, 1500)) + fld('Ширина', numI('w', it.w, 1, 2400)) + fld('Высота', numI('h', it.h, 1, 1400)) +
        fld('Поворот°', numI('rot', it.rot, -180, 180)) + fld('Прозрачность', '<input type="range" data-p="op" min="0" max="1" step="0.05" value="' + it.op + '">') +
        fld('Оттенок', numI('hue', it.hue, 0, 360, 5)) + '<div class="fld" style="justify-content:end">' + chk('hide', it.hide, 'Скрыть') + '</div></div>' +
        '<div class="addg"><button class="eb" type="button" id="edDup">Дублировать</button><button class="eb" type="button" id="edRm">Удалить</button>' +
        '<button class="eb" type="button" data-z="1">Выше</button><button class="eb" type="button" data-z="-1">Ниже</button></div>';
    }
  }
  I.innerHTML = h; bindIns(I);
}
var NUMK = { x: 1, y: 1, w: 1, h: 1, rot: 1, size: 1, ls: 1, radius: 1, hue: 1, op: 1, weight: 1 };
function bindIns(I){
  function dj(id, fn){ var b = $(id); if (b) b.onclick = fn; }
  dj('edDel', delScene); dj('edDup', dupSel); dj('edRm', delSel);
  dj('edReset', function(){ if (!confirm('Сбросить все правки встроенных элементов на этой сцене?')) return; delete D.layout[scene]; commit(); preview(); renderLeft(); renderIns(); });
  dj('edRst', function(){ delete lay()[selKeys[0].slice(2)]; commit(); preview(); renderLeft(); renderIns(); });
  I.querySelectorAll('[data-z]').forEach(function(b){ b.onclick = function(){ order(+b.dataset.z); }; });
  I.querySelectorAll('[data-tk]').forEach(function(b){ b.onclick = function(){
    var it = item(selKeys[0].slice(2)); if (!it) return; var ta = I.querySelector('textarea[data-p=text]');
    var a = ta.selectionStart == null ? ta.value.length : ta.selectionStart, z = ta.selectionEnd == null ? a : ta.selectionEnd;
    it.text = (ta.value.slice(0, a) + b.dataset.tk + ta.value.slice(z)).slice(0, 160); ta.value = it.text; commit(); preview(); ta.focus();
  }; });
  I.querySelectorAll('[data-s]').forEach(function(el){
    var h = function(){
      var c = curCS(); if (!c) return; var s = el.dataset.s;
      if (s === 'name'){ c.name = el.value.slice(0, 28) || 'Сцена'; fillScenes(); }
      else if (s === 'bg'){ c.bg = el.value === 'color' ? (/^#/.test(c.bg) ? c.bg : '#0a1530') : el.value; }
      else if (s === 'bgc'){ c.bg = el.value; }
      else if (s === 'cam'){ c.cam = el.checked; }
      preview();
    };
    el.addEventListener('input', h);
    el.addEventListener('change', function(){ h(); commit(); if (el.dataset.s === 'bg') renderIns(); });
  });
  I.querySelectorAll('[data-p]').forEach(function(el){
    var upd = function(){ setProp(el); };
    el.addEventListener('input', upd);
    el.addEventListener('change', function(){ upd(); commit(); if (/^(style|src|font|fillOn|borderOn|colorOn)$/.test(el.dataset.p)) renderIns(); renderLeftSoft(); });
  });
}
function renderLeftSoft(){ clearTimeout(insT); insT = setTimeout(renderLeft, 60); }
function setProp(el){
  var p = el.dataset.p, k = selKeys[0]; if (!k) return;
  var v = el.type === 'checkbox' ? el.checked : el.value;
  if (k.charAt(0) === 'b'){
    var e = lay()[k.slice(2)] || (lay()[k.slice(2)] = {});
    if (p === 'dx' || p === 'dy' || p === 'hue') e[p] = +v || 0;
    else if (p === 'sc') e.sc = Math.min(400, Math.max(20, +v || 100)) / 100;
    else if (p === 'hide') e.hide = !!v;
    else if (p === 'colorOn'){ if (v) e.color = (I$('color') || '#ffffff'); else delete e.color; }
    else if (p === 'color'){ e.color = v; var co = document.querySelector('#edI [data-p=colorOn]'); if (co) co.checked = true; }
  } else {
    var it = item(k.slice(2)); if (!it) return;
    if (p === 'fillOn'){ it.fill = v ? I$('fill') : ''; }
    else if (p === 'borderOn'){ it.border = v ? I$('border') : ''; }
    else if (p === 'fill' || p === 'border'){ it[p] = v; var cb = document.querySelector('#edI [data-p=' + p + 'On]'); if (cb) cb.checked = true; }
    else if (NUMK[p]) it[p] = p === 'op' || p === 'ls' ? +v : Math.round(+v) || 0;
    else if (el.type === 'checkbox') it[p] = !!v;
    else it[p] = v;
  }
  preview();
}
function I$(p){ var e = document.querySelector('#edI [data-p=' + p + ']'); return e ? e.value : ''; }

window.EditorUI = {
  ready: function(){ ready = true; var E = ED(); if (E){ pushGrid(); preview(); fitStage(); renderLeft(); renderIns(); } },
  onSelect: function(k){ var was = selKeys.length; selKeys = k; renderLeft(); renderIns(); updBar(); if (!was && k.length && tab === 'l' && window.matchMedia('(max-width:980px)').matches) setTab('i'); },
  live: function(){ clearTimeout(insT); insT = setTimeout(function(){ renderIns(); }, 30); },
  changed: function(){ commit(); renderLeft(); }
};
window.EditorOpen = open;
})();
