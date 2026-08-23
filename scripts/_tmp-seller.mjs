const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const send = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value;
await send('Page.enable');
await send('Page.navigate', { url: 'https://www.olx.ua/d/uk/obyavlenie/stoli-loft-stl-pismoviy-stl-ofsniy-stl-na-zamovlennya-IDPgyNp.html' });
for (let i = 0; i < 40; i++) { await sleep(600); if ((await evalJs('document.readyState')) === 'complete') break; }
await sleep(3000);
const v = await evalJs(`JSON.stringify([...document.querySelectorAll('a')].filter(a => /Тарас|автора|user|profile/i.test(a.outerHTML.slice(0,300))).map(a => ({href:a.href.slice(0,100), txt:(a.textContent||'').trim().slice(0,40)})).slice(0,10))`);
console.log(v);
ws.close(); process.exit(0);
