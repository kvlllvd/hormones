/* Браузерный регресс: раскладка на восьми ширинах, график по всем сценариям,
   поведение навигации и органы управления. Playwright в окружении нет, поэтому
   стенд ходит в headless Chrome напрямую по CDP (tools/cdp.mjs).

   Как запускать (из корня проекта, двумя терминалами или в фоне):
     python3 -m http.server 8777
     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
       --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/hormones-chrome
     node tools/regress.mjs

   Грабли стенда, на которые уже наступали (см. журнал) и которые здесь закрыты:
   переходы и анимации в headless не проигрываются — они гасятся, иначе замер
   попадает в первый кадр; кеш отключён, иначе правка «не действует»; прокрутка
   сбрасывается вручную, иначе Chrome возвращает прежнюю; сценарии переключаются
   хешем, а не кликом по меню — открытие меню блокирует прокрутку, полоса
   исчезает и вьюпорт становится шире; закрытая панель навигации стоит за правым
   краем намеренно и в переполнение не считается. */
import { connect } from './cdp.mjs';
import { SITUATIONS } from '../js/situations.js';

const BASE = process.env.URL || 'http://localhost:8777/index.html';
const URL = BASE;

async function suiteLayout(p) {
  const out = [];
  const bad = (...a) => out.push('✗ ' + a.join(' '));
  const ok = (...a) => out.push('· ' + a.join(' '));

  for (const [w, h, mob] of [[1440, 900, false], [1280, 900, false], [1024, 800, false], [860, 800, false], [720, 800, true], [390, 844, true], [360, 780, true], [320, 700, true]]) {
    await p.viewport(w, h, mob);
    p.errors.length = 0;
    await p.goto(URL + '#love');
    /* Chrome возвращает прежнюю прокрутку при переходе на тот же адрес —
       для замера «страница наверху» её надо сбросить руками. */
    await p.eval(`(() => { history.scrollRestoration = 'manual'; window.scrollTo(0, 0);
      window.dispatchEvent(new Event('scroll')); return 1; })()`);
    await p.eval('new Promise(r=>setTimeout(r,250))');
    const r = await p.eval(`(() => {
      const d = document.documentElement;
      return {
        iw: innerWidth, sw: d.scrollWidth, cw: d.clientWidth,
        wide: [...document.querySelectorAll('body *')].filter(e => {
          /* закрытая панель навигации стоит за правым краем намеренно */
          if (e.closest('.picker:not(.is-open)') || e.closest('[hidden]')) return false;
          const b = e.getBoundingClientRect();
          return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1);
        }).slice(0,8).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().left) + '..' + Math.round(e.getBoundingClientRect().right)),
        topbarVar: getComputedStyle(d).getPropertyValue('--topbar-h').trim(),
        topbarReal: document.querySelector('.topbar').offsetHeight,
        isTop: document.querySelector('.topbar').classList.contains('is-top'),
        chips: document.getElementById('chips').children.length,
        cats: document.getElementById('cats').children.length,
        profileHost: document.getElementById('profile').parentElement.id,
        sitName: document.getElementById('sitName').textContent,
      };
    })()`);
    const tag = `${w}px`;
    if (r.sw > r.iw + 1) bad(tag, 'горизонтальное переполнение', r.sw, '>', r.iw);
    if (r.wide.length) bad(tag, 'за краем:', JSON.stringify(r.wide));
    if (parseInt(r.topbarVar) !== r.topbarReal) bad(tag, '--topbar-h', r.topbarVar, '≠ реальной', r.topbarReal);
    if (!r.isTop) bad(tag, 'нет is-top наверху страницы');
    const wantHost = w <= 720 ? 'picker' : 'footRow';
    if (r.profileHost !== wantHost) bad(tag, 'профиль в', r.profileHost, 'вместо', wantHost);
    /* выпадающее меню профиля не должно вылезать за страницу ни на одной ширине */
    const pop = await p.eval(`(() => {
      /* на узком экране кнопка живёт в выдвижной панели — её надо открыть */
      if (matchMedia('(max-width: 720px)').matches) document.getElementById('burgerBtn').click();
      else document.getElementById('navProfile').scrollIntoView({ block: 'center' });
      document.getElementById('navProfile').click();
      const b = document.getElementById('profilePop').getBoundingClientRect();
      const box = [Math.round(b.left), Math.round(b.right)];
      document.getElementById('navProfile').click();
      if (matchMedia('(max-width: 720px)').matches) document.getElementById('navClose').click();
      return { box, out: b.right > innerWidth + 1 || b.left < -1, iw: innerWidth };
    })()`);
    if (pop.out) bad(tag, 'меню профиля за краем', JSON.stringify(pop.box), 'при ширине', pop.iw);
    if (p.errors.length) bad(tag, 'ошибки:', p.errors.join(' | '));
    ok(tag, `шапка ${r.topbarReal}px · разделов ${r.cats} · чипов ${r.chips} · профиль в #${r.profileHost}`);
  }
  return out.filter(l => l.startsWith('✗'));
}

async function suiteChart(p) {
  /* Прогон всех сценариев на двух ширинах: ошибки, вылет меток и подписи
     за поле графика, наложение подписи на точку плейхеда, полнота блоков. */
  const problems = [];
  const stat = {};

  const PROBE = `(() => {
    const chart = document.getElementById('chart');
    const cb = chart.getBoundingClientRect();
    const svg = chart.querySelector('svg');
    if (!svg) return { fail: 'нет svg' };
    const texts = [...svg.querySelectorAll('text')];
    const label = texts.find(t => t.getAttribute('font-size') === '11.5');
    const marks = texts.filter(t => t.getAttribute('font-size') === '9');
    const box = (el) => { const b = el.getBoundingClientRect(); return { l: b.left - cb.left, r: b.right - cb.left, t: b.top - cb.top, b: b.bottom - cb.top }; };
    const dots = [...svg.querySelectorAll('circle')].filter(c => +c.getAttribute('r') >= 3)
      .map(c => ({ x: +c.getAttribute('cx'), y: +c.getAttribute('cy'), r: +c.getAttribute('r') }));
    const W = cb.width, PADR = 10, PADL = 36;
    const outMarks = marks.filter(m => { const b = box(m); return b.r > W - PADR + 0.5 || b.l < PADL - 0.5; }).map(m => m.textContent);
    let labelOut = null, labelHit = null;
    if (label) {
      const b = box(label);
      if (b.r > W - PADR + 0.5 || b.l < PADL - 0.5) labelOut = label.textContent + ' [' + Math.round(b.l) + '..' + Math.round(b.r) + '] поле ' + PADL + '..' + Math.round(W - PADR);
      for (const d of dots) {
        if (d.x + d.r > b.l - 1 && d.x - d.r < b.r + 1 && d.y + d.r > b.t - 1 && d.y - d.r < b.b + 1) { labelHit = label.textContent; break; }
      }
    }
    const de = document.documentElement;
    return {
      outMarks, labelOut, labelHit, marks: marks.length,
      overflow: de.scrollWidth > innerWidth + 1 ? de.scrollWidth + '>' + innerWidth : null,
      timing: (document.getElementById('timingText').textContent || '').trim().length,
      source: (document.getElementById('sourceText').textContent || '').trim().length,
      stats: document.getElementById('stats').children.length,
      recovery: document.getElementById('recoveryList').children.length,
      hormones: document.getElementById('hormones').children.length,
      dose: document.getElementById('dose').hidden ? '' : document.getElementById('dose').textContent,
      name: document.getElementById('sitName').textContent,
      tip: !document.getElementById('chartTip').hidden,
    };
  })()`;

  for (const [w, h, mob] of [[1280, 900, false], [390, 844, true], [320, 700, true]]) {
    await p.viewport(w, h, mob);
    await p.goto(BASE + '?p=m-a26#love');
    const key = w + 'px';
    stat[key] = { marks: 0, outMarks: 0, labelOut: 0, labelHit: 0 };
    for (const s of SITUATIONS) {
      await p.eval(`location.hash = '#${s.id}'`);
      await p.wait(90);
      let r;
      try { r = await p.eval(PROBE); } catch (e) { problems.push(`${key} ${s.id}: ${e.message}`); continue; }
      if (r.fail) { problems.push(`${key} ${s.id}: ${r.fail}`); continue; }
      if (r.name !== s.name) problems.push(`${key} ${s.id}: заголовок «${r.name}» вместо «${s.name}»`);
      if (r.overflow) problems.push(`${key} ${s.id}: переполнение ${r.overflow}`);
      if (!r.timing) problems.push(`${key} ${s.id}: пустая рекомендация`);
      if (!r.source) problems.push(`${key} ${s.id}: не сказано, откуда данные`);
      if (r.stats !== 3) problems.push(`${key} ${s.id}: плашек показателей ${r.stats}`);
      if (!r.recovery) problems.push(`${key} ${s.id}: пустой список возврата`);
      if (!r.hormones) problems.push(`${key} ${s.id}: пустой список гормонов`);
      stat[key].marks += r.marks;
      if (r.outMarks.length) { stat[key].outMarks += r.outMarks.length; problems.push(`${key} ${s.id}: метка за полем — ${r.outMarks.join(', ')}`); }
      if (r.labelOut) { stat[key].labelOut++; problems.push(`${key} ${s.id}: подпись кривой за полем — ${r.labelOut}`); }
      if (r.labelHit) { stat[key].labelHit++; problems.push(`${key} ${s.id}: подпись накрывает точку — ${r.labelHit}`); }
      if (p.errors.length) { problems.push(`${key} ${s.id}: ${p.errors.join(' | ')}`); p.errors.length = 0; }
    }
  }
  console.log('  метки и подписи:', JSON.stringify(stat));
  return problems.map(x => '✗ ' + x);
}

async function suiteBehaviour(p) {
  /* Поведение и навигация: шапка, меню, профиль, окно гормона, подсказка,
     блокировка прокрутки, диплинки, онбординг, типографика. */
  const bad = [];
  const note = [];
  const check = (cond, msg) => { if (!cond) bad.push('✗ ' + msg); };

  /* Переход на тот же адрес Chrome делает внутри документа: скрипты заново
     не выполняются, и подготовленный localStorage «не действует». Поэтому
     второй заход всегда с новым параметром — иначе он ничего не перечитает. */
  let visit = 0;
  const again = (url) => url.replace('#', `${url.includes('?') ? '&' : '?'}v=${++visit}#`);
  const fresh = async (w, h, mob, url = BASE + '?p=m-a26#love') => {
    await p.viewport(w, h, mob);
    await p.goto(url);
    await p.eval(`(() => { try { localStorage.setItem('hormones.menuseen.v1','1'); } catch {} return 1; })()`);
    await p.goto(again(url));
  };

  /* ── десктоп ─────────────────────────────────────────── */
  await fresh(1280, 900, false);

  let r = await p.eval(`(() => {
    const bar = document.querySelector('.topbar');
    const cs = (el, pr) => getComputedStyle(el).getPropertyValue(pr);
    const cat = document.querySelector('.cat'), catOn = document.querySelector('.cat[aria-selected="true"]');
    const chip = document.querySelector('.chip'), chipOn = document.querySelector('.chip[aria-selected="true"]');
    const chips = document.getElementById('chips'), hero = document.querySelector('.hero');
    return {
      isTop: bar.classList.contains('is-top'),
      chipShown: getComputedStyle(document.getElementById('sectChip')).opacity,
      catSize: cs(cat, 'font-size'), catOnSize: cs(catOn, 'font-size'),
      catWeight: cs(catOn.getAttribute('aria-selected') === 'true' ? catOn : cat, 'font-weight'),
      catOffWeight: cs([...document.querySelectorAll('.cat')].find(c => c.getAttribute('aria-selected') !== 'true'), 'font-weight'),
      chipSize: cs(chip, 'font-size'),
      chipOnBg: cs(chipOn, 'background-color'),
      chipOffBg: cs([...document.querySelectorAll('.chip')].find(c => c.getAttribute('aria-selected') !== 'true'), 'background-color'),
      gapChipsToTitle: Math.round(document.getElementById('sitName').getBoundingClientRect().top - chips.getBoundingClientRect().bottom),
      eyebrow: cs(document.getElementById('sitTag'), 'display'),
      themeHost: document.getElementById('themeBtn').parentElement.className,
      themeShown: cs(document.getElementById('themeBtn'), 'opacity'),
      profileHost: document.getElementById('profile').parentElement.id,
      popHidden: document.getElementById('profilePop').hidden,
      iconbtn: [...document.querySelectorAll('.iconbtn')].map(b => Math.round(b.offsetWidth)),
      iconbtnPad: getComputedStyle(document.querySelector('.iconbtn'), '::after').inset,
      labels: { timing: document.getElementById('timingMore').textContent, foot: document.getElementById('footMore').textContent },
      english: document.body.innerText.match(/\\b(More|Less)\\b/g),
      playBtn: !!document.querySelector('.play, #playBtn'),
    };
  })()`);
  check(r.isTop, 'нет is-top на неотскролленной странице');
  check(r.chipShown === '0', 'чип раздела виден до скролла (opacity ' + r.chipShown + ')');
  check(r.catSize === '13px' && r.chipSize === '13px', `разделы/чипы не по 13px: ${r.catSize} / ${r.chipSize}`);
  check(r.catWeight === '600', 'выбранный раздел не полужирный: ' + r.catWeight);
  check(r.catOffWeight === '400', 'невыбранный раздел не обычный: ' + r.catOffWeight);
  check(r.chipOnBg !== r.chipOffBg, 'выбранный чип не отличается заливкой: ' + r.chipOnBg);
  check(r.gapChipsToTitle === 86, `отступ чипы→заголовок ${r.gapChipsToTitle}px вместо 86`);
  check(r.eyebrow === 'none', 'десктоп: раздел над заголовком дублирует навигацию (display ' + r.eyebrow + ')');
  check(/topbar/.test(r.themeHost), 'десктоп: знак темы не в шапке, а в ' + r.themeHost);
  check(r.themeShown === '1', 'десктоп: знак темы не виден до скролла');
  check(r.profileHost === 'footRow', 'профиль не в подвале: ' + r.profileHost);
  check(Object.values(r.labels).every(v => v === 'Ещё'), 'подписи кнопок: ' + JSON.stringify(r.labels));
  check(!r.english, 'английские слова на странице: ' + r.english);
  check(!r.playBtn, 'кнопка проигрывания на месте');
  note.push('десктоп: шапка/типографика сняты');

  /* выпадающее меню профиля: раскрывается вверх, не вылезает */
  r = await p.eval(`(() => {
    document.getElementById('footRow').scrollIntoView({ block: 'center' });
    document.getElementById('navProfile').click();
    const pop = document.getElementById('profilePop'), btn = document.getElementById('navProfile');
    const pb = pop.getBoundingClientRect(), bb = btn.getBoundingClientRect();
    return { hidden: pop.hidden, up: pb.bottom <= bb.top + 2, inView: pb.top >= 0 && pb.left >= 0 && pb.right <= innerWidth,
      expanded: btn.getAttribute('aria-expanded'), opts: pop.querySelectorAll('.profile-opt').length };
  })()`);
  check(!r.hidden && r.expanded === 'true', 'меню профиля не открылось');
  check(r.up, 'меню профиля раскрылось вниз, а не вверх');
  check(r.inView, 'меню профиля вылезает за экран');
  check(r.opts === 7, 'в меню профиля ' + r.opts + ' плашек вместо 7');

  /* выбор применяется сразу, без подтверждения */
  r = await p.eval(`(() => {
    const opt = [...document.querySelectorAll('#popAge .profile-opt')].find(b => b.textContent === '46–60');
    opt.click();
    const saved = JSON.parse(localStorage.getItem('hormones.profile.v1') || '{}');
    return { closed: document.getElementById('profilePop').hidden, label: document.getElementById('navProfileText').textContent, saved };
  })()`);
  check(r.closed, 'меню профиля не закрылось после выбора');
  check(r.label === 'М · 46–60', 'подпись профиля «' + r.label + '»');
  check(r.saved.age === 'a46', 'профиль не сохранился: ' + JSON.stringify(r.saved));

  /* скролл: чип появляется, is-top снимается, логотип-стрелка */
  r = await p.eval(`(() => {
    window.scrollTo(0, 600); document.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    const bar = document.querySelector('.topbar');
    return { isTop: bar.classList.contains('is-top'), scrolled: bar.classList.contains('is-scrolled'),
      chip: getComputedStyle(document.getElementById('sectChip')).opacity,
      theme: getComputedStyle(document.getElementById('themeBtn')).opacity,
      chipText: document.getElementById('sectChipText').textContent };
  })()`);
  check(!r.isTop, 'is-top остался после скролла');
  check(r.scrolled, 'нет is-scrolled после скролла');
  check(r.chip === '1', 'чип раздела не появился при скролле (opacity ' + r.chip + ')');
  check(r.theme === '0', 'десктоп: знак темы не уступил угол чипу при скролле (opacity ' + r.theme + ')');

  /* тема: клик по солнцу делает страницу тёмной, выбор запоминается,
     при скролле знак уступает угол чипу раздела */
  r = await p.eval(`(() => {
    const de = document.documentElement, btn = document.getElementById('themeBtn');
    /* Профиль Chrome живёт между прогонами, и тема в нём могла остаться
       тёмной с прошлого раза — тогда первый клик вёл бы в светлую, и
       проверка падала бы на ровном месте. Начинаем всегда со светлой. */
    if (de.dataset.theme === 'dark') btn.click();
    const was = de.dataset.theme;
    btn.click();
    const dark = { theme: de.dataset.theme, pressed: btn.getAttribute('aria-pressed'),
      saved: localStorage.getItem('hormones.theme.v1'),
      bg: getComputedStyle(document.body).backgroundColor,
      sun: getComputedStyle(document.querySelector('.theme-sun')).display,
      moon: getComputedStyle(document.querySelector('.theme-moon')).display };
    btn.click();
    const light = { theme: de.dataset.theme, saved: localStorage.getItem('hormones.theme.v1'),
      sun: getComputedStyle(document.querySelector('.theme-sun')).display };
    return { was, dark, light };
  })()`);
  check(r.dark.theme === 'dark' && r.dark.pressed === 'true', 'клик по солнцу не включил тёмную тему: ' + JSON.stringify(r.dark));
  check(r.dark.saved === 'dark' && r.light.saved === 'light', 'выбор темы не запомнился: ' + r.dark.saved + ' / ' + r.light.saved);
  check(r.dark.bg !== 'rgb(244, 244, 241)', 'тёмная тема не поменяла фон страницы: ' + r.dark.bg);
  check(r.dark.sun === 'none' && r.dark.moon !== 'none', 'в тёмной теме не появилась луна: ' + JSON.stringify([r.dark.sun, r.dark.moon]));
  check(r.light.sun !== 'none', 'в светлой теме пропало солнце');

  /* окно гормона: открытие, пин, крестик, защита от пина закрытого окна */
  r = await p.eval(`(() => {
    const card = document.querySelector('.hcard');
    const det = document.getElementById('detail'), pin = document.getElementById('detailPin');
    card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));       // наведение
    const hover = { hidden: det.hidden, pressed: pin.getAttribute('aria-pressed') };
    pin.click();                                                               // закрепили
    const pinnedOn = pin.getAttribute('aria-pressed');
    card.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    const staysOpen = !det.hidden;
    pin.click();                                                               // открепили
    const pinnedOff = { pressed: pin.getAttribute('aria-pressed'), hidden: det.hidden };
    card.click();                                                              // клик по плашке
    const byCard = { hidden: det.hidden, pressed: pin.getAttribute('aria-pressed') };
    document.getElementById('detailClose').click();
    const closed = det.hidden;
    pin.click();                                                               // пин закрытого окна
    return { hover, pinnedOn, staysOpen, pinnedOff, byCard, closed,
      ghost: { hidden: det.hidden, pressed: pin.getAttribute('aria-pressed') } };
  })()`);
  check(!r.hover.hidden, 'окно гормона не открылось по наведению');
  check(r.hover.pressed === 'false', 'окно по наведению сразу закреплено');
  check(r.pinnedOn === 'true', 'кнопка «закрепить» не включилась');
  check(r.staysOpen, 'закреплённое окно закрылось, когда курсор ушёл');
  check(r.pinnedOff.pressed === 'false', 'повторный клик не открепил окно');
  check(r.byCard.hidden === false && r.byCard.pressed === 'true', 'клик по плашке не закрепил окно');
  check(r.closed, 'окно гормона не закрылось крестиком');
  check(r.ghost.pressed !== 'true' && r.ghost.hidden, 'закрытое окно удалось «закрепить»');

  /* подсказка на графике считает время под курсором, а не у плейхеда */
  r = await p.eval(`(() => {
    const chart = document.getElementById('chart'), cb = chart.getBoundingClientRect();
    const wrap = document.querySelector('.chart-wrap');
    const at = (frac) => {
      const x = cb.left + 36 + (cb.width - 46) * frac;
      wrap.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: cb.top + cb.height / 2, pointerId: 1 }));
      return document.getElementById('tipBody').textContent.trim().slice(0, 40);
    };
    const a = at(0.05), b = at(0.9);
    return { a, b, differs: a !== b, shown: !document.getElementById('chartTip').hidden };
  })()`);
  check(r.shown, 'подсказка не показалась при наведении');
  check(r.differs, `подсказка одинаковая в начале и в конце оси: «${r.a}»`);

  /* диплинк со старой ступенью a35 */
  await p.goto(BASE + '?p=f-a35#breakup');
  r = await p.eval(`(() => ({ label: document.getElementById('navProfileText').textContent, sit: document.getElementById('sitName').textContent, saved: JSON.parse(localStorage.getItem('hormones.profile.v1')||'{}') }))()`);
  check(r.label === 'Ж · 26–35', 'старая ссылка a35 потеряла профиль: ' + r.label);
  check(r.sit === 'Расставание', 'диплинк не открыл сценарий: ' + r.sit);

  /* ── телефон ─────────────────────────────────────────── */
  await fresh(390, 844, true);
  r = await p.eval(`(() => {
    const cs = (el, pr) => getComputedStyle(el).getPropertyValue(pr);
    document.getElementById('burgerBtn').click();
    const picker = document.getElementById('picker');
    const pb = picker.getBoundingClientRect();
    const cat = document.querySelector('.cat');
    const sep = document.querySelector('.chip-sub');
    const chips = document.getElementById('chips');
    return {
      open: picker.classList.contains('is-open'),
      inView: pb.left >= -1 && pb.right <= innerWidth + 1,
      locked: document.body.classList.contains('is-locked'),
      catSize: cs(cat, 'font-size'),
      profileHost: document.getElementById('profile').parentElement.id,
      profileLabelShown: cs(document.querySelector('.nav-profile-label'), 'display'),
      gapCatsToChips: Math.round(chips.getBoundingClientRect().top - document.getElementById('cats').getBoundingClientRect().bottom),
      sepMargins: sep ? [cs(sep, 'margin-top'), cs(sep, 'margin-bottom')] : null,
      themeHost: document.getElementById('themeBtn').parentElement.className,
      themeBeforeClose: document.getElementById('themeBtn').nextElementSibling === document.getElementById('navClose'),
      eyebrow: cs(document.getElementById('sitTag'), 'display'),
    };
  })()`);
  check(r.open, 'меню не открылось по бургеру');
  check(r.inView, 'панель меню вылезает за экран');
  check(r.locked, 'прокрутка страницы не заблокирована при открытом меню');
  check(r.catSize === '13px', 'разделы в меню не 13px: ' + r.catSize);
  check(r.profileHost === 'picker', 'профиль не в панели: ' + r.profileHost);
  check(r.profileLabelShown !== 'none', 'в панели скрыта подпись «Пол и возраст»');
  check(r.themeHost === 'nav-top', 'телефон: знак темы не в шапке меню, а в ' + r.themeHost);
  check(r.themeBeforeClose, 'телефон: знак темы стоит не рядом с крестиком');
  check(r.eyebrow !== 'none', 'телефон: пропал раздел над заголовком');

  /* знак темы и крестик — пара: сравниваем чернила, а не коробки.
     Коробки совпадали и тогда, когда знак визуально уезжал вверх. */
  r = await p.eval(`(() => {
    const ink = (el) => { const b = el.getBoundingClientRect(); return +(b.top + b.height / 2).toFixed(2); };
    const vis = [...document.querySelectorAll('.nav-top .theme svg')].find(s => getComputedStyle(s).display !== 'none');
    const cross = document.querySelector('#navClose .x path');
    const glyph = (sel) => ink(document.querySelector(sel));
    const sun = ink(vis.querySelector('path'));
    document.getElementById('themeBtn').click();
    const vis2 = [...document.querySelectorAll('.nav-top .theme svg')].find(s => getComputedStyle(s).display !== 'none');
    const moon = ink(vis2.querySelector('path'));
    document.getElementById('themeBtn').click();
    return { sun, moon, cross: ink(cross), text: [...document.querySelectorAll('.iconbtn, .ob-close, .tip-close')].filter(b => b.textContent.trim()).length };
  })()`);
  check(Math.abs(r.sun - r.cross) <= 0.5, `солнце не на уровне крестика: ${r.sun} против ${r.cross}`);
  check(Math.abs(r.moon - r.cross) <= 0.5, `луна не на уровне крестика: ${r.moon} против ${r.cross}`);
  check(!r.text, 'крестик снова нарисован знаком, а не вектором: таких кнопок ' + r.text);

  /* крестик меню ровно на оси бургера, по обеим осям */
  r = await p.eval(`(() => {
    const c = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]; };
    const burger = c(document.getElementById('burgerBtn'));
    const close = c(document.getElementById('navClose'));
    const wordmark = document.querySelector('.wordmark').getBoundingClientRect();
    const title = document.querySelector('.nav-title').getBoundingClientRect();
    return { burger, close, dx: Math.abs(burger[0] - close[0]), dy: Math.abs(burger[1] - close[1]),
      titleDy: Math.abs(Math.round(wordmark.top + wordmark.height/2) - Math.round(title.top + title.height/2)) };
  })()`);
  check(r.dx <= 1 && r.dy <= 1, `крестик меню не на оси бургера: ${JSON.stringify(r.burger)} против ${JSON.stringify(r.close)}`);
  check(r.titleDy <= 2, `«Разделы» не на уровне логотипа: расхождение ${r.titleDy}px`);

  /* закрытие меню возвращает прокрутку */
  r = await p.eval(`(() => {
    document.getElementById('navClose').click();
    return { open: document.getElementById('picker').classList.contains('is-open'), locked: document.body.classList.contains('is-locked') };
  })()`);
  check(!r.open && !r.locked, 'меню не закрылось или прокрутка осталась заблокированной');

  /* телефон: при скролле бургер уступает место чипу, логотип остаётся */
  r = await p.eval(`(() => {
    window.scrollTo(0, 700); window.dispatchEvent(new Event('scroll'));
    const cs = (el) => getComputedStyle(el);
    const burger = document.getElementById('burgerBtn'), chip = document.getElementById('sectChip');
    const wm = document.querySelector('.wordmark-mark');
    return { burger: cs(burger).display, burgerOpacity: cs(burger).opacity, chipOpacity: cs(chip).opacity,
      chipRight: Math.round(innerWidth - chip.getBoundingClientRect().right),
      logo: cs(wm).display, scrolled: document.querySelector('.topbar').classList.contains('is-scrolled') };
  })()`);
  check(r.scrolled, 'телефон: нет is-scrolled');
  check(r.burger === 'none' || r.burgerOpacity === '0', 'телефон: бургер не уступил место чипу (display ' + r.burger + ', opacity ' + r.burgerOpacity + ')');
  check(r.chipOpacity === '1', 'телефон: чип раздела не появился');
  check(r.logo !== 'none', 'телефон: логотип пропал при скролле');

  /* шит гормона: вложенная блокировка прокрутки */
  r = await p.eval(`(() => {
    const y0 = window.scrollY;
    document.querySelector('.hcard').click();
    const one = document.body.classList.contains('is-locked');
    document.querySelector('.hcard').click();   // второй шит поверх первого
    document.getElementById('detailClose').click();
    const still = document.body.classList.contains('is-locked');
    document.getElementById('detailClose').click();
    const freed = !document.body.classList.contains('is-locked');
    return { one, still, freed, y0, y: window.scrollY };
  })()`);
  check(r.one, 'шит не заблокировал прокрутку');
  check(r.freed, 'после закрытия шита прокрутка осталась заблокированной');
  check(Math.abs(r.y - r.y0) <= 2, `после шита прокрутка уехала: ${r.y0} → ${r.y}`);

  /* первый заход на телефоне: онбординга нет, панель показывается сама */
  await p.viewport(390, 844, true);
  await p.goto(BASE);
  await p.eval(`(() => { try { localStorage.clear(); } catch {} return 1; })()`);
  await p.goto(BASE);
  r = await p.eval(`(() => ({ onboarding: !document.getElementById('onboarding').hidden, navOpen: document.getElementById('picker').classList.contains('is-open'), hint: !document.getElementById('navHint').hidden }))()`);
  check(!r.onboarding, 'телефон: онбординг показан');
  check(r.navOpen && r.hint, 'телефон: подсказка про меню не показалась на первом заходе');

  /* первый заход на десктопе: ничего не выбрано заранее */
  await p.viewport(1280, 900, false);
  await p.goto(BASE);
  await p.eval(`(() => { try { localStorage.clear(); } catch {} return 1; })()`);
  await p.goto(BASE);
  r = await p.eval(`(() => ({ shown: !document.getElementById('onboarding').hidden,
    checked: [...document.querySelectorAll('.ob-opt')].filter(b => b.getAttribute('aria-checked') === 'true').length,
    disabled: document.getElementById('obSubmit').disabled,
    closeHidden: document.getElementById('obClose').hidden }))()`);
  check(r.shown, 'десктоп: онбординг не показан на первом заходе');
  check(r.checked === 0, 'десктоп: на первом заходе что-то выбрано заранее (' + r.checked + ')');
  check(r.disabled, 'десктоп: кнопка активна до выбора');
  check(r.closeHidden, 'десктоп: крестик онбординга виден на первом заходе');

  if (p.errors.length) bad.push('✗ ошибки в консоли: ' + p.errors.join(' | '));
  return bad;
}

async function suiteControls(p) {
  /* Органы управления: ползунок, сброс, «Ещё», сравнение полов, режимы списка,
     подсказка, логотип-стрелка, Escape, полоса прокрутки в окне гормона. */
  const bad = [];
  const check = (c, m) => { if (!c) bad.push('✗ ' + m); };

  await p.viewport(1280, 900, false);
  await p.goto(BASE + '?p=m-a26#love');

  /* ползунок и сброс */
  let r = await p.eval(`(() => {
    const sc = document.getElementById('scrub');
    const before = document.getElementById('timeValue').textContent;
    const scrub0 = sc.value;
    sc.value = 1000; sc.dispatchEvent(new Event('input', { bubbles: true }));
    const atEnd = document.getElementById('timeValue').textContent;
    document.getElementById('resetBtn').click();
    const afterReset = { time: document.getElementById('timeValue').textContent, scrub: sc.value };
    return { before, atEnd, afterReset, scrub0, title: document.getElementById('resetBtn').title };
  })()`);
  check(r.atEnd !== r.before, 'ползунок не двигает время');
  check(r.afterReset.time === r.before && r.afterReset.scrub === r.scrub0, 'сброс не вернул график в исходное положение: ' + JSON.stringify(r));
  check(!/начал/.test(r.title), 'подпись кнопки сброса обещает не то, что она делает: ' + r.title);

  /* «Ещё» / «Скрыть» */
  r = await p.eval(`(() => {
    const btn = document.getElementById('footMore'), box = document.getElementById('footWarn');
    const t0 = btn.textContent, h0 = box.offsetHeight;
    btn.click();
    const t1 = btn.textContent, h1 = box.offsetHeight, a1 = btn.getAttribute('aria-expanded');
    btn.click();
    return { t0, t1, a1, grew: h1 > h0, t2: btn.textContent, a2: btn.getAttribute('aria-expanded') };
  })()`);
  check(r.t0 === 'Ещё' && r.t1 === 'Скрыть' && r.t2 === 'Ещё', 'подписи кнопки предупреждения: ' + JSON.stringify(r));
  check(r.grew, 'предупреждение не раскрылось');
  check(r.a1 === 'true' && r.a2 === 'false', 'aria-expanded кнопки предупреждения не переключается');

  /* сравнение полов там, где оно есть */
  await p.goto(BASE + '?p=m-a26#sex');
  r = await p.eval(`(() => {
    const leg = document.getElementById('sexLegend');
    const f = document.querySelector('.sexbtn--f'), m = document.querySelector('.sexbtn--m');
    const before = document.querySelectorAll('#chart path[stroke-width="2.2"]').length;
    f.click();
    const two = { pressed: [m.getAttribute('aria-pressed'), f.getAttribute('aria-pressed')],
      curves: document.querySelectorAll('#chart path[stroke-width="2.2"]').length,
      dual: document.querySelector('.hcard').classList.contains('hcard--dual') };
    m.click();
    const one = { pressed: [m.getAttribute('aria-pressed'), f.getAttribute('aria-pressed')] };
    m.click();   // последний включённый выключить нельзя
    const guard = f.getAttribute('aria-pressed') === 'true' || m.getAttribute('aria-pressed') === 'true';
    return { legendShown: !leg.hidden, before, two, one, guard };
  })()`);
  check(r.legendShown, 'нет переключателя М/Ж в сценарии «Секс»');
  check(r.two.pressed.join() === 'true,true' && r.two.curves === 2, 'второй пол не добавился на график: ' + JSON.stringify(r.two));
  check(r.two.dual, 'плашки гормонов не перешли в парный режим');
  check(r.guard, 'удалось выключить последний включённый пол');

  /* в сценарии без сравнения переключателя нет */
  await p.goto(BASE + '?p=m-a26#caffeine');
  r = await p.eval(`(() => ({ hidden: document.getElementById('sexLegend').hidden, dose: document.getElementById('dose').textContent, doseHidden: document.getElementById('dose').hidden }))()`);
  check(r.hidden, 'переключатель М/Ж показан там, где сравнения нет');
  check(!r.doseHidden && r.dose.trim().length, 'у кофеина пропала доза');

  /* сценарий без дозы прячет чип */
  await p.goto(BASE + '?p=m-a26#breakup');
  r = await p.eval(`(() => ({ doseHidden: document.getElementById('dose').hidden, text: document.getElementById('dose').textContent }))()`);
  check(r.doseHidden && !r.text, 'у расставания показан пустой чип дозы');

  /* режимы списка гормонов */
  r = await p.eval(`(() => {
    const active = document.getElementById('hormones').querySelectorAll('.hcard').length;
    document.getElementById('segAll').click();
    const all = document.getElementById('hormones').querySelectorAll('.hcard').length;
    const cnt = document.getElementById('cntAll').textContent;
    document.getElementById('segActive').click();
    return { active, all, cnt, back: document.getElementById('hormones').querySelectorAll('.hcard').length };
  })()`);
  check(r.all === 21 && r.cnt === '21', `режим «Все» показывает ${r.all} из 21`);
  check(r.active < r.all && r.back === r.active, 'режим «Задействованные» не фильтрует');

  /* логотип: под курсором стрелка, после клика — снова знак */
  r = await p.eval(`(() => {
    const wm = document.querySelector('.wordmark');
    const mark = document.querySelector('.wordmark-mark'), up = document.querySelector('.wordmark-up');
    window.scrollTo(0, 800);
    const cs = (el) => getComputedStyle(el).display;
    const before = [cs(mark), cs(up)];
    wm.click();
    const reverted = wm.classList.contains('is-reverted');
    wm.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    return { before, reverted, afterLeave: wm.classList.contains('is-reverted'), scrolled: window.scrollY };
  })()`);
  check(r.reverted, 'после клика по логотипу не ставится is-reverted');
  check(!r.afterLeave, 'is-reverted не снимается, когда курсор уходит');

  /* Escape закрывает всё подряд */
  await p.goto(BASE + '?p=m-a26#love');
  r = await p.eval(`(() => {
    document.querySelector('.hcard').click();
    document.getElementById('navProfile').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { detail: document.getElementById('detail').hidden, pop: document.getElementById('profilePop').hidden,
      tip: document.getElementById('chartTip').hidden };
  })()`);
  check(r.detail && r.pop && r.tip, 'Escape не закрыл окно/меню/подсказку: ' + JSON.stringify(r));

  /* полоса прокрутки в окне гормона проявляется только при прокрутке */
  r = await p.eval(`(() => {
    const det = document.getElementById('detail');
    document.querySelector('.hcard').click();
    const rest = det.classList.contains('is-scrolling');
    det.dispatchEvent(new Event('scroll'));
    return { rest, scrolling: det.classList.contains('is-scrolling') };
  })()`);
  check(!r.rest, 'полоса прокрутки видна в покое');
  check(r.scrolling, 'полоса прокрутки не проявляется при прокрутке');

  /* телефон: подсказка пинится по тапу и закрывается крестиком */
  await p.viewport(390, 844, true);
  await p.goto(BASE + '?p=m-a26#caffeine');
  const pt = JSON.parse(await p.eval(`(() => { const b = document.getElementById('chart').getBoundingClientRect(); return JSON.stringify([b.left + 36 + (b.width - 46) * 0.55, b.top + b.height / 2]); })()`));
  await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt[0], y: pt[1], id: 1 }] });
  await p.wait(60);
  await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.wait(150);
  r = await p.eval(`(() => {
    const tip = document.getElementById('chartTip');
    const shown = !tip.hidden;
    const tb = tip.getBoundingClientRect();
    const inField = tb.left >= -1 && tb.right <= innerWidth + 1;
    document.getElementById('tipClose').click();
    return { shown, inField, closed: tip.hidden, box: [Math.round(tb.left), Math.round(tb.right)], iw: 390 };
  })()`);
  check(r.shown, 'телефон: подсказка не открылась по тапу');
  check(r.inField, 'телефон: подсказка вылезает за экран ' + JSON.stringify(r.box));
  check(r.closed, 'телефон: подсказка не закрылась крестиком');

  /* телефон: размеры кнопок под палец */
  r = await p.eval(`(() => {
    document.getElementById('burgerBtn').click();
    const close = document.getElementById('navClose');
    document.querySelector('.hcard') && null;
    const sizes = { navClose: Math.round(close.offsetWidth), burger: Math.round(document.getElementById('burgerBtn').offsetWidth) };
    document.getElementById('navClose').click();
    document.querySelector('.hcard').click();
    sizes.detailClose = Math.round(document.getElementById('detailClose').offsetWidth);
    sizes.pinHidden = getComputedStyle(document.getElementById('detailPin')).display === 'none' ? 44 : 0;
    document.getElementById('detailClose').click();
    return sizes;
  })()`);
  check(Object.values(r).every(v => v >= 44), 'телефон: кнопки мельче 44px (pinHidden 0 = пин остался в шите) — ' + JSON.stringify(r));

  /* десктоп: кружки .iconbtn ровно 34px */
  await p.viewport(1280, 900, false);
  await p.goto(BASE + '?p=m-a26#love');
  r = await p.eval(`(() => {
    document.querySelector('.hcard').click();
    const s = [...document.querySelectorAll('#detail .iconbtn')].map(b => Math.round(b.offsetWidth));
    const after = getComputedStyle(document.querySelector('#detail .iconbtn'), '::after');
    return { s, inset: after.top };
  })()`);
  check(r.s.length === 2 && r.s.every(v => v === 34), 'десктоп: кружки .iconbtn ' + JSON.stringify(r.s) + ' вместо 34');
  check(r.inset === '-6px', 'тап-зона .iconbtn::after: ' + r.inset);

  if (p.errors.length) bad.push('✗ консоль: ' + p.errors.join(' | '));
  return bad;
}

async function suiteContent(p) {
  /* Содержимое страницы: рекомендация, блок источника, вода, счётчики,
     отступы и знак сброса — всё, что легко потерять при следующей правке. */
  const bad = [];
  const check = (c, m) => { if (!c) bad.push('✗ ' + m); };


  /* ── десктоп ── */
  await p.viewport(1280, 900, false);
  await p.goto(BASE + '?p=m-a26#caffeine');
  let r = await p.eval(`(() => {
    const gap = Math.round(document.querySelector('.stats').getBoundingClientRect().top
      - document.getElementById('blurbWrap').getBoundingClientRect().bottom);
    const src = document.querySelector('.source'), foot = document.querySelector('.foot');
    const rec = document.querySelector('.recovery');
    const sb = src.getBoundingClientRect(), fb = foot.getBoundingClientRect(), rb = rec.getBoundingClientRect();
    return {
      gap,
      timingTitle: document.querySelector('.timing-title').textContent,
      srcTitle: document.querySelector('.source-title').textContent,
      srcLen: document.getElementById('sourceText').textContent.trim().length,
      afterRecovery: sb.top >= rb.bottom - 1,
      beforeFooter: sb.bottom <= fb.top + 1,
      inMain: !!src.closest('main'),
      srcRight: Math.round(sb.right), iw: innerWidth,
      stale: /Лучшее время/.test(document.body.innerText),
      counters: document.body.innerText.match(/4[0-9] сценариев/g),
      icon: (() => { const s = document.querySelector('#resetBtn svg');
        return { w: s.getAttribute('width'), paths: s.querySelectorAll('path').length,
          stroke: s.querySelector('path').getAttribute('stroke-width') }; })(),
    };
  })()`);
  check(r.gap === 46, `десктоп: отступ текст→плашки ${r.gap}px вместо 46`);
  check(r.timingTitle === 'Рекомендация', 'заголовок блока: ' + r.timingTitle);
  check(r.srcTitle && r.srcLen > 40, 'блок источника пуст: ' + JSON.stringify([r.srcTitle, r.srcLen]));
  check(r.afterRecovery && r.beforeFooter && r.inMain, 'блок источника не между возвратом к норме и подвалом');
  check(r.srcRight <= r.iw, 'блок источника за краем');
  check(!r.stale, 'на странице осталось «Лучшее время»');
  check(r.icon.w === '16' && r.icon.paths === 1 && r.icon.stroke === '2', 'знак сброса: ' + JSON.stringify(r.icon));

  /* источник меняется по сценарию и честно говорит, когда его нет */
  r = await p.eval(`(async () => {
    const get = async (id) => { location.hash = '#' + id; await new Promise(r => setTimeout(r, 90));
      return document.getElementById('sourceText').textContent; };
    return { water: await get('water'), breakup: await get('breakup'), bike40: await get('bike40'),
      caffeine: await get('caffeine'), sleep: await get('sleep') };
  })()`);
  check(/Boschmann/.test(r.water) && /Exp Physiol/.test(r.water), 'у воды не названы работы: ' + r.water.slice(0, 60));
  check(/не рассматривает/.test(r.breakup), 'у расставания не сказано, что источника нет');
  check(/не по дистанциям/.test(r.bike40), 'у велозаезда не сказано про дистанции');
  check(/NIDA/.test(r.caffeine), 'у кофеина не назван NIDA');
  check(/Endotext/.test(r.sleep), 'у сна не назван Endotext');
  check(new Set(Object.values(r)).size === 5, 'тексты источников не различаются: должно быть пять разных');

  /* оговорка в подвале: свёрнута — только лид, развёрнута — с новыми фразами */
  r = await p.eval(`(() => {
    const warn = document.getElementById('footWarn'), btn = document.getElementById('footMore');
    const restHidden = getComputedStyle(document.querySelector('.foot-warn-rest')).display;
    btn.click();
    const open = [...document.querySelectorAll('.foot-warn-rest')].map(e => e.textContent).join(' ');
    const shown = getComputedStyle(document.querySelector('.foot-warn-rest')).display;
    btn.click();
    return { restHidden, shown, label: btn.textContent,
      hasAge: /средние по возрастным группам/.test(open),
      hasDose: /Доза, тренированность/.test(open),
      hasRecovery: /восстановиться после прошлой нагрузки/.test(open) };
  })()`);
  check(r.restHidden === 'none', 'свёрнутая оговорка показывает лишнее');
  check(r.shown !== 'none', 'оговорка не раскрылась');
  check(r.hasAge && r.hasDose && r.hasRecovery, 'в оговорке нет новых фраз: ' + JSON.stringify(r));

  /* вода на месте, с дозой и тремя гормонами */
  await p.goto(BASE + '?p=m-a26#water');
  r = await p.eval(`(() => {
    const chips = [...document.querySelectorAll('#chips .chip')].map(c => c.textContent);
    return { chips, first: chips[0], name: document.getElementById('sitName').textContent,
      dose: document.getElementById('dose').textContent, doseHidden: document.getElementById('dose').hidden,
      cards: document.querySelectorAll('#hormones .hcard').length,
      timing: document.getElementById('timingText').textContent.length,
      cat: document.getElementById('sitTag').textContent };
  })()`);
  /* Вода открывает «Питание»: её пьют раньше любой еды, и группа у неё своя. */
  check(r.first === 'Вода' && r.name === 'Вода', 'воды нет первым чипом в «Питании»: ' + JSON.stringify(r.chips));
  check(r.cat === 'Питание', 'вода не в «Питании»: ' + r.cat);
  check(!r.doseHidden && /300 мл/.test(r.dose), 'у воды нет дозы: ' + r.dose);
  check(r.cards === 3, 'у воды ' + r.cards + ' карточек гормонов вместо 3');
  check(r.timing > 40, 'у воды пустая рекомендация');

  /* ── телефон ── */
  await p.viewport(390, 844, true);
  await p.goto(BASE + '?p=m-a26#caffeine');
  r = await p.eval(`(() => {
    const gap = Math.round(document.querySelector('.stats').getBoundingClientRect().top
      - document.getElementById('blurbWrap').getBoundingClientRect().bottom);
    document.getElementById('burgerBtn').click();
    const cats = document.getElementById('cats'), cs = getComputedStyle(cats);
    const src = document.querySelector('.source').getBoundingClientRect();
    return { gap, padBottom: cs.paddingBottom, marginBottom: cs.marginBottom,
      border: cs.borderBottomWidth, srcLeft: Math.round(src.left), srcRight: Math.round(src.right), iw: innerWidth };
  })()`);
  check(r.gap === 30, `телефон: отступ текст→плашки ${r.gap}px вместо 30`);
  check(r.padBottom === '26px' && r.marginBottom === '26px', `телефон: воздух у разделителя ${r.padBottom} / ${r.marginBottom} вместо 26px`);
  check(r.border === '1px', 'телефон: разделитель пропал');
  check(r.srcLeft >= 0 && r.srcRight <= r.iw, 'телефон: блок источника за краем');

  /* тап-зона знака сброса на телефоне */
  r = await p.eval(`(() => {
    const b = document.getElementById('resetBtn').getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height) };
  })()`);
  check(r.w >= 32 && r.h >= 32, 'телефон: кнопка сброса мельче 32px — ' + JSON.stringify(r));

  /* счётчики */
  r = await p.eval(`(() => ({
    meta: document.querySelector('meta[name=description]').content.match(/\\d+ жизненных/)?.[0],
    og: document.querySelector('meta[property="og:description"]').content.match(/\\d+ сценариев/)?.[0],
    foot: document.querySelector('.foot-meta').textContent.match(/\\d+ сценариев/)?.[0],
    cnt: document.getElementById('cntAll').textContent,
  }))()`);
  check(r.meta === '49 жизненных' && r.og === '49 сценариев' && r.foot === '49 сценариев', 'счётчики: ' + JSON.stringify(r));
  check(r.cnt === '21', 'счётчик гормонов: ' + r.cnt);
  if (p.errors.length) bad.push('✗ консоль: ' + p.errors.join(' | '));
  return bad;
}

const p = await connect();
let total = 0;
for (const [title, suite] of [['раскладка', suiteLayout], ['график по всем сценариям', suiteChart],
                              ['поведение и навигация', suiteBehaviour], ['органы управления', suiteControls],
                              ['содержимое страницы', suiteContent]]) {
  const found = await suite(p);
  console.log(`${title}: ${found.length ? found.length + ' замечаний' : 'чисто'}`);
  found.forEach(l => console.log('  ' + l));
  total += found.length;
}
console.log(total ? `итого замечаний: ${total}` : 'итого: замечаний нет');
p.close();
process.exit(total ? 1 : 0);
