const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PORT = process.env.OLX_PORT || '9222';
const urls = process.argv.slice(2);
const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const page = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const send = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value;
await send('Page.enable');
for (const url of urls) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 40; i++) { await sleep(600); if ((await evalJs('document.readyState')) === 'complete') break; }
  await sleep(2500);
  const v = await evalJs(`(() => {
    const t = document.body.innerText;
    const sellerA = document.querySelector('a[href*=".olx.ua/uk/home/"]') || document.querySelector('a[href*="/list/user/"]');
    const descEl = document.querySelector('[data-testid="ad_description"] div');
    const title = document.querySelector('[data-testid="ad_title"]');
    return JSON.stringify({
      title: title ? title.textContent.trim().slice(0,90) : '',
      seller: sellerA ? sellerA.href.split('?')[0] : null,
      online: (t.match(/Онлайн[^|\\n]{0,40}/) || [''])[0],
      biz: /Бізнес/.test(t),
      desc: (descEl ? descEl.textContent : t.slice(400, 1600)).slice(0, 500)
    });
  })()`);
  console.log('===== ' + url.split('/').pop().split('.')[0].slice(-14));
  console.log(v);
}
await send('Page.navigate', { url: 'https://www.olx.ua/uk/myaccount/' });
ws.close(); process.exit(0);
