'use strict';
/* 準備ノート — ステップ1・2（イベント／TODO／必要な物／当日の手順／ホーム／当日モード） */

/* ================= 定数 ================= */
const TYPES = [
  { id: 'ワークショップ', color: '#67a47d' },
  { id: 'クラス', color: '#e2b567' },
  { id: 'フレッシュライブ', color: '#8295bb' },
  { id: 'コミュニティ', color: '#c98fa0' },
];
const ITEM_STATUS = ['未手配', '手配済', '揃った'];
const PRIORITIES = ['高', '中', '低'];
const WD = ['日', '月', '火', '水', '木', '金', '土'];

/* ================= 日付ユーティリティ（端末のローカル時間） ================= */
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => fmt(new Date());
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 86400000);
const md = s => { const d = parse(s); return `${d.getMonth() + 1}/${pad(d.getDate())}`; };
const longDate = s => { const d = parse(s); return `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`; };
const monthLabel = s => { const d = parse(s); return `${d.getFullYear()}年 ${d.getMonth() + 1}月`; };
function relDay(s) {
  const n = diffDays(s, today());
  if (n === 0) return '今日';
  if (n === 1) return '明日';
  if (n > 1) return `あと${n}日`;
  return `${-n}日前`;
}

/* ================= 小道具 ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const typeOf = id => TYPES.find(t => t.id === id) || TYPES[0];
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ================= データ保存（IndexedDB） ================= */
const DB_NAME = 'junbi-note', STORE = 'kv';
let dbp;
function idb() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function idbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction(STORE).objectStore(STORE).get(k);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function idbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).put(v, k);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

let data = emptyData();
function emptyData() { return { version: 1, events: [], todos: [], items: [], steps: [], lastBackup: null }; }
function normalize(d) {
  const o = emptyData();
  if (!d || typeof d !== 'object') return o;
  for (const k of ['events', 'todos', 'items', 'steps']) o[k] = Array.isArray(d[k]) ? d[k] : [];
  o.lastBackup = typeof d.lastBackup === 'string' ? d.lastBackup : null;
  return o;
}
async function load() {
  try { data = normalize(await idbGet('data')); return; } catch (e) { /* fall through */ }
  try { data = normalize(JSON.parse(localStorage.getItem('junbi-data'))); } catch (e) { data = emptyData(); }
}
let saveTimer;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 40); }
async function persist() {
  clearTimeout(saveTimer);
  try { await idbSet('data', data); }
  catch (e) {
    try { localStorage.setItem('junbi-data', JSON.stringify(data)); }
    catch (e2) { toast('保存できませんでした'); }
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist();
  else render();
});

/* ================= データ取得ヘルパー ================= */
const evById = id => data.events.find(e => e.id === id);
const todosOf = id => data.todos.filter(t => t.eventId === id);
const itemsOf = id => data.items.filter(i => i.eventId === id);
const stepsOf = id => data.steps.filter(s => s.eventId === id).sort((a, b) => a.order - b.order);
const byDate = (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'ja');
function effStatus(ev) {
  if (ev.status === '完了') return '完了';
  if (ev.date === today()) return '当日';
  return '準備中';
}
const todoOverdue = t => !t.done && t.due && t.due < today();
const itemLate = i => i.status !== '揃った' && i.needBy && i.needBy < today();
function counts(ev) {
  const t = todosOf(ev.id), i = itemsOf(ev.id);
  return { td: t.filter(x => x.done).length, tn: t.length, id: i.filter(x => x.status === '揃った').length, in: i.length };
}
function removeEvent(id) {
  data.events = data.events.filter(e => e.id !== id);
  data.todos = data.todos.filter(e => e.eventId !== id);
  data.items = data.items.filter(e => e.eventId !== id);
  data.steps = data.steps.filter(e => e.eventId !== id);
}

/* ================= 画面状態・ナビゲーション ================= */
const ui = { view: 'home', root: 'home', eventId: null, tab: 'todo', mode: 'list', filter: 'すべて', calMonth: today().slice(0, 7), calSel: today(), stack: [] };
function go(view, p = {}) {
  ui.stack.push({ view: ui.view, eventId: ui.eventId, tab: ui.tab });
  Object.assign(ui, { view }, p);
  render(true);
}
function back() {
  const s = ui.stack.pop();
  if (s) Object.assign(ui, s); else ui.view = ui.root === 'settings' ? 'settings' : 'events';
  render(true);
}
function tabTo(v) { ui.stack = []; ui.view = v; ui.root = v; render(true); }

/* ================= 描画部品 ================= */
function check(on, action, id, label) {
  return `<button class="check ${on ? 'on' : ''}" data-a="${action}" data-id="${esc(id)}" aria-label="${esc(label)}" aria-pressed="${on}"><span></span></button>`;
}
function statusBadge(ev) {
  const s = effStatus(ev);
  const cls = s === '当日' ? 'today' : s === '完了' ? 'gray' : '';
  return `<span class="badge ${cls}">${s}</span>`;
}

function eventCard(ev) {
  const c = counts(ev), ty = typeOf(ev.type);
  const stat = (c.tn + c.in) ? `<div class="stat">${c.tn ? `<span>TODO ${c.td}/${c.tn}</span>` : ''}${c.in ? `<span>必要な物 ${c.id}/${c.in}</span>` : ''}</div>`
    : `<div class="stat"><span>準備項目を追加しましょう</span></div>`;
  const rel = ev.status === '完了' ? '' : `　・　${relDay(ev.date)}`;
  return `<div class="card ev tap" style="--tc:${ty.color}" data-a="open-event" data-id="${esc(ev.id)}">
    <div class="top"><span class="d">${longDate(ev.date)}${rel}</span>${statusBadge(ev)}</div>
    <div class="n">${esc(ev.name)}</div>
    <div class="rs">${esc(ev.type)}${ev.place ? '　・　' + esc(ev.place) : ''}</div>${stat}</div>`;
}

function todoRow(t, o = {}) {
  const ev = evById(t.eventId); if (!ev) return '';
  const od = todoOverdue(t);
  const bits = [];
  if (o.showEvent) bits.push(esc(ev.name));
  if (t.due) bits.push(`<span class="nw">${o.showEvent && t.due === today() ? '今日' : `期限 ${md(t.due)}`}</span>`);
  if (!o.showEvent && t.priority) bits.push(`優先度 ${esc(t.priority)}`);
  if (t.done) bits.push('完了');
  const act = o.open ? `data-a="open-event" data-id="${esc(ev.id)}" data-tab="todo"` : `data-a="edit-todo" data-id="${esc(t.id)}"`;
  return `<div class="card row tap ${t.done ? 'done' : ''}" ${act}>
    ${check(t.done, 'toggle-todo', t.id, t.text + ' を完了にする')}
    <div class="rb"><div class="rt">${esc(t.text)}</div><div class="rs">${bits.join('　・　')}</div></div>
    ${od ? '<span class="badge warn">期限切れ</span>' : (!t.done && t.priority === '高' && !o.open ? '<span class="badge warn">高</span>' : '')}</div>`;
}

function itemRow(i, o = {}) {
  const ev = evById(i.eventId); if (!ev) return '';
  const late = itemLate(i), done = i.status === '揃った';
  const bits = [];
  if (o.showEvent) bits.push(esc(ev.name));
  if (i.needBy) bits.push(`<span class="nw">${md(i.needBy)} に必要</span>`);
  bits.push(esc(i.status));
  if (!o.showEvent && i.source) bits.push(esc(i.source));
  const act = o.open ? `data-a="open-event" data-id="${esc(ev.id)}" data-tab="items"` : `data-a="edit-item" data-id="${esc(i.id)}"`;
  const stCls = i.status === '揃った' ? '' : i.status === '手配済' ? 'gray' : 'warn';
  return `<div class="card row tap ${done ? 'done' : ''}" ${act}>
    ${check(done, 'toggle-item', i.id, i.name + ' が揃った')}
    <div class="rb"><div class="rt">${esc(i.name)}${i.qty ? `　× ${esc(i.qty)}` : ''}</div><div class="rs">${bits.join('　・　')}</div></div>
    ${late ? '<span class="badge warn">期限切れ</span>' : (o.open ? '' : `<button class="chipbtn ${stCls}" data-a="cycle-item" data-id="${esc(i.id)}">${esc(i.status)}</button>`)}</div>`;
}

/* ================= ホーム ================= */
function viewHome() {
  const t = today();
  const dueTodos = data.todos.filter(x => x.due && evById(x.eventId) && (x.due === t || (x.due < t && !x.done)))
    .sort((a, b) => (a.done - b.done) || a.due.localeCompare(b.due));
  const total = dueTodos.length, done = dueTodos.filter(x => x.done).length;
  const soon = data.items.filter(i => i.status !== '揃った' && i.needBy && i.needBy <= addDays(t, 7) && evById(i.eventId))
    .sort((a, b) => a.needBy.localeCompare(b.needBy));
  const upcoming = data.events.filter(e => e.status !== '完了' && e.date >= t).sort(byDate).slice(0, 3);
  const d = parse(t);
  const needBackup = data.events.length && (!data.lastBackup || diffDays(t, data.lastBackup) >= 30);

  let h = `<div class="head"><div><p class="eyebrow">${longDate(t)}</p><h1 class="title">今日の準備</h1></div></div>`;

  if (!data.events.length) {
    return h + `<div class="empty"><b>まずはイベントを作りましょう</b>イベントを作ると、TODO・必要な物・当日の手順をまとめて管理できます。
      <div><button class="btn" data-a="new-event">イベントを作る</button></div>
      <div><button class="btn soft" data-a="sample">サンプルを入れて試す</button></div></div>`;
  }
  if (needBackup) h += `<div class="note"><span>${data.lastBackup ? '最後のバックアップから30日以上たちました。' : 'まだバックアップがありません。'}</span><button data-a="tab" data-id="settings">設定へ ›</button></div>`;

  h += `<div class="card hero"><b>今日の進み具合</b>
    <div class="big">${total ? `${done}<small> / ${total} 件 完了</small>` : '<small>今日が期限のTODOはありません</small>'}</div>
    ${total ? `<div class="bar"><i style="width:${Math.round(done / total * 100)}%"></i></div>` : ''}</div>`;

  h += `<h2 class="sec">今日やること<small>期限切れを含む</small></h2>`;
  h += dueTodos.length ? dueTodos.map(x => todoRow(x, { showEvent: true, open: true })).join('')
    : `<div class="empty">今日やることはありません</div>`;

  h += `<h2 class="sec">もうすぐ必要な物<small>1週間以内</small></h2>`;
  h += soon.length ? soon.map(i => itemRow(i, { showEvent: true, open: true })).join('')
    : `<div class="empty">1週間以内に必要な物はありません</div>`;

  h += `<h2 class="sec">直近のイベント</h2>`;
  h += upcoming.length ? upcoming.map(e => {
    const ty = typeOf(e.type);
    return `<div class="card row tap" data-a="open-event" data-id="${esc(e.id)}">
      <div class="dbox" style="border-left:4px solid ${ty.color}">${md(e.date)}</div>
      <div class="rb"><div class="rt">${esc(e.name)}</div><div class="rs">${effStatus(e) === '当日' ? '当日' : relDay(e.date)}${e.place ? '　・　' + esc(e.place) : ''}</div></div>
      <span class="chev">›</span></div>`;
  }).join('') : `<div class="empty">予定されているイベントはありません</div>`;
  return h;
}

/* ================= イベント一覧／カレンダー ================= */
function viewEvents() {
  let h = `<div class="head"><div><h1 class="title">イベント</h1></div></div>
    <div class="seg"><button class="${ui.mode === 'list' ? 'on' : ''}" data-a="set-mode" data-id="list">リスト</button><button class="${ui.mode === 'cal' ? 'on' : ''}" data-a="set-mode" data-id="cal">カレンダー</button></div>`;
  h += ui.mode === 'cal' ? viewCal() : viewList();
  return h;
}
function viewList() {
  const filters = ['すべて', '準備中', '当日', '完了'];
  let h = `<div class="chips">${filters.map(f => `<button class="${ui.filter === f ? 'on' : ''}" data-a="set-filter" data-id="${f}">${f}</button>`).join('')}</div>`;
  const all = data.events.slice();
  let list;
  if (ui.filter === 'すべて') {
    const active = all.filter(e => e.status !== '完了').sort(byDate);
    const done = all.filter(e => e.status === '完了').sort((a, b) => byDate(b, a));
    if (!active.length && !done.length) return h + emptyEvents();
    let last = '';
    for (const e of active) {
      const m = e.date.slice(0, 7);
      if (m !== last) { h += `<div class="mon">${monthLabel(e.date)}</div>`; last = m; }
      h += eventCard(e);
    }
    if (done.length) { h += `<div class="mon">完了したイベント</div>` + done.map(eventCard).join(''); }
    return h;
  }
  list = all.filter(e => effStatus(e) === ui.filter).sort(ui.filter === '完了' ? (a, b) => byDate(b, a) : byDate);
  if (!list.length) return h + (data.events.length ? `<div class="empty">「${ui.filter}」のイベントはありません</div>` : emptyEvents());
  return h + list.map(eventCard).join('');
}
function emptyEvents() {
  return `<div class="empty"><b>イベントはまだありません</b>右下の「＋」から追加できます。</div>`;
}
function viewCal() {
  const [y, m] = ui.calMonth.split('-').map(Number);
  const startDow = new Date(y, m - 1, 1).getDay(), dim = new Date(y, m, 0).getDate();
  const rows = Math.ceil((startDow + dim) / 7);
  const byDay = {};
  data.events.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
  let h = `<div class="calhead"><button class="iconbtn" data-a="cal-prev" aria-label="前の月">‹</button><b>${y}年 ${m}月</b><button class="iconbtn" data-a="cal-next" aria-label="次の月">›</button></div><div class="cal">`;
  h += WD.map(w => `<div class="w">${w}</div>`).join('');
  for (let i = 0; i < rows * 7; i++) {
    const day = i - startDow + 1;
    if (day < 1 || day > dim) { h += '<div></div>'; continue; }
    const ds = `${y}-${pad(m)}-${pad(day)}`;
    const dow = i % 7;
    const evs = byDay[ds] || [];
    h += `<button class="c ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''} ${ds === today() ? 'td' : ''} ${ds === ui.calSel ? 'sel' : ''}" data-a="cal-pick" data-id="${ds}">${day}<span class="dots">${evs.slice(0, 3).map(e => `<i style="background:${ds === ui.calSel ? '#fff' : typeOf(e.type).color}"></i>`).join('')}</span></button>`;
  }
  h += '</div>';
  const sel = (byDay[ui.calSel] || []).sort(byDate);
  h += `<div class="mon">${longDate(ui.calSel)}</div>`;
  h += sel.length ? sel.map(eventCard).join('')
    : `<div class="empty">この日のイベントはありません<div><button class="btn soft" data-a="new-event" data-id="${ui.calSel}">この日にイベントを追加</button></div></div>`;
  return h;
}

/* ================= イベント詳細 ================= */
function viewDetail() {
  const ev = evById(ui.eventId);
  if (!ev) { ui.view = 'events'; return viewEvents(); }
  const ty = typeOf(ev.type), c = counts(ev), steps = stepsOf(ev.id);
  let h = `<button class="back" data-a="back">‹ ${ui.stack.length && ui.stack[ui.stack.length - 1].view === 'home' ? '今日' : 'イベント'}</button>
  <div class="head"><div><h1 class="title">${esc(ev.name)}</h1>
    <p class="sub">${longDate(ev.date)}${ev.place ? '　・　' + esc(ev.place) : ''}</p>
    <p style="margin:10px 0 0;display:flex;gap:6px;align-items:center">${statusBadge(ev)}<span class="badge" style="background:#fff;box-shadow:var(--shadow);color:var(--ink)"><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ty.color};margin-right:5px"></i>${esc(ev.type)}</span></p></div>
    <button class="link" data-a="edit-event">編集</button></div>
  <button class="dayopen" data-a="day-mode"><span>当日モードを開く<small>必要な物の最終確認と、当日の手順 ${steps.filter(s => s.done).length}/${steps.length}</small></span><span class="ar">›</span></button>
  <div class="tabs">${[['todo', 'TODO'], ['items', '必要な物'], ['steps', '手順'], ['memo', 'メモ']].map(([k, l]) => `<button class="${ui.tab === k ? 'on' : ''}" data-a="set-tab" data-id="${k}">${l}</button>`).join('')}</div>`;

  if (ui.tab === 'todo') {
    const list = todosOf(ev.id).sort((a, b) => (a.done - b.done) || ((a.due || '9999').localeCompare(b.due || '9999')));
    h += `<div class="tabhead"><b>TODO<small>${c.td}/${c.tn} 完了</small></b><button class="link" data-a="add-todo">＋ 追加</button></div>`;
    h += list.length ? list.map(t => todoRow(t)).join('') : `<div class="empty">TODOはまだありません<div><button class="btn soft" data-a="add-todo">TODOを追加</button></div></div>`;
  } else if (ui.tab === 'items') {
    const list = itemsOf(ev.id).sort((a, b) => ((a.status === '揃った') - (b.status === '揃った')) || ((a.needBy || '9999').localeCompare(b.needBy || '9999')));
    h += `<div class="tabhead"><b>必要な物<small>${c.id}/${c.in} 揃った</small></b><button class="link" data-a="add-item">＋ 追加</button></div>`;
    h += list.length ? list.map(i => itemRow(i)).join('') : `<div class="empty">必要な物はまだありません<div><button class="btn soft" data-a="add-item">必要な物を追加</button></div></div>`;
  } else if (ui.tab === 'steps') {
    h += `<div class="tabhead"><b>当日の手順<small>${steps.filter(s => s.done).length}/${steps.length} 完了</small></b><button class="link" data-a="add-step">＋ 追加</button></div>`;
    h += steps.length ? steps.map((s, idx) => stepRow(s, idx + 1, false)).join('') : `<div class="empty">当日の手順はまだありません<div><button class="btn soft" data-a="add-step">手順を追加</button></div></div>`;
  } else {
    h += `<div class="tabhead"><b>メモ</b></div><textarea class="memo" id="memo" placeholder="このイベントに関するメモ" aria-label="メモ">${esc(ev.memo || '')}</textarea><div class="saved" id="saved"></div>`;
  }
  return h;
}
function stepRow(s, n, big, nextId) {
  const isNext = nextId === s.id;
  return `<div class="card row tap ${s.done ? 'done' : ''} ${isNext ? 'next' : ''}" data-a="${big ? 'toggle-step' : 'edit-step'}" data-id="${esc(s.id)}">
    <span class="num">${s.done ? '✓' : n}</span>
    <div class="rb"><div class="rt">${esc(s.text)}</div><div class="rs">${s.time ? esc(s.time) : ''}${s.time && isNext ? '　・　' : ''}${isNext ? '次の手順' : ''}</div></div>
    ${big ? '' : check(s.done, 'toggle-step', s.id, s.text + ' を完了にする')}</div>`;
}

/* ================= 当日モード ================= */
function viewDay() {
  const ev = evById(ui.eventId);
  if (!ev) { ui.view = 'events'; return viewEvents(); }
  const items = itemsOf(ev.id).sort((a, b) => ((a.status === '揃った') - (b.status === '揃った')) || ((a.needBy || '9999').localeCompare(b.needBy || '9999')));
  const steps = stepsOf(ev.id);
  const next = steps.find(s => !s.done);
  const ready = items.filter(i => i.status === '揃った').length;
  let h = `<button class="back" data-a="back">‹ イベント詳細</button>
  <div class="dayhero"><div class="tiny">${longDate(ev.date)}　・　当日モード</div><div class="n">${esc(ev.name)}</div></div>
  <div class="big">
  <h2 class="sec">持ち物の最終確認<small>${ready} / ${items.length}</small></h2>`;
  h += items.length ? items.map(i => `<div class="card row tap ${i.status === '揃った' ? 'on' : ''}" data-a="toggle-item" data-id="${esc(i.id)}">
      ${check(i.status === '揃った', 'toggle-item', i.id, i.name + ' が揃った')}
      <div class="rb"><div class="rt">${esc(i.name)}${i.qty ? `　× ${esc(i.qty)}` : ''}</div><div class="rs">${i.status === '揃った' ? '揃った' : (i.needBy ? `必要な日 ${md(i.needBy)}　・　` : '') + esc(i.status)}</div></div></div>`).join('')
    : `<div class="empty">必要な物は登録されていません</div>`;
  h += `<h2 class="sec">当日の手順<small>${steps.filter(s => s.done).length} / ${steps.length} 完了</small></h2>`;
  h += steps.length ? steps.map((s, i) => stepRow(s, i + 1, true, next && next.id)).join('') : `<div class="empty">手順は登録されていません</div>`;
  if (next) h += `<button class="btn soft block" style="margin-top:6px;padding:15px" data-a="step-next" data-id="${esc(next.id)}">次の手順を完了にする　✓</button>`;
  h += `</div>`;
  if (ev.status === '完了') h += `<button class="btn soft block finish" data-a="reopen-event">完了済み（タップで準備中に戻す）</button>`;
  else h += `<button class="btn block finish" data-a="finish-event">${steps.length && !next ? 'お疲れさまでした！イベントを完了にする' : 'イベントを完了にする'}</button>`;
  return h;
}

/* ================= 設定 ================= */
function viewSettings() {
  const lb = data.lastBackup ? `最後のバックアップ：${longDate(data.lastBackup)}` : 'まだバックアップしていません';
  return `<div class="head"><div><h1 class="title">設定</h1></div></div>
  <div class="card set"><b>バックアップ</b><p>データはこのiPhoneの中にだけ保存されています。機種変更や故障に備えて、ときどき書き出しておきましょう。<br>${lb}</p>
    <div class="btns"><button class="btn" data-a="export">書き出す</button><button class="btn soft" data-a="import">読み込む</button></div></div>
  <div class="card set"><b>ホーム画面に追加する</b><p>ホーム画面に追加して使うと、アプリのように全画面で開き、保存データも消えにくくなります。</p>
    <ol><li>Safariでこのページを開く</li><li>画面下の共有ボタン（□↑）をタップ</li><li>「ホーム画面に追加」を選ぶ</li></ol></div>
  <div class="card set"><b>データの管理</b><p>サンプルは「（サンプル）」と付いたイベントです。試し終わったら全データを削除できます。</p>
    <div class="btns"><button class="btn soft" data-a="sample">サンプルを追加</button><button class="btn warnb" data-a="wipe">全データを削除</button></div></div>
  <p class="tiny muted" style="text-align:center;margin-top:20px">準備ノート　ステップ1・2</p>`;
}

/* ================= 描画本体 ================= */
const NAV = [
  ['home', '今日', '<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/></svg>'],
  ['events', 'イベント', '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>'],
  ['settings', '設定', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>'],
];
let wake = null;
async function wakeSync() {
  try {
    if (ui.view === 'day' && !wake && navigator.wakeLock) wake = await navigator.wakeLock.request('screen');
    else if (ui.view !== 'day' && wake) { await wake.release(); wake = null; }
  } catch (e) { wake = null; }
}
function render(top) {
  const y = window.scrollY;
  const views = { home: viewHome, events: viewEvents, detail: viewDetail, day: viewDay, settings: viewSettings };
  $('#app').innerHTML = (views[ui.view] || viewHome)();
  $('#nav').innerHTML = NAV.map(([k, l, ic]) => `<button class="${ui.root === k ? 'on' : ''}" data-a="tab" data-id="${k}" aria-label="${l}">${ic}${l}</button>`).join('');
  const fab = (ui.view === 'events' || ui.view === 'home' && data.events.length) ? `<button class="fab" data-a="new-event" aria-label="イベントを追加">＋</button>` : '';
  $('#fabslot').innerHTML = fab;
  window.scrollTo(0, top ? 0 : y);
  wakeSync();
}

/* ================= 入力シート ================= */
let sheetCtx = null;
function fieldHtml(f, v) {
  const val = v ?? f.def ?? '';
  let input;
  if (f.type === 'select') input = `<select name="${f.k}">${f.options.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  else if (f.type === 'textarea') input = `<textarea name="${f.k}" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`;
  else input = `<input type="${f.type}" name="${f.k}" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" ${f.type === 'number' ? 'min="1" inputmode="numeric"' : ''} ${f.type === 'text' ? 'autocomplete="off"' : ''}>`;
  return `<label class="fld" data-k="${f.k}"><span>${esc(f.label)}${f.required ? '（必須）' : ''}</span>${input}</label>`;
}
function sheet({ title, fields, values = {}, onSave, onDelete, extra = [] }) {
  const el = $('#sheet');
  el.innerHTML = `<div class="scrim" data-a="sheet-close"></div><form class="panel" novalidate>
    <div class="phead"><button type="button" class="link" data-a="sheet-close">キャンセル</button><b>${esc(title)}</b><button type="submit" class="link strong">保存</button></div>
    <div class="pbody">${fields.map(f => fieldHtml(f, values[f.k])).join('')}
    ${extra.map((x, i) => `<button type="button" class="ghost" data-x="${i}">${esc(x.label)}</button>`).join('')}
    ${onDelete ? '<button type="button" class="danger" data-a="sheet-delete">削除する</button>' : ''}</div></form>`;
  el.classList.add('open');
  document.body.classList.add('noscroll');
  sheetCtx = { fields, onSave, onDelete, extra };
  const form = el.querySelector('form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form), vals = {};
    let bad = null;
    for (const f of fields) {
      let v = (fd.get(f.k) ?? '').toString().trim();
      if (f.required && !v) { el.querySelector(`[data-k="${f.k}"]`).classList.add('err'); bad = bad || f.label; }
      vals[f.k] = v;
    }
    if (bad) { toast(`${bad}を入力してください`); return; }
    onSave(vals);
    closeSheet();
  });
  const first = el.querySelector('input[type=text]');
  if (first && !first.value) setTimeout(() => first.focus(), 60);
}
function closeSheet() {
  $('#sheet').classList.remove('open');
  $('#sheet').innerHTML = '';
  document.body.classList.remove('noscroll');
  sheetCtx = null;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetCtx) closeSheet(); });

/* ----- 各フォーム ----- */
function eventForm(ev, presetDate) {
  const isNew = !ev;
  sheet({
    title: isNew ? 'イベントを追加' : 'イベントを編集',
    fields: [
      { k: 'name', label: 'イベント名', type: 'text', required: true, placeholder: '例：秋のワークショップ' },
      { k: 'date', label: '日付', type: 'date', required: true },
      { k: 'type', label: '種類', type: 'select', options: TYPES.map(t => t.id) },
      { k: 'place', label: '場所', type: 'text', placeholder: '例：中目黒スタジオ' },
      ...(isNew ? [] : [{ k: 'status', label: '状態', type: 'select', options: ['準備中', '完了'] }]),
      { k: 'memo', label: 'メモ', type: 'textarea' },
    ],
    values: ev || { type: TYPES[0].id, date: presetDate || '' },
    onSave: v => {
      if (isNew) {
        const n = { id: uid(), status: '準備中', ...v };
        data.events.push(n); save();
        go('detail', { eventId: n.id, tab: 'todo' });
      } else { Object.assign(ev, v); save(); render(); }
    },
    onDelete: isNew ? null : () => {
      if (!confirm(`「${ev.name}」と、そのTODO・必要な物・手順をすべて削除します。よろしいですか？`)) return false;
      removeEvent(ev.id); save(); toast('削除しました'); tabTo('events');
    },
  });
}
function todoForm(eventId, t) {
  sheet({
    title: t ? 'TODOを編集' : 'TODOを追加',
    fields: [
      { k: 'text', label: '内容', type: 'text', required: true, placeholder: '例：会場に備品の確認連絡' },
      { k: 'due', label: '期限', type: 'date' },
      { k: 'priority', label: '優先度', type: 'select', options: PRIORITIES },
      { k: 'memo', label: 'メモ', type: 'textarea' },
    ],
    values: t || { priority: '中' },
    onSave: v => { if (t) Object.assign(t, v); else data.todos.push({ id: uid(), eventId, done: false, ...v }); save(); render(); },
    onDelete: t ? () => { data.todos = data.todos.filter(x => x.id !== t.id); save(); render(); } : null,
  });
}
function itemForm(eventId, it) {
  const ev = evById(eventId);
  sheet({
    title: it ? '必要な物を編集' : '必要な物を追加',
    fields: [
      { k: 'name', label: '物の名前', type: 'text', required: true, placeholder: '例：名札ケース' },
      { k: 'qty', label: '数量', type: 'number', def: '1' },
      { k: 'needBy', label: '必要な日', type: 'date', def: it ? '' : (ev ? addDays(ev.date, -1) : '') },
      { k: 'status', label: '手配状況', type: 'select', options: ITEM_STATUS },
      { k: 'source', label: '入手先', type: 'text', placeholder: '例：100円ショップ、倉庫' },
      { k: 'memo', label: 'メモ', type: 'textarea' },
    ],
    values: it || { status: '未手配' },
    onSave: v => { if (it) Object.assign(it, v); else data.items.push({ id: uid(), eventId, ...v }); save(); render(); },
    onDelete: it ? () => { data.items = data.items.filter(x => x.id !== it.id); save(); render(); } : null,
  });
}
function stepForm(eventId, s) {
  const move = d => {
    const list = stepsOf(eventId), i = list.findIndex(x => x.id === s.id), j = i + d;
    if (j < 0 || j >= list.length) { toast(d < 0 ? 'いちばん上です' : 'いちばん下です'); return; }
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((x, k) => x.order = k + 1);
    save(); render(); toast('移動しました');
  };
  sheet({
    title: s ? '手順を編集' : '手順を追加',
    fields: [
      { k: 'text', label: '内容', type: 'text', required: true, placeholder: '例：受付テーブルを設置' },
      { k: 'time', label: '時刻（任意）', type: 'time' },
    ],
    values: s || {},
    extra: s ? [{ label: '↑ 順番を上げる', fn: () => move(-1) }, { label: '↓ 順番を下げる', fn: () => move(1) }] : [],
    onSave: v => {
      if (s) Object.assign(s, v);
      else { const mx = Math.max(0, ...stepsOf(eventId).map(x => x.order)); data.steps.push({ id: uid(), eventId, order: mx + 1, done: false, ...v }); }
      save(); render();
    },
    onDelete: s ? () => { data.steps = data.steps.filter(x => x.id !== s.id); stepsOf(eventId).forEach((x, k) => x.order = k + 1); save(); render(); } : null,
  });
}

/* ================= バックアップ ================= */
function markBackup() { data.lastBackup = today(); save(); render(); toast('バックアップしました'); }
async function exportBackup() {
  const name = `junbi-backup-${today()}.json`;
  const blob = new Blob([JSON.stringify({ app: 'junbi-note', exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: '準備ノートのバックアップ' });
      markBackup(); return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  markBackup();
}
$('#importfile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    const d = j && j.data ? j.data : j;
    if (!d || !Array.isArray(d.events)) throw new Error('形式が違います');
    if (!confirm(`バックアップを読み込みます（イベント ${d.events.length} 件）。いまのデータは置き換えられます。よろしいですか？`)) return;
    data = normalize(d); await persist(); tabTo('home'); toast('読み込みました');
  } catch (err) { toast('読み込めませんでした。バックアップのファイルを確認してください'); }
});

/* ================= サンプルデータ ================= */
function addSample() {
  const t = today(), mk = (n, o) => ({ id: uid(), ...o });
  const E = (name, type, off, place, status = '準備中') => { const e = { id: uid(), name, type, date: addDays(t, off), place, status, memo: '' }; data.events.push(e); return e.id; };
  const T = (eventId, text, off, priority, done = false) => data.todos.push({ id: uid(), eventId, text, due: off === null ? '' : addDays(t, off), priority, done, memo: '' });
  const I = (eventId, name, qty, off, status, source = '') => data.items.push({ id: uid(), eventId, name, qty: String(qty), needBy: addDays(t, off), status, source, memo: '' });
  const S = (eventId, text, time, order) => data.steps.push({ id: uid(), eventId, text, time, order, done: false });

  const a = E('（サンプル）秋のワークショップ', 'ワークショップ', 7, '中目黒スタジオ');
  T(a, '会場の予約を確定', -12, '高', true); T(a, '参加者リストを作る', 2, '高'); T(a, '配布資料を印刷する', 5, '中');
  T(a, '会場に備品の確認連絡', -1, '高'); T(a, '案内メールを送る', 0, '中'); T(a, '当日の動線を確認', 6, '低', true);
  I(a, '配布資料', 25, 5, '揃った', '自宅プリンター'); I(a, '名札ケース', 20, 3, '未手配', '100円ショップ'); I(a, '延長コード', 2, 6, '手配済', '倉庫');
  S(a, '会場に到着・設営', '8:30', 1); S(a, '受付テーブルを設置', '9:15', 2); S(a, '参加者をお迎えする', '9:45', 3); S(a, '開始のあいさつ', '10:00', 4); S(a, '片付け・鍵の返却', '12:30', 5);

  const b = E('（サンプル）木曜クラス', 'クラス', 12, 'オンライン');
  T(b, '参加リンクを送る', 10, '中'); T(b, '資料を共有する', 11, '中'); I(b, '資料データ', 1, 10, '手配済'); S(b, '接続テスト', '19:30', 1); S(b, 'クラス開始', '20:00', 2);

  const c = E('（サンプル）フレッシュライブ', 'フレッシュライブ', 21, '渋谷ホール');
  T(c, '出演者と進行を確認', 14, '高'); I(c, 'マイク', 2, 20, '未手配', 'レンタル'); I(c, '譜面', 1, 20, '未手配');

  const d = E('（サンプル）コミュニティの集まり', 'コミュニティ', -10, '近所のカフェ', '完了');
  T(d, 'お知らせを出す', -17, '中', true);
  save();
}

/* ================= クリック処理（イベント委譲） ================= */
document.addEventListener('click', e => {
  const x = e.target.closest('[data-x]');
  if (x && sheetCtx) { sheetCtx.extra[+x.dataset.x].fn(); return; }
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const a = el.dataset.a, id = el.dataset.id, ev = evById(ui.eventId);
  switch (a) {
    case 'tab': tabTo(id); break;
    case 'back': back(); break;
    case 'open-event': go('detail', { eventId: id, tab: el.dataset.tab || 'todo' }); break;
    case 'set-tab': ui.tab = id; render(); break;
    case 'set-mode': ui.mode = id; render(); break;
    case 'set-filter': ui.filter = id; render(); break;
    case 'cal-prev': case 'cal-next': {
      const d = parse(ui.calMonth + '-01'); d.setMonth(d.getMonth() + (a === 'cal-next' ? 1 : -1));
      ui.calMonth = fmt(d).slice(0, 7);
      ui.calSel = ui.calMonth === today().slice(0, 7) ? today() : ui.calMonth + '-01';
      render(); break;
    }
    case 'cal-pick': ui.calSel = id; render(); break;
    case 'new-event': eventForm(null, id || (ui.view === 'events' && ui.mode === 'cal' ? ui.calSel : '')); break;
    case 'edit-event': if (ev) eventForm(ev); break;
    case 'day-mode': go('day'); break;
    case 'add-todo': todoForm(ui.eventId); break;
    case 'add-item': itemForm(ui.eventId); break;
    case 'add-step': stepForm(ui.eventId); break;
    case 'edit-todo': todoForm(ui.eventId, data.todos.find(t => t.id === id)); break;
    case 'edit-item': itemForm(ui.eventId, data.items.find(t => t.id === id)); break;
    case 'edit-step': stepForm(ui.eventId, data.steps.find(t => t.id === id)); break;
    case 'toggle-todo': { const t = data.todos.find(t => t.id === id); if (t) { t.done = !t.done; save(); render(); } break; }
    case 'toggle-item': { const i = data.items.find(t => t.id === id); if (i) { i.status = i.status === '揃った' ? '未手配' : '揃った'; save(); render(); } break; }
    case 'cycle-item': { const i = data.items.find(t => t.id === id); if (i) { i.status = ITEM_STATUS[(ITEM_STATUS.indexOf(i.status) + 1) % 3]; save(); render(); } break; }
    case 'toggle-step': { const s = data.steps.find(t => t.id === id); if (s) { s.done = !s.done; save(); render(); } break; }
    case 'step-next': { const s = data.steps.find(t => t.id === id); if (s) { s.done = true; save(); render(); } break; }
    case 'finish-event': if (ev) { ev.status = '完了'; save(); toast('お疲れさまでした！'); ui.stack = []; ui.view = 'events'; ui.root = 'events'; render(true); } break;
    case 'reopen-event': if (ev) { ev.status = '準備中'; save(); render(); toast('準備中に戻しました'); } break;
    case 'export': exportBackup(); break;
    case 'import': $('#importfile').click(); break;
    case 'sample': addSample(); toast('サンプルを追加しました'); render(true); break;
    case 'wipe':
      if (confirm('すべてのイベント・TODO・必要な物・手順を削除します。元に戻せません。先にバックアップを取ることをおすすめします。削除しますか？')) {
        data = emptyData(); persist(); tabTo('home'); toast('すべて削除しました');
      } break;
    case 'sheet-close': closeSheet(); break;
    case 'sheet-delete': if (sheetCtx && sheetCtx.onDelete && sheetCtx.onDelete() !== false) closeSheet(); break;
  }
});

/* メモ欄（入力のたびに保存。再描画はしない） */
let memoTimer;
document.addEventListener('input', e => {
  if (e.target.id !== 'memo') return;
  const ev = evById(ui.eventId); if (!ev) return;
  ev.memo = e.target.value; save();
  const s = $('#saved'); if (s) s.textContent = '保存しました';
  clearTimeout(memoTimer); memoTimer = setTimeout(() => { const s2 = $('#saved'); if (s2) s2.textContent = ''; }, 1500);
});

/* ================= 起動 ================= */
(async function init() {
  await load();
  render(true);
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* 何もしない */ }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
