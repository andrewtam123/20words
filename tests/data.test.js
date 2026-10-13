import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataUrl = new URL('../dist/data/', import.meta.url);
const wordBytes = await readFile(new URL('words.json', dataUrl));
const words = JSON.parse(wordBytes);
const source = JSON.parse(await readFile(new URL('word-source.json', dataUrl), 'utf8'));
const expectedCounts = { 4: 3256, 5: 6676, 6: 11176, 7: 15940, 8: 18049, 9: 17596, 10: 15008 };
const puzzleBytes = await readFile(new URL('puzzle-words.json', dataUrl));
const puzzles = JSON.parse(puzzleBytes);
const expectedPuzzleCounts = { 4: 1922, 5: 3568, 6: 5468, 7: 6916, 8: 6754, 9: 5714, 10: 4337 };

test('the bundled vocabulary has exactly the seven required sorted, unique word pools', () => {
  assert.deepEqual(Object.keys(words), ['4', '5', '6', '7', '8', '9', '10']);
  for (const [length, pool] of Object.entries(words)) {
    assert.ok(Array.isArray(pool), `${length}-letter pool must be an array`);
    assert.equal(pool.length, expectedCounts[length]);
    assert.equal(new Set(pool).size, pool.length, `${length}-letter pool has duplicates`);
    assert.deepEqual(pool, [...pool].sort(), `${length}-letter pool must be sorted`);
    for (const word of pool) {
      assert.equal(typeof word, 'string');
      assert.match(word, /^[a-z]{4,10}$/);
      assert.equal(word.length, Number(length), `Wrong pool for ${word}`);
    }
  }
});

test('provenance counts and checksum match the shipped word data', () => {
  assert.equal(source.version, '2020.12.07');
  assert.equal(source.sourceArchiveSha256, '5587667caa20c4891390c2d42dbb4d5c4c3f41bee77af1457ece3ba23fb859cc');
  assert.deepEqual(source.wordCounts, expectedCounts);
  assert.equal(source.totalWords, Object.values(words).reduce((total, pool) => total + pool.length, 0));
  assert.equal(source.totalWords, 87701);
  assert.equal(source.wordsJsonSha256, createHash('sha256').update(wordBytes).digest('hex'));
  assert.equal(source.wordsJsonSha256, '0ac42b1613d53c6f06b4b7f240b00086c3a2f96b596c0e966b00bc16fa964f7d');
  assert.equal(source.filters.subcategory, 'words');
  assert.equal(source.filters.maximumScowlSizeInclusive, 70);
  assert.equal(source.filters.acceptedLinePattern, '^[a-z]{4,10}$');
  assert.equal(source.includedSourceFiles.length, 88);
});

test('level-35 targets are sorted, unique, and a strict subset of accepted answers', () => {
  assert.deepEqual(Object.keys(puzzles), ['4', '5', '6', '7', '8', '9', '10']);
  for (const [length, pool] of Object.entries(puzzles)) {
    assert.equal(pool.length, expectedPuzzleCounts[length]);
    assert.deepEqual(pool, [...new Set(pool)].sort());
    const accepted = new Set(words[length]);
    for (const word of pool) {
      assert.match(word, /^[a-z]{4,10}$/);
      assert.equal(word.length, Number(length));
      assert.ok(accepted.has(word), `Puzzle target must be accepted: ${word}`);
    }
  }
  assert.deepEqual(source.puzzleSelection.wordCounts, expectedPuzzleCounts);
  assert.equal(source.puzzleSelection.totalWords, 34679);
  assert.equal(source.puzzleSelection.file, 'puzzle-words.json');
  assert.equal(source.puzzleSelection.wordsJsonSha256, createHash('sha256').update(puzzleBytes).digest('hex'));
  assert.equal(source.puzzleSelection.wordsJsonSha256, 'dbd074bb98944d70e5791f544c62d213d92303c163ebec5d7721398b566b16de');
});

test('adding longer words preserves every existing 4–8-letter pool', () => {
  const subsetHash = pools => createHash('sha256').update(`${JSON.stringify(
    Object.fromEntries([4, 5, 6, 7, 8].map(length => [length, pools[length]])),
  )}\n`).digest('hex');
  assert.equal(subsetHash(words), '849b73114a92f6591eeef6ea42773dba901e2cc698e8ae7ada1fcae15b9bf47d');
  assert.equal(subsetHash(puzzles), '63e3c40eb41c8db4833cfe5fdf28965702614ee4204823121e3151dc25ce16be');
});

test('target cutoff includes lower SCOWL tiers and excludes higher-tier examples', () => {
  assert.equal(source.puzzleSelection.maximumScowlSizeInclusive, 35);
  assert.deepEqual(source.puzzleSelection.includedScowlSizes, [10, 20, 35]);
  const levels = source.puzzleSelection.includedSourceFiles.map(path => Number(path.split('.').at(-1)));
  assert.equal(levels.length, 33);
  assert.deepEqual([...new Set(levels)].sort((a, b) => a - b), [10, 20, 35]);
  const targets = new Set(Object.values(puzzles).flat());
  for (const word of ['young', 'cream', 'cigars']) {
    assert.ok(targets.has(word), `Keep representative from levels 10, 20, and 35: ${word}`);
  }
  for (const word of ['weals', 'haaf', 'lunula', 'scilla', 'cowherb', 'scalage']) {
    assert.ok(!targets.has(word), `Higher-tier word must not be selected: ${word}`);
    assert.ok(words[word.length].includes(word), `Still accept valid alternatives: ${word}`);
  }
});

test('the word bank includes alternative anagrams, inflections, and regional spellings', () => {
  const accepted = new Set(Object.values(words).flat());
  for (const word of [
    'care', 'race', 'acre', 'alert', 'alter', 'later',
    'walk', 'walks', 'walked', 'walking',
    'color', 'colour', 'center', 'centre',
    'theater', 'theatre', 'offense', 'offence',
  ]) {
    assert.ok(accepted.has(word), `Missing vocabulary example: ${word}`);
  }
});

test('the distributed word bank includes upstream copyright and permission notices', async () => {
  assert.equal(source.licenseFile, 'SCOWL-LICENSE.txt');
  const license = await readFile(new URL(source.licenseFile, dataUrl), 'utf8');
  assert.match(license, /Copyright 2000-2018 by Kevin Atkinson/);
  assert.match(license, /Permission to use, copy, modify, distribute and sell these word/);
  assert.match(license, /WordNet 1\.6 Copyright 1997 by Princeton University/);
  assert.match(license, /Copyright 1993, Geoff Kuenning/);
  assert.ok(license.length > 10_000, 'Preserve the complete upstream notice file');
});
