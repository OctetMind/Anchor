#!/usr/bin/env node
/**
 * Pure search helpers — run in plain Node, no browser, no dependencies.
 *
 *   node scripts/search-core.test.mjs
 *
 * Covers the parts of the natural-language tool finder that are easy to get
 * wrong: parsing noisy model output, dropping unknown ids, the cap, merge
 * order/dedupe, the no-key gate, catalogue privacy, and the owner's
 * "I want to stop procrastinating" example via the keyword synonyms.
 */
import assert from 'node:assert/strict';
import {
  findTools,
  buildToolCatalogue,
  parseAiToolIds,
  pickAiTools,
  shouldAskAi,
  aiCacheKey,
  catalogueWordSet,
  hasCatalogueWord,
} from '../search-core.js';

/* Minimal tool fixtures: real ids, labels and descriptions (no templates —
   the point is that the catalogue helper must never need them). */
const TOOLS = [
  { id: 'steps', label: 'Break it down', desc: 'Task → small steps', template: 'SECRET TEMPLATE steps' },
  { id: 'start', label: 'Just start', desc: 'Get past the blank stare', template: 'SECRET TEMPLATE start' },
  { id: 'howstart', label: 'How to start a task', desc: 'Tips & tricks to begin', template: 'SECRET TEMPLATE howstart' },
  { id: 'simple', label: 'Explain simply', desc: 'Plain language, short', template: 'SECRET TEMPLATE simple' },
  { id: 'script', label: 'Write it for me', desc: 'Word-for-word message', template: 'SECRET TEMPLATE script' },
  { id: 'hardtalk', label: 'Hard conversation prep', desc: 'Scripts + responses', template: 'SECRET TEMPLATE hardtalk' },
  { id: 'tone', label: 'Tone check', desc: 'Before you hit send', template: 'SECRET TEMPLATE tone' },
  { id: 'rescue', label: 'Shutdown rescue', desc: 'Frozen → one next thing', template: 'SECRET TEMPLATE rescue' },
  { id: 'call', label: 'Call walker', desc: 'Survive phone calls', template: 'SECRET TEMPLATE call' },
  { id: 'three', label: "Today's 3", desc: 'Pick 3, one must-do', template: 'SECRET TEMPLATE three' },
];

const VALID_IDS = TOOLS.map((t) => t.id);

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('PASS  ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL  ' + name);
    console.log('      ' + (e && e.message ? e.message.split('\n')[0] : e));
  }
}

/* ------------------------------ parsing ------------------------------ */

test('parses noisy model output (bullets, numbering, quotes, backticks)', () => {
  const raw = ['Sure! Here you go:', '1. "start"', '- `steps`', '• HOWSTART', 'none'].join('\n');
  assert.deepEqual(parseAiToolIds(raw, VALID_IDS), ['start', 'steps', 'howstart']);
});

test('drops ids that do not exist in TOOLS', () => {
  assert.deepEqual(parseAiToolIds('start\nnot-a-tool\nsteps', VALID_IDS), ['start', 'steps']);
});

test('caps the parsed list at 3', () => {
  const raw = 'start\nsteps\nhowstart\nsimple\ncall';
  assert.deepEqual(parseAiToolIds(raw, VALID_IDS), ['start', 'steps', 'howstart']);
});

test('treats "none" as no picks', () => {
  assert.deepEqual(parseAiToolIds('none', VALID_IDS), []);
  assert.deepEqual(parseAiToolIds('NONE\n', VALID_IDS), []);
});

test('ignores prose and duplicate ids', () => {
  assert.deepEqual(parseAiToolIds('start\nstart\nsteps', VALID_IDS), ['start', 'steps']);
});

/* ------------------------------- merging ----------------------------- */

test('merge keeps AI order and removes ids already in the keyword list', () => {
  assert.deepEqual(pickAiTools(['steps', 'start', 'simple'], ['steps']), ['start', 'simple']);
});

test('merge dedupes AI ids and caps at 3', () => {
  assert.deepEqual(pickAiTools(['start', 'start', 'steps', 'howstart', 'simple'], []), [
    'start',
    'steps',
    'howstart',
  ]);
});

test('merge with no AI picks is empty', () => {
  assert.deepEqual(pickAiTools([], ['start']), []);
});

/* ------------------------- triggering / no key ----------------------- */

const SENTENCE = 'I want to stop procrastinating but I dont know what to do';

test('asks the model for a sentence with weak keyword results', () => {
  assert.equal(shouldAskAi({ query: SENTENCE, keywordCount: 0, hasKey: true }), true);
  assert.equal(shouldAskAi({ query: SENTENCE, keywordCount: 2, hasKey: true }), true);
});

test('never asks without a key, or offline, or for short queries', () => {
  assert.equal(shouldAskAi({ query: SENTENCE, keywordCount: 0, hasKey: false }), false);
  assert.equal(shouldAskAi({ query: SENTENCE, keywordCount: 0, hasKey: true, online: false }), false);
  assert.equal(shouldAskAi({ query: 'start', keywordCount: 0, hasKey: true }), false);
  assert.equal(shouldAskAi({ query: 'start calling', keywordCount: 0, hasKey: true }), false);
});

test('asks when the sentence shares no catalogue word even with 3 hits', () => {
  assert.equal(
    shouldAskAi({ query: SENTENCE, keywordCount: 3, hasKey: true, catalogueHit: false }),
    true
  );
  assert.equal(
    shouldAskAi({ query: SENTENCE, keywordCount: 3, hasKey: true, catalogueHit: true }),
    false
  );
});

/* ------------------------------ catalogue ---------------------------- */

test('catalogue is id — label — desc and never includes templates', () => {
  const out = buildToolCatalogue(TOOLS);
  assert.ok(out.includes('start — Just start — Get past the blank stare'));
  assert.ok(!out.includes('SECRET TEMPLATE'));
  assert.equal(out.split('\n').length, TOOLS.length);
});

test('cache key normalises punctuation, case and whitespace', () => {
  assert.equal(
    aiCacheKey('openai', 'gpt-4o-mini', '  I   WANT to stop!  '),
    aiCacheKey('openai', 'gpt-4o-mini', 'i want to stop')
  );
  assert.notEqual(
    aiCacheKey('openai', 'gpt-4o-mini', 'i want to stop'),
    aiCacheKey('openai', 'gpt-4.1', 'i want to stop')
  );
});

/* ------------------------ keyword synonym fallback ------------------- */

test("owner's sentence surfaces start, steps and howstart with no key", () => {
  const ids = findTools(SENTENCE, TOOLS).map((r) => r.tool.id);
  assert.ok(ids.includes('start'), 'expected start, got ' + ids.join(','));
  assert.ok(ids.includes('steps'), 'expected steps, got ' + ids.join(','));
  assert.ok(ids.includes('howstart'), 'expected howstart, got ' + ids.join(','));
});

test('a short stuck phrase still finds start', () => {
  const ids = findTools('I feel stuck', TOOLS).map((r) => r.tool.id);
  assert.ok(ids.includes('start'), 'expected start, got ' + ids.join(','));
});

/* Natural emotional phrasing must reach the social/conversation tools. */
function idsFor(query) {
  return findTools(query, TOOLS).map((r) => r.tool.id);
}

test("owner's burnout sentence puts hardtalk first, with script and rescue", () => {
  const ids = idsFor('I am feeling burnt out and need to rest how do I tell people that');
  assert.equal(ids[0], 'hardtalk', 'expected hardtalk first, got ' + ids.join(','));
  for (const id of ['hardtalk', 'script', 'rescue']) {
    assert.ok(ids.includes(id), 'expected ' + id + ', got ' + ids.join(','));
  }
});

test('asking for time off and how to tell a boss reaches hardtalk', () => {
  const ids = idsFor('I need time off but I dont know how do I tell my boss');
  assert.equal(ids[0], 'hardtalk', 'expected hardtalk first, got ' + ids.join(','));
  assert.ok(ids.includes('script'), 'expected script, got ' + ids.join(','));
});

test('asking for words to send reaches script', () => {
  const ids = idsFor('Can you write it for me word for word so I can text them');
  assert.equal(ids[0], 'script', 'expected script first, got ' + ids.join(','));
  assert.ok(ids.includes('script'), 'expected script, got ' + ids.join(','));
});

test('asking for time off because of burnout reaches hardtalk, with rescue', () => {
  const ids = idsFor('I need to ask for time off because I am burnt out');
  assert.equal(ids[0], 'hardtalk', 'expected hardtalk first, got ' + ids.join(','));
  assert.ok(ids.includes('rescue'), 'expected rescue, got ' + ids.join(','));
});

test('exhausted and unable to cope reaches rescue', () => {
  const ids = idsFor('I am completely exhausted and cant cope anymore');
  assert.equal(ids[0], 'rescue', 'expected rescue first, got ' + ids.join(','));
  assert.ok(ids.includes('rescue'), 'expected rescue, got ' + ids.join(','));
});

test('checking a draft before sending reaches tone', () => {
  const ids = idsFor('How does this sound before I send it to my manager');
  assert.equal(ids[0], 'tone', 'expected tone first, got ' + ids.join(','));
  assert.ok(ids.includes('tone'), 'expected tone, got ' + ids.join(','));
});

test('single generic words do not match broadly', () => {
  assert.deepEqual(findTools('people rest tell', TOOLS), []);
  assert.deepEqual(findTools('rest tell', TOOLS), []);
});

test('phrase matching respects word boundaries', () => {
  assert.deepEqual(findTools('say nothing', TOOLS), []);
});

test('stopwords alone match nothing (no generic word matching)', () => {
  assert.deepEqual(findTools('the and of to it', TOOLS), []);
});

test('catalogue word detection is true for a known word, false for gibberish', () => {
  const words = catalogueWordSet(TOOLS);
  assert.equal(hasCatalogueWord(SENTENCE, words), true);
  assert.equal(hasCatalogueWord('zxqv blorp', words), false);
});

/* ------------------------------- verdict ----------------------------- */

if (failed) {
  console.log(`\nverdict: RED (${failed} failing)`);
  process.exit(1);
}
console.log('\nverdict: GREEN');
