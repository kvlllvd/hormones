/* Полнота данных: у каждого сценария есть рекомендация, фазы и живая
   категория, лишних ключей нет, гормоны не дублируются и не висят без сценариев.
   Ловится то, что sweep не видит: он проверяет числа, а не связки.
   Запуск из корня проекта: node tools/check.mjs */
import { SITUATIONS, TIMING, PHASES, DOSE, SOURCES, CATEGORIES, COMPARE, SITUATION_BY_ID } from '../js/situations.js';
import { HORMONES, CYCLE_ONLY, HORMONE_BY_ID } from '../js/data.js';
import { CYCLE_VIEWS, CYCLE_PHASES, CYCLE_DAYS, CYCLE_CAT, cycleScenario } from '../js/cycle.js';
import { SEXES, AGES, profileFactors } from '../js/profile.js';

let bad = 0;
const say = (...a) => { console.log(...a); bad++; };
const catIds = new Set(CATEGORIES.map(c => c.id));

for (const s of SITUATIONS) {
  if (!TIMING[s.id]) say('нет рекомендации', s.id);
  if (!PHASES[s.id]) say('нет фаз', s.id);
  if (!SOURCES[s.id]) say('не сказано, откуда данные', s.id);
  if (!catIds.has(s.cat)) say('нет категории', s.id, s.cat);
  if (!s.effects?.length) say('нет эффектов', s.id);
  if (!s.name || !s.blurb || !s.recovery) say('нет имени или текста', s.id);
}
for (const k of Object.keys(TIMING)) if (!SITUATION_BY_ID[k]) say('лишняя рекомендация', k);
for (const k of Object.keys(PHASES)) if (!SITUATION_BY_ID[k]) say('лишние фазы', k);
for (const k of Object.keys(DOSE)) if (!SITUATION_BY_ID[k]) say('лишняя доза', k);
for (const k of Object.keys(SOURCES)) if (!SITUATION_BY_ID[k]) say('лишний источник', k);
for (const id of COMPARE) if (!SITUATION_BY_ID[id]) say('лишнее сравнение полов', id);

const seen = new Set();
for (const s of SITUATIONS) { if (seen.has(s.id)) say('сценарий-дубль', s.id); seen.add(s.id); }
const hseen = new Set();
for (const h of HORMONES) { if (hseen.has(h.id)) say('гормон-дубль', h.id); hseen.add(h.id); }

const used = new Set(SITUATIONS.flatMap(s => s.effects.map(e => e.h)));
for (const h of HORMONES) if (!used.has(h.id)) say('гормон не встречается ни в одном сценарии', h.id);

/* Таблица профиля должна быть полной во всех 12 сочетаниях: дыра в ней
   один раз уже стоила женщинам 35 лет пустого фона. */
for (const sx of SEXES) for (const a of AGES) {
  const f = profileFactors(sx.id, a.id);
  if (!f || typeof f.amp !== 'function' || !Number.isFinite(f.rec)) { say('профиль', sx.id, a.id); continue; }
  for (const h of HORMONES) {
    const v = f.amp(h.id);
    if (!Number.isFinite(v) || v <= 0) say('множитель', sx.id, a.id, h.id, v);
  }
}

/* Цикл: фазы без дыр и нахлёстов покрывают все дни, у каждой фазы есть
   свой вид, у каждого вида — все тексты, а гормоны только цикла не
   просочились ни в общий список, ни в сценарии. */
let day = 1;
for (const ph of CYCLE_PHASES) {
  if (ph.from !== day) say('фазы цикла: дыра или нахлёст перед', ph.id);
  if (!ph.mark || !ph.sci) say('у фазы нет подписи', ph.id);
  day = ph.to + 1;
  if (!CYCLE_VIEWS.some(v => v.phase === ph.id)) say('у фазы нет вида', ph.id);
}
if (day !== CYCLE_DAYS + 1) say('фазы не доходят до конца цикла', day - 1);
if (!CYCLE_VIEWS.some(v => !v.phase)) say('нет вида «Весь цикл»');
const vseen = new Set();
for (const v of CYCLE_VIEWS) {
  if (vseen.has(v.id) || SITUATION_BY_ID[v.id]) say('вид цикла-дубль', v.id); vseen.add(v.id);
  if (v.cat !== CYCLE_CAT.id) say('вид цикла вне раздела', v.id);
  for (const k of ['name', 'short', 'blurb', 'feel', 'her', 'source']) if (!v[k] || !String(v[k]).trim()) say('у вида цикла нет', k, v.id);
  if (!Array.isArray(v.him) || v.him.length < 3 || v.him.some(([t, x]) => !t || !x)) say('рекомендация ему короче трёх частей', v.id);
  if (!v.lead || !v.lead.label || !v.lead.value || !v.lead.sub) say('нет ведущей плашки', v.id);
  if (!cycleScenario().byId[v.hi]) say('вид цикла подсвечивает гормон вне цикла', v.id, v.hi);
  const ph = CYCLE_PHASES.find(p => p.id === v.phase);
  if (v.phase && !ph) say('вид ссылается на несуществующую фазу', v.id, v.phase);
  if (ph && (v.t0 < ph.from || v.t0 > ph.to)) say('стартовый день вне своей фазы', v.id, v.t0);
}
if (CATEGORIES.some(c => c.id === CYCLE_CAT.id)) say('цикл продублирован в общих категориях');
for (const e of cycleScenario().effects) {
  if (!HORMONE_BY_ID[e.id]) say('в цикле неизвестный гормон', e.id);
  if (e.days.length !== CYCLE_DAYS) say('кривая цикла не на все дни', e.id, e.days.length);
  if (!e.note) say('у гормона цикла нет подписи', e.id);
}
for (const h of CYCLE_ONLY) {
  if (HORMONES.some(x => x.id === h.id)) say('гормон цикла попал в общий список', h.id);
  if (used.has(h.id)) say('гормон цикла попал в сценарий', h.id);
  if (!cycleScenario().byId[h.id]) say('гормон цикла не используется в цикле', h.id);
}

console.log(`гормонов ${HORMONES.length} · сценариев ${SITUATIONS.length} · категорий ${CATEGORIES.length} · видов цикла ${CYCLE_VIEWS.length} · проблем ${bad}`);
