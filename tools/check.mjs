/* Полнота данных: у каждого сценария есть «Лучшее время», фазы и живая
   категория, лишних ключей нет, гормоны не дублируются и не висят без сценариев.
   Ловится то, что sweep не видит: он проверяет числа, а не связки.
   Запуск из корня проекта: node tools/check.mjs */
import { SITUATIONS, TIMING, PHASES, DOSE, CATEGORIES, COMPARE, SITUATION_BY_ID } from '../js/situations.js';
import { HORMONES } from '../js/data.js';
import { SEXES, AGES, profileFactors } from '../js/profile.js';

let bad = 0;
const say = (...a) => { console.log(...a); bad++; };
const catIds = new Set(CATEGORIES.map(c => c.id));

for (const s of SITUATIONS) {
  if (!TIMING[s.id]) say('нет «Лучшего времени»', s.id);
  if (!PHASES[s.id]) say('нет фаз', s.id);
  if (!catIds.has(s.cat)) say('нет категории', s.id, s.cat);
  if (!s.effects?.length) say('нет эффектов', s.id);
  if (!s.name || !s.blurb || !s.recovery) say('нет имени или текста', s.id);
}
for (const k of Object.keys(TIMING)) if (!SITUATION_BY_ID[k]) say('лишнее «Лучшее время»', k);
for (const k of Object.keys(PHASES)) if (!SITUATION_BY_ID[k]) say('лишние фазы', k);
for (const k of Object.keys(DOSE)) if (!SITUATION_BY_ID[k]) say('лишняя доза', k);
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

console.log(`гормонов ${HORMONES.length} · сценариев ${SITUATIONS.length} · категорий ${CATEGORIES.length} · проблем ${bad}`);
