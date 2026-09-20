import { HORMONES, HORMONE_BY_ID, GROUPS } from './data.js?v=14';
import { SITUATIONS, SITUATION_BY_ID, CATEGORIES, PHASES, TIMING, COMPARE } from './situations.js?v=14';
import { SEXES, AGES, profileFactors, baseline } from './profile.js?v=14';
import {
  buildScenario, levelAt, peakMoment, amplitude,
  toLog, invLog, formatDuration, formatClock, formatDelta, extreme, TICKS,
} from './engine.js?v=14';

const $ = (id) => document.getElementById(id);
const STORE = 'hormones.profile.v1';
const MENU_SEEN = 'hormones.menuseen.v1';
const RESTORATIVE = new Set(['sleep', 'morninglight', 'meditation', 'hug']);
const isTouch = matchMedia('(hover: none)').matches;
const isSheet = () => matchMedia('(max-width: 720px)').matches;
const SEX_LABEL = { m: 'М', f: 'Ж' };

let neverConfigured = true;

const state = {
  sex: null, age: null, cat: 'bond', sit: 'love',
  t: 0, horizon: 1, sc: null, scByS: {}, sexes: [], sexesOn: new Set(),
  active: null, pinned: null, playing: false, raf: 0,
  view: 'active', hideTimer: 0, tipPinned: false, navOpen: false,
};

/* ─── профиль ───────────────────────────────────────────── */

const FACTORS = {};
function factorsFor(sexId) {
  const key = sexId + state.age;
  return (FACTORS[key] || (FACTORS[key] = profileFactors(sexId, state.age)));
}

function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!saved) return false;
    /* отдельная ступень «35 лет» убрана — она вошла в диапазон 26–35 */
    const age = saved.age === 'a35' ? 'a26' : saved.age;
    if (SEXES.some(s => s.id === saved.sex) && AGES.some(a => a.id === age)) {
      state.sex = saved.sex; state.age = age; neverConfigured = false; return true;
    }
  } catch { /* приватный режим — просто спросим заново */ }
  return false;
}
function saveProfile() {
  try { localStorage.setItem(STORE, JSON.stringify({ sex: state.sex, age: state.age })); } catch {}
}

function buildOnboarding() {
  /* Первый заход — пусто: значения по умолчанию нужны для рендера под окном,
     но выбирать за человека пол и возраст нельзя. Дальше — текущие. */
  const draft = neverConfigured ? { sex: null, age: null } : { sex: state.sex, age: state.age };
  const mk = (host, items, key) => {
    host.innerHTML = '';
    items.forEach(it => {
      const b = document.createElement('button');
      b.className = 'ob-opt'; b.type = 'button'; b.role = 'radio';
      b.textContent = it.title;
      b.setAttribute('aria-checked', draft[key] === it.id);
      b.onclick = () => {
        draft[key] = it.id;
        [...host.children].forEach(c => c.setAttribute('aria-checked', c === b));
        $('obSubmit').disabled = !(draft.sex && draft.age);
      };
      host.appendChild(b);
    });
  };
  mk($('obSex'), SEXES, 'sex');
  mk($('obAge'), AGES, 'age');
  $('obSubmit').disabled = !(draft.sex && draft.age);
  $('obSubmit').onclick = () => {
    const first = neverConfigured;
    neverConfigured = false;
    state.sex = draft.sex; state.age = draft.age;
    saveProfile(); closeOnboarding(); applyProfile();
    state.sexesOn = new Set([state.sex]);
    renderAll();
    if (first) showMenuOnboarding();
  };
  $('obClose').hidden = neverConfigured;
  $('obClose').onclick = closeOnboarding;
}
function openOnboarding() { closeNav(); buildOnboarding(); $('onboarding').hidden = false; }
function closeOnboarding() { $('onboarding').hidden = true; }

function applyProfile() {
  const sex = SEXES.find(s => s.id === state.sex);
  const age = AGES.find(a => a.id === state.age);
  const label = `${sex.short} · ${age.short}`;
  $('navProfileText').textContent = label;
}

/* Пол и возраст трогают редко: на широком экране кнопка стоит в подвале
   рядом со служебной строкой, на узком — в самом низу меню. */
function placeProfile() {
  const btn = $('navProfile');
  const host = isSheet() ? $('picker') : $('footRow');
  if (btn.parentElement !== host) host.appendChild(btn);
}

/* ─── меню разделов ─────────────────────────────────────── */

/* На узком экране навигация живёт в выезжающей панели под бургером,
   на широком — обычным блоком в потоке страницы. */
function openNav() {
  if (!isSheet()) return;
  state.navOpen = true;
  $('picker').classList.add('is-open');
  $('navScrim').hidden = false;
  $('burgerBtn').setAttribute('aria-expanded', 'true');
  lockScroll();
}
function closeNav() {
  if (!state.navOpen) return;
  state.navOpen = false;
  $('picker').classList.remove('is-open');
  $('navScrim').hidden = true;
  $('burgerBtn').setAttribute('aria-expanded', 'false');
  hideMenuHint();
  unlockScroll();
}

/* Первый вход: показываем всю навигацию целиком и подсвечиваем один сценарий. */
function showMenuOnboarding() {
  try { if (localStorage.getItem(MENU_SEEN)) return; } catch {}
  if (isSheet()) openNav();
  $('navHint').hidden = false;
  $('picker').classList.add('is-hinting');
  const chip = $('chips').querySelector('.chip[aria-selected="true"]') || $('chips').querySelector('.chip');
  if (chip) { chip.classList.add('is-hint'); chip.scrollIntoView({ block: 'nearest' }); }
}
function hideMenuHint() {
  $('navHint').hidden = true;
  $('picker').classList.remove('is-hinting');
  document.querySelectorAll('.chip.is-hint').forEach(c => c.classList.remove('is-hint'));
  try { localStorage.setItem(MENU_SEEN, '1'); } catch {}
}

/* Чип раздела в шапке нужен только тогда, когда сам заголовок уже уехал
   под неё: пока заголовок виден, чип дублировал бы его. */
/* Кнопка нужна, только если текст действительно не влез в три строки:
   на широком экране обрезки нет вовсе, и кнопка сама остаётся скрытой. */
function syncBlurb() { collapse($('sitBlurb'), $('blurbMore'), $('blurbWrap')); }
function syncTiming() { collapse($('timingText'), $('timingMore'), $('timing')); }

/* Сворачиваем текст и решаем, нужна ли кнопка: если он и так влез, она лишняя.
   На широком экране обрезки нет вовсе, и кнопка сама остаётся скрытой. */
function collapse(text, btn, host) {
  host.classList.remove('is-open');
  btn.setAttribute('aria-expanded', 'false');
  btn.textContent = 'More';
  btn.hidden = text.scrollHeight <= text.clientHeight + 1;
}

function syncChip() {
  const bar = document.querySelector('.topbar');
  bar.classList.toggle('is-scrolled', $('sitName').getBoundingClientRect().bottom <= bar.offsetHeight);
}

/* ─── блокировка прокрутки под шитом ────────────────────── */

let lockY = 0, lockCount = 0;
function lockScroll() {
  if (lockCount++ ) return;
  lockY = window.scrollY;
  document.body.style.top = -lockY + 'px';
  document.body.classList.add('is-locked');
}
function unlockScroll(force) {
  if (force) lockCount = 0; else if (lockCount && --lockCount) return;
  if (!document.body.classList.contains('is-locked')) return;
  document.body.classList.remove('is-locked');
  document.body.style.top = '';
  window.scrollTo(0, lockY);
}

/* ─── выбор ситуации ────────────────────────────────────── */

function renderCats() {
  const host = $('cats'); host.innerHTML = '';
  CATEGORIES.forEach(c => {
    const b = document.createElement('button');
    b.className = 'cat'; b.type = 'button'; b.role = 'tab';
    b.textContent = c.title;
    b.setAttribute('aria-selected', c.id === state.cat);
    b.onclick = () => {
      state.cat = c.id;
      const first = SITUATIONS.find(s => s.cat === c.id);
      selectSituation(first.id, true);
    };
    host.appendChild(b);
  });
}

function renderChips() {
  const host = $('chips'); host.innerHTML = '';
  let sub = null;
  SITUATIONS.filter(s => s.cat === state.cat).forEach(s => {
    if (s.sub && s.sub !== sub) {           // подразделы внутри категории: зал, велосипед, плавание
      sub = s.sub;
      const sep = document.createElement('span');
      sep.className = 'chip-sub'; sep.textContent = sub; sep.setAttribute('aria-hidden', 'true');
      host.appendChild(sep);
    }
    const b = document.createElement('button');
    b.className = 'chip'; b.type = 'button'; b.role = 'tab';
    b.textContent = s.short || s.name;   // под подзаголовком подраздела длинное имя избыточно
    b.setAttribute('aria-selected', s.id === state.sit);
    b.onclick = () => selectSituation(s.id);
    host.appendChild(b);
  });
}

function selectSituation(id, keepNav) {
  stopPlay();
  state.sit = id;
  state.cat = SITUATION_BY_ID[id].cat;
  state.pinned = null; state.active = null;
  state.sexesOn = new Set([state.sex]);
  hideMenuHint();
  hideDetail(); hideTip();
  history.replaceState(null, '', '#' + id);
  renderAll();
  if (!keepNav) closeNav();
}

/* ─── сценарии для одного или двух полов ────────────────── */

function comparable() { return COMPARE.has(state.sit); }

function activeSexes() {
  if (!comparable()) return [state.sex];
  const on = SEXES.map(s => s.id).filter(id => state.sexesOn.has(id));
  return on.length ? on : [state.sex];
}

function buildScenarios() {
  const sit = SITUATION_BY_ID[state.sit];
  state.sexes = activeSexes();
  state.scByS = {};
  state.sexes.forEach(id => { state.scByS[id] = buildScenario(sit, id, factorsFor(id)); });
  state.sc = state.scByS[state.sex] || state.scByS[state.sexes[0]];
  state.horizon = Math.max(...state.sexes.map(s => state.scByS[s].horizon));
}

function renderLegend() {
  const host = $('sexLegend');
  host.hidden = !comparable();
  if (host.hidden) return;
  host.querySelectorAll('.sexbtn').forEach(b => {
    b.setAttribute('aria-pressed', state.sexes.includes(b.dataset.sex));
  });
}

function toggleSex(id) {
  if (state.sexesOn.has(id)) {
    if (state.sexesOn.size < 2) return;    // последний включённый пол выключить нельзя
    state.sexesOn.delete(id);
  } else state.sexesOn.add(id);
  const t = state.t;
  buildScenarios();
  renderLegend();
  renderHormones();
  updateTime(Math.min(t, state.horizon));
}

/* ─── общий рендер ──────────────────────────────────────── */

function renderAll() {
  const sit = SITUATION_BY_ID[state.sit];
  buildScenarios();
  state.t = peakMoment(state.sc);

  renderCats(); renderChips(); renderLegend();
  $('sitTag').textContent = CATEGORIES.find(c => c.id === sit.cat).title;
  $('sitName').textContent = sit.name;
  $('sitBlurb').textContent = sit.blurb;
  syncBlurb();
  $('sectChipText').textContent = sit.short || sit.name;

  renderStats(sit);
  renderHormones();
  renderRecovery(sit);
  drawChart();
  updateTime(state.t);
  syncChip();

  document.querySelector('main').classList.remove('fade-in');
  void document.querySelector('main').offsetWidth;
  document.querySelector('main').classList.add('fade-in');
}

function renderStats(sit) {
  const sc = state.sc;
  const restorative = RESTORATIVE.has(sit.id);
  const moved = sc.effects.length;
  const slowest = HORMONE_BY_ID[sc.slowest.id].name;
  const cells = [
    {
      label: restorative ? 'Длительность эффекта' : 'Возврат к норме',
      value: formatDuration(sc.horizon),
      sub: restorative ? 'при разовом повторении' : `дольше всех — ${slowest.toLowerCase()}`,
    },
    {
      label: 'Пик нагрузки на систему',
      value: formatClock(peakMoment(sc)),
      sub: 'после начала события',
    },
    {
      label: 'Затронуто гормонов',
      value: `${moved} из ${HORMONES.length}`,
      sub: 'остальные в пределах нормы',
    },
  ];
  $('stats').innerHTML = cells.map(c => `
    <div class="stat">
      <span class="stat-label">${c.label}</span>
      <div><span class="stat-value">${c.value}</span><span class="stat-sub">${c.sub}</span></div>
    </div>`).join('');
}

function renderRecovery(sit) {
  $('recoveryText').textContent = sit.recovery;
  $('timingText').textContent = TIMING[sit.id] || '';
  syncTiming();
  const rows = [...state.sc.effects].sort((a, b) => b.tEnd - a.tEnd).slice(0, 6);
  $('recoveryList').innerHTML = rows.map(e => {
    const h = HORMONE_BY_ID[e.id];
    const ex = extreme(e);
    const dir = ex >= 1 ? 'поднимается' : 'падает';
    return `<div class="rrow">
      <span class="rrow-name">${h.name}<em>${dir} до ${formatDelta(ex)}</em></span>
      <span class="rrow-time">${formatDuration(e.tEnd)}</span>
    </div>`;
  }).join('');
}

/* ─── список гормонов ───────────────────────────────────── */

function effFor(sexId, id) { const sc = state.scByS[sexId]; return sc && sc.byId[id]; }
function movedAnywhere(id) { return state.sexes.some(s => !!effFor(s, id)); }

function visible(id) {
  if (state.view === 'active') return movedAnywhere(id);
  return true;
}

function renderHormones() {
  const host = $('hormones'); host.innerHTML = '';
  $('cntAll').textContent = HORMONES.length;
  $('segActive').setAttribute('aria-selected', state.view === 'active');
  $('segAll').setAttribute('aria-selected', state.view === 'all');

  const rank = (id) => Math.max(...state.sexes.map(s => {
    const e = effFor(s, id); return e ? amplitude(e) : -1;
  }));

  GROUPS.forEach(g => {
    const list = HORMONES.filter(h => h.group === g.id && visible(h.id))
      .sort((a, b) => rank(b.id) - rank(a.id));
    if (!list.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'hgroup';
    wrap.innerHTML = `<h2 class="hgroup-title">${g.title}</h2><div class="hgrid"></div>`;
    const grid = wrap.querySelector('.hgrid');
    list.forEach(h => grid.appendChild(hormoneCard(h)));
    host.appendChild(wrap);
  });
  paintLevels();
  /* после перерисовки списка подсветка активного гормона должна остаться */
  if (state.active) {
    document.querySelectorAll('.hcard').forEach(c => c.classList.toggle('is-active', c.dataset.h === state.active));
  }
}

const BAR = `<span class="hbar"><span class="hbar-track"></span><span class="hbar-fill"></span><span class="hbar-mid"></span></span>`;

function hormoneCard(h) {
  const dual = state.sexes.length > 1;
  const b = document.createElement('button');
  b.className = 'hcard' + (dual ? ' hcard--dual' : ''); b.type = 'button'; b.dataset.h = h.id;
  const scales = dual
    ? `<span class="hduo">${state.sexes.map(s => `
        <span class="hrow" data-s="${s}">
          <i class="hsex hsex--${s}">${SEX_LABEL[s]}</i>${BAR}
          <span class="hval mono">норма</span>
        </span>`).join('')}</span>`
    : `${BAR}<span class="hval mono">норма</span>`;
  b.innerHTML = `<span class="hname">${h.name}<span class="hrole">${h.role}</span></span>${scales}`;
  if (!isTouch) {
    b.addEventListener('mouseenter', () => {
      if (state.pinned) return;
      clearTimeout(state.hideTimer);
      setActive(h.id);
      if (!isSheet()) showDetail(h.id, b);   // на узком экране лист выезжает только по клику
    });
    b.addEventListener('mouseleave', () => { if (!state.pinned && !isSheet()) scheduleHide(); });
  }
  b.addEventListener('click', () => {
    if (state.pinned === h.id) { state.pinned = null; setActive(null); hideDetail(); }
    else { state.pinned = h.id; setActive(h.id); showDetail(h.id, b); }
  });
  return b;
}

/* Полоса: отклонение в логарифмической шкале, центр — норма. */
function paintBar(host, eff, sexId) {
  const lvl = eff ? levelAt(eff, state.t) : 1;
  const dev = Math.log2(lvl);
  const frac = Math.min(1, Math.abs(dev) / 3);
  const fill = host.querySelector('.hbar-fill');
  const val = host.querySelector('.hval');
  const flat = Math.abs(lvl - 1) < 0.03;
  const width = flat ? 2 : Math.max(3, frac * 50);

  fill.style.width = width + '%';
  fill.style.left = flat ? 'calc(50% - 1px)' : (dev >= 0 ? '50%' : (50 - width) + '%');
  fill.style.background = sexId
    ? (eff && !flat ? `var(--sex-${sexId})` : 'var(--flat)')
    : (flat ? 'var(--flat)' : (dev > 0 ? 'var(--up)' : 'var(--down)'));
  val.textContent = eff ? formatDelta(lvl) : 'в норме';
  val.className = 'hval mono ' + (sexId
    ? (eff && !flat ? 'sex-' + sexId : 'flat')
    : (flat || !eff ? 'flat' : dev > 0 ? 'up' : 'down'));
}

function paintLevels() {
  const dual = state.sexes.length > 1;
  document.querySelectorAll('.hcard').forEach(card => {
    const id = card.dataset.h;
    if (dual) {
      card.querySelectorAll('.hrow').forEach(row => paintBar(row, effFor(row.dataset.s, id), row.dataset.s));
      card.classList.toggle('is-flat', !movedAnywhere(id));
    } else {
      const eff = state.sc.byId[id];
      paintBar(card, eff, null);
      card.classList.toggle('is-flat', !eff);
    }
  });
  if (state.active) updateDetailNow();
}

function setActive(id) {
  state.active = id;
  document.querySelectorAll('.hcard').forEach(c => c.classList.toggle('is-active', c.dataset.h === id));
  drawChart();
}

/* ─── график ────────────────────────────────────────────── */

const PAD = { l: 36, r: 10, t: 42, b: 18 };
const SEX_COLOR = { m: '#3E8FD4', f: '#D9569B' };

function chartGeom() {
  const host = $('chart');
  return { w: host.clientWidth || 600, h: host.clientHeight || 220 };
}
function playheadX() {
  const { w } = chartGeom();
  return PAD.l + toLog(state.t, state.horizon) * (w - PAD.l - PAD.r);
}

function drawChart() {
  const host = $('chart');
  const { w, h } = chartGeom();
  if (!state.sc) return;
  const H = state.horizon;
  const dual = state.sexes.length > 1;
  const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b;

  let lo = -0.35, hi = 0.35;
  const curves = [];
  state.sexes.forEach(sx => {
    state.scByS[sx].effects.forEach(e => {
      const pts = [];
      for (let i = 0; i <= 120; i++) {
        const t = invLog(i / 120, H);
        const v = Math.log2(levelAt(e, t));
        lo = Math.min(lo, v); hi = Math.max(hi, v);
        pts.push([i / 120, v]);
      }
      curves.push({ sex: sx, e, pts });
    });
  });
  lo -= 0.18; hi += 0.18;

  const xOf = (u) => PAD.l + u * pw;
  const yOf = (v) => PAD.t + (hi - v) / (hi - lo) * ph;
  const path = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + xOf(p[0]).toFixed(1) + ' ' + yOf(p[1]).toFixed(1)).join(' ');

  /* Светлая зона — пока идёт само событие; метки сверху — его этапы. */
  const ph_ = PHASES[state.sit];
  let spanRect = '', marks = '';
  if (ph_ && ph_.span > 0) {
    const x2 = xOf(toLog(Math.min(ph_.span, H), H));
    spanRect = `<rect x="${PAD.l}" y="${PAD.t}" width="${(x2 - PAD.l).toFixed(1)}" height="${ph}" fill="#F1F1EC"/>`;
  }
  if (ph_) {
    /* Два яруса подписей: на узком экране иначе выживает одна метка из трёх. */
    const rowY = [PAD.t - 29, PAD.t - 13];
    const lastR = [-1e9, -1e9];
    ph_.marks.forEach((mk, i) => {
      if (mk.t > H) return;
      const x = xOf(toLog(mk.t, H));
      const est = mk.l.length * 4.95;
      const anchor = x + est > w - PAD.r ? 'end' : 'start';
      const tx = anchor === 'end' ? x - 5 : x + 5;
      const left = anchor === 'end' ? tx - est : tx;
      let row = i % 2;
      if (left < lastR[row] + 7) row = 1 - row;
      if (left < lastR[row] + 7) return;
      lastR[row] = left + est;
      const y = rowY[row];
      marks += `<line x1="${x.toFixed(1)}" y1="${(y + 4).toFixed(1)}" x2="${x.toFixed(1)}" y2="${PAD.t + ph}" stroke="#DCDCD5" stroke-width="1"/>
        <circle cx="${x.toFixed(1)}" cy="${(y + 4).toFixed(1)}" r="1.8" fill="#C2C2BA"/>
        <text x="${tx.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="9" fill="#83837B">${mk.l}</text>`;
    });
  }

  const gridVals = [4, 3, 2, 1, 0, -1, -2].filter(v => v > lo + 0.05 && v < hi - 0.05);
  const grid = gridVals.map(v => {
    const y = yOf(v).toFixed(1);
    const label = v === 0 ? 'норма' : (v > 0 ? '×' + Math.pow(2, v) : '×' + String(Math.pow(2, v)).replace('.', ','));
    return `<line x1="${PAD.l}" y1="${y}" x2="${w - PAD.r}" y2="${y}" stroke="${v === 0 ? '#D2D2CB' : '#EDEDE8'}" stroke-width="1"/>
            <text x="${PAD.l - 7}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9.5" fill="#8A8A82" font-family="Geist Mono, monospace">${label}</text>`;
  }).join('');

  const cand = TICKS.filter(t => t <= H * 0.95 && t >= H / 5000);
  const step = Math.max(1, Math.ceil(cand.length / (w < 420 ? 4 : 7)));
  /* отсчитываем от конца, чтобы правый край шкалы всегда был подписан */
  const xa = cand.filter((_, i) => (cand.length - 1 - i) % step === 0).map(t => {
    const x = xOf(toLog(t, H)).toFixed(1);
    return `<line x1="${x}" y1="${PAD.t}" x2="${x}" y2="${PAD.t + ph}" stroke="#F2F2EE" stroke-width="1"/>
            <text x="${x}" y="${h - 4}" text-anchor="middle" font-size="9.5" fill="#8A8A82" font-family="Geist Mono, monospace">${formatClock(t)}</text>`;
  }).join('');

  const pxN = xOf(toLog(state.t, H));
  const px = pxN.toFixed(1);

  const activeId = state.active && movedAnywhere(state.active) ? state.active : state.sc.effects[0].id;
  const hiCurves = curves.filter(c => c.e.id === activeId);
  const base = curves.filter(c => c.e.id !== activeId).map(c => {
    const stroke = dual ? SEX_COLOR[c.sex] : '#C9C9C1';
    return `<path d="${path(c.pts)}" fill="none" stroke="${stroke}" stroke-width="1.4"
      stroke-linecap="round" stroke-linejoin="round" opacity="${dual ? '.25' : '.8'}"/>`;
  }).join('');

  let top = '', topLabel = '';
  const hiC = hiCurves.find(c => c.sex === state.sex) || hiCurves[0];
  if (hiC) {
    const far = hiC.pts.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
    const up = far[1] >= 0;
    const color = dual ? '#0E0E10' : (up ? 'var(--up)' : 'var(--down)');
    const name = HORMONE_BY_ID[hiC.e.id].name;
    const est = name.length * 6.4;
    const fx = xOf(far[0]);
    /* Подпись уводим на ту сторону от пика, где не стоит точка плейхеда. */
    const spanOf = (a) => (a === 'end' ? [fx - 11 - est, fx - 11] : [fx + 11, fx + 11 + est]);
    const clashes = (a) => { const [l, r] = spanOf(a); return pxN > l - 7 && pxN < r + 7; };
    const inField = (a) => { const [l, r] = spanOf(a); return l >= PAD.l + 2 && r <= w - PAD.r - 2; };
    let anchor = inField('start') ? 'start' : 'end';
    let stuck = clashes(anchor);
    if (stuck) {
      const alt = anchor === 'start' ? 'end' : 'start';
      if (inField(alt) && !clashes(alt)) { anchor = alt; stuck = false; }
    }
    let lx = anchor === 'end' ? fx - 11 : fx + 11;
    lx = Math.max(PAD.l + (anchor === 'end' ? est : 0) + 4, Math.min(w - PAD.r - 4, lx));
    /* Разойтись по горизонтали не вышло — уводим подпись по вертикали от точки. */
    const clampY = (v) => Math.max(PAD.t + 10, Math.min(PAD.t + ph - 4, v));
    const above = clampY(yOf(far[1]) - 10), below = clampY(yOf(far[1]) + 16);
    const dotY = yOf(Math.log2(levelAt(hiC.e, state.t)));
    let ly = up ? above : below;
    if (stuck) ly = Math.abs(above - dotY) >= Math.abs(below - dotY) ? above : below;
    top = hiCurves.map(c => `<path d="${path(c.pts)}" fill="none" stroke="${dual ? SEX_COLOR[c.sex] : color}"
      stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
    topLabel = `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}"
        text-anchor="${anchor}" font-size="11.5" font-weight="500" fill="${color}"
        stroke="#fff" stroke-width="3.5" paint-order="stroke">${name}</text>`;
  }

  const head = `<line x1="${px}" y1="${PAD.t - 4}" x2="${px}" y2="${PAD.t + ph}" stroke="#0E0E10" stroke-width="1" stroke-dasharray="2 3" opacity=".5"/>`;
  const dotList = dual
    ? hiCurves
    : [hiC, ...curves.filter(c => c !== hiC).slice(0, 3)].filter(Boolean);
  const dots = dotList.map(c => {
    const v = Math.log2(levelAt(c.e, state.t));
    const upv = v > 0.02, flat = Math.abs(v) <= 0.02;
    const color = dual ? SEX_COLOR[c.sex] : (flat ? '#B8B8B2' : upv ? 'var(--up)' : 'var(--down)');
    return `<circle cx="${px}" cy="${yOf(v).toFixed(1)}" r="${c === hiC || dual ? 4.5 : 3}" fill="${color}" stroke="#fff" stroke-width="2"/>`;
  }).join('');

  host.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    ${spanRect}${xa}${grid}${marks}${base}${top}${head}${topLabel}${dots}</svg>`;
}

/* ─── время ─────────────────────────────────────────────── */

function updateTime(t) {
  state.t = Math.max(0, Math.min(state.horizon, t));
  $('timeValue').textContent = state.t < 1 ? 'начало' : formatClock(state.t);
  $('timeCaption').textContent = state.t < 1 ? 'момент события' : 'после начала';
  $('scrub').value = Math.round(toLog(state.t, state.horizon) * 1000);

  let now = 0, max = 0;
  state.sc.effects.forEach(e => {
    now += Math.abs(Math.log2(levelAt(e, state.t)));
    max += Math.max(Math.abs(Math.log2(e.peak)), e.hasReb ? Math.abs(Math.log2(e.reb)) : 0);
  });
  const load = max ? Math.round(now / max * 100) : 0;
  $('timeLoad').textContent = load <= 3 ? 'система в норме' : `отклонение ${load}%`;

  paintLevels();
  drawChart();
  if (state.tipPinned) renderTip(playheadX());
}

function startPlay() {
  state.playing = true;
  $('playIcon').setAttribute('d', 'M4 3h3v10H4zM9 3h3v10H9z');
  const H = state.horizon;
  const dur = 9000;
  const from = state.t >= H * 0.98 ? 0 : toLog(state.t, H);
  const t0 = performance.now();
  const tick = (now) => {
    if (!state.playing) return;
    const u = from + (now - t0) / dur * (1 - from);
    if (u >= 1) { updateTime(H); stopPlay(); return; }
    updateTime(invLog(u, H));
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
}
function stopPlay() {
  state.playing = false;
  cancelAnimationFrame(state.raf);
  $('playIcon').setAttribute('d', 'M4.5 3.2v9.6l8-4.8z');
}

/* ─── подсказка на графике ──────────────────────────────── */

function chartPointer(ev) {
  const host = $('chart');
  const r = host.getBoundingClientRect();
  const pw = r.width - PAD.l - PAD.r;
  const u = Math.max(0, Math.min(1, (ev.clientX - r.left - PAD.l) / pw));
  stopPlay();
  updateTime(invLog(u, state.horizon));
  state.tipPinned = true;                 // подсказка закрывается только крестиком
  renderTip(playheadX());
}

/* x — позиция в пикселях внутри .chart-wrap; t по умолчанию — текущее время. */
function renderTip(x, tAt) {
  const tip = $('chartTip');
  const t = tAt != null ? tAt : state.t;
  const dual = state.sexes.length > 1;
  const ids = [...new Set(state.sexes.flatMap(s => state.scByS[s].effects.map(e => e.id)))]
    .map(id => ({
      id,
      dev: Math.max(...state.sexes.map(s => {
        const e = effFor(s, id); return e ? Math.abs(Math.log2(levelAt(e, t))) : 0;
      })),
    }))
    .sort((a, b) => b.dev - a.dev)
    .filter(r => r.dev > 0.043)
    .slice(0, 3);

  if (!ids.length) { hideTip(); return; }
  tip.hidden = false;
  $('tipBody').innerHTML = `<b>${t < 1 ? 'момент события' : formatClock(t) + ' спустя'}</b>` +
    ids.map(r => {
      const vals = state.sexes.map(s => {
        const e = effFor(s, r.id);
        const v = e ? formatDelta(levelAt(e, t)) : 'норма';
        return dual ? `<span class="tip-v tip-v--${s}">${SEX_LABEL[s]} ${v}</span>` : `<span class="tip-v">${v}</span>`;
      }).join('');
      return `<div class="tip-row"><span>${HORMONE_BY_ID[r.id].name}</span><span class="tip-vals">${vals}</span></div>`;
    }).join('');

  const rect = $('chart').getBoundingClientRect();
  const w = tip.offsetWidth;
  tip.style.left = Math.max(w / 2 + 4, Math.min(rect.width - w / 2 - 4, x)) + 'px';
  tip.style.top = (PAD.t + 6) + 'px';
}
function hideTip() { $('chartTip').hidden = true; state.tipPinned = false; }

/* ─── карточка гормона ──────────────────────────────────── */

function showDetail(id, anchor) {
  const h = HORMONE_BY_ID[id];
  const base = baseline(state.sex, state.age, id);
  const sexTitle = SEXES.find(s => s.id === state.sex).title.toLowerCase();
  const ageTitle = AGES.find(a => a.id === state.age).title;
  const dual = state.sexes.length > 1;

  const nowRows = dual
    ? `<div class="detail-now detail-now--dual" id="detailNow">${state.sexes.map(s => {
        const e = effFor(s, id);
        return `<span class="detail-duo detail-duo--${s}" data-s="${s}">
          <i>${SEX_LABEL[s]}</i>
          <b class="mono">${e ? formatDelta(levelAt(e, state.t)) : 'норма'}</b></span>`;
      }).join('')}<span class="detail-now-l" id="detailNowL">сейчас, через ${state.t < 1 ? 'момент' : formatClock(state.t)}</span></div>`
    : (() => {
        const eff = state.sc.byId[id];
        const lvl = eff ? levelAt(eff, state.t) : 1;
        return `<div class="detail-now" id="detailNow">
          <span class="detail-now-v" id="detailNowV">${eff ? formatDelta(lvl) : 'норма'}</span>
          <span class="detail-now-l" id="detailNowL">${eff ? 'сейчас, через ' + (state.t < 1 ? 'момент' : formatClock(state.t)) : 'в этом сценарии не меняется'}</span>
        </div>`;
      })();

  const note = state.sexes.map(s => effFor(s, id)).find(e => e && e.note);

  $('detailBody').innerHTML = `
    <div class="detail-head">
      <div class="detail-name">${h.name}</div>
      <div class="detail-latin">${h.latin} · ${h.role.toLowerCase()}</div>
    </div>
    ${nowRows}
    ${note ? `<p class="detail-note">${note.note}</p>` : ''}
    <div class="detail-sec"><h4>За что отвечает</h4><p>${h.what}</p></div>
    <div class="detail-sec"><h4>Где и как вырабатывается</h4><p>${h.where}</p></div>
    <div class="detail-sec"><h4>Как поддерживать</h4><p>${h.support}</p></div>
    ${base ? `<p class="detail-base"><b>Ваш базовый фон:</b> ≈${Math.round(base.value * 100)}% от пикового уровня молодости (${sexTitle} пол, ${ageTitle}). ${base.note}</p>` : ''}
  `;
  const d = $('detail');
  const wasHidden = d.hidden;
  d.hidden = false;
  if (isSheet()) {
    $('scrim').hidden = false;
    if (wasHidden) lockScroll();
  } else if (anchor) {
    const r = anchor.getBoundingClientRect();
    const dw = d.offsetWidth, dh = d.offsetHeight;
    let left = r.right + 12;
    if (left + dw > innerWidth - 12) left = r.left - dw - 12;
    if (left < 12) left = Math.max(12, innerWidth / 2 - dw / 2);
    d.style.left = left + 'px';
    d.style.top = Math.max(12, Math.min(innerHeight - dh - 12, r.top - 8)) + 'px';
  }
}

function updateDetailNow() {
  if (!state.active || $('detail').hidden) return;
  const l = $('detailNowL');
  const stamp = 'сейчас, через ' + (state.t < 1 ? 'момент' : formatClock(state.t));
  const duos = document.querySelectorAll('.detail-duo');
  if (duos.length) {
    duos.forEach(d => {
      const e = effFor(d.dataset.s, state.active);
      d.querySelector('b').textContent = e ? formatDelta(levelAt(e, state.t)) : 'норма';
    });
    if (l) l.textContent = stamp;
    return;
  }
  const v = $('detailNowV');
  const eff = state.sc.byId[state.active];
  if (!v || !eff) return;
  v.textContent = formatDelta(levelAt(eff, state.t));
  if (l) l.textContent = stamp;
}

function hideDetail() {
  clearTimeout(state.hideTimer);
  const wasOpen = !$('detail').hidden;
  $('detail').hidden = true;
  $('scrim').hidden = true;
  if (wasOpen && isSheet()) unlockScroll();
}
/* Пауза перед закрытием: курсор успевает дойти от карточки до окна. */
function scheduleHide() {
  clearTimeout(state.hideTimer);
  state.hideTimer = setTimeout(() => {
    if (!state.pinned) { setActive(null); hideDetail(); }
  }, 240);
}
function closeDetail() {
  state.pinned = null;
  setActive(null);
  hideDetail();
}

/* ─── события ───────────────────────────────────────────── */

function bind() {
  $('navProfile').onclick = openOnboarding;
  $('burgerBtn').onclick = () => (state.navOpen ? closeNav() : openNav());
  $('navClose').onclick = closeNav;
  $('navScrim').onclick = closeNav;
  $('navHintOk').onclick = hideMenuHint;
  $('sectChip').onclick = () => {
    if (isSheet()) { state.navOpen ? closeNav() : openNav(); return; }
    scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' });
  };

  $('playBtn').onclick = () => (state.playing ? stopPlay() : startPlay());
  $('scrub').oninput = (e) => { stopPlay(); updateTime(invLog(e.target.value / 1000, state.horizon)); };
  $('detailClose').onclick = closeDetail;
  $('scrim').onclick = closeDetail;
  $('tipClose').onclick = (e) => { e.stopPropagation(); hideTip(); };

  $('resetBtn').onclick = () => { stopPlay(); closeDetail(); updateTime(peakMoment(state.sc)); };

  $('segActive').onclick = () => { state.view = 'active'; renderHormones(); };
  $('segAll').onclick = () => { state.view = 'all'; renderHormones(); };

  $('sexLegend').addEventListener('click', (e) => {
    const b = e.target.closest('.sexbtn');
    if (b) toggleSex(b.dataset.sex);
  });

  const bmore = $('blurbMore');
  bmore.onclick = () => {
    const open = $('blurbWrap').classList.toggle('is-open');
    bmore.setAttribute('aria-expanded', open);
    bmore.textContent = open ? 'Less' : 'More';
  };

  const tmore = $('timingMore');
  tmore.onclick = () => {
    const open = $('timing').classList.toggle('is-open');
    tmore.setAttribute('aria-expanded', open);
    tmore.textContent = open ? 'Less' : 'More';
  };

  const more = $('footMore');
  more.onclick = () => {
    const open = $('footWarn').classList.toggle('is-open');
    more.setAttribute('aria-expanded', open);
    more.textContent = open ? 'Less' : 'More';
  };

  const det = $('detail');
  let scrollFade = 0;
  det.addEventListener('scroll', () => {
    det.classList.add('is-scrolling');
    clearTimeout(scrollFade);
    scrollFade = setTimeout(() => det.classList.remove('is-scrolling'), 700);
  }, { passive: true });
  det.addEventListener('mouseenter', () => clearTimeout(state.hideTimer));
  det.addEventListener('mouseleave', () => { if (!state.pinned) scheduleHide(); });

  /* клик по любому свободному месту закрывает окно гормона */
  document.addEventListener('click', (e) => {
    if ($('detail').hidden) return;
    if (e.target.closest('#detail') || e.target.closest('.hcard')) return;
    closeDetail();
  });

  const wrap = document.querySelector('.chart-wrap');
  let dragging = false;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.chart-tip')) return;
    dragging = true; wrap.setPointerCapture(e.pointerId); chartPointer(e);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (dragging) { chartPointer(e); e.preventDefault(); }
    else if (!isTouch && !state.tipPinned) {
      const r = $('chart').getBoundingClientRect();
      const pw = r.width - PAD.l - PAD.r;
      const uu = Math.max(0, Math.min(1, (e.clientX - r.left - PAD.l) / pw));
      renderTip(e.clientX - r.left, invLog(uu, state.horizon));
    }
  });
  wrap.addEventListener('pointerup', () => { dragging = false; });
  wrap.addEventListener('pointercancel', () => { dragging = false; });
  wrap.addEventListener('mouseleave', () => { if (!state.tipPinned) hideTip(); });

  addEventListener('scroll', syncChip, { passive: true });

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDetail(); closeOnboarding(); closeNav(); hideTip(); }
  });

  let rt;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (!isSheet() && state.navOpen) closeNav();
      placeProfile();
      syncBlurb(); syncTiming();
      syncChip();
      drawChart();
      if (state.tipPinned) renderTip(playheadX());
    }, 120);
  });
  addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (SITUATION_BY_ID[id] && id !== state.sit) selectSituation(id);
  });
}

/* ─── старт ─────────────────────────────────────────────── */

const hash = location.hash.slice(1);
if (SITUATION_BY_ID[hash]) { state.sit = hash; state.cat = SITUATION_BY_ID[hash].cat; }

/* Ссылка вида ?p=f-a36 открывает карту сразу под нужный профиль. */
const fromLink = (new URLSearchParams(location.search).get('p') || '').split('-');
/* ступень «35 лет» вошла в 26–35 — старые ссылки переводим, как и старый профиль */
const linkAge = fromLink[1] === 'a35' ? 'a26' : fromLink[1];
if (SEXES.some(s => s.id === fromLink[0]) && AGES.some(a => a.id === linkAge)) {
  state.sex = fromLink[0]; state.age = linkAge; neverConfigured = false; saveProfile();
}

bind();
placeProfile();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { syncBlurb(); syncTiming(); syncChip(); });
if (state.sex || loadProfile()) {
  state.sexesOn = new Set([state.sex]);
  applyProfile();
  renderAll();
} else {
  state.sex = 'm'; state.age = 'a26';
  state.sexesOn = new Set([state.sex]);
  applyProfile();
  renderAll();
  /* на телефоне онбординга нет — работаем на значениях по умолчанию,
     пол и возраст меняются из меню, когда это понадобится. Зато показываем,
     где эта навигация живёт: под бургером её иначе не найти. */
  if (isSheet()) { neverConfigured = false; showMenuOnboarding(); }
  else openOnboarding();
}
