// All data access lives here. A future service worker can cache these same
// same-origin resources without changing the engine or presentation layer.
async function loadPools(filename) {
  const response = await fetch(new URL(`../data/${filename}`, import.meta.url));
  if (!response.ok) throw new Error(`Word bank request failed (${response.status}).`);
  const pools = await response.json();
  for (const length of [4, 5, 6, 7, 8, 9, 10]) {
    if (!pools || !Array.isArray(pools[length]) || pools[length].length === 0 ||
        pools[length].some(word => typeof word !== 'string' || !/^[a-z]+$/.test(word) || word.length !== length)) {
      throw new Error('The word bank is incomplete or invalid.');
    }
  }
  return pools;
}

export async function loadWordBank() {
  const [pools, acceptedPools] = await Promise.all([
    loadPools('puzzle-words.json'),
    loadPools('words.json'),
  ]);
  const targets = Object.values(pools).flat();
  const acceptedWords = new Set(Object.values(acceptedPools).flat());
  if (targets.some(word => !acceptedWords.has(word))) {
    throw new Error('A puzzle word is missing from the accepted vocabulary.');
  }
  return { pools, acceptedWords, count: acceptedWords.size, targetCount: targets.length };
}
