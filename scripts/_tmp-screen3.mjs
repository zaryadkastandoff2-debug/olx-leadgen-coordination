const urls = [
 'https://www.olx.ua/d/uk/obyavlenie/stoli-na-zamovlennya-stoli-pismov-loft-rozbrn-IDPgDWh.html',
 'https://www.olx.ua/d/uk/obyavlenie/stl-ofsniy-stl-mebl-na-zamovlennya-stl-loft-mebl-stul-IDNYsjo.html',
 'https://www.olx.ua/d/uk/obyavlenie/stoli-z-naturalnim-derevom-stoli-loft-stoli-na-zamovlennya-IDPh43c.html'
];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const send = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Page.enable');
for (const url of urls) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 40; i++) { await sleep(600); if ((await send('Runtime.evaluate', { expression: 'document.readyState' })).result.value === 'complete') break; }
  await sleep(3000);
  const v = await send('Runtime.evaluate', { expression: `JSON.stringify({
    seller: (document.querySelector('a[href*="/list/user/"]')||{}).href||null,
    text: document.body.innerText.slice(400,1900)
  })`, returnByValue: true });
  console.log('=====', url.slice(-30));
  console.log((v.result.value || '').replace(/\\n/g, ' | ').slice(0, 1000));
}
await send('Page.navigate', { url: 'https://www.olx.ua/uk/myaccount/' });
ws.close(); process.exit(0);
