import { HORMONES, HORMONE_BY_ID, GROUPS } from './data.js';
import { SITUATIONS, SITUATION_BY_ID, CATEGORIES } from './situations.js';
import { SEXES, AGES, profileFactors, baseline } from './profile.js';
import {
  buildScenario, levelAt, peakMoment, amplitude,
  toLog, invLog, formatDuration, formatClock, formatDelta, extreme, TICKS,
} from './engine.js';

const $ = (id) => document.getElementById(id);
const STORE = 'hormones.profile.v1';
const RESTORATIVE = new Set(['sleep', 'morninglight', 'meditation', 'hug']);
const isTouch = matchMedia('(hover: none)').matches;
const isSheet = () => matchMedia('(max-width: 720px)').matches;

const state = {
  sex: null, age: null, cat: 'bond', sit: 'sex',
  t: 0, scenario: null, factors: null,
  active: null, pinned: null, playing: false, raf: 0,
};

/* ─── профиль ───────────────────────────────────────────── */

function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && SEXES.some(s => s.id === saved.sex) && AGES.some(a => a.id === saved.age)) {
      state.sex = saved.sex; state.age = saved.age; return true;
    }
  } catch { /* приватный режим — просто спросим заново */ }
  return false;
}
function saveProfile() {
  try { localStorage.setItem(STORE, JSON.stringify({ sex: state.sex, age: state.age })); } catch {}
}

function buildOnboarding() {
  const draft = { sex: state.sex, age: state.age };
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
    state.sex = draft.sex; state.age = draft.age;
    saveProfile(); closeOnboarding(); applyProfile(); renderAll();
  };
  $('obClose').hidden = !(state.sex && state.age);
  $('obClose').onclick = closeOnboarding;
}
function openOnboarding() { buildOnboarding(); $('onboarding').hidden = false; }
function closeOnboarding() { $('onboarding').hidden = true; }

function applyProfile() {
  state.factors = profileFactors(state.sex, state.age);
  const sex = SEXES.find(s => s.id === state.sex);
  const age = AGES.find(a => a.id === state.age);
  $('profileText').textContent = `${sex.short} · ${age.short}`;
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
      selectSituation(first.id);
    };
    host.appendChild(b);
  });
}

function renderChips() {
  const host = $('chips'); host.innerHTML = '';
  SITUATIONS.filter(s => s.cat === state.cat).forEach(s => {
    const b = document.createElement('button');
    b.className = 'chip'; b.type = 'button'; b.role = 'tab';
    b.textContent = s.name;
    b.setAttribute('aria-selected', s.id === state.sit);
    b.onclick = () => selectSituation(s.id);
    host.appendChild(b);
    if (s.id === state.sit) requestAnimationFrame(() => b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }));
  });
}

function selectSituation(id) {
  stopPlay();
  state.sit = id;
  state.cat = SITUATION_BY_ID[id].cat;
  state.pinned = null; state.active = null;
  hideDetail();
  history.replaceState(null, '', '#' + id);
  renderAll();
}

/* ─── общий рендер ──────────────────────────────────────── */

function renderAll() {
  const sit = SITUATION_BY_ID[state.sit];
  state.scenario = buildScenario(sit, state.sex, state.factors);
  state.t = peakMoment(state.scenario);

  renderCats(); renderChips();
  $('sitTag').textContent = `${CATEGORIES.find(c => c.id === sit.cat).title} · ${sit.tag}`;
  $('sitName').textContent = sit.name;
  $('sitBlurb').textContent = sit.blurb;

  renderStats(sit);
  renderHormones();
  renderRecovery(sit);
  drawChart();
  updateTime(state.t);

  document.querySelector('main').classList.remove('fade-in');
  void document.querySelector('main').offsetWidth;
  document.querySelector('main').classList.add('fade-in');
}

function renderStats(sit) {
  const sc = state.scenario;
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
  const rows = [...state.scenario.effects].sort((a, b) => b.tEnd - a.tEnd).slice(0, 6);
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

function renderHormones() {
  const sc = state.scenario;
  const host = $('hormones'); host.innerHTML = '';
  GROUPS.forEach(g => {
    const list = HORMONES.filter(h => h.group === g.id)
      .sort((a, b) => (sc.byId[b.id] ? amplitude(sc.byId[b.id]) : -1) - (sc.byId[a.id] ? amplitude(sc.byId[a.id]) : -1));
    const wrap = document.createElement('div');
    wrap.className = 'hgroup';
    wrap.innerHTML = `<h2 class="hgroup-title">${g.title}</h2><div class="hgrid"></div>`;
    const grid = wrap.querySelector('.hgrid');
    list.forEach(h => grid.appendChild(hormoneCard(h)));
    host.appendChild(wrap);
  });
  paintLevels();
}

function hormoneCard(h) {
  const b = document.createElement('button');
  b.className = 'hcard'; b.type = 'button'; b.dataset.h = h.id;
  b.innerHTML = `
    <span class="hname">${h.name}<span class="hrole">${h.role}</span></span>
    <span class="hbar"><span class="hbar-track"></span><span class="hbar-fill"></span><span class="hbar-mid"></span></span>
    <span class="hval mono">норма</span>`;
  if (!isTouch) {
    b.addEventListener('mouseenter', () => {
      if (state.pinned) return;
      setActive(h.id);
      if (!isSheet()) showDetail(h.id, b);   // на узком экране лист выезжает только по клику
    });
    b.addEventListener('mouseleave', () => { if (!state.pinned && !isSheet()) { setActive(null); hideDetail(); } });
  }
  b.addEventListener('click', () => {
    if (state.pinned === h.id) { state.pinned = null; setActive(null); hideDetail(); }
    else { state.pinned = h.id; setActive(h.id); showDetail(h.id, b); }
  });
  return b;
}

/* Полоса: отклонение в логарифмической шкале, центр — норма. */
function paintLevels() {
  const sc = state.scenario;
  document.querySelectorAll('.hcard').forEach(card => {
    const id = card.dataset.h;
    const eff = sc.byId[id];
    const lvl = eff ? levelAt(eff, state.t) : 1;
    const dev = Math.log2(lvl);
    const frac = Math.min(1, Math.abs(dev) / 3);
    const fill = card.querySelector('.hbar-fill');
    const val = card.querySelector('.hval');
    const flat = Math.abs(lvl - 1) < 0.03;

    fill.style.width = (flat ? 2 : Math.max(3, frac * 50)) + '%';
    fill.style.left = flat ? 'calc(50% - 1px)' : (dev >= 0 ? '50%' : (50 - Math.max(3, frac * 50)) + '%');
    fill.style.background = flat ? 'var(--flat)' : (dev > 0 ? 'var(--up)' : 'var(--down)');
    val.textContent = eff ? formatDelta(lvl) : 'в норме';
    val.className = 'hval mono ' + (flat || !eff ? 'flat' : dev > 0 ? 'up' : 'down');
    card.classList.toggle('is-flat', !eff);
  });
  if (state.active) updateDetailNow();
}

function setActive(id) {
  state.active = id;
  document.querySelectorAll('.hcard').forEach(c => c.classList.toggle('is-active', c.dataset.h === id));
  drawChart();
  const sc = state.scenario;
  const lead = id && sc.byId[id] ? id : sc.effects[0].id;
  const name = HORMONE_BY_ID[lead].name.toLowerCase();
  $('chartNote').textContent = (id && sc.byId[id])
    ? `Выделен ${name}. Серые линии — остальные затронутые гормоны.`
    : `Каждая линия — гормон, выделен ${name}: он отклоняется сильнее всех. Тяните по графику, чтобы отмотать время, или наведите на гормон в списке ниже.`;
}

/* ─── график ────────────────────────────────────────────── */

const PAD = { l: 36, r: 10, t: 14, b: 18 };

function drawChart() {
  const host = $('chart');
  const w = host.clientWidth || 600;
  const h = host.clientHeight || 220;
  const sc = state.scenario;
  if (!sc) return;
  const H = sc.horizon;
  const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b;

  let lo = -0.35, hi = 0.35;
  const curves = sc.effects.map(e => {
    const pts = [];
    for (let i = 0; i <= 120; i++) {
      const t = invLog(i / 120, H);
      const v = Math.log2(levelAt(e, t));
      lo = Math.min(lo, v); hi = Math.max(hi, v);
      pts.push([i / 120, v]);
    }
    return { e, pts };
  });
  lo -= 0.18; hi += 0.18;

  const xOf = (u) => PAD.l + u * pw;
  const yOf = (v) => PAD.t + (hi - v) / (hi - lo) * ph;
  const path = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + xOf(p[0]).toFixed(1) + ' ' + yOf(p[1]).toFixed(1)).join(' ');

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

  const activeId = state.active && sc.byId[state.active] ? state.active : sc.effects[0].id;
  const base = curves.filter(c => c.e.id !== activeId)
    .map(c => `<path d="${path(c.pts)}" fill="none" stroke="#C9C9C1" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`).join('');

  let top = '';
  const hiC = curves.find(c => c.e.id === activeId);
  if (hiC) {
    const far = hiC.pts.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
    const up = far[1] >= 0;
    const color = up ? 'var(--up)' : 'var(--down)';
    const lx = Math.min(w - PAD.r - 6, Math.max(PAD.l + 4, xOf(far[0])));
    const anchor = lx > w - 90 ? 'end' : 'start';
    top = `<path d="${path(hiC.pts)}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="${(anchor === 'end' ? lx - 8 : lx + 8).toFixed(1)}" y="${Math.max(PAD.t + 9, Math.min(PAD.t + ph - 4, yOf(far[1]) + (up ? -9 : 15))).toFixed(1)}"
        text-anchor="${anchor}" font-size="11.5" font-weight="500" fill="${color}"
        stroke="#fff" stroke-width="3.5" paint-order="stroke">${HORMONE_BY_ID[hiC.e.id].name}</text>`;
  }

  const u = toLog(state.t, H);
  const px = xOf(u).toFixed(1);
  let head = `<line x1="${px}" y1="${PAD.t - 4}" x2="${px}" y2="${PAD.t + ph}" stroke="#0E0E10" stroke-width="1" stroke-dasharray="2 3" opacity=".5"/>`;
  const dots = [hiC, ...curves.filter(c => c !== hiC).slice(0, 3)].filter(Boolean).map(c => {
    const v = Math.log2(levelAt(c.e, state.t));
    const up = v > 0.02, flat = Math.abs(v) <= 0.02;
    const color = flat ? '#B8B8B2' : up ? 'var(--up)' : 'var(--down)';
    return `<circle cx="${px}" cy="${yOf(v).toFixed(1)}" r="${c === hiC ? 4.5 : 3}" fill="${color}" stroke="#fff" stroke-width="2"/>`;
  }).join('');

  host.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    ${xa}${grid}${base}${top}${head}${dots}</svg>`;
}

/* ─── время ─────────────────────────────────────────────── */

function updateTime(t) {
  const sc = state.scenario;
  state.t = Math.max(0, Math.min(sc.horizon, t));
  $('timeValue').textContent = state.t < 1 ? 'начало' : formatClock(state.t);
  $('timeCaption').textContent = state.t < 1 ? 'момент события' : 'после начала';
  $('scrub').value = Math.round(toLog(state.t, sc.horizon) * 1000);

  let now = 0, max = 0;
  sc.effects.forEach(e => {
    now += Math.abs(Math.log2(levelAt(e, state.t)));
    max += Math.max(Math.abs(Math.log2(e.peak)), e.hasReb ? Math.abs(Math.log2(e.reb)) : 0);
  });
  const load = max ? Math.round(now / max * 100) : 0;
  $('timeLoad').textContent = load <= 3 ? 'система в норме' : `отклонение ${load}%`;

  paintLevels();
  drawChart();
}

function startPlay() {
  const sc = state.scenario;
  state.playing = true;
  $('playIcon').setAttribute('d', 'M4 3h3v10H4zM9 3h3v10H9z');
  const dur = 9000;
  const from = state.t >= sc.horizon * 0.98 ? 0 : toLog(state.t, sc.horizon);
  const t0 = performance.now();
  const tick = (now) => {
    if (!state.playing) return;
    const u = from + (now - t0) / dur * (1 - from);
    if (u >= 1) { updateTime(sc.horizon); stopPlay(); return; }
    updateTime(invLog(u, sc.horizon));
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
  updateTime(invLog(u, state.scenario.horizon));
  showTip(ev.clientX - r.left, r);
}

function showTip(x, rect) {
  const tip = $('chartTip');
  const sc = state.scenario;
  const rows = sc.effects
    .map(e => ({ e, v: levelAt(e, state.t) }))
    .sort((a, b) => Math.abs(Math.log2(b.v)) - Math.abs(Math.log2(a.v)))
    .slice(0, 3)
    .filter(r => Math.abs(r.v - 1) > 0.03);
  if (!rows.length) { tip.hidden = true; return; }
  tip.hidden = false;
  tip.innerHTML = `<b>${state.t < 1 ? 'момент события' : formatClock(state.t) + ' спустя'}</b>` +
    rows.map(r => `<div class="tip-row"><span>${HORMONE_BY_ID[r.e.id].name}</span><span class="tip-v">${formatDelta(r.v)}</span></div>`).join('');
  const w = tip.offsetWidth;
  tip.style.left = Math.max(w / 2 + 4, Math.min(rect.width - w / 2 - 4, x)) + 'px';
  tip.style.top = '54px';
}
function hideTip() { $('chartTip').hidden = true; }

/* ─── карточка гормона ──────────────────────────────────── */

function showDetail(id, anchor) {
  const h = HORMONE_BY_ID[id];
  const eff = state.scenario.byId[id];
  const lvl = eff ? levelAt(eff, state.t) : 1;
  const base = baseline(state.sex, state.age, id);
  const sexTitle = SEXES.find(s => s.id === state.sex).title.toLowerCase();
  const ageTitle = AGES.find(a => a.id === state.age).title;

  $('detailBody').innerHTML = `
    <div class="detail-head">
      <div class="detail-name">${h.name}</div>
      <div class="detail-latin">${h.latin} · ${h.role.toLowerCase()}</div>
    </div>
    <div class="detail-now">
      <span class="detail-now-v" id="detailNowV">${eff ? formatDelta(lvl) : 'норма'}</span>
      <span class="detail-now-l" id="detailNowL">${eff ? 'сейчас, через ' + (state.t < 1 ? 'момент' : formatClock(state.t)) : 'в этом сценарии не меняется'}</span>
    </div>
    ${eff && eff.note ? `<p class="detail-note">${eff.note}</p>` : ''}
    <div class="detail-sec"><h4>За что отвечает</h4><p>${h.what}</p></div>
    <div class="detail-sec"><h4>Где и как вырабатывается</h4><p>${h.where}</p></div>
    <div class="detail-sec"><h4>Как поддерживать</h4><p>${h.support}</p></div>
    ${base ? `<p class="detail-base"><b>Ваш базовый фон:</b> ≈${Math.round(base.value * 100)}% от пикового уровня молодости (${sexTitle} пол, ${ageTitle}). ${base.note}</p>` : ''}
  `;
  const d = $('detail');
  d.hidden = false;
  if (isSheet()) {
    $('scrim').hidden = false;
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
  const v = $('detailNowV'), l = $('detailNowL');
  if (!v || !state.active) return;
  const eff = state.scenario.byId[state.active];
  if (!eff) return;
  v.textContent = formatDelta(levelAt(eff, state.t));
  l.textContent = 'сейчас, через ' + (state.t < 1 ? 'момент' : formatClock(state.t));
}
function hideDetail() {
  $('detail').hidden = true;
  $('scrim').hidden = true;
}

/* ─── события ───────────────────────────────────────────── */

function bind() {
  $('profileBtn').onclick = openOnboarding;
  $('playBtn').onclick = () => (state.playing ? stopPlay() : startPlay());
  $('scrub').oninput = (e) => { stopPlay(); updateTime(invLog(e.target.value / 1000, state.scenario.horizon)); };
  $('detailClose').onclick = () => { state.pinned = null; setActive(null); hideDetail(); };
  $('scrim').onclick = () => { state.pinned = null; setActive(null); hideDetail(); };

  const wrap = document.querySelector('.chart-wrap');
  let dragging = false;
  wrap.addEventListener('pointerdown', (e) => { dragging = true; wrap.setPointerCapture(e.pointerId); chartPointer(e); });
  wrap.addEventListener('pointermove', (e) => {
    if (dragging) { chartPointer(e); e.preventDefault(); }
    else if (!isTouch) { const r = $('chart').getBoundingClientRect(); showTip(e.clientX - r.left, r); }
  });
  wrap.addEventListener('pointerup', () => { dragging = false; });
  wrap.addEventListener('pointercancel', () => { dragging = false; });
  wrap.addEventListener('mouseleave', hideTip);

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { state.pinned = null; setActive(null); hideDetail(); closeOnboarding(); }
  });

  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawChart, 120); });
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
if (SEXES.some(s => s.id === fromLink[0]) && AGES.some(a => a.id === fromLink[1])) {
  state.sex = fromLink[0]; state.age = fromLink[1]; saveProfile();
}

bind();
if (state.sex || loadProfile()) {
  applyProfile();
  renderAll();
} else {
  openOnboarding();
  state.sex = 'm'; state.age = 'a26';
  applyProfile();
  renderAll();
}
