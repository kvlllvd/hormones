/* Прогон модели: все сценарии × пол × возрастная группа.
   Запуск из корня проекта: node tools/sweep.mjs
   Проверяет конечность и положительность уровней, возврат к норме
   на горизонте, положительный горизонт, ссылки на несуществующие
   гормоны и метки фаз за пределами графика. */
import { SITUATIONS, PHASES } from '../js/situations.js';
import { HORMONE_BY_ID } from '../js/data.js';
import { SEXES, AGES, profileFactors } from '../js/profile.js';
import { buildScenario, levelAt } from '../js/engine.js';
import { cycleScenario, CYCLE_DAYS } from '../js/cycle.js';
let bad=0, n=0, maxAmp=0, maxWho='';
for (const s of SITUATIONS) {
  for (const e of s.effects) if(!HORMONE_BY_ID[e.h]){console.log('НЕТ ГОРМОНА',s.id,e.h);bad++}
  for (const sx of SEXES) for (const a of AGES) {
    n++;
    const f = profileFactors(sx.id, a.id);
    const sc = buildScenario(s, sx.id, f);
    if (!(sc.horizon > 0)) { console.log('горизонт', s.id, sx.id, a.id, sc.horizon); bad++; }
    for (const e of sc.effects) {
      const amp = Math.max(e.peak, e.hasReb?e.reb:1, 1/Math.min(e.peak, e.hasReb?e.reb:1));
      if (amp > maxAmp) { maxAmp = amp; maxWho = s.id+'/'+e.id+'/'+sx.id+a.id; }
      for (const t of [0, sc.horizon*0.25, sc.horizon*0.5, sc.horizon]) {
        const v = levelAt(e, t);
        if (!Number.isFinite(v) || v <= 0) { console.log('уровень', s.id, e.id, t, v); bad++; }
      }
      const end = levelAt(e, sc.horizon);
      if (Math.abs(end - 1) > 0.02) { console.log('не вернулся к норме', s.id, e.id, sx.id, a.id, end.toFixed(3)); bad++; }
    }
    const ph = PHASES[s.id];
    if (!ph) { if(sx.id==='m'&&a.id==='a18') {console.log('нет фаз', s.id); bad++;} }
    else for (const mk of ph.marks) if (mk.t > sc.horizon) { console.log('метка за горизонтом', s.id, mk.l, mk.t, '>', sc.horizon.toFixed(0)); bad++; }
  }
}
for (const k of Object.keys(PHASES)) if(!SITUATIONS.find(s=>s.id===k)) {console.log('лишние фазы',k);bad++}
/* Цикл: в каждом узле кривая проходит ровно через данные, а между узлами
   не выходит за пределы соседних значений — сплайн не должен рисовать пиков
   и провалов, которых нет в таблице. */
for (const e of cycleScenario().effects) {
  for (let d = 1; d <= CYCLE_DAYS; d++) {
    const v = levelAt(e, d);
    if (!Number.isFinite(v) || v <= 0 || Math.abs(v - e.days[d - 1]) > 1e-9) { console.log('цикл: узел', e.id, d, v); bad++; }
  }
  for (let t = 1; t < CYCLE_DAYS; t += 0.05) {
    const i = Math.floor(t - 1), a = e.days[i], b = e.days[Math.min(i + 1, CYCLE_DAYS - 1)];
    const v = levelAt(e, t);
    if (v < Math.min(a, b) - 1e-6 || v > Math.max(a, b) + 1e-6) { console.log('цикл: выброс сплайна', e.id, t.toFixed(2), v.toFixed(3)); bad++; break; }
  }
}
console.log(`проверено ${n} комбинаций · сценариев ${SITUATIONS.length} · проблем ${bad} · макс. амплитуда ${maxAmp.toFixed(1)}× (${maxWho})`);
