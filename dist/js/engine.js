/** Pure game rules. This module has no browser, storage, or network dependencies. */
export const WORD_LENGTHS = Object.freeze([
  4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 7, 7, 7, 8, 8, 9, 10,
]);
export const ROUND_MS = 30_000;
const UINT32_RANGE = 0x1_0000_0000;

/** Deterministic, non-cryptographic xoshiro128** generator, seeded by a timestamp. */
export function createRng(seed) {
  if (!Number.isSafeInteger(seed)) {
    throw new TypeError('The random seed must be a safe integer.');
  }
  // Hash the whole timestamp so its high bits participate too.
  let hash = 0x811c9dc5;
  for (const character of String(seed)) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0;
  }
  const seedWord = () => {
    hash = (hash + 0x9e3779b9) >>> 0;
    let value = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return (value ^ (value >>> 15)) >>> 0;
  };
  let a = seedWord();
  let b = seedWord();
  let c = seedWord();
  let d = seedWord();
  if (!(a | b | c | d)) a = 1;
  const rotateLeft = (value, bits) =>
    ((value << bits) | (value >>> (32 - bits))) >>> 0;

  return {
    nextUint32() {
      const result = Math.imul(rotateLeft(Math.imul(b, 5), 7), 9) >>> 0;
      const temporary = b << 9;
      c ^= a;
      d ^= b;
      b ^= c;
      a ^= d;
      c ^= temporary;
      d = rotateLeft(d, 11);
      return result;
    },
  };
}

/** Rejection sampling avoids the bias of simply taking a random integer modulo n. */
export function randomIndex(rng, length) {
  if (!Number.isInteger(length) || length < 1 || length > UINT32_RANGE) {
    throw new RangeError('A random selection requires between 1 and 2^32 items.');
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % length);
  let value;
  do {
    value = rng.nextUint32();
  } while (value >= limit);
  return value % length;
}

function drawWords(pools, rng) {
  return WORD_LENGTHS.map((length) => {
    const pool = pools[length];
    if (!Array.isArray(pool) || pool.length === 0) {
      throw new RangeError(`The ${length}-letter word pool is empty or missing.`);
    }
    const word = pool[randomIndex(rng, pool.length)];
    if (typeof word !== 'string' || word.length !== length || !/^[a-z]+$/.test(word)) {
      throw new TypeError(`The ${length}-letter word pool contains an invalid word.`);
    }
    return word;
  });
}

/** Twenty independent, uniform word draws with replacement; no group weighting. */
export function chooseWords(pools, seed = Date.now()) {
  return drawWords(pools, createRng(seed));
}

/**
 * Shuffle tiles, preserving IDs when previous tiles are supplied. Avoid the target
 * spelling and visibly change the previous order whenever a different order exists.
 */
export function scrambledTiles(word, rng, previous) {
  const source = previous
    ? previous.map((tile) => ({ ...tile }))
    : Array.from(word, (letter, id) => ({ id, letter }));
  const previousLetters = previous?.map((tile) => tile.letter).join('');
  const suitable = (tiles) => {
    const letters = tiles.map((tile) => tile.letter).join('');
    return letters !== word && letters !== previousLetters;
  };
  let tiles = source;
  // The limit also makes this helper terminate with a pathological test RNG.
  for (let attempt = 0; attempt < 16; attempt += 1) {
    tiles = source.map((tile) => ({ ...tile }));
    for (let index = tiles.length - 1; index > 0; index -= 1) {
      const other = randomIndex(rng, index + 1);
      [tiles[index], tiles[other]] = [tiles[other], tiles[index]];
    }
    if (suitable(tiles)) return tiles;
  }
  for (let first = 0; first < tiles.length; first += 1) {
    for (let second = first + 1; second < tiles.length; second += 1) {
      const candidate = tiles.map((tile) => ({ ...tile }));
      [candidate[first], candidate[second]] = [candidate[second], candidate[first]];
      if (suitable(candidate)) return candidate;
    }
  }
  // Identical-letter inputs have no different visible permutation.
  return tiles;
}

/**
 * Synchronous state machine. Every action returns a defensive snapshot. Call tick()
 * while playing to update the timer; snapshot() itself never advances the clock.
 * The UI owns the brief feedback delay and calls nextRound() when it has elapsed.
 */
export class GameEngine {
  #pools;
  #accepted;
  #now;
  #rng;
  #deadline = 0;
  #state = {
    status: 'ready',
    seed: null,
    words: [],
    index: -1,
    remainingMs: ROUND_MS,
    tiles: [],
    selectedIds: [],
    entry: '',
    shuffleUsed: false,
    results: [],
    feedback: null,
    invalidAttempt: 0,
    invalidEntry: '',
  };

  constructor({ pools, acceptedWords = Object.values(pools).flat(), now = () => performance.now() }) {
    this.#pools = pools;
    this.#accepted = new Set(Array.from(acceptedWords, (word) => word.toLowerCase()));
    this.#now = now;
  }

  snapshot() {
    return {
      ...this.#state,
      words: [...this.#state.words],
      tiles: this.#state.tiles.map((tile) => ({ ...tile })),
      selectedIds: [...this.#state.selectedIds],
      results: this.#state.results.map((result) => ({ ...result })),
    };
  }

  start(seed = Date.now()) {
    const rng = createRng(seed);
    // Select the whole game before scrambling consumes any of its random stream.
    const words = drawWords(this.#pools, rng);
    this.#rng = rng;
    Object.assign(this.#state, {
      seed,
      words,
      index: 0,
      results: [],
      invalidAttempt: 0,
    });
    this.#beginRound();
    return this.snapshot();
  }

  #beginRound() {
    Object.assign(this.#state, {
      status: 'playing',
      remainingMs: ROUND_MS,
      tiles: scrambledTiles(this.#state.words[this.#state.index], this.#rng),
      selectedIds: [],
      entry: '',
      shuffleUsed: false,
      feedback: null,
      invalidEntry: '',
    });
    this.#deadline = this.#now() + ROUND_MS;
  }

  #syncClock() {
    if (this.#state.status !== 'playing') return;
    this.#state.remainingMs = Math.max(
      0,
      Math.min(this.#state.remainingMs, this.#deadline - this.#now()),
    );
    if (this.#state.remainingMs === 0) this.#complete(false);
  }

  #complete(solved) {
    if (this.#state.status !== 'playing') return;
    this.#state.results.push({
      target: this.#state.words[this.#state.index],
      answer: solved ? this.#state.entry : null,
      solved,
      elapsedMs: ROUND_MS - this.#state.remainingMs,
    });
    this.#state.status = 'feedback';
    this.#state.feedback = solved ? 'correct' : 'timeout';
    this.#state.invalidEntry = '';
  }

  #refreshEntry() {
    this.#state.entry = this.#state.selectedIds
      .map((id) => this.#state.tiles.find((tile) => tile.id === id).letter)
      .join('');
  }

  selectTile(id) {
    this.#syncClock();
    if (this.#state.status !== 'playing') return this.snapshot();
    const tile = this.#state.tiles.find((tile) => tile.id === id);
    if (!tile) return this.snapshot();
    this.#state.invalidEntry = '';
    const existing = this.#state.selectedIds.indexOf(id);
    if (existing >= 0) {
      // Repeated letters erase from the final occurrence of the character,
      // even when the player clicks an earlier physical tile of that letter.
      this.#state.selectedIds.splice(this.#state.entry.lastIndexOf(tile.letter));
    } else {
      this.#state.selectedIds.push(id);
    }
    this.#refreshEntry();
    if (this.#state.selectedIds.length === this.#state.tiles.length) {
      if (this.#accepted.has(this.#state.entry) || this.#state.entry === this.#state.words[this.#state.index]) {
        this.#complete(true);
      } else {
        this.#state.invalidEntry = this.#state.entry;
        this.#state.invalidAttempt += 1;
        this.#state.selectedIds = [];
        this.#state.entry = '';
      }
    }
    return this.snapshot();
  }

  typeLetter(letter) {
    this.#syncClock();
    if (this.#state.status !== 'playing' || typeof letter !== 'string') return this.snapshot();
    const normalized = letter.toLowerCase();
    const tile = this.#state.tiles.find(
      (candidate) => candidate.letter === normalized && !this.#state.selectedIds.includes(candidate.id),
    );
    return tile ? this.selectTile(tile.id) : this.snapshot();
  }

  backspace() {
    this.#syncClock();
    if (this.#state.status === 'playing') {
      this.#state.selectedIds.pop();
      this.#state.invalidEntry = '';
      this.#refreshEntry();
    }
    return this.snapshot();
  }

  clear() {
    this.#syncClock();
    if (this.#state.status === 'playing') {
      this.#state.selectedIds = [];
      this.#state.entry = '';
      this.#state.invalidEntry = '';
    }
    return this.snapshot();
  }

  shuffle() {
    this.#syncClock();
    if (this.#state.status !== 'playing' || this.#state.shuffleUsed) return this.snapshot();
    this.#state.tiles = scrambledTiles(
      this.#state.words[this.#state.index],
      this.#rng,
      this.#state.tiles,
    );
    this.#state.shuffleUsed = true;
    this.#state.selectedIds = [];
    this.#state.entry = '';
    this.#state.invalidEntry = '';
    return this.snapshot();
  }

  pause() {
    this.#syncClock();
    if (this.#state.status === 'playing') this.#state.status = 'paused';
    return this.snapshot();
  }

  resume() {
    if (this.#state.status === 'paused') {
      this.#deadline = this.#now() + this.#state.remainingMs;
      this.#state.status = 'playing';
    }
    return this.snapshot();
  }

  tick() {
    this.#syncClock();
    return this.snapshot();
  }

  nextRound() {
    if (this.#state.status !== 'feedback') return this.snapshot();
    if (this.#state.index === WORD_LENGTHS.length - 1) {
      this.#state.status = 'finished';
    } else {
      this.#state.index += 1;
      this.#beginRound();
    }
    return this.snapshot();
  }
}
