/* Мини-драйвер CDP без зависимостей. У каждой посылки свой таймаут,
   ожидание загрузки — опросом readyState, а не событием: так стенд
   не подвисает молча, если домен не отвечает. */
export async function connect(port = 9222) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiting = new Map(); const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) {
      const { res, rej } = waiting.get(d.id); waiting.delete(d.id);
      d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result);
    } else if (d.method === 'Runtime.exceptionThrown') {
      errors.push('JS: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0]);
    } else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') {
      errors.push('console: ' + d.params.entry.text);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; waiting.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (waiting.delete(i)) rej(new Error('нет ответа: ' + method)); }, 15000);
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  /* Без этого Chrome отдаёт из кеша и старую разметку, и старый скрипт:
     правка вроде бы не действует, хотя на диске она есть. */
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  try { await send('Page.bringToFront'); } catch {}
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const api = {
    send, errors, wait,
    async viewport(width, height, mobile = false) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
      await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
    },
    async goto(url, settle = 400) {
      errors.length = 0;
      await send('Page.navigate', { url });
      for (let i = 0; i < 60; i++) {
        await wait(100);
        try { if (await api.eval('document.readyState') === 'complete') break; } catch {}
      }
      await wait(settle);
      /* Переходы и анимации в headless не проигрываются: без этого замер
         всегда попадает в первый кадр. Гасим их и меряем конечное состояние. */
      await api.eval(`(() => { const st = document.createElement('style');
        st.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
        document.head.appendChild(st); return 1; })()`);
    },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: `(() => { ${expr.trim().startsWith('return') ? expr : 'return (' + expr + ')'} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0]);
      return r.result.value;
    },
    async shot(path) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const { writeFileSync } = await import('node:fs');
      writeFileSync(path, Buffer.from(r.data, 'base64'));
    },
    /* Вкладку за собой закрываем: иначе они копятся, и у очередного прогона
       рендерер уходит в фон — вызовы Emulation начинают висеть без ответа. */
    async close() {
      try { await send('Target.closeTarget', { targetId: t.id }); } catch {}
      try { ws.close(); } catch {}
    },
  };
  return api;
}
