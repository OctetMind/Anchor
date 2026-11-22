/* ==========================================================================
   Anchor — one-shot AI assistant for AuDHD brains.
   Local-first: keys + chats live in localStorage. No server, no analytics.
   ========================================================================== */
'use strict';

/* ---------------------------- constants ---------------------------- */

const LS_SETTINGS = 'anchor.settings.v1';
const LS_CONVOS = 'anchor.convos.v1';
const LS_LAST = 'anchor.last';
const LS_SECRETS = 'anchor.secrets.v1';
const LS_ACCORD = 'anchor.accordion.v1';

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    kind: 'openai',
    base: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    needsKey: true,
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    base: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    needsKey: true,
  },
  google: {
    label: 'Google (Gemini)',
    kind: 'gemini',
    base: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-flash',
    needsKey: true,
  },
  openrouter: {
    label: 'OpenRouter (many models)',
    kind: 'openai',
    base: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    needsKey: true,
  },
  groq: {
    label: 'Groq (fast, free tier)',
    kind: 'openai',
    base: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    needsKey: true,
  },
  ollama: {
    label: 'Ollama (local, no key)',
    kind: 'openai',
    base: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    needsKey: false,
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    kind: 'openai',
    base: '',
    defaultModel: '',
    needsKey: false,
  },
};

const MODES = {
  oneshot: {
    label: 'One shot (recommended)',
    prompt: [
      'Answer in ONE complete response, first time. Rules:',
      '- Never ask the user questions before answering. If something is unclear, pick the most likely meaning, write "Assumed: …" in one line, then answer fully. If a second interpretation is common, answer the likely one and add a short "If you meant …" section.',
      '- Include everything needed to act: full steps, exact wording, complete code, full lists. No "and so on", no teasers.',
      '- Structure: a short headline with the direct answer first, then details in small sections or numbered steps.',
      '- Re-check your own answer before sending it: verify numbers, names, code and logic.',
      '- State confidence plainly when unsure, and still give your best answer.',
    ].join('\n'),
  },
  steps: {
    label: 'Step by step',
    prompt: [
      'Break everything into small, concrete, numbered steps. Rules:',
      '- One action per step, starting with a verb.',
      '- Start with "Do this first: …" as the very first line.',
      '- Add a rough time estimate per step, like "(2 min)".',
      '- Include exactly what "done" looks like at the end.',
      '- If the task is big, split it into today-only steps and later steps, clearly separated.',
    ].join('\n'),
  },
  simple: {
    label: 'Simple words',
    prompt: [
      'Write in plain language. Rules:',
      '- Short sentences, max ~15 words each.',
      '- No jargon, no idioms. If a technical word is needed, explain it in brackets right after it.',
      '- Use everyday comparisons for anything abstract.',
      '- Assume the reader is smart but exhausted.',
    ].join('\n'),
  },
  direct: {
    label: 'Direct & minimal',
    prompt: [
      'Use the minimum number of words. Rules:',
      '- Lead with the answer.',
      '- Lists over paragraphs.',
      '- No preamble, no summary at the end, no hedging.',
    ].join('\n'),
  },
  calm: {
    label: 'Calm & steady',
    prompt: [
      'Be warm but never patronising. Rules:',
      '- No guilt, shame or "should" language. Ever.',
      '- If the task feels big, that is normal — quietly make it smaller.',
      '- At most one short sentence of acknowledgment, then practical help.',
      '- Never use motivational filler.',
    ].join('\n'),
  },
  custom: {
    label: 'Custom instructions',
    prompt: '',
  },
};

const TOOLS = [
  {
    id: 'steps',
    label: 'Break it down',
    desc: 'Task → small steps',
    template: 'Break this into small, doable steps for me. One action per step, with a rough time estimate. Tell me the single first thing to do.\n\nThe task:\n',
  },
  {
    id: 'start',
    label: 'Just start',
    desc: 'Get past the blank stare',
    template: "I'm stuck on starting this. Give me: (1) the smallest possible 2-minute version of the first action, (2) exactly what \"done\" looks like for today. No pep talk.\n\nThe thing I'm avoiding:\n",
  },
  {
    id: 'howstart',
    label: 'How to start a task',
    desc: 'Tips & tricks to begin',
    template:
      "I struggle to start this task. Give me tricks for getting started that actually fit THIS task.\n\nThe task:\n\nRules:\n" +
      '- 3-5 concrete tricks (for example: shrink the first step to 2 minutes, body doubling, change location or posture, visible countdown timer, do a 1-minute warm-up task first, remove one piece of friction, tell someone your first step).\n' +
      '- One line each, saying exactly how to apply it to this task.\n' +
      '- End with "Try this first: …" picking the single best one.\n' +
      '- No motivational filler, no shame.',
  },
  {
    id: 'decide',
    label: 'Decide for me',
    desc: 'End decision paralysis',
    template: 'Decide for me.\n\nThe options:\n\nWhat matters most to me:\n\nPick ONE option, say why in 2 lines, and tell me what to do first.',
  },
  {
    id: 'simple',
    label: 'Explain simply',
    desc: 'Plain language, short',
    template: 'Explain this like I\'m smart but tired. Short sentences, no jargon:\n\n',
  },
  {
    id: 'script',
    label: 'Write it for me',
    desc: 'Word-for-word message',
    template: "Write this for me word-for-word, ready to send. Keep it short, clear and kind.\n\nWhat it's about and who it's for:\n",
  },
  {
    id: 'sort',
    label: 'Sort brain dump',
    desc: 'Mess → organized',
    template: "Sort my brain dump below into: to-dos, ideas, worries, and everything else. Turn the to-dos into a short list of concrete actions.\n\nHere's the dump:\n",
  },
  {
    id: 'howlong',
    label: 'How long will it take?',
    desc: 'Realistic time estimate',
    template:
      'Estimate how long this task will really take me. I have ADHD, so include the hidden parts: setup, finding things, switching into it, breaks, cleanup.\n\nThe task:\n\nRules:\n' +
      '- Give an honest range: fast day / normal day / bad brain day.\n' +
      '- Break it into stages with minutes each.\n' +
      '- If this kind of task usually takes longer than I think, say so plainly.\n' +
      '- End with "Book this much time: …"',
  },
  {
    id: 'fits',
    label: 'What fits in X min?',
    desc: 'Match task to time + energy',
    template:
      'I have this much time right now: [minutes]\nMy energy is: [low / medium / good]\n\nThings I could do:\n\n\n' +
      'Pick what realistically fits right now. Rules:\n' +
      '- Max 1 main thing + 1 easy bonus thing.\n' +
      '- If nothing fits, say so and give the smallest useful 5-minute option instead.\n' +
      '- Tell me what "enough" looks like when time is up, so I can stop without guilt.',
  },
  {
    id: 'three',
    label: "Today's 3",
    desc: 'Pick 3, one must-do',
    template:
      "Here's everything on my mind. Pick exactly 3 things for today — no more.\n\nEverything:\n\nRules:\n" +
      '- One must-do: the thing with real consequences if it slips.\n' +
      "- Two smaller or half-done versions of other things.\n" +
      "- If something has been dodged for weeks, shrink it until it's startable today.\n" +
      '- Everything not picked goes under "Not today — and that\'s fine."',
  },
  {
    id: 'call',
    label: 'Call walker',
    desc: 'Survive phone calls',
    template:
      "I need to make this phone call and I keep avoiding it.\n\nWho I'm calling and what it's about:\n\nRules:\n" +
      '- What to have ready before dialing (account numbers, dates, a notes doc).\n' +
      '- The exact opening line, word-for-word.\n' +
      "- Likely questions they'll ask, with my answers as fill-in blanks.\n" +
      '- Two lines for if I get confused or need a moment.\n' +
      '- What to write down during the call.\n' +
      '- One tiny after-the-call step (log it, calendar the follow-up).',
  },
  {
    id: 'hardtalk',
    label: 'Hard conversation prep',
    desc: 'Scripts + responses',
    template:
      "I need to have a conversation I'd rather avoid. Prep me for it.\n\nThe situation and what I want out of it:\n\nRules:\n" +
      '- How to open, word-for-word.\n' +
      '- My 2-3 key points, in order.\n' +
      '- What to say if they respond with: anger, guilt-tripping, or "later".\n' +
      '- One clean exit line for however it goes.\n' +
      '- Kind but firm. No apologizing for having needs.',
  },
  {
    id: 'switch',
    label: 'Transition helper',
    desc: 'Switch tasks smoothly',
    template:
      "I'm stuck doing [current thing] and I need to switch to [next thing].\n\nGive me a transition plan:\n" +
      '- A 2-minute wind-down for leaving the current thing (save point, quick note, stand up).\n' +
      '- The exact first physical move into the new thing.\n' +
      '- One sentence making the switch feel allowed — the old thing will still be there later.\n' +
      '- Total transition time: under 5 minutes.',
  },
  {
    id: 'decode',
    label: 'Message decoder',
    desc: 'What did they mean?',
    template:
      "I received this message and I can't tell how to read it. Decode it for me.\n\nThe message:\n\nRules:\n" +
      '- The most literal, neutral reading of what it actually says.\n' +
      '- What is being asked of me, if anything.\n' +
      '- Max 2 genuinely unclear things, phrased as assumptions I could check.\n' +
      '- Two ready-to-send replies: a short one and a slightly warmer one.\n' +
      "- If there's no hidden meaning, say that plainly. Don't invent one.",
  },
  {
    id: 'tone',
    label: 'Tone check',
    desc: 'Before you hit send',
    template:
      'Check how this comes across before I send it.\n\nMy draft:\n\nRules:\n' +
      '- One line on the tone it reads as (blunt, warm, annoyed, fine…).\n' +
      '- Anything that could land badly, quoted exactly.\n' +
      '- Two rewrites: more direct, and softer — keep my meaning.\n' +
      "- Keep my voice; don't make me sound corporate.\n" +
      '- End with a verdict: which version to send.',
  },
  {
    id: 'summarize',
    label: 'Summarize this',
    desc: 'Long text → 5 bullets',
    template:
      'Summarize this for me.\n\nThe text:\n\nRules:\n' +
      '- Max 5 bullets, plain language.\n' +
      '- One line: what I need to DO because of this, and by when.\n' +
      '- One line: what I can safely ignore.\n' +
      '- No new jargon.',
  },
  {
    id: 'rescue',
    label: 'Shutdown rescue',
    desc: 'Frozen → one next thing',
    template:
      "I'm overwhelmed and frozen right now. Help me get moving again, gently.\n\nThe situation (as much as I can type):\n\nRules:\n" +
      '- No lectures, no "shoulds", no pretending it\'s fine.\n' +
      '- First: a tiny grounding sequence — 3 physical steps, under 2 minutes total.\n' +
      "- Then: ONE next action so small it sounds almost insulting. That's the right size.\n" +
      '- Then: one direction for after it — no pressure, no list.\n' +
      '- If this sounds like a medical or safety emergency, say so clearly and tell me to contact real help (emergency services or someone near me).',
  },
  {
    id: 'routine',
    label: 'Routine builder',
    desc: 'Steps with real times',
    template:
      'Build me a routine I can actually follow.\n\nThe routine I need (e.g. leaving the house, starting work, going to bed) and roughly when:\n\nRules:\n' +
      '- Numbered steps, one action each, in order.\n' +
      '- Realistic minutes per step for a slow day.\n' +
      '- Mark the 2-3 load-bearing steps (skip those and it collapses).\n' +
      '- One reset line: what to do if it derails midway.\n' +
      '- Short enough to fit one screen.',
  },
  {
    id: 'futureme',
    label: 'Note to future me',
    desc: 'Keep the context',
    template:
      "I need to leave a note for future me, who will have forgotten all context.\n\nMy scribbles:\n\nRules:\n" +
      '- Turn it into a clear direct instruction: what to do, in order.\n' +
      "- Add the context I'll have lost: why it matters, where things are, who's involved.\n" +
      '- Format: "FUTURE ME: [the mission]" at the top, then the steps, then "It\'s done when: …"\n' +
      '- Make dates and times explicit. If something is ambiguous, state your assumption in one line.',
  },
];

const DEFAULT_SETTINGS = {
  provider: 'openai',
  keys: { openai: '', anthropic: '', google: '', openrouter: '', groq: '', ollama: '', custom: '' },
  bases: {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com',
    google: 'https://generativelanguage.googleapis.com',
    openrouter: 'https://openrouter.ai/api/v1',
    groq: 'https://api.groq.com/openai/v1',
    ollama: 'http://localhost:11434/v1',
    custom: '',
  },
  model: {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-sonnet-4-5',
    google: 'gemini-2.5-flash',
    openrouter: 'openai/gpt-4o-mini',
    groq: 'llama-3.3-70b-versatile',
    ollama: 'llama3.2',
    custom: '',
  },
  temperature: 0.6,
  topP: 1,
  maxTokens: 8192,
  mode: 'oneshot',
  customPrompt: '',
  profile: '',
  favoriteTools: [],
  voiceLang: '',
  autoSpeak: false,
  ttsRate: 1,
  ttsVoiceURI: '',
  stream: true,
  encryptKeys: false,
  autoLockMins: 5,
  theme: 'dark',
  fontScale: 1,
  spacing: 'normal',
  reduceMotion: false,
};

/* ---------------------------- icons (dynamic) ---------------------------- */

const ICONS = {
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  retry: '<path d="M21 3v5h-5"/><path d="M21 8a9 9 0 1 0-9 13c2.5 0 4.9-1 6.7-2.7"/>',
  pencil: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  steps: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5.5v13l11-6.5Z" fill="currentColor" stroke="none"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5.5"/>',
  bubble: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  funnel: '<path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5A6 6 0 1 0 6 11.5c.8.8 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  speaker: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  stopbtn: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z"/>',
  arrows: '<path d="m8 3 4 4-4 4"/><path d="M12 7H4"/><path d="m16 21-4-4 4-4"/><path d="M12 17h8"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 16 3.5-5.5"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  lifebuoy: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.9 4.9 2.9 2.9M16.2 16.2l2.9 2.9M19.1 4.9l-2.9 2.9M7.8 16.2l-2.9 2.9"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6L22 7"/>',
};

function icon(name) {
  return (
    '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (ICONS[name] || '') +
    '</svg>'
  );
}

/* ---------------------------- state ---------------------------- */

let settings = loadSettings();
let convos = [];
let currentId = null;
let streaming = false;
let aborter = null;
let genTimer = null;

// chat storage: IndexedDB with a localStorage fallback
let db = null;
let storageMode = 'local';
const storeMeta = new Map(); // convo id -> last persisted `updated`
let justMigrated = false;
let flushing = false;
let flushQueued = false;
let idbFailNotified = false;

// encrypted-key ("paranoid mode") state
let secrets = loadSecrets(); // { v, kdf, providers } or null — ciphertext only
let unlockedKeys = {}; // provider -> plaintext key, memory only
let unlockKey = null; // derived CryptoKey, memory only
let lockDeadline = 0; // auto-lock timestamp; 0 = not scheduled
let pendingScrollMsgId = null; // message to scroll to + flash after switching chats

/* ---------------------------- tiny dom helpers ---------------------------- */

const $ = (sel) => document.querySelector(sel);

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(ts) {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(ts);
  } catch {
    return '';
  }
}

function relDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  const days = Math.floor((today.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return days + 'd ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ---------------------------- storage ---------------------------- */

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!extra || typeof extra !== 'object') return out;
  for (const k of Object.keys(extra)) {
    if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], extra[k]);
    } else if (extra[k] !== undefined) {
      out[k] = extra[k];
    }
  }
  return out;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return deepMerge(structuredClone(DEFAULT_SETTINGS), JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function saveSettings() {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
    flashSaved();
  } catch {
    /* storage full or blocked */
  }
}

/* ---------------------------- secrets store (encrypted API keys) ---------------------------- */

function loadSecrets() {
  try {
    const raw = localStorage.getItem(LS_SECRETS);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && s.kdf && s.providers) return s;
    return null;
  } catch {
    return null;
  }
}

function saveSecrets() {
  try {
    localStorage.setItem(LS_SECRETS, JSON.stringify(secrets));
  } catch {
    toast('Could not save the encrypted key — storage blocked.');
  }
}

function subtleAvailable() {
  return !!(window.crypto && window.crypto.subtle && window.TextEncoder && window.TextDecoder);
}

function paranoidOn() {
  return !!settings.encryptKeys;
}
function hasAnySecret() {
  return !!(secrets && secrets.providers && Object.keys(secrets.providers).length);
}
function isLocked() {
  return paranoidOn() && hasAnySecret() && !unlockKey;
}

/* WebCrypto: PBKDF2 (passphrase) -> AES-GCM 256. Ciphertext only ever touches disk. */
const te = new TextEncoder();
const td = new TextDecoder();

function b64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}
function unb64(str) {
  const b = atob(str);
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

async function deriveKey(pass, salt, iterations) {
  const km = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptText(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(plaintext));
  return { iv: b64(iv), ct: b64(ct) };
}

async function decryptText(key, blob) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return td.decode(pt);
}

/* ---------------------------- chat storage: IndexedDB (+ localStorage fallback) ---------------------------- */

function idbOpen() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open('anchor-chats', 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('conversations')) {
        d.createObjectStore('conversations', { keyPath: 'id' });
      }
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error || new Error('IndexedDB open failed'));
    rq.onblocked = () => reject(new Error('IndexedDB blocked (close other Anchor tabs)'));
  });
}

function idbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('conversations', 'readonly');
    const rq = tx.objectStore('conversations').getAll();
    rq.onsuccess = () => resolve(rq.result || []);
    rq.onerror = () => reject(rq.error);
  });
}

function idbPutAll(list) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('conversations', 'readwrite');
    const st = tx.objectStore('conversations');
    for (const c of list) st.put(c);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

async function initChatStorage() {
  if ('indexedDB' in window) {
    try {
      db = await idbOpen();
      let rows = await idbGetAll();
      const legacyRaw = localStorage.getItem(LS_CONVOS);
      if (legacyRaw !== null) {
        let legacy = [];
        try {
          const a = JSON.parse(legacyRaw);
          if (Array.isArray(a)) legacy = a.filter((c) => c && c.id);
        } catch { /* unreadable legacy — ignore it */ }
        if (legacy.length || rows.length) {
          // merge by id (newest wins) so nothing is ever lost
          const byId = new Map();
          for (const c of rows) byId.set(c.id, c);
          let changed = false;
          for (const c of legacy) {
            const ex = byId.get(c.id);
            if (!ex || (c.updated || 0) > (ex.updated || 0)) { byId.set(c.id, c); changed = true; }
          }
          rows = [...byId.values()];
          if (changed || rows.length) await idbPutAll(rows);
          // verify before removing the old copy
          const check = await idbGetAll();
          const have = new Set(check.map((c) => c.id));
          if (rows.every((c) => have.has(c.id))) {
            localStorage.removeItem(LS_CONVOS);
            if (legacy.length) justMigrated = true;
          }
        } else {
          localStorage.removeItem(LS_CONVOS);
        }
      }
      convos = rows.filter((c) => c && c.id && Array.isArray(c.messages));
      storageMode = 'idb';
      for (const c of convos) storeMeta.set(c.id, c.updated);
      return;
    } catch { /* fall back to localStorage below */ }
  }
  storageMode = 'local';
  try {
    const arr = JSON.parse(localStorage.getItem(LS_CONVOS) || '[]');
    convos = Array.isArray(arr) ? arr.filter((c) => c && c.id && Array.isArray(c.messages)) : [];
  } catch {
    convos = [];
  }
}

async function wipeChatDb() {
  try {
    if (db) { db.close(); db = null; }
  } catch { /* ignore */ }
  await new Promise((resolve) => {
    try {
      const rq = indexedDB.deleteDatabase('anchor-chats');
      rq.onsuccess = rq.onerror = rq.onblocked = () => resolve();
      setTimeout(resolve, 1500); // if blocked by another tab, move on anyway
    } catch {
      resolve();
    }
  });
}

let saveTimer = null;
function saveConvos() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushConvos, 300);
}

async function flushConvos() {
  if (flushing) { flushQueued = true; return; }
  flushing = true;
  try {
    if (storageMode === 'local') {
      try {
        localStorage.setItem(LS_CONVOS, JSON.stringify(convos));
      } catch {
        toast('Storage is full — old chats may not save.');
      }
      return;
    }
    if (!db) return;
    // incremental write: only convos whose `updated` changed since last flush
    const tx = db.transaction('conversations', 'readwrite');
    const st = tx.objectStore('conversations');
    const current = new Set(convos.map((c) => c.id));
    for (const id of [...storeMeta.keys()]) {
      if (!current.has(id)) { st.delete(id); storeMeta.delete(id); }
    }
    for (const c of convos) {
      if (storeMeta.get(c.id) !== c.updated) { st.put(c); storeMeta.set(c.id, c.updated); }
    }
    await txDone(tx);
    idbFailNotified = false;
  } catch {
    if (!idbFailNotified) { toast('Saving chats hit an IndexedDB error.'); idbFailNotified = true; }
  } finally {
    flushing = false;
    if (flushQueued) { flushQueued = false; saveConvos(); }
  }
}

function rememberLast() {
  try {
    if (currentId) localStorage.setItem(LS_LAST, currentId);
    else localStorage.removeItem(LS_LAST);
  } catch { /* ignore */ }
}

function currentConvo() {
  return convos.find((c) => c.id === currentId) || null;
}

/* ---------------------------- markdown (mini, safe) ---------------------------- */

function mdInline(s) {
  s = s.replace(/`([^`\n]+)`/g, (m, c) => '<code>' + c + '</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

function renderCodeBlock(block) {
  const label = block.lang || 'code';
  return (
    '<div class="codeblock"><div class="codebar"><span>' + escapeHtml(label) + '</span>' +
    '<button type="button" class="code-copy" data-code="' + encodeURIComponent(block.code) + '">Copy</button></div>' +
    '<pre><code>' + escapeHtml(block.code) + '</code></pre></div>'
  );
}

function buildList(items) {
  let out = '';
  const stack = []; // {type, indent}
  let openLi = false;
  for (const it of items) {
    const type = it.ordered ? 'ol' : 'ul';
    while (stack.length && it.indent < stack[stack.length - 1].indent) {
      if (openLi) { out += '</li>'; openLi = false; }
      out += '</' + stack.pop().type + '>';
    }
    const top = stack[stack.length - 1];
    if (stack.length === 0) {
      stack.push({ type, indent: it.indent });
      out += '<' + type + '>';
    } else if (it.indent > top.indent) {
      stack.push({ type, indent: it.indent });
      out += '<' + type + '>';
    } else if (top.type !== type) {
      if (openLi) { out += '</li>'; openLi = false; }
      out += '</' + stack.pop().type + '>';
      stack.push({ type, indent: it.indent });
      out += '<' + type + '>';
    }
    if (openLi) out += '</li>';
    out += '<li>' + mdInline(escapeHtml(it.text));
    openLi = true;
  }
  if (openLi) out += '</li>';
  while (stack.length) out += '</' + stack.pop().type + '>';
  return out;
}

function mdRender(text) {
  if (!text) return '';
  text = String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '  ');

  const codeBlocks = [];
  text = text.replace(/```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g, (m, lang, code) => {
    codeBlocks.push({ lang: lang.trim(), code: code.replace(/\n$/, '') });
    return '\u0000CB' + (codeBlocks.length - 1) + '\u0000';
  });

  const lines = text.split('\n');
  let html = '';
  let i = 0;
  let listItems = null; // active list accumulator
  let para = null; // active paragraph accumulator

  const flushList = () => {
    if (listItems) { html += buildList(listItems); listItems = null; }
  };
  const flushPara = () => {
    if (para) {
      html += '<p>' + para.map((l) => mdInline(escapeHtml(l))).join('<br>') + '</p>';
      para = null;
    }
  };
  const flushAll = () => { flushPara(); flushList(); };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // code block placeholder
    const cb = trimmed.match(/^\u0000CB(\d+)\u0000$/);
    if (cb) {
      flushAll();
      html += renderCodeBlock(codeBlocks[Number(cb[1])]);
      i++;
      continue;
    }

    // blank line
    if (!trimmed) { flushAll(); i++; continue; }

    // heading
    let m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      flushAll();
      const lvl = m[1].length;
      html += '<h' + lvl + '>' + mdInline(escapeHtml(m[2])) + '</h' + lvl + '>';
      i++;
      continue;
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flushAll(); html += '<hr>'; i++; continue; }

    // blockquote
    if (/^>/.test(line)) {
      flushAll();
      const q = [];
      while (i < lines.length && /^>/.test(lines[i])) {
        q.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      html += '<blockquote>' + q.map((l) => mdInline(escapeHtml(l))).join('<br>') + '</blockquote>';
      continue;
    }

    // table
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushAll();
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      html += renderTable(rows);
      continue;
    }

    // list item
    m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (m) {
      flushPara();
      if (!listItems) listItems = [];
      listItems.push({
        indent: Math.floor(m[1].length / 2),
        ordered: /\d/.test(m[2][0]),
        text: m[3],
      });
      i++;
      continue;
    }

    // paragraph
    flushList();
    if (!para) para = [];
    para.push(line);
    i++;
  }
  flushAll();
  return html;
}

function renderTable(rows) {
  const cells = (r) =>
    r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  let out = '<table><thead><tr>';
  for (const h of head) out += '<th>' + mdInline(escapeHtml(h)) + '</th>';
  out += '</tr></thead><tbody>';
  for (let r = 2; r < rows.length; r++) {
    const cs = cells(rows[r]);
    out += '<tr>';
    for (let c = 0; c < head.length; c++) out += '<td>' + mdInline(escapeHtml(cs[c] || '')) + '</td>';
    out += '</tr>';
  }
  out += '</tbody></table>';
  return out;
}

/* ---------------------------- system prompt ---------------------------- */

function buildSystemPrompt() {
  const mode = MODES[settings.mode] ? settings.mode : 'oneshot';
  let modeText;
  if (mode === 'custom') {
    modeText = settings.customPrompt.trim() || MODES.oneshot.prompt;
  } else {
    modeText = MODES[mode].prompt;
  }
  let out =
    'You are Anchor, an assistant built for one person: an AuDHD user who wants complete, correct, first-time answers with minimal back-and-forth.\n\n' +
    'Always:\n' +
    '- Be literal, concrete and direct. No idioms, no sarcasm, no vague hints.\n' +
    '- No filler: no compliments, no "great question", no motivational talk.\n' +
    '- Max 3 options when listing choices, and always mark one as your recommendation.\n' +
    '- When the user must write or say something, provide exact word-for-word text they can copy.\n' +
    '- Say clearly when you are unsure or guessing.\n\n' +
    'Current answer mode — ' + (MODES[mode].label || mode) + ':\n' + modeText;

  const profile = settings.profile.trim();
  if (profile) out += '\n\nAbout the user (always applies):\n' + profile;
  return out;
}

/* ---------------------------- api helpers ---------------------------- */

function providerConf() {
  return PROVIDERS[settings.provider] || PROVIDERS.openai;
}

function apiKey() {
  const p = settings.provider;
  if (paranoidOn()) return (unlockedKeys[p] || '').trim();
  return (settings.keys[p] || '').trim();
}

async function encryptAndStoreKey(p, v) {
  try {
    if (!secrets) return;
    if (!v) delete secrets.providers[p];
    else secrets.providers[p] = await encryptText(unlockKey, v);
    saveSecrets();
  } catch {
    toast('Could not save the encrypted key.');
  }
}

/* ---------------------------- passphrase dialog ---------------------------- */

let passMode = 'unlock'; // 'unlock' | 'setup'
let passResolve = null;
let passResult = null;

function openPassDialog(mode) {
  const dlg = $('#passphrase');
  if (dlg.open) return Promise.resolve(null);
  passMode = mode;
  passResult = null;
  const setup = mode === 'setup';
  $('#pass-title').textContent = setup ? 'Set a passphrase' : 'Unlock';
  $('#pass-desc').textContent = setup
    ? 'This encrypts your API key on this device (AES-GCM). You will type it once per session. If you ever forget it, just paste your key again — chats are never encrypted.'
    : 'Enter your passphrase to use your API key this session.';
  $('#pass-confirm-row').hidden = !setup;
  $('#pass-strength-row').hidden = !setup;
  updateStrength('');
  $('#pass-input').value = '';
  $('#pass-confirm').value = '';
  $('#pass-error').hidden = true;
  const ok = $('#pass-ok');
  ok.disabled = false;
  ok.textContent = setup ? 'Save' : 'Unlock';
  return new Promise((resolve) => {
    passResolve = resolve;
    dlg.showModal();
    setTimeout(() => $('#pass-input').focus(), 60);
  });
}

function closePass(result) {
  passResult = result;
  $('#passphrase').close();
}

async function tryUnlock(pass) {
  if (!secrets || !secrets.kdf) return false;
  try {
    const key = await deriveKey(pass, unb64(secrets.kdf.salt), secrets.kdf.iterations || 310000);
    const out = {};
    for (const p of Object.keys(secrets.providers || {})) {
      out[p] = await decryptText(key, secrets.providers[p]); // throws on wrong passphrase
    }
    unlockKey = key;
    unlockedKeys = out;
    refreshProviderFields();
    updateKeyHint();
    scheduleAutolock();
    return true;
  } catch {
    return false;
  }
}

async function promptUnlock() {
  if (!isLocked()) return true;
  return (await openPassDialog('unlock')) === true;
}

async function submitPassDialog() {
  const okBtn = $('#pass-ok');
  if (okBtn.disabled) return; // already checking
  const pass = $('#pass-input').value;
  const err = $('#pass-error');
  if (passMode === 'setup') {
    if (pass.length < 4) { err.textContent = 'Use at least 4 characters.'; err.hidden = false; return; }
    if (pass !== $('#pass-confirm').value) { err.textContent = "Passphrases don't match."; err.hidden = false; return; }
    closePass({ pass });
    return;
  }
  okBtn.disabled = true;
  okBtn.textContent = 'Checking…';
  const good = await tryUnlock(pass);
  okBtn.disabled = false;
  okBtn.textContent = 'Unlock';
  if (good) {
    closePass(true);
  } else {
    err.textContent = 'Wrong passphrase — try again.';
    err.hidden = false;
    $('#pass-input').select();
  }
}

async function handleEncryptToggle(on) {
  if (on) {
    if (!subtleAvailable()) {
      toast('Encryption needs HTTPS or localhost — this page is not a secure context.');
      return false;
    }
    const r = await openPassDialog('setup');
    if (!r || !r.pass) return false;
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(r.pass, salt, 310000);
      secrets = { v: 1, kdf: { hash: 'SHA-256', iterations: 310000, salt: b64(salt) }, providers: {} };
      unlockKey = key;
      unlockedKeys = {};
      for (const p of Object.keys(settings.keys)) {
        const v = (settings.keys[p] || '').trim();
        if (v) {
          unlockedKeys[p] = v;
          secrets.providers[p] = await encryptText(key, v);
        }
        settings.keys[p] = ''; // scrub plaintext from localStorage
      }
      settings.encryptKeys = true;
      saveSettings();
      saveSecrets();
      refreshProviderFields();
      updateKeyHint();
      scheduleAutolock();
      toast('API key encrypted on this device ✓');
      return true;
    } catch {
      secrets = loadSecrets();
      unlockKey = null;
      unlockedKeys = {};
      toast('Encryption setup failed — nothing changed.');
      return false;
    }
  }
  // turning OFF — decrypt first
  if (secrets) {
    const ok = await promptUnlock();
    if (!ok) {
      toast('Unlock first to turn encryption off.');
      return false;
    }
    for (const p of Object.keys(secrets.providers || {})) {
      settings.keys[p] = unlockedKeys[p] || '';
    }
  }
  settings.encryptKeys = false;
  secrets = null;
  unlockedKeys = {};
  unlockKey = null;
  lockDeadline = 0;
  try { localStorage.removeItem(LS_SECRETS); } catch { /* ignore */ }
  saveSettings();
  refreshProviderFields();
  updateKeyHint();
  toast('API key stored normally again');
  return true;
}

/* ---------------------------- passphrase strength ---------------------------- */

const WEAK_PASSES = new Set([
  'password', 'password1', 'passw0rd', '123456', '12345678', '123456789', 'qwerty',
  'qwertyuiop', 'abc123', 'monkey', 'letmein', 'dragon', '111111', '000000',
  'baseball', 'iloveyou', 'trustno1', 'sunshine', 'master', 'welcome', 'shadow',
  'ashley', 'football', 'jesus', 'michael', 'ninja', 'mustang', 'admin', 'login',
  'princess', 'solo', 'starwars', 'hello', 'freedom', 'whatever', 'aaaaaaaa',
]);

function passStrength(p) {
  if (!p) return 0;
  if (WEAK_PASSES.has(p.toLowerCase())) return 4;
  if (/^(.)\1+$/.test(p)) return 4;
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/[0-9]/.test(p)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(p)) pool += 33;
  let bits = Math.round(p.length * Math.log2(pool || 2));
  if (/ /.test(p.trim())) bits += 6; // multi-word bonus
  return bits;
}

function updateStrength(p) {
  const fill = $('#pass-meter-fill');
  const label = $('#pass-strength-label');
  if (!fill || !label) return;
  if (!p) {
    fill.style.width = '0%';
    fill.className = 'pass-meter-fill';
    label.textContent = '';
    return;
  }
  const bits = passStrength(p);
  fill.style.width = Math.max(6, Math.min(100, (bits / 80) * 100)) + '%';
  let cls, txt;
  if (bits < 25) { cls = 'weak'; txt = 'Too predictable — anyone could guess this.'; }
  else if (bits < 40) { cls = 'ok'; txt = 'Okay.'; }
  else if (bits < 60) { cls = 'good'; txt = 'Good.'; }
  else { cls = 'strong'; txt = 'Strong.'; }
  fill.className = 'pass-meter-fill ' + cls;
  label.textContent = txt;
}

/* ---------------------------- auto-lock after inactivity ---------------------------- */

function scheduleAutolock() {
  if (!settings.autoLockMins || !paranoidOn() || !unlockKey) {
    lockDeadline = 0;
    return;
  }
  lockDeadline = Date.now() + settings.autoLockMins * 60000;
}

function autolockTick() {
  if (!lockDeadline) return;
  // active use counts: mid-generation, or the settings dialog is open
  if (streaming || $('#settings').open) { scheduleAutolock(); return; }
  if (Date.now() >= lockDeadline) doAutoLock();
}

function doAutoLock() {
  if (!unlockKey) return;
  lockDeadline = 0;
  unlockKey = null;
  unlockedKeys = {};
  refreshProviderFields();
  updateKeyHint();
  toast('Auto-locked after inactivity — passphrase needed next time');
}

/* ---------------------------- search across chats ---------------------------- */

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function markSnippet(raw, q) {
  const ql = q.toLowerCase();
  const idx = raw.toLowerCase().indexOf(ql);
  if (idx < 0) return escapeHtml(raw.slice(0, 90));
  const start = Math.max(0, idx - 26);
  const end = Math.min(raw.length, idx + ql.length + 80);
  const win = (start > 0 ? '…' : '') + raw.slice(start, end) + (end < raw.length ? '…' : '');
  try {
    const re = new RegExp('(' + escapeRegExp(q) + ')', 'ig');
    const parts = win.split(re);
    return parts.map((part, i) => (i % 2 ? '<mark>' + escapeHtml(part) + '</mark>' : escapeHtml(part))).join('');
  } catch {
    return escapeHtml(win);
  }
}

function searchChats(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = [];
  const sorted = convos.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  for (const c of sorted) {
    if ((c.title || '').toLowerCase().includes(q)) {
      results.push({ convo: c, msg: null, raw: c.title || 'Untitled' });
    }
    for (const m of c.messages) {
      if ((m.text || '').toLowerCase().includes(q)) {
        results.push({ convo: c, msg: m, raw: m.text || '' });
      }
    }
  }
  return results;
}

function renderSearch(query) {
  const list = $('#convo-list');
  const res = $('#search-results');
  const q = query.trim();
  if (!q) {
    res.hidden = true;
    list.style.display = '';
    return;
  }
  const results = searchChats(q);
  list.style.display = 'none';
  res.hidden = false;
  if (!results.length) {
    res.innerHTML =
      '<p class="hint" style="padding:6px 8px">No chats match “' + escapeHtml(q.slice(0, 40)) +
      '”. Try fewer or different words.</p>';
    return;
  }
  const shown = results.slice(0, 30);
  res.innerHTML =
    shown
      .map((r) => {
        const title = escapeHtml(r.convo.title || 'Untitled') + ' · ' + relDate(r.convo.updated || r.convo.created);
        const role = r.msg ? '<span class="sh-role">' + (r.msg.role === 'user' ? 'you' : 'ai') + '</span> ' : '';
        return (
          '<button type="button" class="search-hit" data-convo="' + r.convo.id + '"' +
          (r.msg ? ' data-msg="' + r.msg.id + '"' : '') + '>' +
          '<span class="sh-title">' + title + '</span>' +
          '<span class="sh-snip">' + role + markSnippet(r.raw, q) + '</span>' +
          '</button>'
        );
      })
      .join('') +
    (results.length > 30
      ? '<p class="hint" style="padding:6px 8px">+' + (results.length - 30) + ' more — keep typing to narrow it down</p>'
      : '');
}

function afterRenderScroll() {
  if (!pendingScrollMsgId) return;
  const id = pendingScrollMsgId;
  pendingScrollMsgId = null;
  const el = document.querySelector('#messages [data-id="' + id + '"]');
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 3500);
}

function apiBase() {
  const conf = providerConf();
  return (settings.bases[settings.provider] || conf.base || '').trim().replace(/\/+$/, '');
}

function modelLabel() {
  return settings.model[settings.provider] || providerConf().defaultModel || 'model';
}

function anthropicHeaders(key) {
  return {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

async function httpError(res) {
  let msg = '';
  let txt = '';
  try { txt = await res.text(); } catch { /* body unreadable */ }
  try {
    const j = JSON.parse(txt);
    msg = j.error?.message || j.message || j.error?.status || '';
  } catch {
    msg = txt.slice(0, 300);
  }
  const err = new Error(String(msg || 'HTTP ' + res.status));
  err.status = res.status;
  return err;
}

function friendlyError(err) {
  if (err.status === 401 || err.status === 403) {
    return 'The API key was rejected. Open Settings → AI and check the key for this provider.';
  }
  if (err.status === 404) {
    return 'Model or address not found. Check the model name (Settings → AI), and try "Load model list".';
  }
  if (err.status === 429) {
    return 'Rate limit reached. Wait a moment, then tap Retry.';
  }
  if (err.status >= 500) {
    return 'The provider had a server problem. Usually works on retry — tap Retry.';
  }
  if (err.status === 400 && /max_tokens|maxOutputTokens/i.test(err.message || '')) {
    return 'The provider rejected the max answer length. Lower "Max answer length" in Settings → AI → Advanced.';
  }
  if (err instanceof TypeError || /fetch|network/i.test(err.message || '')) {
    return 'Could not reach the server. Check your connection and the Base URL. Using Ollama or LM Studio? Start it with browser access allowed, e.g. OLLAMA_ORIGINS="*" ollama serve.';
  }
  return 'Something went wrong talking to the AI. Tap Retry, or check Settings → AI.';
}

function normalizeHistory(messages) {
  // merge consecutive same-role messages (some APIs require strict alternation)
  const out = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role) last.text += '\n\n' + m.text;
    else out.push({ role, text: m.text });
  }
  while (out.length && out[0].role === 'assistant') out.shift();
  return out;
}

async function readSSE(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        if (data) {
          try { onEvent(JSON.parse(data)); } catch { /* keepalive or partial */ }
        }
      }
    }
  }
}

function extractDelta(kind, j) {
  try {
    if (kind === 'openai') return j.choices?.[0]?.delta?.content || '';
    if (kind === 'anthropic') return j.type === 'content_block_delta' && j.delta?.text ? j.delta.text : '';
    if (kind === 'gemini') return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  } catch { /* malformed chunk */ }
  return '';
}

async function streamChat({ messages, system, onDelta, signal }) {
  const conf = providerConf();
  const kind = conf.kind;
  const key = apiKey();
  const base = apiBase();
  const model = modelLabel();

  if (!base) throw new Error('No Base URL set — open Settings → AI.');
  if (conf.needsKey && !key) {
    const e = new Error('No API key set — open Settings → AI.');
    e.noKey = true;
    throw e;
  }

  const hist = normalizeHistory(messages);
  const stream = settings.stream;
  let headers = { 'Content-Type': 'application/json' };

  const consume = async (res) => {
    if (stream) {
      if (!res.body) throw new Error('Streaming not supported by this server — turn off "Show answers as they are written" in Settings → AI → Advanced.');
      let got = false;
      await readSSE(res, (j) => {
        const d = extractDelta(kind, j);
        if (d) { got = true; onDelta(d); }
      });
      if (!got) throw new Error('Empty response from the model. Try again or pick another model.');
    } else {
      const j = await res.json();
      let text = '';
      if (kind === 'openai') text = j.choices?.[0]?.message?.content || '';
      else if (kind === 'anthropic') text = (j.content || []).map((c) => c.text || '').join('');
      else text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!text) throw new Error('Empty response — try raising "Max answer length" (Settings → AI → Advanced) or pick another model.');
      onDelta(text);
    }
  };

  if (kind === 'openai') {
    const url = base + '/chat/completions';
    if (key) headers['Authorization'] = 'Bearer ' + key;
    if (settings.provider === 'openrouter') headers['X-Title'] = 'Anchor';
    const body = {
      model,
      messages: [{ role: 'system', content: system }, ...hist.map((m) => ({ role: m.role, content: m.text }))],
      temperature: settings.temperature,
      top_p: settings.topP,
      max_tokens: settings.maxTokens,
      stream,
    };
    // Newer OpenAI models reject some legacy params — read the server's complaint
    // and resend without them instead of failing the whole answer.
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
      if (res.ok) { await consume(res); return; }
      const err = await httpError(res);
      if (err.status === 400 && attempt < 3) {
        const msg = err.message || '';
        if (/max_tokens|max_completion_tokens/i.test(msg)) {
          const mt = body.max_tokens ?? body.max_completion_tokens ?? settings.maxTokens;
          delete body.max_tokens;
          body.max_completion_tokens = mt;
          continue;
        }
        if (/temperature/i.test(msg)) { delete body.temperature; continue; }
        if (/top_p/i.test(msg)) { delete body.top_p; continue; }
      }
      throw err;
    }
  }

  if (kind === 'anthropic') {
    const url = base + '/v1/messages';
    Object.assign(headers, anthropicHeaders(key));
    const body = {
      model,
      system,
      messages: hist.map((m) => ({ role: m.role, content: [{ type: 'text', text: m.text }] })),
      max_tokens: settings.maxTokens,
      temperature: Math.min(settings.temperature, 1),
      top_p: settings.topP,
      stream,
    };
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) throw await httpError(res);
    await consume(res);
    return;
  }

  // gemini
  const url = base + '/v1beta/models/' + encodeURIComponent(model) + (stream ? ':streamGenerateContent?alt=sse' : ':generateContent');
  headers['x-goog-api-key'] = key;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: hist.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
    generationConfig: {
      temperature: settings.temperature,
      topP: settings.topP,
      maxOutputTokens: settings.maxTokens,
    },
  };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) throw await httpError(res);
  await consume(res);
}

async function fetchModels() {
  const conf = providerConf();
  const kind = conf.kind;
  const key = apiKey();
  const base = apiBase();
  if (!base) throw new Error('No Base URL set.');
  if (conf.needsKey && !key) throw new Error('Add your API key first.');

  let url;
  let headers = {};
  if (kind === 'anthropic') {
    url = base + '/v1/models';
    Object.assign(headers, anthropicHeaders(key));
  } else if (kind === 'gemini') {
    url = base + '/v1beta/models?pageSize=1000';
    headers['x-goog-api-key'] = key;
  } else {
    url = base + '/models';
    if (key) headers['Authorization'] = 'Bearer ' + key;
    if (settings.provider === 'openrouter') headers['X-Title'] = 'Anchor';
  }

  const res = await fetch(url, { headers });
  if (!res.ok) throw await httpError(res);
  const j = await res.json();

  let ids = [];
  if (kind === 'gemini') {
    ids = (j.models || []).map((m) => (m.name || '').replace(/^models\//, ''));
  } else {
    ids = (j.data || j.models || []).map((m) => m.id || m.name || '');
  }
  ids = ids.filter(Boolean).filter((n) => !/embedding|imagen|veo|tts|whisper|aqa|moderation/i.test(n));
  return [...new Set(ids)].sort();
}

/* ---------------------------- preferences ---------------------------- */

function applyPrefs() {
  const root = document.documentElement;
  const theme = settings.theme === 'auto'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : settings.theme;
  root.dataset.theme = theme;
  root.style.setProperty('--font-scale', settings.fontScale);
  root.dataset.spacing = settings.spacing;
  root.dataset.motion = settings.reduceMotion ? 'reduce' : 'full';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#f7f5f1' : '#14161a';
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (settings.theme === 'auto') applyPrefs();
});

/* ---------------------------- toast ---------------------------- */

let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

let flashTimer = null;
function flashSaved() {
  const el = $('#save-flash');
  if (!el) return;
  el.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

/* ---------------------------- rendering: sidebar ---------------------------- */

/* ---------------------------- natural-language tool finder ---------------------------- */

const STOP = new Set(
  ('i im ive to a an the my me about for with of on in at and or is are it its this that these those ' +
    'them they you your yours please so but if then when what which who whom whose why how now do does ' +
    'did doing be been being was were will would could should shall may might must just really very ' +
    'some something someone anybody anything stuff person people thing things').split(' ')
);

const TOOL_MATCH = {
  steps: { phrases: ['break it down', 'step by step', 'how do i do', 'piece by piece'], words: ['step', 'instruction', 'plan', 'checklist', 'guide', 'project', 'task', 'big', 'breakdown'] },
  start: { phrases: ['get started', 'just start', 'keep avoiding', 'get going', 'cant start', "can't start", 'get past'], words: ['start', 'stuck', 'avoid', 'avoiding', 'procrastinate', 'begin', 'first', 'action', 'dread'] },
  howstart: { phrases: ['how to start', 'tips for starting', 'ways to start', 'start a task'], words: ['tip', 'trick', 'strategy', 'strategies', 'motivation', 'hack'] },
  howlong: { phrases: ['how long', 'time estimate', 'will it take', 'how much time'], words: ['long', 'estimate', 'duration', 'minutes', 'hours', 'spend'] },
  fits: { phrases: ['what can i do', 'short on time', 'little time', 'spare time'], words: ['energy', 'battery', 'window', 'gap', 'capacity', 'fit'] },
  three: { phrases: ['what should i do today', 'most important', 'pick for me'], words: ['today', 'prioritize', 'priority', 'focus', 'three', 'top'] },
  call: { phrases: ['phone call', 'make a call', 'call them', 'phone them', 'ring them'], words: ['call', 'phone', 'dial', 'telephone', 'receptionist', 'helpline'] },
  hardtalk: { phrases: ['hard conversation', 'difficult conversation', 'awkward conversation', 'talk to my boss', 'need to tell', 'set a boundary'], words: ['conversation', 'difficult', 'awkward', 'confront', 'boundary', 'boundaries', 'boss', 'argument'] },
  switch: { phrases: ['switch tasks', 'switch to', 'transition between', 'stop doing'], words: ['switch', 'transition', 'change', 'move', 'shift', 'pivot'] },
  decode: { phrases: ['what did they mean', 'what they meant', 'hidden meaning', 'reading into'], words: ['message', 'text', 'email', 'mean', 'interpret', 'subtext', 'reply'] },
  tone: { phrases: ['tone check', 'how does this sound', 'before i send', 'sounds rude', 'sounds harsh', 'sounds aggressive'], words: ['tone', 'rude', 'blunt', 'soften', 'harsh', 'across', 'draft'] },
  summarize: { phrases: ['summarize this', 'main points', 'key points', 'too long', 'tldr'], words: ['summarize', 'summarise', 'summary', 'shorten', 'condense', 'article', 'bullet', 'skim'] },
  rescue: { phrases: ['too much', 'shut down', 'cant move', "can't move", 'cant function', "can't function", 'falling apart', 'melting down'], words: ['overwhelmed', 'frozen', 'panic', 'meltdown', 'shutdown', 'spiral', 'drowning', 'anxious', 'anxiety', 'burnout'] },
  routine: { phrases: ['morning routine', 'evening routine', 'leaving the house', 'wind down', 'bedtime'], words: ['routine', 'morning', 'evening', 'night', 'bed', 'habit', 'daily', 'schedule'] },
  futureme: { phrases: ['future me', 'dont forget', "don't forget", 'will forget', 'note to self'], words: ['note', 'remember', 'forget', 'future', 'reminder', 'scribble', 'context'] },
  decide: { phrases: ['decide for me', 'cant decide', "can't decide", 'make the decision', 'decision paralysis', 'pick one'], words: ['decide', 'decision', 'choose', 'option', 'options', 'choice', 'indecisive', 'paralysis'] },
  simple: { phrases: ['explain like', 'in plain english', 'too complicated', 'what does this mean', 'dont understand', "don't understand"], words: ['explain', 'simple', 'simplify', 'understand', 'confusing', 'jargon', 'plain', 'eli5'] },
  script: { phrases: ['write it for me', 'what should i say', 'how do i say', 'word for word', 'ready to send'], words: ['write', 'draft', 'compose', 'letter', 'response', 'wording', 'script'] },
  sort: { phrases: ['brain dump', 'sort my thoughts', 'too many thoughts', 'mess in my head', 'all over the place'], words: ['dump', 'messy', 'organize', 'organise', 'sort', 'chaos', 'thoughts', 'jumble', 'scattered'] },
};

// tools that often go together with a matched tool
const TOOL_HINTS = {
  call: ['start', 'howstart'],
  hardtalk: ['script', 'decode'],
  steps: ['three', 'howlong'],
  start: ['howstart'],
  decode: ['tone', 'script'],
  summarize: ['simple'],
  rescue: ['three'],
  fits: ['howlong'],
  three: ['sort'],
  futureme: ['sort'],
  switch: ['start'],
};

function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}

function tokenize(q) {
  return q
    .toLowerCase()
    .replace(/tl;dr/g, 'tldr')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

function findTools(query) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const raw = query.toLowerCase();
  const results = [];
  for (const t of TOOLS) {
    const dict = TOOL_MATCH[t.id] || {};
    let score = 0;
    const why = new Set();
    for (const ph of dict.phrases || []) {
      if (raw.includes(ph)) { score += 6; why.add(ph); }
    }
    for (const w of dict.words || []) {
      if (tokens.includes(stem(w))) { score += 3; why.add(w); }
    }
    // the tool's own label/description words count a little
    const labelWords = (t.label + ' ' + t.desc).toLowerCase().match(/[a-z]+/g) || [];
    for (const w of labelWords) {
      if (w.length > 2 && !STOP.has(w) && tokens.includes(stem(w))) score += 1;
    }
    if (score > 0) results.push({ tool: t, score, why: [...why] });
  }
  // "often used together" suggestions
  const hinted = new Map();
  for (const r of results) {
    for (const id of TOOL_HINTS[r.tool.id] || []) {
      if (!results.some((x) => x.tool.id === id)) {
        hinted.set(id, Math.max(2, hinted.get(id) || 2));
      }
    }
  }
  for (const [id, s] of hinted) {
    const t = TOOLS.find((x) => x.id === id);
    if (t) results.push({ tool: t, score: s, why: ['related'] });
  }
  return results.sort((a, b) => b.score - a.score).filter((r) => r.score >= 2).slice(0, 4);
}

function renderFinder(query, resultsEl, listEl) {
  const q = query.trim();
  if (!q) {
    resultsEl.hidden = true;
    resultsEl.innerHTML = '';
    if (listEl) listEl.style.display = '';
    return;
  }
  const matches = findTools(q);
  if (!matches.length) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '<p class="finder-msg">No tool matched that — try other words, or browse the list.</p>';
    if (listEl) listEl.style.display = '';
    return;
  }
  if (listEl) listEl.style.display = 'none';
  resultsEl.hidden = false;
  resultsEl.innerHTML = matches
    .map((m) => {
      const why = m.why[0] === 'related'
        ? 'often used together'
        : 'matched: ' + m.why.slice(0, 3).map((w) => '“' + escapeHtml(w) + '”').join(', ');
      return (
        '<div class="finder-hit">' + toolBtnHtml(m.tool) +
        '<div class="finder-why">' + why + '</div>' +
        '</div>'
      );
    })
    .join('');
}


function sortedTools() {
  const favs = (settings.favoriteTools || []).filter((id) => TOOLS.some((t) => t.id === id));
  const favTools = favs.map((id) => TOOLS.find((t) => t.id === id));
  const rest = TOOLS.filter((t) => !favs.includes(t.id));
  return [...favTools, ...rest];
}

function toolBtnHtml(t) {
  const fav = (settings.favoriteTools || []).includes(t.id);
  const starFill = fav ? 'currentColor' : 'none';
  return (
    '<div class="tool-card">' +
    '<button type="button" class="tool-btn" data-tool="' + t.id + '">' +
    icon(TOOL_ICONS[t.id] || 'bubble') +
    '<span><span class="t-label">' + escapeHtml(t.label) + '</span>' +
    '<span class="t-desc">' + escapeHtml(t.desc) + '</span></span>' +
    '</button>' +
    '<button type="button" class="tool-star' + (fav ? ' active' : '') + '" data-fav="' + t.id + '" ' +
    'aria-label="' + (fav ? 'Unfavorite ' : 'Favorite ') + escapeHtml(t.label) + '" ' +
    'title="' + (fav ? 'Unfavorite' : 'Favorite — moves it to the top') + '">' +
    '<svg class="ic" viewBox="0 0 24 24" fill="' + starFill + '" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' +
    '</button>' +
    '</div>'
  );
}

function toggleFavTool(id) {
  if (!TOOLS.some((t) => t.id === id)) return;
  const favs = settings.favoriteTools || [];
  const i = favs.indexOf(id);
  if (i >= 0) favs.splice(i, 1);
  else favs.push(id);
  settings.favoriteTools = favs;
  saveSettings();
  renderTools();
  toast(i >= 0 ? 'Removed from favorites' : '★ Favorited — it stays at the top');
}

function renderTools() {
  const all = sortedTools();
  $('#tool-list').innerHTML = all.map(toolBtnHtml).join('');
  // home screen stays calm: favorites only once starred, otherwise a starter set
  const favs = all.filter((t) => (settings.favoriteTools || []).includes(t.id));
  if (favs.length) {
    $('#tool-list-empty').innerHTML = favs.map(toolBtnHtml).join('');
  } else {
    $('#tool-list-empty').innerHTML =
      all.slice(0, 8).map(toolBtnHtml).join('') +
      '<p class="dim" style="grid-column:1/-1;margin:4px 0 0;">All ' + all.length + ' tools live in the side menu (☰) — star your favorites to pin them here.</p>';
  }
}

const TOOL_ICONS = {
  steps: 'steps', start: 'play', howstart: 'bulb', decide: 'check', simple: 'bubble',
  script: 'pencil', sort: 'funnel', howlong: 'clock', fits: 'hourglass', three: 'target',
  call: 'phone', hardtalk: 'shield', switch: 'arrows', decode: 'eye', tone: 'gauge',
  summarize: 'doc', rescue: 'lifebuoy', routine: 'repeat', futureme: 'mail',
};

function renderConvList() {
  const list = $('#convo-list');
  const sorted = convos.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  if (!sorted.length) {
    list.innerHTML = '<p class="hint" style="padding:4px 8px">No chats yet. Your conversations appear here.</p>';
    return;
  }
  list.innerHTML = sorted
    .map(
      (c) =>
        '<div class="convo-item' + (c.id === currentId ? ' active' : '') + '" data-id="' + c.id + '" role="button" tabindex="0">' +
        '<span class="c-title">' + escapeHtml(c.title || 'Untitled') + '</span>' +
        '<span class="c-date">' + relDate(c.updated || c.created) + '</span>' +
        '<button type="button" class="c-del" data-del="' + c.id + '" aria-label="Delete chat" title="Delete">' + icon('trash') + '</button>' +
        '</div>'
    )
    .join('');
  // keep live search results up to date after sends/deletes
  if (!$('#search-results').hidden) renderSearch($('#search-input').value);
}

/* ---------------------------- rendering: messages ---------------------------- */

function renderMessages() {
  const wrap = $('#messages');
  const convo = currentConvo();
  const msgs = convo ? convo.messages : [];
  $('#empty').style.display = msgs.length ? 'none' : '';
  wrap.innerHTML = msgs.map((m) => renderMessage(m)).join('');
  scrollToBottom(true);
  afterRenderScroll();
  if (ttsActive && ttsMessageId) markSpeaking(ttsMessageId, true); // survive re-renders
}

function renderMessage(m) {
  const isUser = m.role === 'user';
  const who = isUser ? 'You' : (m.model || 'Assistant');
  let actions = '';
  if (isUser) {
    actions =
      '<button type="button" class="act-btn" data-act="copy" data-id="' + m.id + '">' + icon('copy') + 'Copy</button>' +
      '<button type="button" class="act-btn" data-act="edit" data-id="' + m.id + '">' + icon('pencil') + 'Edit</button>';
  } else {
    actions =
      '<button type="button" class="act-btn" data-act="copy" data-id="' + m.id + '">' + icon('copy') + 'Copy</button>' +
      (ttsSupported() ? '<button type="button" class="act-btn" data-listen="' + m.id + '" aria-pressed="false">' + icon('speaker') + 'Listen</button>' : '') +
      '<button type="button" class="act-btn" data-act="retry" data-id="' + m.id + '">' + icon('retry') + 'Retry</button>';
  }
  return (
    '<div class="msg ' + m.role + '" data-id="' + m.id + '">' +
    '<div class="meta">' + escapeHtml(who) + ' · ' + fmtTime(m.ts) + '</div>' +
    '<div class="bubble">' + mdRender(m.text) + '</div>' +
    '<div class="actions">' + actions + '</div>' +
    '</div>'
  );
}

function userNearBottom() {
  const chat = $('#chat');
  return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 120;
}

function scrollToBottom(force) {
  if (force || userNearBottom()) {
    const chat = $('#chat');
    chat.scrollTop = chat.scrollHeight;
  }
}

/* live assistant bubble used during streaming */
function makeLiveBubble() {
  const wrap = $('#messages');
  $('#empty').style.display = 'none';
  const root = document.createElement('div');
  root.className = 'msg assistant streaming';
  root.innerHTML =
    '<div class="meta">' + escapeHtml(modelLabel()) + '</div>' +
    '<div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>';
  wrap.appendChild(root);
  scrollToBottom(true);

  const body = root.querySelector('.bubble');
  let pending = null;
  let raf = 0;
  return {
    root,
    update(text) {
      pending = text;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (pending !== null) {
            body.innerHTML = mdRender(pending);
            scrollToBottom(false);
          }
        });
      }
    },
    remove() {
      cancelAnimationFrame(raf);
      root.remove();
    },
    finish() {
      cancelAnimationFrame(raf);
      root.remove();
    },
  };
}

function renderErrorBubble(err) {
  const wrap = $('#messages');
  const div = document.createElement('div');
  div.className = 'msg error';
  const friendly = err.noKey
    ? 'No API key yet. Add one in Settings → AI (one minute, free options exist).'
    : friendlyError(err);
  div.innerHTML =
    '<div class="bubble">' +
    '<p class="e-title">That didn\'t work</p>' +
    '<p>' + escapeHtml(friendly) + '</p>' +
    (err.message && !err.noKey ? '<div class="e-detail">' + escapeHtml(String(err.message).slice(0, 500)) + '</div>' : '') +
    '<div class="e-actions"><button type="button" class="btn-ghost" data-act="regen">' + icon('retry') + 'Retry</button></div>' +
    '</div>';
  wrap.appendChild(div);
  scrollToBottom(true);
}

/* ---------------------------- voice input ---------------------------- */

let recog = null; // active SpeechRecognition
let voiceActive = false;
let voiceBase = ''; // composer text when recording started
let voiceFinal = ''; // accumulated final transcript

function speechSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || recog) return;
  const input = $('#composer-input');
  const r = new SR();
  r.lang = (settings.voiceLang || navigator.language || 'en-US').trim();
  r.continuous = true;
  r.interimResults = true;
  voiceBase = input.value ? input.value.replace(/\s+$/, '') + ' ' : '';
  voiceFinal = '';

  r.onresult = (e) => {
    if (!voiceActive) return; // events after an intentional stop
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) voiceFinal += res[0].transcript;
      else interim += res[0].transcript;
    }
    input.value = voiceBase + voiceFinal + interim;
    autoGrow(input);
    updateSendBtn();
  };

  r.onerror = (e) => {
    const err = e.error || '';
    if (err === 'no-speech') toast("Didn't catch anything — try again.");
    else if (err === 'not-allowed' || err === 'service-not-allowed') toast('Microphone blocked — allow mic access for this site in your browser settings.');
    else if (err === 'audio-capture') toast('No microphone found.');
    else if (err === 'network') toast('Speech service unreachable — check your connection.');
    // 'aborted' is normal when stopping — ignore
  };

  r.onend = () => {
    recog = null;
    stopVoiceUi();
    if (voiceActive || voiceFinal || voiceBase) {
      const input2 = $('#composer-input');
      input2.value = (voiceBase + voiceFinal).replace(/\s+$/, '');
      voiceActive = false;
      autoGrow(input2);
      updateSendBtn();
      input2.focus();
      input2.setSelectionRange(input2.value.length, input2.value.length);
    }
  };

  try {
    r.start();
    recog = r;
    voiceActive = true;
    $('#mic-btn').classList.add('listening');
    $('#mic-btn').setAttribute('aria-pressed', 'true');
  } catch {
    recog = null;
  }
}

function stopVoice(keepText) {
  if (!recog) return;
  if (!keepText) {
    voiceBase = '';
    voiceFinal = '';
    voiceActive = false; // block late onresult writes
  }
  try { recog.stop(); } catch { /* already stopped */ }
}

function stopVoiceUi() {
  const b = $('#mic-btn');
  b.classList.remove('listening');
  b.setAttribute('aria-pressed', 'false');
}

function toggleVoice() {
  if (voiceActive) stopVoice(true);
  else startVoice();
}

/* ---------------------------- text-to-speech (read aloud) ---------------------------- */

let ttsSession = 0; // token: stale utterance events from a stopped session are ignored
let ttsActive = false;
let ttsMessageId = null;

function ttsSupported() {
  return 'speechSynthesis' in window;
}

// strip markdown so it sounds natural, not like reading syntax
function speechText(md) {
  return String(md)
    .replace(/```[\s\S]*?```/g, ' ') // code blocks are not read aloud
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> their text
    .replace(/[#>`_~]+/g, ' ')
    .replace(/\*+/g, '')
    .replace(/^\s*[-+•]\s+/gm, '') // bullets
    .replace(/^\s*\d+[.)]\s+/gm, '') // numbers (spoken naturally by pause)
    .replace(/\|/g, ', ') // tables
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Chrome cuts long utterances — speak in small sentence-sized chunks
function chunkText(text, max = 220) {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]+["')\]]*|\S+$/g) || [];
  const chunks = [];
  let cur = '';
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ''; };
  for (const s of sentences) {
    if (s.length > max) {
      // very long sentence: split on word boundaries
      for (const w of s.split(' ')) {
        if ((cur + ' ' + w).length > max) push();
        cur = cur ? cur + ' ' + w : w;
      }
      continue;
    }
    if ((cur + s).length > max) push();
    cur += s;
  }
  push();
  return chunks;
}

function pickVoice() {
  if (!settings.ttsVoiceURI || !ttsSupported()) return null;
  const voices = speechSynthesis.getVoices() || [];
  return voices.find((v) => v.voiceURI === settings.ttsVoiceURI) || null;
}

function markSpeaking(id, on) {
  const el = document.querySelector('#messages .msg[data-id="' + id + '"]');
  if (!el) return;
  el.classList.toggle('speaking', on);
  const b = el.querySelector('[data-listen]');
  if (b) {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = (on ? icon('stopbtn') + 'Stop' : icon('speaker') + 'Listen');
  }
}

function finishSpeaking() {
  ttsActive = false;
  const id = ttsMessageId;
  ttsMessageId = null;
  if (id) markSpeaking(id, false);
}

function stopSpeaking() {
  if (!ttsSupported()) return;
  ttsSession++; // invalidate any in-flight utterance events
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
  finishSpeaking();
}

function speakMessage(id) {
  const convo = currentConvo();
  const m = convo && convo.messages.find((x) => x.id === id);
  if (!m || !ttsSupported()) return;
  stopSpeaking();
  const text = speechText(m.text);
  if (!text) {
    toast('Nothing to read aloud — probably just code.');
    return;
  }
  const chunks = chunkText(text);
  if (!chunks.length) return;

  const sess = ++ttsSession;
  ttsActive = true;
  ttsMessageId = id;
  markSpeaking(id, true);

  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c);
    u.rate = settings.ttsRate || 1;
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    if (i === chunks.length - 1) {
      u.onend = u.onerror = () => {
        if (ttsSession === sess) finishSpeaking();
      };
    }
    speechSynthesis.speak(u);
  });
}

function populateVoices() {
  const sel = $('#set-ttsvoice');
  if (!sel || !ttsSupported()) return;
  const voices = speechSynthesis.getVoices() || [];
  sel.innerHTML =
    '<option value="">Device default</option>' +
    voices
      .map((v) => '<option value="' + escapeHtml(v.voiceURI) + '">' + escapeHtml(v.name + ' (' + v.lang + ')') + '</option>')
      .join('');
  const cur = settings.ttsVoiceURI || '';
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
}

/* ---------------------------- conversation actions ---------------------------- */

function newChat() {
  if (streaming) stopStreaming();
  if (voiceActive) stopVoice(true);
  stopSpeaking();
  currentId = null;
  rememberLast();
  $('#chat-title').textContent = 'New chat';
  renderMessages();
  renderConvList();
  closeSidebar();
  $('#composer-input').focus();
}

function switchConvo(id) {
  if (id === currentId) {
    if (pendingScrollMsgId) afterRenderScroll(); // already rendered — just jump to it
    closeSidebar();
    return;
  }
  if (streaming) stopStreaming();
  if (voiceActive) stopVoice(true);
  stopSpeaking();
  currentId = id;
  rememberLast();
  const c = currentConvo();
  if (c) $('#chat-title').textContent = c.title || 'Chat';
  renderMessages();
  renderConvList();
  closeSidebar();
}

function deleteConvo(id) {
  convos = convos.filter((c) => c.id !== id);
  if (currentId === id) {
    stopSpeaking();
    currentId = null;
    $('#chat-title').textContent = 'New chat';
    renderMessages();
  }
  saveConvos();
  renderConvList();
  toast('Chat deleted');
}

function ensureConvo() {
  let c = currentConvo();
  if (!c) {
    c = { id: uid(), title: 'New chat', created: Date.now(), updated: Date.now(), messages: [] };
    convos.push(c);
    currentId = c.id;
  }
  return c;
}

async function sendCurrentText() {
  const input = $('#composer-input');
  const text = input.value.trim();
  if (!text || streaming) return;
  if (voiceActive) stopVoice(false); // stop mic; late events won't resurrect sent text

  const conf = providerConf();
  if (conf.needsKey && isLocked()) {
    const ok = await promptUnlock();
    if (!ok) {
      toast('Still locked — tap send again to retry.');
      return;
    }
  }
  if (conf.needsKey && !apiKey()) {
    openSettings('ai');
    toast('Add your API key first — Settings → AI');
    return;
  }

  const convo = ensureConvo();
  rememberLast();
  convo.messages.push({ id: uid(), role: 'user', text, ts: Date.now() });
  if (convo.messages.length === 1) {
    convo.title = text.length > 44 ? text.slice(0, 44).replace(/\s+\S*$/, '') + '…' : text;
    $('#chat-title').textContent = convo.title;
  }
  convo.updated = Date.now();
  saveConvos();

  input.value = '';
  autoGrow(input);
  updateSendBtn();

  renderMessages();
  renderConvList();
  generate();
}

function stopStreaming() {
  if (aborter) aborter.abort();
}

function setSending(on) {
  const btn = $('#send-btn');
  streaming = on;
  if (on) {
    btn.classList.add('stop');
    btn.disabled = false;
    btn.setAttribute('aria-label', 'Stop');
    btn.title = 'Stop';
    btn.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>';
  } else {
    btn.classList.remove('stop');
    btn.setAttribute('aria-label', 'Send message');
    btn.title = 'Send';
    btn.innerHTML = icon('send');
    updateSendBtn();
  }
}

async function generate() {
  const convo = currentConvo();
  if (!convo || !convo.messages.length) return;
  if (convo.messages[convo.messages.length - 1].role === 'assistant') return;

  aborter = new AbortController();
  setSending(true);
  const live = makeLiveBubble();

  const t0 = Date.now();
  genTimer = setInterval(() => {
    const meta = live.root.querySelector('.meta');
    if (meta) meta.textContent = modelLabel() + ' · writing… ' + Math.round((Date.now() - t0) / 1000) + 's';
  }, 1000);

  let acc = '';
  try {
    await streamChat({
      messages: convo.messages,
      system: buildSystemPrompt(),
      onDelta: (d) => {
        acc += d;
        live.update(acc);
      },
      signal: aborter.signal,
    });
    live.finish();
    convo.messages.push({ id: uid(), role: 'assistant', text: acc, model: modelLabel(), ts: Date.now() });
    convo.updated = Date.now();
    saveConvos();
    renderConvList();
    renderMessages();
    if (settings.autoSpeak && ttsSupported()) {
      const last = convo.messages[convo.messages.length - 1];
      if (last) speakMessage(last.id);
    }
  } catch (err) {
    if (err && err.name === 'AbortError') {
      live.finish();
      if (acc.trim()) {
        convo.messages.push({ id: uid(), role: 'assistant', text: acc, model: modelLabel(), ts: Date.now() });
        convo.updated = Date.now();
        saveConvos();
        renderConvList();
        renderMessages();
        toast('Stopped — kept what was written');
      } else {
        renderMessages(); // restores empty state if needed
        toast('Stopped');
      }
    } else {
      live.remove();
      renderErrorBubble(err);
    }
  } finally {
    clearInterval(genTimer);
    genTimer = null;
    aborter = null;
    setSending(false);
  }
}

function regenerate() {
  if (streaming) return;
  const convo = currentConvo();
  if (!convo) return;
  while (convo.messages.length && convo.messages[convo.messages.length - 1].role === 'assistant') {
    convo.messages.pop();
  }
  convo.updated = Date.now();
  saveConvos();
  renderMessages();
  if (convo.messages.length) generate();
}

function editMessage(id) {
  if (streaming) return;
  const convo = currentConvo();
  if (!convo) return;
  const idx = convo.messages.findIndex((m) => m.id === id);
  if (idx < 0 || convo.messages[idx].role !== 'user') return;
  const input = $('#composer-input');
  input.value = convo.messages[idx].text;
  convo.messages.splice(idx);
  convo.updated = Date.now();
  saveConvos();
  renderMessages();
  autoGrow(input);
  updateSendBtn();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

/* ---------------------------- export ---------------------------- */

function download(filename, content, type) {
  const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function exportCurrentChat() {
  const c = currentConvo();
  if (!c || !c.messages.length) { toast('Nothing to export yet.'); return; }
  const lines = ['# ' + (c.title || 'Chat'), ''];
  for (const m of c.messages) {
    const who = m.role === 'user' ? 'You' : (m.model || 'Assistant');
    lines.push('## ' + who + ' — ' + fmtTime(m.ts), '', m.text, '');
  }
  download(anchorSafeName(c.title) + '.md', lines.join('\n'), 'text/markdown;charset=utf-8');
  toast('Chat downloaded');
}

function anchorSafeName(s) {
  return (s || 'chat').replace(/[^\w\d -]+/g, '').replace(/\s+/g, '-').slice(0, 60) || 'chat';
}

function exportAll() {
  if (!convos.length) { toast('Nothing to export yet.'); return; }
  download('anchor-chats.json', JSON.stringify({ app: 'anchor', exported: new Date().toISOString(), conversations: convos }, null, 2), 'application/json');
  toast('All chats downloaded (no keys included)');
}

/* ---------------------------- clipboard ---------------------------- */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('Copied');
    } catch {
      toast('Could not copy — long-press to select instead');
    }
  }
}

/* ---------------------------- sidebar / dialogs ---------------------------- */

function openSidebar() {
  $('#sidebar').classList.add('open');
  $('#backdrop').hidden = false;
}
function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#backdrop').hidden = true;
}

/* ---------------------------- sidebar accordions ---------------------------- */

function accordDefaults() {
  return { tools: true, chats: false };
}

function loadAccordState() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_ACCORD) || '{}');
    if (raw && typeof raw === 'object') return Object.assign(accordDefaults(), raw);
  } catch { /* ignore */ }
  return accordDefaults();
}

let accordState = loadAccordState();

function applyAccord(name) {
  const btn = $('#acc-' + name);
  const body = $('#acc-' + name + '-body');
  if (!btn || !body) return;
  const open = !!accordState[name];
  btn.setAttribute('aria-expanded', String(open));
  body.hidden = !open;
  const nav = btn.closest('nav');
  if (nav) nav.classList.toggle('acc-open', open);
}

function toggleAccord(name) {
  accordState[name] = !accordState[name];
  try { localStorage.setItem(LS_ACCORD, JSON.stringify(accordState)); } catch { /* ignore */ }
  applyAccord(name);
}

const settingsDialog = () => $('#settings');

function openSettings(tab) {
  populateSettings();
  settingsDialog().showModal();
  if (tab) switchTab(tab);
}
function closeSettings() {
  try { settingsDialog().close(); } catch { /* not open */ }
}

function openAbout() {
  try { $('#about').showModal(); } catch { /* already open */ }
}
function closeAbout() {
  try { $('#about').close(); } catch { /* not open */ }
}

/* ---------------------------- professional help finder ---------------------------- */

const HELP_CATS = {
  therapist: 'therapist',
  psychologist: 'psychologist',
  psychiatrist: 'psychiatrist',
  adhd: 'ADHD autism assessment',
  gp: 'general practitioner doctor',
  crisis: 'crisis support center',
};
let helpCat = 'therapist';

function openHelp() {
  const input = $('#help-area');
  try { input.value = localStorage.getItem('anchor.helparea') || ''; } catch { /* ignore */ }
  try { $('#help').showModal(); } catch { /* already open */ }
  setTimeout(() => input.focus(), 60);
}

function closeHelp() {
  try { $('#help').close(); } catch { /* not open */ }
}

function runHelpSearch() {
  const area = $('#help-area').value.trim();
  if (!area) {
    toast('Type a suburb, area, or ZIP code first.');
    $('#help-area').focus();
    return;
  }
  try { localStorage.setItem('anchor.helparea', area); } catch { /* ignore */ }
  const query = HELP_CATS[helpCat] + ' near ' + area;
  const enc = encodeURIComponent(query);
  // keyless consumer embed (Google Maps share-embed) — loads only on this search
  $('#help-map').src = 'https://maps.google.com/maps?q=' + enc + '&z=13&output=embed';
  $('#help-maps-link').href = 'https://www.google.com/maps/search/?api=1&query=' + enc;
  $('#help-web-link').href = 'https://www.google.com/search?q=' + enc;
  $('#help-results').hidden = false;
}

function setHelpCat(cat) {
  helpCat = HELP_CATS[cat] !== undefined ? cat : 'therapist';
  document.querySelectorAll('.help-chip').forEach((c) => {
    const on = c.dataset.cat === helpCat;
    c.classList.toggle('active', on);
    c.setAttribute('aria-pressed', String(on));
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === name));
  });
  document.querySelectorAll('[data-tab-body]').forEach((s) => {
    s.hidden = s.dataset.tabBody !== name;
  });
}

/* ---------------------------- settings ui ---------------------------- */

function populateSettings() {
  const provs = Object.keys(PROVIDERS);
  $('#set-provider').innerHTML = provs
    .map((p) => '<option value="' + p + '">' + escapeHtml(PROVIDERS[p].label) + '</option>')
    .join('');

  $('#set-mode').innerHTML = Object.keys(MODES)
    .map((m) => '<option value="' + m + '">' + escapeHtml(MODES[m].label) + '</option>')
    .join('');

  $('#set-provider').value = settings.provider;
  refreshProviderFields();
  $('#set-mode').value = settings.mode;
  $('#custom-prompt-row').hidden = settings.mode !== 'custom';
  $('#set-customprompt').value = settings.customPrompt;
  $('#set-profile').value = settings.profile;
  $('#set-temp').value = settings.temperature;
  $('#temp-val').value = settings.temperature.toFixed(2);
  updateTempHint();
  $('#set-topp').value = settings.topP;
  $('#topp-val').value = settings.topP.toFixed(2);
  $('#set-maxtok').value = settings.maxTokens;
  $('#set-stream').checked = settings.stream;
  $('#set-theme').value = settings.theme;
  $('#set-fontscale').value = settings.fontScale;
  $('#fontscale-val').value = Math.round(settings.fontScale * 100) + '%';
  $('#set-spacing').value = settings.spacing;
  $('#set-motion').checked = settings.reduceMotion;
  $('#set-voicelang').value = settings.voiceLang || '';
  $('#set-autospeak').checked = settings.autoSpeak;
  $('#set-ttsrate').value = settings.ttsRate;
  $('#ttsrate-val').value = (settings.ttsRate || 1).toFixed(2) + '×';
  $('#tts-settings').style.display = ttsSupported() ? '' : 'none';
  populateVoices();
  $('#model-status').textContent = '';
  updateStorageUsage();
}

function refreshProviderFields() {
  const p = settings.provider;
  const conf = PROVIDERS[p];
  $('#set-base').value = settings.bases[p] ?? conf.base ?? '';
  $('#set-model').value = settings.model[p] ?? conf.defaultModel ?? '';
  $('#set-key').value = paranoidOn() ? (unlockedKeys[p] || '') : (settings.keys[p] || '');
  const locked = isLocked();
  $('#key-wrap').style.display = locked ? 'none' : '';
  $('#key-locked').hidden = !locked;
  $('#key-row').style.display = conf.needsKey ? '' : 'none';
  $('#encrypt-row').style.display = conf.needsKey ? '' : 'none';
  $('#set-encrypt').checked = paranoidOn();
  $('#set-encrypt').disabled = !subtleAvailable();
  $('#set-autolock').value = String(settings.autoLockMins);
  $('#autolock-row').style.display = conf.needsKey && paranoidOn() ? '' : 'none';
  $('#model-options').innerHTML = '';
  updateModelPill();
}

function updateModelPill() {
  const conf = providerConf();
  const short = modelLabel().split('/').pop();
  $('#model-pill').textContent = short + ' · ' + shortLabel(conf.label);
}

function shortLabel(label) {
  return label.replace(/\s*\(.*\)/, '');
}

function updateTempHint() {
  const t = settings.temperature;
  let hint;
  if (t <= 0.25) hint = 'Very predictable — good for facts, code, scripts.';
  else if (t <= 0.6) hint = 'Balanced — consistent but not robotic.';
  else if (t <= 0.85) hint = 'A bit more flexible in wording.';
  else hint = 'Creative — more variety, more surprises.';
  $('#temp-hint').textContent = hint;
}

async function updateStorageUsage() {
  let text;
  try {
    if (storageMode === 'idb' && navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      text =
        fmtBytes(est.usage || 0) + ' of chats used · ' + fmtBytes(est.quota || 0) + ' available · ' +
        convos.length + ' chat' + (convos.length === 1 ? '' : 's') + ' (IndexedDB)';
    } else {
      const bytes = (localStorage.getItem(LS_CONVOS) || '').length + (localStorage.getItem(LS_SETTINGS) || '').length;
      text = (bytes / 1024).toFixed(1) + ' KB in this browser · ' + convos.length + ' chat' + (convos.length === 1 ? '' : 's');
    }
  } catch {
    text = 'Unknown (storage blocked)';
  }
  $('#storage-usage').textContent = text;
}

function fmtBytes(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

function updateKeyHint() {
  const conf = providerConf();
  let show = false;
  if (conf.needsKey) {
    if (isLocked()) {
      show = true;
      $('#key-hint-text').textContent = 'Your API key is locked this session —';
      $('#key-hint-btn').textContent = 'unlock with your passphrase';
      $('#key-hint-tail').textContent = ' (it stays encrypted on this device).';
    } else if (!apiKey()) {
      show = true;
      $('#key-hint-text').textContent = 'No API key yet —';
      $('#key-hint-btn').textContent = 'open Settings → AI';
      $('#key-hint-tail').textContent = ' to add one (takes a minute).';
    }
  }
  $('#key-hint').hidden = !show;
}

/* ---------------------------- composer ---------------------------- */

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.38) + 'px';
}

function updateSendBtn() {
  if (streaming) return;
  $('#send-btn').disabled = !$('#composer-input').value.trim();
}

/* ---------------------------- wiring ---------------------------- */

function wire() {
  // sidebar
  $('#open-sidebar').addEventListener('click', openSidebar);
  $('#close-sidebar').addEventListener('click', closeSidebar);
  $('#backdrop').addEventListener('click', closeSidebar);
  $('#new-chat').addEventListener('click', newChat);
  $('#acc-tools').addEventListener('click', () => toggleAccord('tools'));
  $('#acc-chats').addEventListener('click', () => toggleAccord('chats'));

  // tools (+ favorites) — natural-language finder in sidebar + home screen
  document.querySelectorAll('.finder-wrap').forEach((wrap) => {
    const input = wrap.querySelector('.tool-finder');
    const results = wrap.querySelector('.finder-results');
    const clearBtn = wrap.querySelector('.finder-clear');
    const listEl = wrap.dataset.hide ? $(wrap.dataset.hide) : null;
    let deb = null;
    input.addEventListener('input', () => {
      clearTimeout(deb);
      clearBtn.hidden = !input.value;
      deb = setTimeout(() => renderFinder(input.value, results, listEl), 150);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = results.querySelector('.tool-btn[data-tool]');
        if (first) first.click(); // use the top match
      }
    });
    clearBtn.addEventListener('click', () => {
      input.value = '';
      renderFinder('', results, listEl);
      clearBtn.hidden = true;
      input.focus();
    });
  });

  document.addEventListener('click', (e) => {
    const favBtn = e.target.closest('[data-fav]');
    if (favBtn) {
      toggleFavTool(favBtn.dataset.fav);
      return;
    }
    const btn = e.target.closest('[data-tool]');
    if (!btn) return;
    // if picked from finder results, reset the finder back to the full list
    const wrap = btn.closest('.finder-wrap');
    if (wrap) {
      const inp = wrap.querySelector('.tool-finder');
      const cb = wrap.querySelector('.finder-clear');
      inp.value = '';
      cb.hidden = true;
      renderFinder('', wrap.querySelector('.finder-results'), wrap.dataset.hide ? $(wrap.dataset.hide) : null);
    }
    const tool = TOOLS.find((t) => t.id === btn.dataset.tool);
    if (!tool) return;
    const input = $('#composer-input');
    input.value = tool.template;
    autoGrow(input);
    updateSendBtn();
    closeSidebar();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });

  // conversation list
  $('#convo-list').addEventListener('click', (e) => {
    const del = e.target.closest('.c-del');
    if (del) {
      e.stopPropagation();
      if (del.classList.contains('armed')) {
        deleteConvo(del.dataset.del);
      } else {
        del.classList.add('armed');
        del.title = 'Tap again to really delete';
        setTimeout(() => del.classList.remove('armed'), 3000);
      }
      return;
    }
    const item = e.target.closest('.convo-item');
    if (item) switchConvo(item.dataset.id);
  });
  $('#convo-list').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const item = e.target.closest('.convo-item');
      if (item) { e.preventDefault(); switchConvo(item.dataset.id); }
    }
  });

  // search across chats
  const searchInput = $('#search-input');
  let searchDebounce = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    $('#search-clear').hidden = !searchInput.value;
    const q = searchInput.value;
    searchDebounce = setTimeout(() => renderSearch(q), 120);
  });
  $('#search-clear').addEventListener('click', () => {
    searchInput.value = '';
    renderSearch('');
    $('#search-clear').hidden = true;
    searchInput.focus();
  });
  $('#search-results').addEventListener('click', (e) => {
    const hit = e.target.closest('.search-hit');
    if (!hit) return;
    pendingScrollMsgId = hit.dataset.msg || null;
    switchConvo(hit.dataset.convo);
  });

  // auto-lock: any interaction resets the idle timer
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    document.addEventListener(ev, scheduleAutolock, { passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      autolockTick(); // lock immediately if the deadline passed while away
      scheduleAutolock();
    }
  });
  $('#set-autolock').addEventListener('change', () => {
    settings.autoLockMins = Number($('#set-autolock').value) || 0;
    saveSettings();
    scheduleAutolock();
  });

  // topbar
  $('#theme-toggle').addEventListener('click', () => {
    settings.theme = (resolveTheme() === 'dark') ? 'light' : 'dark';
    applyPrefs();
    saveSettings();
  });
  $('#open-settings').addEventListener('click', () => openSettings('ai'));
  $('#open-settings-side').addEventListener('click', () => { closeSidebar(); openSettings('ai'); });
  $('#open-about').addEventListener('click', openAbout);
  $('#open-about-side').addEventListener('click', () => { closeSidebar(); openAbout(); });
  $('#close-about').addEventListener('click', closeAbout);
  $('#open-help-empty').addEventListener('click', openHelp);
  $('#open-help-about').addEventListener('click', openHelp);
  $('#open-help').addEventListener('click', openHelp);
  $('#open-help-side').addEventListener('click', () => { closeSidebar(); openHelp(); });
  $('#close-help').addEventListener('click', closeHelp);
  $('#help-search').addEventListener('click', runHelpSearch);
  $('#help-area').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runHelpSearch(); }
  });
  $('#help').addEventListener('click', (e) => {
    const chip = e.target.closest('.help-chip');
    if (!chip) return;
    setHelpCat(chip.dataset.cat);
    if (!$('#help-results').hidden) runHelpSearch(); // live re-search once results are showing
  });
  $('#model-pill').addEventListener('click', () => openSettings('ai'));
  $('#key-hint-btn').addEventListener('click', async () => {
    if (isLocked()) { await promptUnlock(); return; }
    openSettings('ai');
  });

  // composer
  const input = $('#composer-input');
  input.addEventListener('input', () => { autoGrow(input); updateSendBtn(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      sendCurrentText();
    }
  });
  $('#send-btn').addEventListener('click', () => {
    if (streaming) stopStreaming();
    else sendCurrentText();
  });
  $('#mic-btn').addEventListener('click', toggleVoice);

  // message actions (delegated)
  $('#messages').addEventListener('click', async (e) => {
    const codeCopy = e.target.closest('.code-copy');
    if (codeCopy) {
      await copyText(decodeURIComponent(codeCopy.dataset.code || ''));
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) {
      const listenBtn = e.target.closest('[data-listen]');
      if (listenBtn) {
        const lid = listenBtn.dataset.listen;
        if (ttsActive && ttsMessageId === lid) stopSpeaking();
        else speakMessage(lid);
      }
      return;
    }
    const act = btn.dataset.act;
    if (act === 'regen') { regenerate(); return; }
    const id = btn.dataset.id;
    const convo = currentConvo();
    const msg = convo && convo.messages.find((m) => m.id === id);
    if (!msg) return;
    if (act === 'copy') await copyText(msg.text);
    if (act === 'edit') editMessage(id);
    if (act === 'retry') {
      if (streaming) return;
      // drop this assistant message and everything after it, then re-answer
      const idx = convo.messages.findIndex((m) => m.id === id);
      convo.messages.splice(idx);
      convo.updated = Date.now();
      saveConvos();
      renderMessages();
      generate();
    }
  });

  // passphrase dialog
  $('#pass-ok').addEventListener('click', submitPassDialog);
  $('#pass-cancel').addEventListener('click', () => closePass(null));
  $('#close-pass').addEventListener('click', () => closePass(null));
  $('#passphrase').addEventListener('close', () => {
    const r = passResolve;
    passResolve = null;
    if (r) r(passResult);
    passResult = null;
  });
  for (const id of ['pass-input', 'pass-confirm']) {
    $('#' + id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitPassDialog(); }
    });
  }
  $('#pass-input').addEventListener('input', () => {
    if (passMode === 'setup') updateStrength($('#pass-input').value);
  });

  // settings dialog
  $('#close-settings').addEventListener('click', closeSettings);
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  $('#set-provider').addEventListener('change', () => {
    settings.provider = $('#set-provider').value;
    saveSettings();
    refreshProviderFields();
    updateKeyHint();
  });
  $('#set-base').addEventListener('input', () => {
    settings.bases[settings.provider] = $('#set-base').value.trim();
    saveSettings();
  });
  $('#set-key').addEventListener('input', () => {
    const v = $('#set-key').value.trim();
    const p = settings.provider;
    if (paranoidOn()) {
      unlockedKeys[p] = v; // memory first, so sending works immediately
      if (unlockKey) encryptAndStoreKey(p, v);
    } else {
      settings.keys[p] = v;
      saveSettings();
    }
    updateKeyHint();
    updateModelPill();
  });
  $('#set-encrypt').addEventListener('change', async () => {
    const want = $('#set-encrypt').checked;
    const ok = await handleEncryptToggle(want);
    if (!ok) $('#set-encrypt').checked = settings.encryptKeys; // revert on failure/cancel
  });
  $('#btn-unlock').addEventListener('click', async () => { await promptUnlock(); });
  $('#key-eye').addEventListener('click', () => {
    const k = $('#set-key');
    k.type = k.type === 'password' ? 'text' : 'password';
  });
  $('#set-model').addEventListener('input', () => {
    settings.model[settings.provider] = $('#set-model').value.trim();
    saveSettings();
    updateModelPill();
  });
  $('#btn-models').addEventListener('click', async () => {
    const status = $('#model-status');
    if (isLocked()) {
      const ok = await promptUnlock();
      if (!ok) { status.textContent = 'Locked — unlock your key first.'; return; }
    }
    status.textContent = 'Loading…';
    try {
      const models = await fetchModels();
      $('#model-options').innerHTML = models.map((m) => '<option value="' + escapeHtml(m) + '">').join('');
      status.textContent = '✓ ' + models.length + ' models loaded — type in the box to pick';
    } catch (err) {
      status.textContent = '✗ ' + (friendlyError(err) || err.message);
    }
  });
  $('#set-mode').addEventListener('change', () => {
    settings.mode = $('#set-mode').value;
    $('#custom-prompt-row').hidden = settings.mode !== 'custom';
    saveSettings();
  });
  $('#set-customprompt').addEventListener('input', () => {
    settings.customPrompt = $('#set-customprompt').value;
    saveSettings();
  });
  $('#set-profile').addEventListener('input', () => {
    settings.profile = $('#set-profile').value;
    saveSettings();
  });
  $('#set-temp').addEventListener('input', () => {
    settings.temperature = Number($('#set-temp').value);
    $('#temp-val').value = settings.temperature.toFixed(2);
    updateTempHint();
    saveSettings();
  });
  $('#set-topp').addEventListener('input', () => {
    settings.topP = Number($('#set-topp').value);
    $('#topp-val').value = settings.topP.toFixed(2);
    saveSettings();
  });
  $('#set-maxtok').addEventListener('input', () => {
    const v = Math.max(256, Math.min(65536, Number($('#set-maxtok').value) || 8192));
    settings.maxTokens = v;
    saveSettings();
  });
  $('#set-stream').addEventListener('change', () => {
    settings.stream = $('#set-stream').checked;
    saveSettings();
  });
  $('#set-theme').addEventListener('change', () => {
    settings.theme = $('#set-theme').value;
    applyPrefs();
    saveSettings();
  });
  $('#set-fontscale').addEventListener('input', () => {
    settings.fontScale = Number($('#set-fontscale').value);
    $('#fontscale-val').value = Math.round(settings.fontScale * 100) + '%';
    applyPrefs();
    saveSettings();
  });
  $('#set-spacing').addEventListener('change', () => {
    settings.spacing = $('#set-spacing').value;
    applyPrefs();
    saveSettings();
  });
  $('#set-motion').addEventListener('change', () => {
    settings.reduceMotion = $('#set-motion').checked;
    applyPrefs();
    saveSettings();
  });
  $('#set-voicelang').addEventListener('input', () => {
    settings.voiceLang = $('#set-voicelang').value.trim();
    saveSettings();
  });
  $('#set-autospeak').addEventListener('change', () => {
    settings.autoSpeak = $('#set-autospeak').checked;
    saveSettings();
  });
  $('#set-ttsrate').addEventListener('input', () => {
    settings.ttsRate = Number($('#set-ttsrate').value) || 1;
    $('#ttsrate-val').value = settings.ttsRate.toFixed(2) + '×';
    saveSettings();
  });
  $('#set-ttsvoice').addEventListener('change', () => {
    settings.ttsVoiceURI = $('#set-ttsvoice').value;
    saveSettings();
  });
  if (ttsSupported()) {
    speechSynthesis.onvoiceschanged = populateVoices;
  }

  // data tab
  $('#btn-export-chat').addEventListener('click', exportCurrentChat);
  $('#btn-export-all').addEventListener('click', exportAll);
  const clearBtn = $('#btn-clear-all');
  clearBtn.addEventListener('click', async () => {
    if (clearBtn.classList.contains('armed')) {
      clearBtn.disabled = true;
      clearBtn.textContent = 'Deleting…';
      localStorage.removeItem(LS_SETTINGS);
      localStorage.removeItem(LS_CONVOS);
      localStorage.removeItem(LS_SECRETS);
      localStorage.removeItem(LS_LAST);
      await wipeChatDb();
      location.reload();
    } else {
      clearBtn.classList.add('armed');
      clearBtn.textContent = 'Tap again to DELETE everything';
      setTimeout(() => {
        clearBtn.classList.remove('armed');
        clearBtn.textContent = 'Delete ALL chats and settings';
      }, 4000);
    }
  });

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      newChat();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openSidebar();
      const si = $('#search-input');
      si.focus();
      si.select();
    }
    if (e.key === 'Escape' && $('#sidebar').classList.contains('open')) closeSidebar();
  });

  // pwa install
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    const btn = $('#install-btn');
    btn.hidden = false;
    btn.addEventListener('click', async () => {
      btn.hidden = true;
      e.prompt();
    }, { once: true });
  });
}

function resolveTheme() {
  const t = document.documentElement.dataset.theme;
  return t === 'light' ? 'light' : 'dark';
}

/* ---------------------------- init ---------------------------- */

async function init() {
  applyPrefs();
  renderTools();
  wire();
  applyAccord('tools');
  applyAccord('chats');
  await initChatStorage();

  // self-heal: encryption flag on but secrets gone (wiped manually) -> plain mode
  if (settings.encryptKeys && !secrets) {
    settings.encryptKeys = false;
    saveSettings();
  }
  if (justMigrated) toast('Chats moved to the bigger local database ✓');
  setInterval(autolockTick, 10000);

  // reopen the chat you were in last time
  try {
    const last = localStorage.getItem(LS_LAST);
    if (last && convos.find((c) => c.id === last)) {
      currentId = last;
      const c = currentConvo();
      if (c) $('#chat-title').textContent = c.title || 'Chat';
    }
  } catch { /* ignore */ }

  renderConvList();
  renderMessages();
  updateModelPill();
  updateKeyHint();
  updateSendBtn();
  autoGrow($('#composer-input'));
  $('#mic-btn').hidden = !speechSupported();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline is optional */ });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((e) => console.error('Anchor init failed:', e));
});
