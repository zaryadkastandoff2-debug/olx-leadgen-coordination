const PORT = process.env.OLX_PORT || '9222';
// Полностраничный скриншот через существующую вкладку (гость блокирует новые).
// Usage: node shot.mjs <url> <out.jpg>
import { writeFileSync } from 'node:fs';

const [url, out] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.error) console.error('CDP error:', JSON.stringify(m.error).slice(0, 160));
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pend.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const prevUrl = page.url;

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const r = await send('Runtime.evaluate', { expression: 'document.readyState' });
  if (r?.result?.value === 'complete') break;
}
await sleep(2500);
// Полная прокрутка страницы: срабатывают reveal-анимации и ленивые картинки.
const pageH = (await send('Runtime.evaluate', { expression: 'document.body.scrollHeight' }))?.result?.value || 5000;
for (let y = 0; y <= pageH; y += 700) {
  await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${y})` });
  await sleep(350);
}
await sleep(800);
// Все lazy-картинки в eager и ожидание полной загрузки.
await send('Runtime.evaluate', {
  expression: `(async () => {
    document.querySelectorAll('img[loading="lazy"]').forEach(i => i.loading = 'eager');
    await Promise.all([...document.images].map(img => img.complete ? 1 : new Promise(r => { img.onload = r; img.onerror = r; })));
    return [...document.images].filter(i => i.complete && i.naturalWidth > 0).length + '/' + document.images.length;
  })()`,
  awaitPromise: true,
  timeout: 30000,
});
await sleep(1200);
// Форсировать финальное состояние анимаций: иначе при captureBeyondViewport
// секции с .reveal снимаются в начале транзишена (пустые).
await send('Runtime.evaluate', {
  expression: `(() => {
    const s = document.createElement('style');
    s.textContent = '*{transition:none!important;animation:none!important;animation-duration:0s!important}'
      + '[class*="reveal"],[class*="fade"],[data-reveal]{opacity:1!important;transform:none!important}';
    document.head.appendChild(s);
    document.querySelectorAll('.reveal,[data-reveal]').forEach(e => e.classList.add('in','visible','shown'));
    window.scrollTo(0, 0);
    return 'forced';
  })()`,
});
await sleep(600);
const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82, captureBeyondViewport: true });
if (!shot?.data) throw new Error('no screenshot data');
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('saved', out, Math.round(shot.data.length / 1024) + 'KB');
await send('Page.navigate', { url: prevUrl });
ws.close();
process.exit(0);