const PORT = process.env.OLX_PORT || '9222';
// Скрининг объявлений OLX через существующую вкладку.
// Usage: node olx-screen.mjs <adUrl1> [adUrl2 ...]
const urls = process.argv.slice(2);
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

for (const url of urls) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 40; i++) {
    await sleep(600);
    if ((await evalJs('document.readyState')) === 'complete') break;
  }
  await sleep(2500);
  const data = await evalJs(`(() => {
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => { try { return JSON.parse(s.textContent); } catch(e){ return null; } }).filter(Boolean)[0] || {};
    const bodyText = document.body.innerText;
    const sellerA = document.querySelector('a[href*="/list/user/"]');
    const onlineM = bodyText.match(/Онлайн[^\\n]{0,40}/);
    const sinceM = bodyText.match(/на OLX з[^\\n]{0,30}/);
    const desc = ld.description || '';
    return JSON.stringify({
      title: (ld.name || document.title).slice(0, 110),
      price: (ld.offers || {}).price,
      desc: desc.slice(0, 600),
      profile: sellerA ? sellerA.href.split('?')[0] : null,
      online: onlineM ? onlineM[0] : '',
      since: sinceM ? sinceM[0] : '',
      hasLinks: /https?:\\/\\/|www\\.|t\\.me\\/|instagram|facebook|viber|telegram/i.test(desc),
      store: /Магазин|Бізнес-сторінка/.test(bodyText.slice(0, 9000))
    });
  })()`);
  console.log('== ' + url.slice(0, 90));
  console.log(data);
}

await send('Page.navigate', { url: prevUrl.startsWith('https://www.olx.ua') ? prevUrl : 'https://www.olx.ua/uk/myaccount/' });
ws.close();
process.exit(0);