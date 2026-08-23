const PORT = process.env.OLX_PORT || '9222';
// Отправка сообщения в чат OLX через существующую вкладку (гость блокирует новые).
// Usage: node olx-send2.mjs <ADURL:adUrl> <adId> <imagePath> <messageFile>
import { readFileSync } from 'node:fs';

const [profileUrl, adId, imagePath, messageFile] = process.argv.slice(2);
const message = readFileSync(messageFile, 'utf8');

const log = (...a) => console.log('[olx-send]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && c.pending.has(m.id)) { c.pending.get(m.id)(m); c.pending.delete(m.id); }
      else c.events.push(m);
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); });
  }
}

async function evalJs(cdp, expression, awaitPromise = false) {
  const env = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, timeout: 25000 });
  const r = env.result || {};
  if (r.exceptionDetails) throw new Error('JS exception: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
  return r.result?.value;
}

async function poll(cdp, expression, timeout = 30000) {
  const start = Date.now();
  for (;;) {
    const v = await evalJs(cdp, expression);
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('poll timeout: ' + expression.slice(0, 80));
    await sleep(500);
  }
}

const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
if (!page) throw new Error('no page target');
log('using tab:', page.url.slice(0, 60));
const cdp = await CDP.connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('DOM.enable');
await cdp.send('Runtime.enable');

let adHref;
if (profileUrl.startsWith('ADURL:')) {
  adHref = profileUrl.slice(6);
} else {
  await cdp.send('Page.navigate', { url: profileUrl });
  await poll(cdp, `document.readyState === 'complete' && document.querySelectorAll('a[href*="/d/uk/obyavlenie/"]').length > 0`);
  adHref = await evalJs(cdp, `(document.querySelector('a[href*="${adId}"]') || document.querySelector('a[href*="/d/uk/obyavlenie/"]')).href`);
}
log('ad href:', adHref);

await cdp.send('Page.navigate', { url: adHref + (adHref.includes('?') ? '&' : '?') + 'chat=1' });
await poll(cdp, `document.readyState === 'complete'`);
await poll(cdp, `location.href.includes("${adId}")`, 15000);
await poll(cdp, `!!document.querySelector('textarea')`, 40000);
log('chat textarea found');

const docEnv = await cdp.send('DOM.getDocument', { depth: -1 });
const inpEnv = await cdp.send('DOM.querySelector', { nodeId: docEnv.result.root.nodeId, selector: 'input#image-upload' });
if (!inpEnv.result?.nodeId) throw new Error('no #image-upload input');
await cdp.send('DOM.setFileInputFiles', { nodeId: inpEnv.result.nodeId, files: [imagePath] });
await poll(cdp, `!!document.querySelector('[data-testid="attachment-preview-item"]')`, 20000);
log('attachment preview shown');

const filled = await evalJs(cdp, `(() => {
  const ta = document.querySelector('textarea');
  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  set.call(ta, ${JSON.stringify(message)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return ta.value.length;
})()`);
log('textarea filled, len', filled);
await sleep(600);

await poll(cdp, `(() => { const b = document.querySelector('button[aria-label="Submit message"]'); return !!b && !b.disabled; })()`, 20000);
await evalJs(cdp, `document.querySelector('button[aria-label="Submit message"]').click()`);
await sleep(1500);
const still = await evalJs(cdp, `document.querySelector('textarea')?.value || ''`);
if (still.trim()) {
  log('textarea still filled, clicking again');
  await evalJs(cdp, `(() => { const b = document.querySelector('button[aria-label="Submit message"]'); if (b) b.click(); })()`);
}

const start40 = message.slice(0, 40);
for (let i = 0; i < 20; i++) {
  const v = await evalJs(cdp, `JSON.stringify({
    ta: (document.querySelector('textarea')?.value || '').trim(),
    inLog: document.body.innerText.includes(${JSON.stringify(start40)})
  })`);
  const o = JSON.parse(v);
  if (o.ta === '' && o.inLog) {
    log('MESSAGE SENT OK');
    await cdp.send('Page.navigate', { url: 'https://www.olx.ua/uk/myaccount/' });
    process.exit(0);
  }
  await sleep(1000);
}
const diag = await evalJs(cdp, `JSON.stringify({ ta: document.querySelector('textarea')?.value, tail: document.body.innerText.slice(-600) })`);
throw new Error('verify failed: ' + diag);