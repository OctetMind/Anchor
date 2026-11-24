/* ==========================================================================
   Anchor — pure search helpers (keyword matching + AI-search plumbing).

   Loaded by index.html as a module BEFORE app.js, and imported directly by
   scripts/search-core.test.mjs in Node. No DOM, no storage, no network here.
   ========================================================================== */

const STOP = new Set(
  ('i im ive to a an the my me about for with of on in at and or is are it its this that these those ' +
    'them they you your yours please so but if then when what which who whom whose why how now do does ' +
    'did doing be been being was were will would could should shall may might must just really very ' +
    'some something someone anybody anything stuff person people thing things').split(' ')
);

const TOOL_MATCH = {
  steps: {
    phrases: [
      'break it down', 'step by step', 'how do i do', 'piece by piece',
      'dont know what to do', "don't know what to do",
      'dont know where to begin', "don't know where to begin",
      'no idea', 'cant start', "can't start", 'putting off',
    ],
    words: ['step', 'instruction', 'plan', 'checklist', 'guide', 'project', 'task', 'big', 'breakdown', 'procrastinate', 'overwhelmed'],
  },
  start: {
    phrases: [
      'get started', 'just start', 'keep avoiding', 'get going', 'cant start', "can't start", 'get past',
      'procrastinating', 'procrastinate', 'putting off',
      'dont know where to begin', "don't know where to begin",
      'dont know what to do', "don't know what to do",
      'overwhelmed', 'stuck', 'no idea',
    ],
    words: ['start', 'stuck', 'avoid', 'avoiding', 'procrastinate', 'begin', 'first', 'action', 'dread'],
  },
  howstart: {
    phrases: [
      'how to start', 'tips for starting', 'ways to start', 'start a task',
      'dont know what to do', "don't know what to do",
      'dont know where to begin', "don't know where to begin",
      'overwhelmed', 'no idea', 'putting off', 'cant start', "can't start",
    ],
    words: ['tip', 'trick', 'strategy', 'strategies', 'motivation', 'hack', 'procrastinate', 'stuck'],
  },
  howlong: { phrases: ['how long', 'time estimate', 'will it take', 'how much time'], words: ['long', 'estimate', 'duration', 'minutes', 'hours', 'spend'] },
  fits: { phrases: ['what can i do', 'short on time', 'little time', 'spare time'], words: ['energy', 'battery', 'window', 'gap', 'capacity', 'fit'] },
  three: { phrases: ['what should i do today', 'most important', 'pick for me'], words: ['today', 'prioritize', 'priority', 'focus', 'three', 'top'] },
  call: { phrases: ['phone call', 'make a call', 'call them', 'phone them', 'ring them'], words: ['call', 'phone', 'dial', 'telephone', 'receptionist', 'helpline'] },
  hardtalk: { phrases: ['hard conversation', 'difficult conversation', 'awkward conversation', 'talk to my boss', 'need to tell', 'set a boundary', 'burnt out', 'burned out', 'burnout', 'need to rest', 'need time off', 'tell people', 'tell someone', 'tell my boss', 'how do i tell', 'how do i say', 'let people know', 'let them know', 'say no', 'ask for time off', 'cancel plans', 'reschedule'], words: ['conversation', 'difficult', 'awkward', 'confront', 'boundary', 'boundaries', 'boss', 'argument'] },
  switch: { phrases: ['switch tasks', 'switch to', 'transition between', 'stop doing'], words: ['switch', 'transition', 'change', 'move', 'shift', 'pivot'] },
  decode: { phrases: ['what did they mean', 'what they meant', 'hidden meaning', 'reading into'], words: ['message', 'text', 'email', 'mean', 'interpret', 'subtext', 'reply'] },
  tone: { phrases: ['tone check', 'how does this sound', 'does this sound', 'before i send', 'check my draft', 'sounds rude', 'sounds harsh', 'sounds aggressive'], words: ['tone', 'rude', 'blunt', 'soften', 'harsh', 'across', 'draft'] },
  summarize: { phrases: ['summarize this', 'main points', 'key points', 'too long', 'tldr'], words: ['summarize', 'summarise', 'summary', 'shorten', 'condense', 'article', 'bullet', 'skim'] },
  rescue: { phrases: ['too much', 'shut down', 'cant move', "can't move", 'cant function', "can't function", 'falling apart', 'melting down', 'burnt out', 'burned out', 'burnout', 'need to rest', 'cant cope', "can't cope"], words: ['overwhelmed', 'frozen', 'panic', 'meltdown', 'shutdown', 'spiral', 'drowning', 'anxious', 'anxiety', 'burnout', 'exhausted'] },
  routine: { phrases: ['morning routine', 'evening routine', 'leaving the house', 'wind down', 'bedtime'], words: ['routine', 'morning', 'evening', 'night', 'bed', 'habit', 'daily', 'schedule'] },
  futureme: { phrases: ['future me', 'dont forget', "don't forget", 'will forget', 'note to self'], words: ['note', 'remember', 'forget', 'future', 'reminder', 'scribble', 'context'] },
  decide: { phrases: ['decide for me', 'cant decide', "can't decide", 'make the decision', 'decision paralysis', 'pick one'], words: ['decide', 'decision', 'choose', 'option', 'options', 'choice', 'indecisive', 'paralysis'] },
  simple: {
    phrases: [
      'explain like', 'in plain english', 'too complicated', 'what does this mean', 'dont understand', "don't understand",
      'dont know what to do', "don't know what to do", 'no idea', 'overwhelmed', 'cant start', "can't start",
    ],
    words: ['explain', 'simple', 'simplify', 'understand', 'confusing', 'jargon', 'plain', 'eli5'],
  },
  script: { phrases: ['write it for me', 'what should i say', 'how do i say', 'word for word', 'ready to send', 'tell people', 'tell someone', 'how do i tell', 'what do i say', 'let them know', 'text them', 'write a message', 'send a message', 'write an email', 'send an email'], words: ['write', 'draft', 'compose', 'letter', 'response', 'wording', 'script'] },
  sort: { phrases: ['brain dump', 'sort my thoughts', 'too many thoughts', 'mess in my head', 'all over the place'], words: ['dump', 'messy', 'organize', 'organise', 'sort', 'chaos', 'thoughts', 'jumble', 'scattered'] },
};

// tools that often go together with a matched tool
const TOOL_HINTS = {
  call: ['start', 'howstart'],
  hardtalk: ['script', 'decode'],
  steps: ['three', 'howlong', 'start'],
  start: ['howstart', 'steps'],
  howstart: ['start', 'steps'],
  decode: ['tone', 'script'],
  summarize: ['simple'],
  simple: ['steps'],
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
  return String(q || '')
    .toLowerCase()
    .replace(/tl;dr/g, 'tldr')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

/* Phrases match whole words only, so "say no" cannot fire inside
   "say nothing" and "rest" cannot fire inside "restaurant". */
function phraseText(s) {
  return (
    ' ' +
    String(s || '')
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[^a-z0-9']+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() +
    ' '
  );
}

/* Keyword search. `tools` is the app's TOOLS array (or a test fixture). */
function findTools(query, tools = []) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const raw = phraseText(query);
  const results = [];
  for (const t of tools) {
    const dict = TOOL_MATCH[t.id] || {};
    let score = 0;
    const why = new Set();
    for (const ph of dict.phrases || []) {
      if (raw.includes(phraseText(ph))) { score += 6; why.add(ph); }
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
    const t = tools.find((x) => x.id === id);
    if (t) results.push({ tool: t, score: s, why: ['related'] });
  }
  return results.sort((a, b) => b.score - a.score).filter((r) => r.score >= 2).slice(0, 4);
}

/* ---------------------------- AI search helpers ---------------------------- */

/* Compact catalogue: ids, labels and descriptions only — never templates. */
function buildToolCatalogue(tools) {
  return tools.map((t) => `${t.id} — ${t.label} — ${t.desc}`).join('\n');
}

function normaliseQuery(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function aiCacheKey(provider, model, query) {
  return `${provider}|${model}|${normaliseQuery(query)}`;
}

/* Defensive parse of a model reply that should be ids, one per line. */
function parseAiToolIds(text, validIds, cap = 3) {
  const valid = new Set(validIds);
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    let s = line.trim().toLowerCase();
    if (!s) continue;
    s = s.replace(/^[\s>*#\-\u2022]+/, '').replace(/^\d+\s*[.)]\s*/, '');
    s = s.replace(/^["'`]+|["'`]+$/g, '').trim();
    const token = s.split(/\s+/)[0].replace(/[^a-z0-9]+/g, '');
    if (!token || token === 'none') continue;
    if (valid.has(token) && !out.includes(token)) out.push(token);
    if (out.length >= cap) break;
  }
  return out;
}

/* AI picks minus anything already shown by keyword search, capped. */
function pickAiTools(aiIds, keywordIds, cap = 3) {
  const seen = new Set(keywordIds);
  const out = [];
  for (const id of aiIds) {
    if (seen.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

function sentenceLike(query) {
  return String(query || '').trim().split(/\s+/).filter(Boolean).length >= 3;
}

/* Gate for the LLM call: no key, offline, short query, or strong keyword
   results all mean "let the instant keyword list stand". */
function shouldAskAi({ query, keywordCount = 0, hasKey = false, online = true, catalogueHit = true }) {
  if (!hasKey || !online) return false;
  if (!sentenceLike(query)) return false;
  return keywordCount < 3 || !catalogueHit;
}

function catalogueWordSet(tools) {
  const set = new Set();
  for (const t of tools) {
    const dict = TOOL_MATCH[t.id] || {};
    for (const w of dict.words || []) set.add(stem(w));
    for (const p of dict.phrases || []) for (const w of tokenize(p)) set.add(w);
    const labelWords = ((t.label || '') + ' ' + (t.desc || '')).toLowerCase().match(/[a-z]+/g) || [];
    for (const w of labelWords) {
      if (w.length > 2 && !STOP.has(w)) set.add(stem(w));
    }
  }
  return set;
}

function hasCatalogueWord(query, words) {
  return tokenize(query).some((t) => words.has(t));
}

/* Browser bridge: app.js reads these through globalThis.AnchorSearch. */
globalThis.AnchorSearch = {
  STOP,
  TOOL_MATCH,
  TOOL_HINTS,
  stem,
  tokenize,
  findTools,
  buildToolCatalogue,
  normaliseQuery,
  aiCacheKey,
  parseAiToolIds,
  pickAiTools,
  sentenceLike,
  shouldAskAi,
  catalogueWordSet,
  hasCatalogueWord,
};

export {
  STOP,
  TOOL_MATCH,
  TOOL_HINTS,
  stem,
  tokenize,
  findTools,
  buildToolCatalogue,
  normaliseQuery,
  aiCacheKey,
  parseAiToolIds,
  pickAiTools,
  sentenceLike,
  shouldAskAi,
  catalogueWordSet,
  hasCatalogueWord,
};
