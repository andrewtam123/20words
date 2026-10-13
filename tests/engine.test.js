import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORD_LENGTHS, ROUND_MS, createRng, randomIndex, chooseWords, scrambledTiles, GameEngine,
} from '../dist/js/engine.js';

const pools = {
  4: ['care', 'race', 'acre', 'noon'],
  5: ['apple', 'pearl'],
  6: ['planet', 'listen', 'silent'],
  7: ['teacher', 'another'],
  8: ['elephant', 'computer'],
  9: ['pineapple', 'blueberry'],
  10: ['basketball', 'bookkeeper'],
};
const singlePools = {
  4: ['care'], 5: ['apple'], 6: ['planet'], 7: ['teacher'], 8: ['elephant'],
  9: ['pineapple'], 10: ['bookkeeper'],
};

function fixture(options = {}) {
  let time = 1_000;
  const engine = new GameEngine({
    pools: singlePools,
    acceptedWords: [...Object.values(pools).flat(), 'aces'],
    now: () => time,
    ...options,
  });
  return { engine, advance: (milliseconds) => { time += milliseconds; } };
}

function type(engine, word) {
  for (const letter of word) engine.typeLetter(letter);
  return engine.snapshot();
}

test('fixed progression is 2 four-, 5 five-, 6 six-, 3 seven-, 2 eight-, 1 nine-, and 1 ten-letter words', () => {
  assert.deepEqual(WORD_LENGTHS, [4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 7, 7, 7, 8, 8, 9, 10]);
  assert.ok(Object.isFrozen(WORD_LENGTHS));
  for (const seed of [0, 1, 42, 1_791_849_600_123]) {
    const words = chooseWords(pools, seed);
    assert.deepEqual(words.map((word) => word.length), WORD_LENGTHS);
    assert.ok(words.every((word) => pools[word.length].includes(word)));
  }
});

test('seeded generator and word choices are deterministic and use the full timestamp', () => {
  const samples = (seed) => {
    const rng = createRng(seed);
    return Array.from({ length: 20 }, () => rng.nextUint32());
  };
  assert.deepEqual(samples(123), samples(123));
  assert.notDeepEqual(samples(123), samples(124));
  assert.notDeepEqual(samples(123), samples(123 + 2 ** 32));
  assert.ok(samples(0).every((value) => Number.isInteger(value) && value >= 0 && value < 2 ** 32));
  assert.deepEqual(chooseWords(pools, 123), chooseWords(pools, 123));
  assert.throws(() => createRng(NaN), TypeError);
});

test('random indices reject the biased tail and include both boundary indices', () => {
  const values = [0xffff_ffff, 0xffff_fffe, 0, 5];
  let calls = 0;
  const rng = { nextUint32: () => { calls += 1; return values.shift(); } };
  assert.equal(randomIndex(rng, 3), 2);
  assert.equal(calls, 2, '2^32 - 1 must be rejected for a three-item pool');
  assert.equal(randomIndex(rng, 3), 0);
  assert.equal(randomIndex(rng, 3), 2);
  assert.throws(() => randomIndex(rng, 0), RangeError);
  assert.throws(() => randomIndex(rng, 1.5), RangeError);
});

test('word selection uses words directly and allows replacement within each game', () => {
  const words = chooseWords(singlePools, 456);
  assert.equal(words[0], 'care');
  assert.equal(words[1], 'care');
  assert.deepEqual(words.slice(2, 7), Array(5).fill('apple'));
  // This independent expected draw sequence catches accidental group sampling,
  // extra RNG consumption during word selection, and duplicate exclusions.
  const rng = createRng(456);
  const expected = WORD_LENGTHS.map((length) => pools[length][randomIndex(rng, pools[length].length)]);
  assert.deepEqual(chooseWords(pools, 456), expected);
});

test('all twenty words are selected before any tile scrambling consumes randomness', () => {
  const { engine } = fixture({ pools });
  assert.deepEqual(engine.start(789).words, chooseWords(pools, 789));
  engine.shuffle();
  assert.deepEqual(engine.snapshot().words, chooseWords(pools, 789));
});

test('scrambles preserve repeated letters and tile IDs while changing the visible order', () => {
  const rng = createRng(123);
  const first = scrambledTiles('noon', rng);
  assert.notEqual(first.map((tile) => tile.letter).join(''), 'noon');
  assert.equal(first.map((tile) => tile.letter).sort().join(''), 'nnoo');
  assert.deepEqual(first.map((tile) => tile.id).sort(), [0, 1, 2, 3]);
  const second = scrambledTiles('noon', rng, first);
  assert.notEqual(second.map((tile) => tile.letter).join(''), first.map((tile) => tile.letter).join(''));
  assert.deepEqual([...second].sort((a, b) => a.id - b.id), [...first].sort((a, b) => a.id - b.id));
  assert.equal(scrambledTiles('aaaa', rng).length, 4, 'degenerate inputs must terminate');
});

test('ready state ignores gameplay actions and starts with a fresh thirty seconds', () => {
  const { engine } = fixture();
  for (const action of [() => engine.shuffle(), () => engine.pause(), () => engine.nextRound(), () => engine.typeLetter('c')]) {
    assert.equal(action().status, 'ready');
  }
  const state = engine.start(1);
  assert.equal(state.status, 'playing');
  assert.equal(state.remainingMs, ROUND_MS);
  assert.equal(state.index, 0);
  assert.equal(state.seed, 1);
});

test('any accepted alternative anagram solves automatically and records the player answer', () => {
  const { engine, advance } = fixture();
  engine.start(1);
  advance(4_321);
  const state = type(engine, 'RACE');
  assert.equal(state.status, 'feedback');
  assert.equal(state.feedback, 'correct');
  assert.deepEqual(state.results, [{ target: 'care', answer: 'race', solved: true, elapsedMs: 4_321 }]);
  assert.equal(state.remainingMs, 25_679);
});

test('repeated letters consume separate tiles and unavailable letters do nothing', () => {
  const { engine } = fixture({ pools: { ...singlePools, 4: ['noon'] } });
  engine.start(1);
  engine.typeLetter('n');
  engine.typeLetter('n');
  assert.equal(engine.snapshot().entry, 'nn');
  assert.equal(new Set(engine.snapshot().selectedIds).size, 2);
  engine.typeLetter('n');
  engine.typeLetter('s');
  assert.equal(engine.snapshot().entry, 'nn');
  engine.clear();
  assert.equal(type(engine, 'noon').feedback, 'correct');
});

test('clicking a selected tile clears its suffix while Backspace removes only the final letter', () => {
  const { engine } = fixture();
  engine.start(1);
  type(engine, 'car');
  const state = engine.snapshot();
  engine.selectTile(state.selectedIds[1]);
  assert.equal(engine.snapshot().entry, 'c');
  assert.deepEqual(engine.snapshot().selectedIds, [state.selectedIds[0]]);
  type(engine, 'ar');
  engine.selectTile(state.selectedIds[0]);
  assert.equal(engine.snapshot().entry, '');
  assert.deepEqual(engine.snapshot().selectedIds, []);
  type(engine, 'car');
  engine.backspace();
  assert.equal(engine.snapshot().entry, 'ca');
  engine.clear();
  assert.deepEqual(engine.snapshot().selectedIds, []);
  assert.equal(engine.snapshot().entry, '');
});

test('clicking either selected duplicate clears from the last occurrence and releases the suffix tiles', () => {
  for (const clickedOccurrence of [0, 1]) {
    const { engine } = fixture({ pools: { ...singlePools, 4: ['noon'] } });
    engine.start(1);
    const partial = type(engine, 'nno');
    assert.equal(partial.status, 'playing');
    assert.equal(partial.entry, 'nno');

    const state = engine.selectTile(partial.selectedIds[clickedOccurrence]);
    assert.equal(state.entry, 'n');
    assert.deepEqual(state.selectedIds, [partial.selectedIds[0]]);

    // The removed O can be selected again, and the removed N completes NOON.
    assert.equal(engine.selectTile(partial.selectedIds[2]).entry, 'no');
    const solved = type(engine, 'on');
    assert.equal(solved.feedback, 'correct');
    assert.equal(solved.results[0].answer, 'noon');
    assert.equal(solved.selectedIds.at(-1), partial.selectedIds[1]);
  }
});

test('invalid guesses clear the entry, expose rejected text, and leave the timer running', () => {
  const { engine, advance } = fixture();
  engine.start(1);
  advance(2_000);
  let state = type(engine, 'caer');
  assert.equal(state.status, 'playing');
  assert.equal(state.entry, '');
  assert.equal(state.invalidEntry, 'caer');
  assert.equal(state.invalidAttempt, 1);
  assert.equal(state.remainingMs, 28_000);
  advance(3_000);
  assert.equal(engine.tick().remainingMs, 25_000);
  engine.typeLetter('r');
  assert.equal(engine.snapshot().invalidEntry, '');
  state = type(engine, 'ace');
  assert.equal(state.feedback, 'correct');
  assert.equal(state.results[0].elapsedMs, 5_000);
});

test('an accepted dictionary word cannot bypass the available-letter constraint', () => {
  const { engine } = fixture();
  engine.start(1);
  type(engine, 'aces');
  assert.equal(engine.snapshot().status, 'playing');
  assert.equal(engine.snapshot().entry, 'ace');
  assert.deepEqual(engine.snapshot().results, []);
});

test('shuffle is single use, preserves the puzzle, clears the entry, and never resets time', () => {
  const { engine, advance } = fixture();
  engine.start(1);
  engine.typeLetter('c');
  const initial = engine.snapshot();
  advance(7_500);
  const shuffled = engine.shuffle();
  assert.equal(shuffled.shuffleUsed, true);
  assert.equal(shuffled.entry, '');
  assert.equal(shuffled.remainingMs, 22_500);
  assert.deepEqual(shuffled.words, initial.words);
  assert.notDeepEqual(shuffled.tiles, initial.tiles);
  advance(100);
  const twice = engine.shuffle();
  assert.deepEqual(twice.tiles, shuffled.tiles);
  assert.equal(twice.remainingMs, 22_400);
  type(engine, 'care');
  assert.equal(engine.nextRound().shuffleUsed, false);
});

test('pause preserves entry and remaining time; resume excludes time spent paused', () => {
  const { engine, advance } = fixture();
  engine.start(1);
  engine.typeLetter('c');
  advance(12_345);
  assert.equal(engine.pause().remainingMs, 17_655);
  advance(500_000);
  assert.equal(engine.tick().remainingMs, 17_655);
  assert.equal(engine.typeLetter('a').entry, 'c');
  assert.equal(engine.shuffle().shuffleUsed, false);
  assert.equal(engine.resume().status, 'playing');
  advance(1_000);
  assert.equal(engine.tick().remainingMs, 16_655);
  assert.equal(engine.snapshot().entry, 'c');
});

test('a last letter just before the deadline succeeds', () => {
  const { engine, advance } = fixture();
  engine.start(1);
  type(engine, 'car');
  advance(ROUND_MS - 1);
  assert.equal(engine.typeLetter('e').feedback, 'correct');
  assert.equal(engine.snapshot().results[0].elapsedMs, ROUND_MS - 1);
});

test('deadline equality times out before processing input and finishes the round only once', () => {
  const { engine, advance } = fixture();
  engine.start(1);
  type(engine, 'car');
  advance(ROUND_MS);
  let state = engine.typeLetter('e');
  assert.equal(state.feedback, 'timeout');
  assert.deepEqual(state.results, [{ target: 'care', answer: null, solved: false, elapsedMs: ROUND_MS }]);
  engine.tick();
  engine.typeLetter('e');
  engine.pause();
  state = engine.shuffle();
  assert.equal(state.results.length, 1);
  assert.equal(state.remainingMs, 0);
});

test('a delayed timer callback expires the round using elapsed time without advancing other rounds', () => {
  const { engine, advance } = fixture();
  engine.start(1);
  advance(90_000);
  assert.equal(engine.tick().feedback, 'timeout');
  advance(10_000);
  assert.equal(engine.tick().results.length, 1);
  const next = engine.nextRound();
  assert.equal(next.index, 1);
  assert.equal(next.remainingMs, ROUND_MS);
  assert.equal(next.status, 'playing');
  assert.equal(engine.nextRound().index, 1, 'duplicate callbacks cannot skip a playing round');
});

test('feedback consumes none of the next round time and inputs cannot alter a completed result', () => {
  const { engine, advance } = fixture();
  engine.start(1);
  type(engine, 'care');
  const solved = engine.snapshot();
  advance(100_000);
  engine.clear();
  engine.backspace();
  engine.selectTile(solved.tiles[0].id);
  assert.deepEqual(engine.tick().results, solved.results);
  assert.equal(engine.nextRound().remainingMs, ROUND_MS);
});

test('all twenty rounds contribute exactly one result and then finish', () => {
  const { engine, advance } = fixture();
  engine.start(1);
  for (let round = 0; round < WORD_LENGTHS.length; round += 1) {
    assert.equal(engine.snapshot().index, round);
    if (round % 2 === 0) {
      type(engine, engine.snapshot().words[round]);
    } else {
      advance(ROUND_MS);
      engine.tick();
    }
    assert.equal(engine.snapshot().results.length, round + 1);
    const next = engine.nextRound();
    if (round === 17 || round === 18) {
      const nextWordLength = round === 17 ? 9 : 10;
      assert.equal(next.status, 'playing', `Result ${round + 1} must not finish the game`);
      assert.equal(next.index, round + 1);
      assert.equal(next.words[next.index].length, nextWordLength);
      assert.equal(next.tiles.length, nextWordLength);
      assert.equal(next.remainingMs, ROUND_MS);
    }
  }
  const state = engine.snapshot();
  assert.equal(state.status, 'finished');
  assert.equal(state.results.filter((result) => result.solved).length, 10);
  assert.equal(state.results.length, 20);
  engine.nextRound();
  engine.tick();
  assert.deepEqual(engine.snapshot(), state);
});

test('nine- and ten-letter answers support repeated letters and selected-letter suffix removal', () => {
  const { engine } = fixture();
  engine.start(1);
  for (let round = 0; round < 18; round += 1) {
    type(engine, engine.snapshot().words[round]);
    engine.nextRound();
  }

  for (const [word, repeatedLetter] of [['pineapple', 'p'], ['bookkeeper', 'e']]) {
    const initial = engine.snapshot();
    assert.equal(initial.status, 'playing');
    assert.equal(initial.tiles.length, word.length);
    const partial = type(engine, word.slice(0, -1));
    assert.equal(partial.status, 'playing', 'All letters are required before automatic submission');
    assert.equal(partial.entry, word.slice(0, -1));
    assert.equal(new Set(partial.selectedIds).size, word.length - 1);

    const firstOccurrence = partial.entry.indexOf(repeatedLetter);
    const lastOccurrence = partial.entry.lastIndexOf(repeatedLetter);
    assert.ok(lastOccurrence > firstOccurrence, 'The fixture exercises distinct repeated-letter tiles');
    const shortened = engine.selectTile(partial.selectedIds[firstOccurrence]);
    assert.equal(shortened.entry, word.slice(0, lastOccurrence));
    assert.deepEqual(shortened.selectedIds, partial.selectedIds.slice(0, lastOccurrence));

    const solved = type(engine, word.slice(lastOccurrence));
    assert.equal(solved.feedback, 'correct');
    assert.equal(solved.results.at(-1).answer, word);
    assert.equal(new Set(solved.selectedIds).size, word.length);
    engine.nextRound();
  }
  assert.equal(engine.snapshot().status, 'finished');
  assert.equal(engine.snapshot().results.filter((result) => result.solved).length, 20);
});

test('starting a new game resets in-memory state even during pause or feedback', () => {
  const { engine, advance } = fixture();
  engine.start(1);
  type(engine, 'caer');
  engine.shuffle();
  engine.pause();
  advance(100_000);
  let state = engine.start(2);
  assert.equal(state.invalidAttempt, 0);
  assert.equal(state.invalidEntry, '');
  assert.equal(state.shuffleUsed, false);
  assert.equal(state.index, 0);
  assert.equal(state.remainingMs, ROUND_MS);
  type(engine, 'care');
  state = engine.start(3);
  assert.equal(state.results.length, 0);
  assert.equal(state.feedback, null);
  assert.equal(engine.nextRound().index, 0);
});

test('snapshots cannot mutate engine words, tiles, selections, or results', () => {
  const { engine } = fixture();
  engine.start(1);
  const state = engine.snapshot();
  state.words[0] = 'xxxx';
  state.tiles[0].letter = 'x';
  state.selectedIds.push(100);
  assert.equal(engine.snapshot().words[0], 'care');
  assert.equal(engine.snapshot().tiles.some((tile) => tile.letter === 'x'), false);
  assert.deepEqual(engine.snapshot().selectedIds, []);
  type(engine, 'care');
  const solved = engine.snapshot();
  solved.results[0].solved = false;
  solved.results.push({});
  assert.equal(engine.snapshot().results.length, 1);
  assert.equal(engine.snapshot().results[0].solved, true);
});

test('empty and malformed selected word pools fail clearly', () => {
  assert.throws(() => chooseWords({ ...singlePools, 4: [] }, 1), /4-letter word pool/);
  assert.throws(() => chooseWords({ ...singlePools, 4: ['wrong'] }, 1), /invalid word/);
});
