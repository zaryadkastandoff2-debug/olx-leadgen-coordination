const PORT = process.env.OLX_PORT || '9222';
// Проверка профиля продавца OLX через существующую вкладку.
// Usage: node check-profile.mjs <profileUrl>
const [url] = process.argv.slice(2);
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
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pend.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value;

await send('Page.enable');
await send('Page.navigate', { url });
for (let i = 0; i < 40; i++) {
  await sleep(600);
  if ((await evalJs('document.readyState')) === 'complete') break;
}
await sleep(3500);
const data = await evalJs(`(() => {
  const t = document.body.innerText;
  const m = t.match(/Ми знайшли (\\d+) оголошень?/);
  return JSON.stringify({
    ads: m ? m[1] : null,
    hasLinks: /https?:\\/\\/|www\\.|t\\.me\\/|instagram|facebook|viber|telegram/i.test(t.slice(0, 9000)),
    store: /Магазин|Бізнес-сторінка/.test(t.slice(0, 9000)),
    online: (t.match(/Онлайн[^\\n]{0,40}/) || [''])[0]
  });
})()`);
console.log(data);
await send('Page.navigate', { url: 'https://www.olx.ua/uk/myaccount/' });
ws.close();
process.exit(0);