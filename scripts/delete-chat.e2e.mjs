#!/usr/bin/env node
/**
 * Delete-a-chat end-to-end loop (zero dependencies).
 *
 * Drives the real app in headless Chrome over the DevTools protocol:
 *   - serves the workspace over http://127.0.0.1:<ephemeral>
 *   - loads index.html/app.js like a browser would
 *   - seeds two chats through the app's own globals
 *   - taps the row's Delete control with real input events
 *   - asserts the user-visible symptom: the chat is gone from the DOM,
 *     from `convos`, and from IndexedDB
 *
 * Usage:
 *   CHROME_BIN=/path/to/chrome-headless-shell node scripts/delete-chat.e2e.mjs
 *   ... --mobile          emulate a phone (390x844, touch, sidebar opened)
 *
 * Exit code 0 = contract holds, 1 = red (bug reproduced).
 * No network access, no npm dependencies.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const MOBILE = process.argv.includes('--mobile');
const VERBOSE = process.argv.includes('--verbose');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function findChrome() {
  const candidates = [];
  if (process.env.CHROME_BIN) candidates.push(process.env.CHROME_BIN);
  // puppeteer cache layouts (extracted or not-yet-extracted)
  const cache = path.join(os.homedir(), '.cache', 'puppeteer');
  candidates.push(
    '/tmp/anchor-chrome/chrome-headless-shell-linux64/chrome-headless-shell',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  );
  for (const c of candidates) if (c && existsSync(c)) return c;
  const glob = (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  };
  for (const kind of ['chrome-headless-shell', 'chrome']) {
    for (const v of glob(path.join(cache, kind))) {
      const p = path.join(cache, kind, v, `${kind}-linux64`, kind === 'chrome' ? 'chrome' : 'chrome-headless-shell');
      if (existsSync(p)) return p;
    }
  }
  throw new Error('No Chrome binary found. Set CHROME_BIN=/path/to/chrome-headless-shell');
}

/* ------------------------------- static server ------------------------------ */

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT)) throw new Error('outside root');
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

/* ---------------------------------- CDP ----------------------------------- */

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.events = [];
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', (e) => reject(new Error('ws error')), { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} ${JSON.stringify(msg.error.data || '')}`));
        else resolve(msg.result);
        return;
      }
      if (msg.method) {
        this.events.push(msg);
        const cbs = this.listeners.get(msg.method) || [];
        for (const cb of cbs) cb(msg.params, msg.sessionId);
      }
    });
  }

  on(method, cb) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(cb);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launch(bin, userDataDir) {
  const proc = spawn(
    bin,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  proc.stderr.on('data', (d) => {
    if (VERBOSE) process.stderr.write(`[chrome] ${d}`);
  });
  return proc;
}

async function wsUrlFromPortFile(dir) {
  const file = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    try {
      const raw = await readFile(file, 'utf8');
      const [port, wsPath] = raw.trim().split('\n');
      if (port && wsPath) return `ws://127.0.0.1:${port}${wsPath}`;
    } catch {
      /* not yet */
    }
    await sleep(50);
  }
  throw new Error('Chrome did not expose a DevTools port');
}

/* ------------------------------ page helpers ------------------------------- */

const SEED = `
(async () => {
  const now = Date.now();
  try { localStorage.clear(); } catch {}
  convos = [
    { id: 'c1', title: 'Alpha chat', created: now - 200000, updated: now - 200000, messages: [] },
    { id: 'c2', title: 'Beta chat', created: now - 100000, updated: now - 100000, messages: [] },
  ];
  currentId = 'c2';
  rememberLast();
  renderConvList();
  saveConvos();
  await new Promise((r) => setTimeout(r, 600));
  return { storageMode, ids: convos.map((c) => c.id), rows: document.querySelectorAll('#convo-list .convo-item').length };
})()
`;

const OBSERVE = `
(() => {
  const btn = !!document.querySelector('.c-del[data-del="c2"]');
  const row = !!document.querySelector('.convo-item[data-id="c2"]');
  const del = document.querySelector('.c-del[data-del="c2"]');
  const openDialogs = [...document.querySelectorAll('dialog')].filter((d) => d.open).map((d) => d.id);
  return {
    deleteButton: btn,
    row,
    armed: !!(del && del.classList.contains('armed')),
    inConvos: typeof convos !== 'undefined' && convos.some((c) => c.id === 'c2'),
    convoCount: typeof convos !== 'undefined' ? convos.length : null,
    currentId: typeof currentId !== 'undefined' ? currentId : null,
    openDialogs,
    dialogText: openDialogs.length ? (document.getElementById(openDialogs[0]) || {}).textContent.trim().replace(/\s+/g, ' ').slice(0, 120) : '',
    focus: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null,
    toast: (document.querySelector('#toast') || {}).textContent || '',
  };
})()
`;

const STORAGE = `
(async () => {
  const out = { local: null, idb: null, error: null };
  try {
    out.local = (JSON.parse(localStorage.getItem('anchor.convos.v1') || '[]') || []).map((c) => c.id);
  } catch (e) { out.local = 'unreadable'; }
  try {
    out.idb = await new Promise((resolve) => {
      const rq = indexedDB.open('anchor-chats', 1);
      rq.onerror = () => resolve('IDB_OPEN_ERROR');
      rq.onblocked = () => resolve('IDB_BLOCKED');
      rq.onsuccess = () => {
        const d = rq.result;
        try {
          const g = d.transaction('conversations', 'readonly').objectStore('conversations').getAll();
          g.onsuccess = () => resolve(g.result.map((c) => c.id));
          g.onerror = () => resolve('IDB_READ_ERROR');
        } catch (e) { resolve('IDB_TX_ERROR:' + e.message); }
      };
    });
  } catch (e) { out.error = String(e && e.message); }
  return out;
})()
`;

const RECT = (selector) => `
(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) {
    const chain = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const b = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      chain.push({
        el: n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\\s+/).join('.') : ''),
        w: Math.round(b.width), h: Math.round(b.height),
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
        overflow: cs.overflow, maxHeight: cs.maxHeight,
        transformed: cs.transform === 'none' ? undefined : true,
      });
    }
    return { zero: true, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, chain };
  }
  const x = Math.round(r.left + r.width / 2);
  const y = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(x, y);
  return {
    x, y, w: Math.round(r.width), h: Math.round(r.height),
    opacity: getComputedStyle(el).opacity,
    hit: hit ? (hit.id || hit.className || hit.tagName) : null,
    hitIsSelf: !!(hit && el.contains(hit)),
  };
})()
`;

/* -------------------------------- scenarios -------------------------------- */

async function connectPage(port) {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'anchor-e2e-'));
  const chrome = launch(findChrome(), userDataDir);
  const cdp = new CDP(await wsUrlFromPortFile(userDataDir));
  await cdp.connect();

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);

  const problems = [];
  cdp.on('Runtime.exceptionThrown', (p) => {
    problems.push(`exception: ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`);
  });
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') problems.push(`console.error: ${(p.args || []).map((a) => a.value || a.description).join(' ')}`);
  });

  await S('Page.enable');
  await S('Runtime.enable');
  await S('Network.enable');
  await S('Network.setCacheDisabled', { cacheDisabled: true });
  try { await S('Network.setBypassServiceWorker', { bypass: true }); } catch { /* older chrome */ }

  if (MOBILE) {
    await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  } else {
    await S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  }

  const evalJS = async (expression, { awaitPromise = true } = {}) => {
    const res = await S('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      throw new Error(
        'page eval failed: ' +
          (res.exceptionDetails.exception?.description || res.exceptionDetails.text)
      );
    }
    return res.result.value;
  };

  const waitFor = async (expression, label, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try {
        if (await evalJS(expression)) return true;
      } catch {
        /* not ready */
      }
      await sleep(50);
    }
    throw new Error(`timeout waiting for ${label}`);
  };

  await S('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
  await waitFor(`document.readyState === 'complete' && typeof storageMode !== 'undefined' && typeof convos !== 'undefined'`, 'app boot');
  await waitFor(`document.querySelector('#convo-list .hint') !== null || document.querySelectorAll('#convo-list .convo-item').length > 0`, 'first render');

  const seed = await evalJS(SEED);
  await waitFor(`document.querySelectorAll('#convo-list .convo-item').length === 2`, 'seeded rows');

  const tapAt = async (x, y) => {
    if (MOBILE) {
      await S('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await sleep(30);
      await S('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await S('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await sleep(20);
      await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(200);
  };

  const tap = async (selector, label, { hittable = true } = {}) => {
    const rect = await evalJS(RECT(selector));
    if (!rect) throw new Error(`${label}: selector not found: ${selector}`);
    if (rect.zero) throw new Error(`${label}: element has zero size (not rendered) ${JSON.stringify(rect.chain)}`);
    if (hittable && !rect.hitIsSelf) throw new Error(`${label}: element covered at (${rect.x},${rect.y}) by ${JSON.stringify(rect.hit)}`);
    await tapAt(rect.x, rect.y);
    return rect;
  };

  /* real user flow: open the menu on a phone, and expand the "Chats" accordion
     (it ships collapsed, so the list is not reachable until it is opened) */
  if (MOBILE) {
    await tap('#open-sidebar', 'open menu');
    await sleep(250);
  }
  const chatsHidden = await evalJS(`(() => { const b = document.querySelector('#acc-chats-body'); return !!(b && b.hidden); })()`);
  if (chatsHidden) {
    await tap('#acc-chats', 'expand Chats');
    await waitFor(`(() => { const b = document.querySelector('#acc-chats-body'); return !!(b && !b.hidden); })()`, 'chats accordion open');
  }

  const press = async (key) => {
    const code = key === 'Escape' ? 27 : key === 'Tab' ? 9 : 0;
    await S('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await S('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await sleep(150);
  };

  const observe = () => evalJS(OBSERVE);
  const storage = async () => {
    await sleep(700); // saveConvos debounce is 300ms
    return evalJS(STORAGE);
  };

  const cleanup = async () => {
    try { await S('Page.navigate', { url: 'about:blank' }); } catch { /* ignore */ }
    cdp.close();
    try { chrome.kill('SIGKILL'); } catch { /* ignore */ }
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  };

  return { evalJS, tap, tapAt, press, observe, storage, cleanup, seed, problems, sessionId };
}

async function scenarioConfirmFlow(port, { gapMs = 0, title }) {
  const page = await connectPage(port);
  const steps = [];
  const fails = [];
  try {
    const rect = await page.tap('.c-del[data-del="c2"]', 'tap Delete');
    const afterTap = await page.observe();
    steps.push({ step: 'tap on .c-del', target: rect, after: afterTap });

    if (afterTap.openDialogs.length) {
      const focusedInside = await page.evalJS(
        `(() => { const d = document.getElementById(${JSON.stringify(afterTap.openDialogs[0])}); return !!(d && d.contains(document.activeElement)); })()`
      );
      if (!focusedInside) fails.push('focus did not move into the confirmation dialog');
    }

    let before = afterTap;
    if (gapMs) {
      await sleep(gapMs);
      before = await page.observe();
      steps.push({ step: `state after ${gapMs}ms idle`, after: before });
    }

    let confirmVia = 'none';
    if (before.openDialogs.length) {
      const dlg = before.openDialogs[0];
      const sel = `#${dlg} [data-confirm]`;
      if (!(await page.evalJS(`!!document.querySelector(${JSON.stringify(sel)})`))) {
        fails.push(`dialog #${dlg} has no [data-confirm] destructive control`);
      } else {
        confirmVia = `dialog #${dlg} [data-confirm]`;
        await page.tap(sel, 'confirm in dialog');
      }
    } else {
      /* legacy arm pattern: the second tap has to land on the same 34px icon */
      confirmVia = 'second tap on the same .c-del (arm pattern)';
      await page.tap('.c-del[data-del="c2"]', 'second tap on Delete');
    }
    const afterConfirm = await page.observe();
    steps.push({ step: `confirm via ${confirmVia}`, after: afterConfirm });
    const store = await page.storage();
    steps.push({ step: 'persisted state', storage: store });

    if (!afterTap.openDialogs.length) {
      fails.push('one tap on Delete opened no confirmation dialog - the chat can only be deleted by a second tap on the same tiny icon');
    }
    if (!afterTap.inConvos) fails.push('a single tap deleted the chat with no confirmation');
    if (afterConfirm.row || afterConfirm.deleteButton || afterConfirm.inConvos) {
      fails.push('after confirming, chat c2 is still in the list (DOM/convos)');
    }
    if (Array.isArray(store.idb) && store.idb.includes('c2')) fails.push('after confirming, c2 is still in IndexedDB');
    if (page.problems.length) fails.push(...page.problems);
    return { name: title, seed: page.seed, steps, fails };
  } finally {
    await page.cleanup();
  }
}

async function scenarioDoubleTap(port, { title }) {
  const page = await connectPage(port);
  const steps = [];
  const fails = [];
  try {
    const rect = await page.tap('.c-del[data-del="c2"]', 'first tap');
    const afterFirst = await page.observe();
    steps.push({ step: 'first tap', after: afterFirst });
    /* second tap on the exact same pixels, as a frustrated user would */
    const hit = await page.evalJS(`(() => {
      const el = document.elementFromPoint(${rect.x}, ${rect.y});
      if (!el) return null;
      return {
        tag: el.tagName,
        id: el.id,
        cls: typeof el.className === 'string' ? el.className : '',
        confirm: !!(el.closest && el.closest('[data-confirm]')),
        inOpenDialog: !!(el.closest && el.closest('dialog[open]')),
      };
    })()`);
    await page.tapAt(rect.x, rect.y);
    const afterSecond = await page.observe();
    steps.push({ step: 'second tap on same pixels', landedOn: hit, after: afterSecond });
    if (afterSecond.openDialogs.length) {
      const dlg = afterSecond.openDialogs[0];
      await page.tap(`#${dlg} [data-cancel]`, 'cancel in dialog');
      steps.push({ step: 'cancel in dialog', after: await page.observe() });
    }
    const store = await page.storage();
    steps.push({ step: 'persisted state', storage: store });

    /* A deletion is only "silent" if the second tap hit the row control itself;
       landing on the dialog's explicit [data-confirm] button is a real confirmation. */
    if (!afterSecond.inConvos && !(hit && hit.confirm)) {
      fails.push('two rapid taps on the same row button deleted the chat with no confirmation dialog');
    }
    if (page.problems.length) fails.push(...page.problems);
    return { name: title, seed: page.seed, steps, fails };
  } finally {
    await page.cleanup();
  }
}

async function scenarioEscape(port, { title }) {
  const page = await connectPage(port);
  const steps = [];
  const fails = [];
  try {
    await page.tap('.c-del[data-del="c2"]', 'tap Delete');
    const afterTap = await page.observe();
    steps.push({ step: 'tap on .c-del', after: afterTap });
    await page.press('Escape');
    const afterEsc = await page.observe();
    steps.push({ step: 'press Escape', after: afterEsc });

    if (!afterTap.openDialogs.length) fails.push('one tap on Delete opened no confirmation dialog');
    if (afterEsc.openDialogs.length) fails.push('Escape did not close the confirmation dialog');
    if (!afterEsc.inConvos) fails.push('Escape deleted the chat instead of cancelling');
    return { name: title, seed: page.seed, steps, fails };
  } finally {
    await page.cleanup();
  }
}

/* ---------------------------------- main ---------------------------------- */

const results = [];
let server;
let fatal = null;
try {
  const started = await startServer();
  server = started.server;
  const env = MOBILE ? 'mobile' : 'desktop';
  results.push(await scenarioConfirmFlow(started.port, { title: `tap Delete then confirm (${env})` }));
  results.push(await scenarioConfirmFlow(started.port, { gapMs: 3500, title: `tap Delete, 3.5s pause, confirm (${env})` }));
  results.push(await scenarioDoubleTap(started.port, { title: `two rapid taps must not delete (${env})` }));
  results.push(await scenarioEscape(started.port, { title: `Escape cancels the confirmation (${env})` }));
} catch (e) {
  fatal = String(e && e.stack ? e.stack.split('\n')[0] : e);
} finally {
  if (server) server.close();
}

if (fatal) {
  console.log(JSON.stringify({ fatal }));
  console.log('\nverdict: HARNESS ERROR');
  process.exit(2);
}

let red = false;
for (const r of results) {
  const ok = r.fails.length === 0;
  if (!ok) red = true;
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  for (const s of r.steps) console.log('  ' + JSON.stringify(s));
  for (const f of r.fails) console.log('  ! ' + f);
}
console.log(`\nverdict: ${red ? 'RED (delete contract broken)' : 'GREEN (delete contract holds)'}`);
process.exit(red ? 1 : 0);
