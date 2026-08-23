const PORT = process.env.OLX_PORT || '9222';
// Читает тред по имени собеседника в списке чатов OLX.
// Usage: node read-thread.mjs <Имя>
const [name] = process.argv.slice(2);
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
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  return r?.result?.value;
};

await send('Page.enable');
const cur = await evalJs('location.href');
if (!cur.includes('/answers')) {
  await send('Page.navigate', { url: 'https://www.olx.ua/uk/myaccount/answers/?my_ads=0' });
  for (let i = 0; i < 30; i++) {
    await sleep(700);
    if ((await evalJs('document.readyState')) === 'complete') break;
  }
  await sleep(5000);
}

const clicked = await evalJs(`(() => {
  const all = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.textContent || '').trim().startsWith(${JSON.stringify(name)}));
  if (!all.length) return 'NOT_FOUND';
  all[0].click();
  return 'CLICKED';
})()`);
console.log('click:', clicked);
if (clicked !== 'CLICKED') process.exit(1);

await sleep(8000);
console.log('url:', await evalJs('location.href'));
const body = await evalJs('document.body.innerText');
const idx = body.lastIndexOf(name);
console.log('--- THREAD TEXT ---');
console.log((idx >= 0 ? body.slice(idx, idx + 3500) : body.slice(0, 3500)).replace(/\n{2,}/g, '\n'));
process.exit(0);