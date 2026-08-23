const PORT = process.env.OLX_PORT || '9222';
// Поиск OLX через существующую вкладку: список карточек в JSON.
// Usage: node olx-search.mjs "<запрос>"
const [q] = process.argv.slice(2);
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
const prevUrl = page.url;
await send('Page.navigate', { url: 'https://www.olx.ua/uk/list/q-' + encodeURIComponent(q) + '/' });
for (let i = 0; i < 40; i++) {
  await sleep(600);
  if ((await evalJs('document.readyState')) === 'complete') break;
}
await sleep(4000);
const cards = await evalJs(`(() => {
  const cards = [...document.querySelectorAll('[data-testid="l-card"]')];
  return JSON.stringify(cards.slice(0, 22).map(c => {
    const a = c.querySelector('a[href*="/obyavlenie/"]');
    const p = c.querySelector('[data-testid="ad-price"]');
    const t = c.querySelector('h4, h6, h3');
    return { slug: a ? a.href.split('/').pop().split('?')[0] : null, p: p ? p.textContent.trim() : '', t: t ? t.textContent.trim().slice(0, 70) : '' };
  }).filter(x => x.slug));
})()`);
console.log(cards || '[]');
await send('Page.navigate', { url: prevUrl.startsWith('https://www.olx.ua') ? prevUrl : 'https://www.olx.ua/uk/myaccount/' });
ws.close();
process.exit(0);