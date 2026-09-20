/* Профиль: пол и возрастная группа.
   amp — во сколько раз сильнее/слабее реагирует гормон,
   rec — во сколько раз дольше идёт возврат к норме,
   base — базовый фон относительно пикового значения в 20–25 лет. */

export const SEXES = [
  { id: 'm', title: 'Мужской', short: 'М' },
  { id: 'f', title: 'Женский', short: 'Ж' },
];

export const AGES = [
  { id: 'a18', title: '18–25', short: '18–25' },
  { id: 'a26', title: '26–34', short: '26–34' },
  { id: 'a35', title: '35 лет', short: '35' },
  { id: 'a36', title: '36–45', short: '36–45' },
  { id: 'a46', title: '46–60', short: '46–60' },
  { id: 'a60', title: '60+',   short: '60+' },
];

export const SEX_AMP = {
  m: {
    testosterone: 1.15, vasopressin: 1.2, oxytocin: 0.85, prolactin: 0.9,
    estradiol: 0.6, progesterone: 0.5, dopamine: 1.05, cortisol: 0.95,
  },
  f: {
    testosterone: 0.7, vasopressin: 0.8, oxytocin: 1.25, prolactin: 1.15,
    estradiol: 1.3, progesterone: 1.4, serotonin: 1.1, cortisol: 1.1,
  },
};

export const AGE_AMP = {
  a18: { rec: 0.85, h: { dopamine: 1.2, testosterone: 1.15, gh: 1.15, adrenaline: 1.1, melatonin: 1.15 } },
  a26: { rec: 1.0,  h: {} },
  a35: { rec: 1.08, h: { gh: 0.88, testosterone: 0.96, melatonin: 0.92, dhea: 0.92, dopamine: 0.97 } },
  a36: { rec: 1.15, h: { gh: 0.8, testosterone: 0.92, melatonin: 0.85, dhea: 0.85, dopamine: 0.95 } },
  a46: { rec: 1.35, h: { gh: 0.55, testosterone: 0.8, melatonin: 0.65, dhea: 0.65, estradiol: 0.7, progesterone: 0.6, dopamine: 0.9, thyroid: 0.95 } },
  a60: { rec: 1.6,  h: { gh: 0.35, testosterone: 0.68, melatonin: 0.45, dhea: 0.45, estradiol: 0.5, progesterone: 0.45, dopamine: 0.85, adrenaline: 0.9, thyroid: 0.9 } },
};

/* Базовый фон: доля от пикового уровня в молодости. */
const BASE = {
  m: {
    testosterone: { a18: 1.0, a26: 0.95, a35: 0.84, a35: 0.9, a36: 0.86, a46: 0.74, a60: 0.6 },
    gh:           { a18: 1.0, a26: 0.8, a35: 0.67, a35: 0.66,  a36: 0.55, a46: 0.35, a60: 0.2 },
    melatonin:    { a18: 1.0, a26: 0.85, a35: 0.77, a35: 0.77, a36: 0.7,  a46: 0.5,  a60: 0.3 },
    dhea:         { a18: 1.0, a26: 0.9, a35: 0.8, a35: 0.8,  a36: 0.72, a46: 0.52, a60: 0.35 },
    estradiol:    { a18: 1.0, a26: 1.0, a35: 0.96, a35: 1.01,  a36: 1.02, a46: 1.05, a60: 1.05 },
    progesterone: { a18: 1.0, a26: 1.0, a35: 0.88, a35: 0.97,  a36: 0.95, a46: 0.9,  a60: 0.85 },
    thyroid:      { a18: 1.0, a26: 1.0, a35: 0.98, a35: 0.99,  a36: 0.97, a46: 0.94, a60: 0.9 },
    cortisol:     { a18: 1.0, a26: 1.0, a35: 1.01, a35: 1.01,  a36: 1.03, a46: 1.08, a60: 1.15 },
  },
  f: {
    testosterone: { a18: 1.0, a26: 0.9,  a36: 0.78, a46: 0.6,  a60: 0.45 },
    estradiol:    { a18: 1.0, a26: 1.0,  a36: 0.92, a46: 0.45, a60: 0.12 },
    progesterone: { a18: 1.0, a26: 0.95, a36: 0.8,  a46: 0.3,  a60: 0.08 },
    gh:           { a18: 1.0, a26: 0.8,  a36: 0.55, a46: 0.33, a60: 0.18 },
    melatonin:    { a18: 1.0, a26: 0.85, a36: 0.7,  a46: 0.5,  a60: 0.3 },
    dhea:         { a18: 1.0, a26: 0.9,  a36: 0.7,  a46: 0.5,  a60: 0.33 },
    thyroid:      { a18: 1.0, a26: 1.0,  a36: 0.96, a46: 0.92, a60: 0.88 },
    cortisol:     { a18: 1.0, a26: 1.0,  a36: 1.03, a46: 1.1,  a60: 1.18 },
  },
};

const BASE_NOTE = {
  testosterone: 'Снижается примерно на 1% в год после 30 — медленно и у всех.',
  estradiol: 'У женщин обрушивается в перименопаузу, у мужчин медленно растёт с долей жировой ткани.',
  progesterone: 'Держится, пока есть овуляторные циклы, и исчезает после менопаузы.',
  gh: 'Падает быстрее всех гормонов: после 40 остаётся треть от юношеского уровня.',
  melatonin: 'С возрастом шишковидная железа кальцинируется — отсюда чуткий и короткий сон у пожилых.',
  dhea: 'Пик около 25 лет, дальше −2% в год. Буфер стресса с возрастом тоньше.',
  thyroid: 'Почти не меняется; заметные отклонения — повод проверить щитовидную железу.',
  cortisol: 'Базовый уровень с возрастом слегка растёт, а суточный размах сглаживается.',
};

export function profileFactors(sexId, ageId) {
  const age = AGE_AMP[ageId] || AGE_AMP.a26;
  const sex = SEX_AMP[sexId] || SEX_AMP.m;
  return {
    rec: age.rec,
    amp: (hid) => (sex[hid] || 1) * (age.h[hid] || 1),
  };
}

export function baseline(sexId, ageId, hid) {
  const table = BASE[sexId] && BASE[sexId][hid];
  if (!table) return null;
  return { value: table[ageId], note: BASE_NOTE[hid] };
}
