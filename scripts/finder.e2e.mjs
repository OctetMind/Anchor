#!/usr/bin/env node
/**
 * Tool-finder end-to-end check (zero dependencies).
 *
 * Drives the real app in headless Chrome over the DevTools protocol and types
 * the owner's sentence into the home-screen finder. No API key is configured,
 * so this exercises the keyword/synonym fallback: at least one tool must show.
 *
 * Usage:
 *   node scripts/finder.e2e.mjs
 *   CHROME_BIN=/path/to/chrome-headless-shell node scripts/finder.e2e.mjs
 *
 * Exit code 0 = the sentence surfaces a tool, 1 = red, 2 = harness error.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const QUERY = 'I want to stop procrastinating but I dont know what to do';
const EXPECTED = ['start', 'steps', 'howstart', 'simple', 'call'];
const FINDER = '.finder-wrap[data-hide="#tool-list-empty"]';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function findChrome() {
  const candidates = [];
  if (process.env.CHROME_BIN) candidates.push(process.env.CHROME_BIN);
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
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
  }
  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
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
  return spawn(
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
    { stdio: ['ignore', 'ignore', 'ignore'] }
  );
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

async function main() {
  const errors = [];
  const { server, port } = await startServer();
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'anchor-finder-'));
  const chrome = launch(findChrome(), userDataDir);
  const cdp = new CDP(await wsUrlFromPortFile(userDataDir));
  await cdp.connect();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);

  cdp.ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push('exception: ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || ''));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push('console.error: ' + (msg.params.args || []).map((a) => a.value || a.description).join(' '));
    }
  });

  const evalJS = async (expression) => {
    const res = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (res.exceptionDetails) {
      throw new Error('page eval failed: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    }
    return res.result.value;
  };

  const waitFor = async (expression, label, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try {
        if (await evalJS(expression)) return;
      } catch {
        /* not ready */
      }
      await sleep(50);
    }
    throw new Error('timeout waiting for ' + label);
  };

  try {
    await S('Page.enable');
    await S('Runtime.enable');
    await S('Network.enable');
    await S('Network.setCacheDisabled', { cacheDisabled: true });
    try { await S('Network.setBypassServiceWorker', { bypass: true }); } catch { /* older chrome */ }
    await S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    await S('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
    await waitFor(`document.readyState === 'complete' && typeof convos !== 'undefined'`, 'app boot');
    await waitFor(`!!document.querySelector(${JSON.stringify(FINDER + ' .tool-finder')})`, 'finder input');

    const focused = await evalJS(
      `(() => { const el = document.querySelector(${JSON.stringify(FINDER + ' .tool-finder')}); el.focus(); return document.activeElement === el; })()`
    );
    if (!focused) throw new Error('could not focus the tool finder input');

    await S('Input.insertText', { text: QUERY });
    await waitFor(
      `(() => { const r = document.querySelector(${JSON.stringify(FINDER + ' .finder-results')}); return !!r && !r.hidden && r.querySelectorAll('.tool-btn[data-tool]').length > 0; })()`,
      'finder results',
      6000
    );

    const ids = await evalJS(
      `[...document.querySelectorAll(${JSON.stringify(FINDER + ' .finder-results .tool-btn[data-tool]')})].map((b) => b.dataset.tool)`
    );
    const aiGroups = await evalJS(`document.querySelectorAll(${JSON.stringify(FINDER + ' .finder-group')}).length`);
    const hits = ids.filter((id) => EXPECTED.includes(id));
    const fails = [];
    if (!ids.length) fails.push('typing the sentence produced no tool cards');
    if (!hits.length) fails.push('no start/steps/howstart/simple/call in results: ' + ids.join(', '));
    if (aiGroups) fails.push('AI group rendered without a configured key');
    if (errors.length) fails.push(...errors);

    /* Second check: a mocked key + mocked provider reply must render the AI
       picks above the keyword results without removing them. */
    const AI_QUERY = 'I feel very lost today';
    await evalJS(`(() => {
      const el = document.querySelector(${JSON.stringify(FINDER + ' .tool-finder')});
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      settings.keys.openai = 'e2e-test-key';
      settings.provider = 'openai';
      window.fetch = async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'simple\\ncall' } }] }),
      });
      el.focus();
      return true;
    })()`);
    await sleep(200);
    await S('Input.insertText', { text: AI_QUERY });
    await waitFor(
      `(() => { const g = document.querySelector(${JSON.stringify(FINDER + ' .finder-group')}); return !!g && g.querySelectorAll('.tool-btn[data-tool]').length > 0; })()`,
      'AI closest-match group',
      6000
    );
    const aiIds = await evalJS(
      `[...document.querySelectorAll(${JSON.stringify(FINDER + ' .finder-group .tool-btn[data-tool]')})].map((b) => b.dataset.tool)`
    );
    const allIds = await evalJS(
      `[...document.querySelectorAll(${JSON.stringify(FINDER + ' .finder-results .tool-btn[data-tool]')})].map((b) => b.dataset.tool)`
    );
    if (aiIds.join(',') !== 'simple,call') fails.push('unexpected AI group ids: ' + aiIds.join(', '));
    if (!allIds.includes('three')) fails.push('keyword results disappeared after AI picks: ' + allIds.join(', '));

    console.log(JSON.stringify({ noKey: { query: QUERY, ids, hits, aiGroups, errors }, mockedKey: { query: AI_QUERY, aiIds, allIds } }, null, 2));
    if (fails.length) {
      console.log('\nFAIL  hybrid finder checks');
      for (const f of fails) console.log('  ! ' + f);
      console.log('\nverdict: RED');
      return 1;
    }
    console.log('\nPASS  finder surfaces a tool for a sentence with no key');
    console.log('PASS  mocked AI picks render above keyword results');
    console.log('verdict: GREEN');
    return 0;
  } finally {
    try { await S('Page.navigate', { url: 'about:blank' }); } catch { /* ignore */ }
    cdp.close();
    try { chrome.kill('SIGKILL'); } catch { /* ignore */ }
    server.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

let code;
try {
  code = await main();
} catch (e) {
  console.log(JSON.stringify({ fatal: String(e && e.stack ? e.stack.split('\n')[0] : e) }));
  console.log('\nverdict: HARNESS ERROR');
  code = 2;
}
process.exit(code);
