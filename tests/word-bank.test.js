import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadWordBank } from '../dist/js/word-bank.js';
import { chooseWords, GameEngine } from '../dist/js/engine.js';

test('the loader supplies restricted targets and preserves broader anagram acceptance', async t => {
  t.mock.method(globalThis, 'fetch', async url => new Response(await readFile(url)));
  const bank = await loadWordBank();
  assert.equal(bank.targetCount, 34679);
  assert.equal(bank.count, 87701);
  assert.ok(bank.pools[4].includes('neat'));
  assert.ok(!bank.pools[4].includes('etna'));
  assert.ok(bank.acceptedWords.has('etna'));
  const targets = new Set(Object.values(bank.pools).flat());
  for (const seed of [0, 1, 42, 1_791_849_600_123]) {
    const selection = chooseWords(bank.pools, seed);
    assert.ok(selection.every(word => targets.has(word)));
    assert.equal(selection.length, 20);
    assert.equal(selection[18].length, 9);
    assert.equal(selection[19].length, 10);
  }

  // ETNA is a valid higher-tier alternative to the eligible target NEAT.
  const engine = new GameEngine({ ...bank, pools: { ...bank.pools, 4: ['neat'] }, now: () => 0 });
  engine.start(42);
  for (const letter of 'etna') engine.typeLetter(letter);
  assert.equal(engine.snapshot().feedback, 'correct');
  assert.equal(engine.snapshot().results[0].answer, 'etna');
});

for (const filename of ['puzzle-words.json', 'words.json']) {
  for (const length of [9, 10]) {
    test(`the loader rejects a missing ${length}-letter pool in ${filename}`, async t => {
      t.mock.method(globalThis, 'fetch', async url => {
        const pools = JSON.parse(await readFile(url, 'utf8'));
        if (url.pathname.endsWith(`/${filename}`)) delete pools[length];
        return new Response(JSON.stringify(pools));
      });
      await assert.rejects(loadWordBank(), /The word bank is incomplete or invalid/);
    });
  }
}

test('a missing target bank cannot silently fall back to the broad dictionary', async t => {
  t.mock.method(globalThis, 'fetch', async url => url.pathname.endsWith('/puzzle-words.json')
    ? new Response('Not found', { status: 404 })
    : new Response(await readFile(url)));
  await assert.rejects(loadWordBank(), /Word bank request failed \(404\)/);
});
