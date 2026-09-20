/* Модель динамики: подъём к пику, спад, при необходимости — фаза отката.
   Все времена в минутах от момента события. */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (u) => u * u * (3 - 2 * u);

/* Профиль сдвигает амплитуду отклонения и растягивает возврат к норме. */
export function resolveEffect(eff, sexId, factors) {
  const amp = factors.amp(eff.h);
  const rawPeak = (sexId === 'f' && eff.pf != null) ? eff.pf
    : (sexId === 'm' && eff.pm != null) ? eff.pm
    : (eff.p != null ? eff.p : (eff.pm != null ? eff.pm : eff.pf));
  const scale = (v) => clamp(1 + (v - 1) * amp, 0.05, 30);

  const peak = scale(rawPeak);
  const tRise = Math.max(1, eff.r);
  const hasReb = eff.rb != null && eff.rt != null;
  const reb = hasReb ? scale(eff.rb) : null;
  const tReb = hasReb ? Math.max(tRise + 1, eff.rt) : null;
  const tail = eff.n * factors.rec;
  const tEnd = (hasReb ? tReb : tRise) + tail;

  return { id: eff.h, note: eff.note, peak, tRise, reb, tReb, tEnd, hasReb };
}

export function levelAt(e, t) {
  if (t <= 0) return 1;
  if (t < e.tRise) return 1 + (e.peak - 1) * smooth(t / e.tRise);
  if (e.hasReb) {
    if (t < e.tReb) {
      const u = smooth((t - e.tRise) / (e.tReb - e.tRise));
      return e.peak + (e.reb - e.peak) * u;
    }
    const u = clamp((t - e.tReb) / (e.tEnd - e.tReb), 0, 1);
    return 1 + (e.reb - 1) * Math.pow(1 - u, 1.7);
  }
  const u = clamp((t - e.tRise) / (e.tEnd - e.tRise), 0, 1);
  return 1 + (e.peak - 1) * Math.pow(1 - u, 2);
}

/* Насколько сильно гормон отклоняется за весь сценарий — для сортировки. */
export function amplitude(e) {
  return Math.abs(Math.log2(extreme(e)));
}

/* Самое сильное отклонение за сценарий — пик или фаза отката. */
export function extreme(e) {
  if (!e.hasReb) return e.peak;
  return Math.abs(Math.log2(e.reb)) > Math.abs(Math.log2(e.peak)) ? e.reb : e.peak;
}

export function buildScenario(situation, sexId, factors) {
  const effects = situation.effects
    .map(eff => resolveEffect(eff, sexId, factors))
    .sort((a, b) => amplitude(b) - amplitude(a));
  const horizon = Math.max(...effects.map(e => e.tEnd));
  const slowest = effects.reduce((a, b) => (b.tEnd > a.tEnd ? b : a));
  return { effects, byId: Object.fromEntries(effects.map(e => [e.id, e])), horizon, slowest };
}

/* Момент, когда система отклонена сильнее всего — стартовая точка по умолчанию. */
export function peakMoment(scenario) {
  let best = 0, bestScore = -1;
  const H = scenario.horizon;
  for (let i = 0; i <= 240; i++) {
    const t = invLog(i / 240, H);
    let score = 0;
    for (const e of scenario.effects) score += Math.abs(Math.log2(levelAt(e, t)));
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

/* Логарифмическая шкала времени: минуты и месяцы на одной оси. */
export const toLog = (t, H) => Math.log1p(Math.max(0, t)) / Math.log1p(H);
export const invLog = (u, H) => Math.expm1(clamp(u, 0, 1) * Math.log1p(H));

const MIN = 1, HOUR = 60, DAY = 1440, WEEK = 10080, MONTH = 43200, YEAR = 525600;

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function formatDuration(m) {
  if (m < 1) return 'мгновенно';
  if (m < 90) { const v = Math.round(m); return v + ' ' + plural(v, 'минута', 'минуты', 'минут'); }
  if (m < 48 * HOUR) { const v = Math.round(m / HOUR); return v + ' ' + plural(v, 'час', 'часа', 'часов'); }
  if (m < 12 * DAY) { const v = Math.round(m / DAY); return v + ' ' + plural(v, 'день', 'дня', 'дней'); }
  if (m < 8 * WEEK) { const v = Math.round(m / WEEK); return v + ' ' + plural(v, 'неделя', 'недели', 'недель'); }
  if (m < 18 * MONTH) { const v = Math.round(m / MONTH); return v + ' ' + plural(v, 'месяц', 'месяца', 'месяцев'); }
  const v = Math.round(m / YEAR * 10) / 10;
  return String(v).replace('.', ',') + ' ' + plural(Math.round(v), 'год', 'года', 'лет');
}

/* Короткая подпись для оси и таймера. */
export function formatClock(m) {
  if (m < 1) return '0';
  if (m < 60) return Math.round(m) + ' мин';
  if (m < 48 * HOUR) {
    const h = m / HOUR;
    return (h < 10 ? Math.round(h * 10) / 10 : Math.round(h)).toString().replace('.', ',') + ' ч';
  }
  if (m < 14 * DAY) return Math.round(m / DAY) + ' дн';
  if (m < 10 * WEEK) return Math.round(m / WEEK) + ' нед';
  if (m < 18 * MONTH) return Math.round(m / MONTH) + ' мес';
  return (Math.round(m / YEAR * 10) / 10).toString().replace('.', ',') + ' г';
}

export const TICKS = [
  1, 5, 15, 30, HOUR, 2 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 3 * DAY, WEEK, 2 * WEEK, MONTH, 3 * MONTH, 6 * MONTH, YEAR,
];

export function formatDelta(level) {
  const pct = (level - 1) * 100;
  if (Math.abs(pct) < 3) return 'норма';
  const sign = pct > 0 ? '+' : '−';
  const v = Math.abs(pct);
  return sign + (v >= 100 ? Math.round(v / 10) * 10 : Math.round(v)) + '%';
}
