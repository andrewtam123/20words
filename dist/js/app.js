import { GameEngine, WORD_LENGTHS, ROUND_MS } from './engine.js';
import { loadWordBank } from './word-bank.js';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries([
  'welcome', 'play-area', 'pause-area', 'results-area', 'start', 'load-status', 'retry-load',
  'round-label', 'round-length', 'progress', 'timer', 'seconds', 'timer-fill', 'score-small',
  'answer', 'feedback', 'tiles', 'shuffle', 'shuffle-label', 'clear', 'pause', 'resume',
  'restart', 'play-again', 'results-title', 'final-score', 'result-caption', 'result-grid',
  'word-review', 'help-dialog', 'about-dialog', 'dictionary-info',
].map(id => [id, $(id)]));

let engine;
let animationFrame = 0;
let feedbackTimer = 0;
let invalidTimer = 0;
let generation = 0;
let renderedKey = '';
let lastInvalidAttempt = 0;
let invalidVisible = false;
let suspendedFeedback = false;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function dialogOpen() {
  return ui['help-dialog'].open || ui['about-dialog'].open;
}

function clearScheduledWork() {
  cancelAnimationFrame(animationFrame);
  clearTimeout(feedbackTimer);
  clearTimeout(invalidTimer);
  animationFrame = feedbackTimer = invalidTimer = 0;
}

function beginGame() {
  if (!engine) return;
  generation += 1;
  clearScheduledWork();
  suspendedFeedback = false;
  invalidVisible = false;
  lastInvalidAttempt = 0;
  renderedKey = '';
  document.querySelector('.word-review').open = false;
  render(engine.start(Date.now()));
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function act(method, value) {
  if (!engine || dialogOpen()) return;
  render(engine[method](value));
}

function showScreen(status) {
  const screen = suspendedFeedback || status === 'paused' ? 'pause-area'
    : status === 'finished' ? 'results-area'
    : status === 'ready' ? 'welcome' : 'play-area';
  for (const id of ['welcome', 'play-area', 'pause-area', 'results-area']) ui[id].hidden = id !== screen;
}

function progressCell(index, result, current, tag = 'li') {
  const state = result ? (result.solved ? 'solved' : 'missed') : current ? 'current' : '';
  const label = result ? (result.solved ? 'solved' : 'missed') : current ? 'current word' : 'upcoming';
  const cell = node(tag, `progress-cell ${state}`, result ? (result.solved ? '✓' : '×') : String(index + 1).padStart(2, '0'));
  cell.setAttribute('aria-label', `Word ${index + 1}, ${WORD_LENGTHS[index]} letters, ${label}`);
  if (current) cell.setAttribute('aria-current', 'step');
  return cell;
}

function renderTimer(state) {
  const seconds = Math.ceil(state.remainingMs / 1000);
  if (ui.seconds.textContent !== String(seconds)) {
    ui.seconds.textContent = seconds;
    ui.timer.setAttribute('aria-label', `${seconds} seconds remaining`);
  }
  const urgent = state.remainingMs <= 10000;
  ui.timer.classList.toggle('urgent', urgent);
  ui['timer-fill'].classList.toggle('urgent', urgent);
  ui['timer-fill'].style.transform = `scaleX(${Math.max(0, state.remainingMs / ROUND_MS)})`;
}

function renderRound(state) {
  const activeTile = document.activeElement?.dataset.tile;
  const length = WORD_LENGTHS[state.index];
  const solved = state.results.filter(result => result.solved).length;
  ui['round-label'].textContent = `Word ${String(state.index + 1).padStart(2, '0')} / ${WORD_LENGTHS.length}`;
  ui['round-length'].textContent = `${length} letters`;
  ui['score-small'].textContent = `${solved} solved`;
  ui.progress.replaceChildren(...WORD_LENGTHS.map((_, index) => progressCell(index, state.results[index], index === state.index && state.status !== 'feedback')));

  const invalid = invalidVisible && Boolean(state.invalidEntry) && state.status === 'playing';
  const appearance = state.feedback || (invalid ? 'invalid' : '');
  const displayed = state.feedback === 'timeout' ? state.words[state.index]
    : invalid ? state.invalidEntry : state.entry;
  ui.answer.className = `answer-slots ${appearance}`;
  ui.answer.setAttribute('aria-label', displayed ? `${state.feedback === 'timeout' ? 'Answer' : 'Your answer'}: ${displayed.toUpperCase()}` : `Your answer, ${length} letters`);
  ui.answer.replaceChildren(...Array.from({ length }, (_, index) => node('span', `answer-slot${displayed[index] ? ' filled' : ''}`, displayed[index]?.toUpperCase() || '')));
  ui.feedback.className = `feedback ${appearance}`;
  ui.feedback.textContent = state.feedback === 'correct' ? 'Found it!'
    : state.feedback === 'timeout' ? 'Time’s up. On to the next.'
    : invalid ? 'Not in the word bank. Try again.' : '';
  if (state.feedback === 'timeout' && state.index === WORD_LENGTHS.length - 1) ui.feedback.textContent = 'Time’s up. Let’s see how you did.';

  ui.tiles.style.setProperty('--tile-columns', Math.ceil(length / 2));
  ui.tiles.replaceChildren(...state.tiles.map(tile => {
    const position = state.selectedIds.indexOf(tile.id);
    const button = node('button', `letter-tile${position >= 0 ? ' selected' : ''}`, tile.letter.toUpperCase());
    button.type = 'button';
    button.dataset.tile = tile.id;
    button.setAttribute('aria-label', `Letter ${tile.letter.toUpperCase()}, tile ${tile.id + 1}${position >= 0 ? `, selected at position ${position + 1}` : ''}`);
    button.setAttribute('aria-pressed', String(position >= 0));
    button.disabled = state.status !== 'playing';
    if (position >= 0) {
      const marker = node('span', 'tile-position', position + 1);
      marker.setAttribute('aria-hidden', 'true');
      button.append(marker);
    }
    return button;
  }));
  if (activeTile !== undefined && state.status === 'playing') {
    ui.tiles.querySelector(`[data-tile="${activeTile}"]`)?.focus({ preventScroll: true });
  }
  ui.shuffle.disabled = state.shuffleUsed || state.status !== 'playing';
  ui['shuffle-label'].textContent = state.shuffleUsed ? 'Shuffle used' : 'Shuffle · 1';
  ui.clear.disabled = (!state.entry && !state.invalidEntry) || state.status !== 'playing';
}

function renderResults(state) {
  const score = state.results.filter(result => result.solved).length;
  ui['results-title'].textContent = score === WORD_LENGTHS.length ? 'Every word found.' : score >= 12 ? 'Nice wordplay.' : 'Another round?';
  ui['final-score'].textContent = score;
  ui['result-caption'].textContent = `${score === 1 ? 'Word' : 'Words'} found before the clock ran out.`;
  ui['result-grid'].replaceChildren(...state.results.map((result, index) => progressCell(index, result, false, 'span')));
  ui['word-review'].replaceChildren(...state.results.map((result, index) => {
    const row = node('li', `review-row ${result.solved ? 'solved' : 'missed'}`);
    row.append(node('span', 'review-number', String(index + 1).padStart(2, '0')));
    const answer = node('span', 'review-answer', result.answer || result.target);
    if (result.answer && result.answer !== result.target) answer.append(node('span', 'review-target', `Also: ${result.target.toUpperCase()}`));
    row.append(answer, node('span', 'review-status', result.solved ? `✓ ${(result.elapsedMs / 1000).toFixed(1)}s` : '× Missed'));
    return row;
  }));
}

function schedule(state) {
  if (state.status === 'playing' && !animationFrame && !document.hidden && !dialogOpen()) {
    animationFrame = requestAnimationFrame(() => {
      animationFrame = 0;
      render(engine.tick());
    });
  }
  if (state.status === 'feedback' && !feedbackTimer && !suspendedFeedback && !document.hidden && !dialogOpen()) {
    const expectedGeneration = generation;
    const expectedRound = state.index;
    feedbackTimer = setTimeout(() => {
      feedbackTimer = 0;
      const current = engine.snapshot();
      if (generation === expectedGeneration && current.index === expectedRound && current.status === 'feedback' && !suspendedFeedback && !document.hidden && !dialogOpen()) render(engine.nextRound());
    }, state.feedback === 'correct' ? 900 : 1800);
  }
}

function render(state) {
  if (state.invalidAttempt !== lastInvalidAttempt) {
    lastInvalidAttempt = state.invalidAttempt;
    invalidVisible = true;
    clearTimeout(invalidTimer);
    const expectedGeneration = generation;
    invalidTimer = setTimeout(() => {
      invalidTimer = 0;
      if (expectedGeneration !== generation) return;
      invalidVisible = false;
      render(engine.tick());
    }, 650);
  }
  showScreen(state.status);
  if (state.status === 'playing' || state.status === 'feedback') renderTimer(state);
  // Countdown frames only update the clock. Keep focus and tile DOM stable.
  const key = JSON.stringify([state.status, state.index, state.entry, state.selectedIds, state.shuffleUsed, state.tiles, state.results.length, state.feedback, state.invalidEntry, state.invalidAttempt, invalidVisible, suspendedFeedback]);
  if (key !== renderedKey) {
    renderedKey = key;
    if (state.status === 'playing' || state.status === 'feedback') renderRound(state);
    if (state.status === 'finished') renderResults(state);
  }
  schedule(state);
}

function suspend() {
  if (!engine) return;
  cancelAnimationFrame(animationFrame);
  clearTimeout(feedbackTimer);
  animationFrame = feedbackTimer = 0;
  const state = engine.pause();
  if (state.status === 'feedback') suspendedFeedback = true;
  render(state);
}

function resume() {
  suspendedFeedback = false;
  act('resume');
}

ui.start.addEventListener('click', beginGame);
ui['play-again'].addEventListener('click', beginGame);
ui.restart.addEventListener('click', beginGame);
ui.pause.addEventListener('click', suspend);
ui.resume.addEventListener('click', resume);
ui.shuffle.addEventListener('click', () => act('shuffle'));
ui.clear.addEventListener('click', () => act('clear'));
ui.tiles.addEventListener('click', event => {
  const tile = event.target.closest('button[data-tile]');
  if (tile) act('selectTile', Number(tile.dataset.tile));
});

document.addEventListener('keydown', event => {
  if (!engine || dialogOpen() || event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.target.closest('input, textarea, [contenteditable="true"]')) return;
  if (engine.snapshot().status !== 'playing') return;
  // Deliberately no Space or Shift shuffle shortcut. Only the button shuffles.
  const isLetter = /^[a-z]$/i.test(event.key);
  if (!isLetter && event.key !== 'Backspace') return;
  event.preventDefault();
  // Direct typing should not leave a focus ring on the last clicked tile.
  // Tab navigation and button activation keep their normal focus behavior.
  const focused = document.activeElement;
  if (focused?.matches('button[data-tile]') && ui.tiles.contains(focused)) focused.blur();
  act(isLetter ? 'typeLetter' : 'backspace', event.key);
});

function openDialog(dialog) {
  suspend();
  dialog.showModal();
}
$('help-open').addEventListener('click', () => openDialog(ui['help-dialog']));
$('about-open').addEventListener('click', () => openDialog(ui['about-dialog']));
for (const dialog of [ui['help-dialog'], ui['about-dialog']]) {
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if (event.target === dialog) {
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  } });
}
document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
window.addEventListener('pagehide', suspend);

async function initialize() {
  ui.start.disabled = true;
  ui.start.textContent = 'Loading words…';
  ui['load-status'].textContent = 'Getting your word bank ready.';
  ui['retry-load'].hidden = true;
  try {
    const bank = await loadWordBank();
    engine = new GameEngine(bank);
    ui.start.disabled = false;
    ui.start.replaceChildren(document.createTextNode('Start a game'), node('span', '', '→'));
    ui.start.lastElementChild.setAttribute('aria-hidden', 'true');
    ui['load-status'].textContent = 'No daily limit. Just one more round.';
    ui['dictionary-info'].textContent = `${bank.targetCount.toLocaleString()} puzzle words from SCOWL 2020.12.07, through level 35. ${bank.count.toLocaleString()} accepted answers through level 70. English, American, British, and Canadian spellings.`;
  } catch (error) {
    ui.start.textContent = 'Words unavailable';
    ui['load-status'].textContent = 'Couldn’t load the words. Check your connection and try again.';
    ui['retry-load'].hidden = false;
    console.error('Unable to initialize the word bank:', error);
  }
}
ui['retry-load'].addEventListener('click', initialize);
initialize();
