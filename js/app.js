import { HORMONES, HORMONE_BY_ID, GROUPS } from './data.js?v=70';
import { SITUATIONS, SITUATION_BY_ID, CATEGORIES, PHASES, TIMING, COMPARE, DOSE, SOURCES } from './situations.js?v=70';
import { SEXES, AGES, profileFactors, baseline } from './profile.js?v=70';
import {
  buildScenario, levelAt, peakMoment, amplitude,
  toLog, invLog, formatDuration, formatClock, formatDelta, extreme, TICKS,
} from './engine.js?v=70';

const $ = (id) => document.getElementById(id);
const STORE = 'hormones.profile.v1';
const MENU_SEEN = 'hormones.menuseen.v1';
const RESTORATIVE = new Set(['sleep', 'morninglight', 'meditation', 'hug']);
const isTouch = matchMedia('(hover: none)').matches;
const isSheet = () => matchMedia('(max-width: 720px)').matches;
const SEX_LABEL = { m: 'М', f: 'Ж' };

let neverConfigured = true;

const state = {
  sex: null, age: null, cat: 'rhythm', sit: 'sleep',
  t: 0, horizon: 1, sc: null, scByS: {}, sexes: [], sexesOn: new Set(),
  active: null, pinned: null, detailId: null,
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
  const box = $('profile');
  const host = isSheet() ? $('picker') : $('footRow');
  if (box.parentElement !== host) host.appendChild(box);
}

/* Пол и возраст меняются прямо из кнопки — и в подвале, и в меню на телефоне:
   меню раскрывается вверх и применяет выбор сразу, без подтверждения.
   Карточка на весь экран осталась только для первого захода. */
function buildProfilePop() {
  const mk = (host, items, key) => {
    host.innerHTML = '';
    items.forEach(it => {
      const b = document.createElement('button');
      b.className = 'profile-opt'; b.type = 'button'; b.role = 'radio';
      b.textContent = it.title;
      b.setAttribute('aria-checked', state[key] === it.id);
      b.onclick = () => {
        if (state[key] === it.id) return closeProfilePop();
        state[key] = it.id;
        neverConfigured = false;
        saveProfile(); applyProfile();
        state.sexesOn = new Set([state.sex]);
        renderAll();
        closeProfilePop();
      };
      host.appendChild(b);
    });
  };
  mk($('popSex'), SEXES, 'sex');
  mk($('popAge'), AGES, 'age');
}
function openProfilePop() {
  buildProfilePop();
  $('profilePop').hidden = false;
  $('navProfile').setAttribute('aria-expanded', 'true');
}
function closeProfilePop() {
  $('profilePop').hidden = true;
  $('navProfile').setAttribute('aria-expanded', 'false');
}
function toggleProfilePop() {
  $('profilePop').hidden ? openProfilePop() : closeProfilePop();
}

/* ─── тема ──────────────────────────────────────────────── */

/* Светлая по умолчанию, тёмная включается только кнопкой и запоминается
   в браузере. Системную настройку не слушаем: выбор человека иначе спорил бы
   с ней на каждом заходе. Цвета живут переменными в :root — javascript
   переключает один атрибут, перерисовывать ничего не нужно, включая график. */
const THEME = 'hormones.theme.v1';

function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const btn = $('themeBtn');
  const label = dark ? 'Светлая тема' : 'Тёмная тема';
  btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  btn.setAttribute('aria-label', label);
  btn.title = label;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#0F0F11' : '#F5F5F3';
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme !== 'dark';
  applyTheme(dark);
  try { localStorage.setItem(THEME, dark ? 'dark' : 'light'); } catch {}
}
function loadTheme() {
  let dark = false;
  try { dark = localStorage.getItem(THEME) === 'dark'; } catch { /* приватный режим */ }
  applyTheme(dark);
}

/* Знак темы стоит там же, где второй элемент управления: на широком экране —
   в правом углу шапки, на узком — в меню рядом с крестиком, потому что угол
   шапки там занят бургером и чипом. Приём тот же, что и с профилем. */
function placeTheme() {
  const btn = $('themeBtn');
  if (isSheet()) { if (btn.nextElementSibling !== $('navClose')) $('navClose').before(btn); }
  else if (!btn.closest('.topbar')) $('burgerBtn').before(btn);
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
  closeProfilePop();
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
function syncTiming() { collapse($('timingText'), $('timingMore'), $('timing')); }
function syncSource() { collapse($('sourceText'), $('sourceMore'), $('source')); }

/* Сворачиваем текст и решаем, нужна ли кнопка: если он и так влез, она лишняя.
   На широком экране обрезки нет вовсе, и кнопка сама остаётся скрытой. */
function collapse(text, btn, host) {
  host.classList.remove('is-open');
  btn.setAttribute('aria-expanded', 'false');
  btn.textContent = 'Ещё';
  btn.hidden = text.scrollHeight <= text.clientHeight + 1;
}

function syncChip() {
  const bar = document.querySelector('.topbar');
  bar.classList.toggle('is-scrolled', $('sitName').getBoundingClientRect().bottom <= bar.offsetHeight);
  bar.classList.toggle('is-top', window.scrollY <= 1);
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

/* Приставка группы в чипе: вместо отдельного подзаголовка ряда. */
const SUB_PREFIX = { 'Зал': 'Силовые', 'Велосипед': 'Вел', 'Плавание': 'Плавание' };

function chipLabel(s) {
  let text = (s.short || s.name).replace(' минут', ' мин');
  const prefix = SUB_PREFIX[s.sub];
  if (!prefix) return text;
  /* Плавание в данных в метрах, в чипе — в километрах, как у велосипеда. */
  const m = text.match(/^(\d+) м$/);
  if (m) text = (+m[1] / 1000).toFixed(1).replace(/[.,]0$/, '').replace('.', ',') + ' км';
  return `${prefix} \u00A0\u00B7\u00A0 ${text}`;
}

function renderChips() {
  const host = $('chips'); host.innerHTML = '';
  const list = SITUATIONS.filter(s => s.cat === state.cat);
  const grouped = list.some(s => s.sub || s.brk);   // точки нужны только там, где группы размечены
  let group = null;
  list.forEach(s => {
    /* Группа — либо подраздел (зал, велосипед, плавание), либо явная метка brk
       на первом сценарии новой группы (питание, близость, вещества). */
    const g = s.sub || '';
    if (grouped && group !== null && (s.brk || g !== group)) {
      const sep = document.createElement('span');
      sep.className = 'chip-dot'; sep.textContent = '\u00B7'; sep.setAttribute('aria-hidden', 'true');
      host.appendChild(sep);
    }
    group = g;
    const b = document.createElement('button');
    b.className = 'chip'; b.type = 'button'; b.role = 'tab';
    b.textContent = chipLabel(s);
    b.setAttribute('aria-selected', s.id === state.sit);
    b.onclick = () => selectSituation(s.id);
    host.appendChild(b);
  });
}

function selectSituation(id, keepNav) {
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
  $('sectChipText').textContent = sit.name;

  /* Кривая посчитана на конкретную дозу — показываем её рядом с графиком. */
  const dose = $('dose');
  dose.textContent = DOSE[sit.id] || '';
  dose.hidden = !DOSE[sit.id];

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
  $('sourceText').textContent = SOURCES[sit.id];
  $('recoveryText').textContent = sit.recovery;
  $('timingText').textContent = TIMING[sit.id] || '';
  syncTiming();
  syncSource();
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
    if (state.pinned === h.id) { state.pinned = null; setActive(null); hideDetail(); syncPin(); }
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
}

function setActive(id) {
  state.active = id;
  document.querySelectorAll('.hcard').forEach(c => c.classList.toggle('is-active', c.dataset.h === id));
  drawChart();
}

/* ─── график ────────────────────────────────────────────── */

const PAD = { l: 36, r: 10, t: 42, b: 18 };
const SEX_COLOR = { m: 'var(--sex-m)', f: 'var(--sex-f)' };

/* Ширина подписи на графике. Оценка «столько-то пикселей на символ» годится
   для упаковки меток (журнал: точный замер там сбивает раскладку и меток
   выживает меньше), но решать по ней, влезает ли подпись в поле, нельзя:
   на кириллице она занижает ширину, и подписи уезжали за край. Для границ
   поля меряем честно — тем же шрифтом, каким рисуем. */
const measureCtx = document.createElement('canvas').getContext('2d');
let measureFamily = '';
function textWidth(text, size, weight) {
  /* Гарнитуру спрашиваем раз: ползунок перерисовывает график на каждый кадр. */
  if (!measureFamily) measureFamily = getComputedStyle(document.body).fontFamily || 'sans-serif';
  measureCtx.font = `${weight} ${size}px ${measureFamily}`;
  return measureCtx.measureText(text).width;
}

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
    spanRect = `<rect x="${PAD.l}" y="${PAD.t}" width="${(x2 - PAD.l).toFixed(1)}" height="${ph}" fill="var(--chart-span)"/>`;
  }
  if (ph_) {
    /* Два яруса подписей: на узком экране иначе выживает одна метка из трёх. */
    const rowY = [PAD.t - 29, PAD.t - 13];
    const lastR = [-1e9, -1e9];
    ph_.marks.forEach((mk, i) => {
      if (mk.t > H) return;
      const x = xOf(toLog(mk.t, H));
      const est = mk.l.length * 4.95;
      const real = textWidth(mk.l, 9, 400);
      /* Сначала вправо от риски, если не влезает — влево; не влезает никуда —
         метку не рисуем вовсе: обрезанная краем поля читается хуже, чем никакая. */
      const fits = (a) => (a === 'end' ? x - 5 - real >= PAD.l : x + 5 + real <= w - PAD.r);
      const anchor = fits('start') ? 'start' : fits('end') ? 'end' : null;
      if (!anchor) return;
      const tx = anchor === 'end' ? x - 5 : x + 5;
      const left = anchor === 'end' ? tx - est : tx;
      let row = i % 2;
      if (left < lastR[row] + 7) row = 1 - row;
      if (left < lastR[row] + 7) return;
      lastR[row] = left + est;
      const y = rowY[row];
      marks += `<line x1="${x.toFixed(1)}" y1="${(y + 4).toFixed(1)}" x2="${x.toFixed(1)}" y2="${PAD.t + ph}" stroke="var(--chart-mark)" stroke-width="1"/>
        <circle cx="${x.toFixed(1)}" cy="${(y + 4).toFixed(1)}" r="1.8" fill="var(--chart-mark-dot)"/>
        <text x="${tx.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="9" fill="var(--chart-mark-text)">${mk.l}</text>`;
    });
  }

  const gridVals = [4, 3, 2, 1, 0, -1, -2].filter(v => v > lo + 0.05 && v < hi - 0.05);
  const grid = gridVals.map(v => {
    const y = yOf(v).toFixed(1);
    const label = v === 0 ? 'норма' : (v > 0 ? '×' + Math.pow(2, v) : '×' + String(Math.pow(2, v)).replace('.', ','));
    return `<line x1="${PAD.l}" y1="${y}" x2="${w - PAD.r}" y2="${y}" stroke="${v === 0 ? 'var(--chart-zero)' : 'var(--chart-grid)'}" stroke-width="1"/>
            <text x="${PAD.l - 7}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9.5" fill="var(--chart-tick)" font-family="Geist Mono, monospace">${label}</text>`;
  }).join('');

  const cand = TICKS.filter(t => t <= H * 0.95 && t >= H / 5000);
  const step = Math.max(1, Math.ceil(cand.length / (w < 420 ? 4 : 7)));
  /* отсчитываем от конца, чтобы правый край шкалы всегда был подписан */
  const xa = cand.filter((_, i) => (cand.length - 1 - i) % step === 0).map(t => {
    const x = xOf(toLog(t, H)).toFixed(1);
    return `<line x1="${x}" y1="${PAD.t}" x2="${x}" y2="${PAD.t + ph}" stroke="var(--chart-vgrid)" stroke-width="1"/>
            <text x="${x}" y="${h - 4}" text-anchor="middle" font-size="9.5" fill="var(--chart-tick)" font-family="Geist Mono, monospace">${formatClock(t)}</text>`;
  }).join('');

  const pxN = xOf(toLog(state.t, H));
  const px = pxN.toFixed(1);

  const activeId = state.active && movedAnywhere(state.active) ? state.active : state.sc.effects[0].id;
  const hiCurves = curves.filter(c => c.e.id === activeId);
  const base = curves.filter(c => c.e.id !== activeId).map(c => {
    const stroke = dual ? SEX_COLOR[c.sex] : 'var(--chart-base)';
    return `<path d="${path(c.pts)}" fill="none" stroke="${stroke}" stroke-width="1.4"
      stroke-linecap="round" stroke-linejoin="round" opacity="${dual ? '.25' : '.8'}"/>`;
  }).join('');

  let top = '', topLabel = '';
  const hiC = hiCurves.find(c => c.sex === state.sex) || hiCurves[0];
  /* Точки плейхеда нужны раньше отрисовки: подпись кривой обходит их все,
     а не только точку своей кривой — соседняя лежит на том же x. */
  const dotList = dual
    ? hiCurves
    : [hiC, ...curves.filter(c => c !== hiC).slice(0, 3)].filter(Boolean);
  if (hiC) {
    const far = hiC.pts.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
    const up = far[1] >= 0;
    const color = dual ? 'var(--ink)' : (up ? 'var(--up)' : 'var(--down)');
    const name = HORMONE_BY_ID[hiC.e.id].name;
    const est = textWidth(name, 11.5, 500);
    const fx = xOf(far[0]);
    /* Подпись уводим на ту сторону от пика, где не стоит точка плейхеда. */
    const spanOf = (a) => (a === 'end' ? [fx - 11 - est, fx - 11] : [fx + 11, fx + 11 + est]);
    const clashes = (a) => { const [l, r] = spanOf(a); return pxN > l - 7 && pxN < r + 7; };
    const inField = (a) => { const [l, r] = spanOf(a); return l >= PAD.l + 2 && r <= w - PAD.r - 2; };
    let anchor = inField('start') ? 'start' : 'end';
    if (clashes(anchor)) {
      const alt = anchor === 'start' ? 'end' : 'start';
      if (inField(alt) && !clashes(alt)) anchor = alt;
    }
    let lx = anchor === 'end' ? fx - 11 : fx + 11;
    lx = Math.max(PAD.l + (anchor === 'end' ? est : 0) + 4, Math.min(w - PAD.r - 4, lx));
    /* На узком экране подпись притирается к краю поля — и снова наезжает на
       точку, хотя выбранная сторона была свободна. Поэтому наложение считаем
       по итоговому месту, а не по задуманному. */
    const [sl, sr] = anchor === 'end' ? [lx - est, lx] : [lx, lx + est];
    const stuck = pxN > sl - 7 && pxN < sr + 7;
    /* Разойтись по горизонтали не вышло — уводим подпись по вертикали от точки.
       Мало выбрать дальнюю сторону: подпись высотой 15 px и точка радиусом 4,5
       всё равно перекрывались. Поэтому отводим ровно настолько, чтобы рамка
       подписи прошла мимо точки, и не дальше — иначе она оторвётся от кривой. */
    const clampY = (v) => Math.max(PAD.t + 10, Math.min(PAD.t + ph - 4, v));
    const above = clampY(yOf(far[1]) - 10), below = clampY(yOf(far[1]) + 16);
    const dotYs = dotList.map(c => yOf(Math.log2(levelAt(c.e, state.t))));
    /* Подпись высотой 15 px сидит на базовой линии: сверху 12, снизу 3.
       Мимо точки радиусом 4,5 она проходит, если отстоит на 9 вверх или 18 вниз. */
    const free = (v) => dotYs.every(dy => v <= dy - 9 || v >= dy + 18);
    let ly = up ? above : below;
    if (stuck) {
      const over = clampY(Math.min(...dotYs) - 12), under = clampY(Math.max(...dotYs) + 20);
      ly = [up ? above : below, up ? below : above, over, under].find(free) ?? ly;
    }
    top = hiCurves.map(c => `<path d="${path(c.pts)}" fill="none" stroke="${dual ? SEX_COLOR[c.sex] : color}"
      stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
    topLabel = `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}"
        text-anchor="${anchor}" font-size="11.5" font-weight="500" fill="${color}"
        stroke="var(--surface)" stroke-width="3.5" paint-order="stroke">${name}</text>`;
  }

  const head = `<line x1="${px}" y1="${PAD.t - 4}" x2="${px}" y2="${PAD.t + ph}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="2 3" opacity=".5"/>`;
  const dots = dotList.map(c => {
    const v = Math.log2(levelAt(c.e, state.t));
    const upv = v > 0.02, flat = Math.abs(v) <= 0.02;
    const color = dual ? SEX_COLOR[c.sex] : (flat ? 'var(--flat)' : upv ? 'var(--up)' : 'var(--down)');
    return `<circle cx="${px}" cy="${yOf(v).toFixed(1)}" r="${c === hiC || dual ? 4.5 : 3}" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`;
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

  paintLevels();
  drawChart();
  if (state.tipPinned) renderTip(playheadX());
}

/* ─── подсказка на графике ──────────────────────────────── */

function chartPointer(ev) {
  const host = $('chart');
  const r = host.getBoundingClientRect();
  const pw = r.width - PAD.l - PAD.r;
  const u = Math.max(0, Math.min(1, (ev.clientX - r.left - PAD.l) / pw));
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
  state.detailId = id;
  syncPin();
  const base = baseline(state.sex, state.age, id);
  const sexTitle = SEXES.find(s => s.id === state.sex).title.toLowerCase();
  const ageTitle = AGES.find(a => a.id === state.age).title;

  const note = state.sexes.map(s => effFor(s, id)).find(e => e && e.note);

  $('detailBody').innerHTML = `
    <div class="detail-head">
      <div class="detail-name">${h.name}</div>
      <div class="detail-latin">${h.latin} · ${h.role.toLowerCase()}</div>
    </div>
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
  syncPin();
}

/* Кнопка «закрепить» делает ровно то же, что повторный клик по плашке гормона:
   закреплённое окно не закрывается, когда курсор уходит в сторону. */
function syncPin() {
  const on = state.pinned && state.pinned === state.detailId;
  const btn = $('detailPin');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.setAttribute('aria-label', on ? 'Открепить окно' : 'Закрепить окно');
  btn.title = on ? 'Открепить окно' : 'Закрепить окно';
}
function togglePin() {
  if (!state.detailId || $('detail').hidden) return;
  if (state.pinned === state.detailId) { state.pinned = null; setActive(null); hideDetail(); }
  else { state.pinned = state.detailId; setActive(state.detailId); }
  syncPin();
}

const toTop = () =>
  scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' });

/* ─── события ───────────────────────────────────────────── */

function bind() {
  $('navProfile').onclick = toggleProfilePop;
  $('themeBtn').onclick = toggleTheme;
  $('burgerBtn').onclick = () => (state.navOpen ? closeNav() : openNav());
  $('navClose').onclick = closeNav;
  $('navScrim').onclick = closeNav;
  $('navHintOk').onclick = hideMenuHint;
  $('sectChip').onclick = () => {
    if (isSheet()) { state.navOpen ? closeNav() : openNav(); return; }
    toTop();
  };
  /* Логотип никуда не уводит — страница одна. Вместо перезагрузки поднимаем наверх. */
  const wm = document.querySelector('.wordmark');
  wm.onclick = (e) => { e.preventDefault(); wm.classList.add('is-reverted'); toTop(); };
  wm.onmouseleave = () => wm.classList.remove('is-reverted');

  $('scrub').oninput = (e) => updateTime(invLog(e.target.value / 1000, state.horizon));
  $('detailClose').onclick = closeDetail;
  $('detailPin').onclick = togglePin;
  $('scrim').onclick = closeDetail;
  $('tipClose').onclick = (e) => { e.stopPropagation(); hideTip(); };

  $('resetBtn').onclick = () => { closeDetail(); updateTime(peakMoment(state.sc)); };

  $('segActive').onclick = () => { state.view = 'active'; renderHormones(); };
  $('segAll').onclick = () => { state.view = 'all'; renderHormones(); };

  $('sexLegend').addEventListener('click', (e) => {
    const b = e.target.closest('.sexbtn');
    if (b) toggleSex(b.dataset.sex);
  });

  const tmore = $('timingMore');
  tmore.onclick = () => {
    const open = $('timing').classList.toggle('is-open');
    tmore.setAttribute('aria-expanded', open);
    tmore.textContent = open ? 'Скрыть' : 'Ещё';
  };

  const smore = $('sourceMore');
  smore.onclick = () => {
    const open = $('source').classList.toggle('is-open');
    smore.setAttribute('aria-expanded', open);
    smore.textContent = open ? 'Скрыть' : 'Ещё';
  };

  const more = $('footMore');
  more.onclick = () => {
    const open = $('footWarn').classList.toggle('is-open');
    more.setAttribute('aria-expanded', open);
    more.textContent = open ? 'Скрыть' : 'Ещё';
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

  /* клик мимо выпадающего меню профиля закрывает его */
  document.addEventListener('click', (e) => {
    if (!$('profilePop').hidden && !e.target.closest('#profile')) closeProfilePop();
  });

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
    if (e.key === 'Escape') { closeDetail(); closeOnboarding(); closeNav(); hideTip(); closeProfilePop(); }
  });

  let rt;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (!isSheet() && state.navOpen) closeNav();
      placeProfile();
      placeTheme();
      syncTiming();
      syncSource();
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
placeTheme();
loadTheme();
/* Пока шрифт не приехал, замер подписей идёт по запасному — перерисовываем. */
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { syncTiming(); syncSource(); syncChip(); drawChart(); });
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
