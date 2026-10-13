# Agent handoff: 20 words

## Purpose and current scope

This repository is **20 words · Unlimited**, a mobile-friendly, static anagram game inspired by 18words. The local folder may still be named `18words`; the product name is **20 words**. Preserve the original-game attribution where it is a historical credit.

Read this file, [README.md](README.md), and the relevant implementation before changing behavior. [NEXT_STEPS.md](NEXT_STEPS.md) contains the requested future features: **offline caching**, a **predefined dictionary catalog/easy dictionary substitution**, **incremental custom builds with local saving and share/import links**, and **two-player battle mode over a network**. Custom builds replace the earlier standalone difficulty-mode proposal; 20-word Easy/Medium/Hard recipes will be built-in defaults. These are plans, not instructions to implement features during unrelated tasks. Dictionary cutoffs/sizes, the initially selected default build, build/link size limits and battle networking/rule details remain open.

The source review on **2026-10-12** covered the engine, UI, styles, HTML, manifest, dictionary loader/generator, tests, and Pages workflow. All **37 Node tests passed** on Node 24.19.0. This is a review baseline, not a guarantee about later changes. No core gameplay defect was found; review limitations are recorded below.

## Product decisions to preserve

- Exactly **20 rounds**, with lengths defined by `WORD_LENGTHS` in `dist/js/engine.js`:
  `4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 7, 7, 7, 8, 8, 9, 10`.
  Rounds 19 and 20 are **9 and 10 letters**. The earlier 18- and 19-word versions are superseded. This is the current shipped game and the required progression for future default builds; planned custom builds may use different counts and ordered lengths.
- Each word gets **30 seconds**. Unused time does not carry forward. The score is the number solved out of 20; elapsed times are shown only in the results review.
- Unlimited new games, no daily challenge or account requirement. The current solo app has no backend, database, external runtime library, analytics, or remote dictionary API. Planned battle mode is an explicitly requested exception requiring network communication/shared match state; solo play must remain independent of that service.
- Current game state lives only in memory. Reloading or closing the page loses the current game. **Game recovery and saved scores/statistics remain excluded.** The user has now requested persistent local **build definitions**, which is a specific exception to the earlier no-persistence scope, not permission to save active words, seeds, timer, answers or progress. No build storage exists yet.
- There is currently **no service worker or deliberate offline cache**. A loaded game can keep running without additional gameplay requests, but offline reload/launch is not promised. The manifest alone does not provide offline support.
- Preserve touch/mobile play and hardware keyboard support. Shuffle is available only by activating its button, once per round. There is **no global Space or Shift shuffle shortcut**; ordinary keyboard activation of a focused button remains valid accessibility behavior.

## Architecture and edit locations

`dist/` is the checked-in, editable application source and deployment artifact. There is **no build step** that regenerates its HTML/CSS/JS. Do not replace it with compiled output or add a framework/build system without a task that needs it.

| File | Responsibility |
| --- | --- |
| `dist/js/engine.js` | Pure synchronous rules, RNG, selection, tile identity, deadlines, state transitions and results. No DOM, network or storage. |
| `dist/js/app.js` | DOM rendering, input, screen/dialog lifecycle, feedback delays, startup/retry and browser suspension. |
| `dist/js/word-bank.js` | The single dictionary-loading boundary; fetches and validates both local JSON banks. |
| `dist/index.html` | Static screens, instructions, metadata, accessible labels, credits and asset links. |
| `dist/styles.css` | Responsive layout, tile/answer sizing, focus, colors and reduced-motion behavior. |
| `dist/manifest.webmanifest`, `dist/assets/` | Home-screen metadata and SVG/PNG branding. |
| `dist/data/` | Generated target/accepted dictionaries, provenance and full upstream license notices. |
| `scripts/prepare-words.mjs` | Reproducible SCOWL extraction. |
| `scripts/serve.mjs` | Local static preview server; not a production backend. |
| `tests/` | Built-in Node tests for rules, dictionary integrity and loading. |
| `.github/workflows/pages.yml` | Test and publish the contents of `dist/` to GitHub Pages. |

Keep rules in the engine, browser behavior in the UI, and data access in the loader. Rendering uses DOM methods and `textContent`. URLs are relative or derived from `import.meta.url`; preserve hosting under both `/` and `/20words/`.

## Rules and implementation details that are easy to regress

### Random selection

`beginGame()` passes `Date.now()` to `GameEngine.start()`. The entire timestamp string is hashed into a deterministic, non-cryptographic xoshiro128** generator. **All 20 target words are drawn before any tile scrambling consumes random numbers.** For each required length, draw uniformly from that length's deduplicated target array, independently **with replacement**. `randomIndex()` uses rejection sampling to avoid modulo bias.

Do not add a queue, anagram-group sampling, frequency weighting, duplicate prevention, or repeat history. Repeated words/groups are allowed. The same seed and ordered pools give the same target sequence. Player shuffles consume the remaining RNG stream and can affect later tile arrangements, but cannot change the already selected words.

### Tiles and answers

Tiles have stable IDs, including duplicate letters. A full selection submits automatically. Any accepted word using exactly the available letters succeeds; the selected target is also always accepted by the engine. Invalid full guesses clear the selection and permit immediate retry while the timer keeps running; the UI briefly displays the rejected entry.

Clicking a **selected** tile removes the suffix starting at the **last occurrence of that character in the current entry**, inclusive. Example: with `NNO` entered, clicking either selected N leaves `N`. This is deliberately different from removing one tile and shifting the rest. Backspace removes only the last selected tile; Clear removes everything.

Shuffle clears the entry and preserves the target, tile identities and remaining time. Scrambling avoids the target spelling and, on shuffle, the previous visible order when another permutation exists. Its bounded fallback must still terminate for repeated/identical-letter inputs.

### Timing and lifecycle

The engine uses an injectable monotonic clock (`performance.now()` by default), separate from the wall-clock seed. Every gameplay action checks the deadline before processing input; an input exactly at the deadline loses. `snapshot()` does not advance time; `tick()` does. Only one result can be recorded per round.

The state machine is `ready -> playing -> feedback -> playing/finished`, with `playing <-> paused`. The UI calls `nextRound()` after **900 ms** for success or **1,800 ms** for a timeout reveal. Invalid feedback lasts **650 ms**. Feedback time does not consume the next round's time.

In the current solo game, Pause, opening Help/About, hiding the document, and `pagehide` suspend play. The puzzle is hidden on the pause screen. Returning to the tab or closing a dialog requires explicit Resume. Feedback suspension is tracked separately in the UI because the engine remains in `feedback`. Future battle mode needs an explicit shared pause/disconnect policy; a local tab cannot independently suspend the match clock.

Preserve `clearScheduledWork()`, the game-generation/round checks on callbacks, and feedback suspension when changing lifecycle code. Countdown frames update the timer without rebuilding tiles. Direct typing/Backspace blur a focused letter tile to avoid the previously reported orange focus ring, while Tab navigation retains visible focus.

Round-dependent labels in `app.js` mostly use `WORD_LENGTHS.length`, but HTML copy, the score denominator, icons, manifest and README contain explicit branding/counts. The results heading also uses a fixed 12-solved threshold. Any future requested rule/name change needs an audit of all these locations.

### Planned custom-build extension

The requested builder appends ordered groups of **word length + predefined dictionary + number of words** until the player is satisfied. Builds must be locally saveable and portable through export/import links. Share the reusable recipe, not a fixed seed or sampled answers; every solo play continues to draw fresh words. Default Easy/Medium/Hard builds use the exact 20-word progression above and their corresponding dictionaries. A future battle invite is separate from a recipe link and joins a match with one shared word sequence.

Implementation will need an explicit, immutable per-round plan in place of global `WORD_LENGTHS` for arbitrary games, dictionary resolution for each round, and dynamic progress/scoring/final-round UI. Draw all configured targets before scrambling, retaining uniform independent sampling with replacement. Bind accepted answers to the chosen dictionary policy per round; share a broad bank across compatible profiles rather than accidentally unioning unrelated sources. Keep catalog, build validation, local storage and link encoding outside the engine. The full plan and acceptance checks are in `NEXT_STEPS.md`; none of this is implemented in the current source.

### Planned battle extension

Two players on different devices play the same words; the first valid solver earns one point per round and the highest final score wins. Draw once per match using a frozen default/custom build and dictionary versions, rather than seeding each device independently. Networking and room coordination belong outside the pure engine. One authority must validate and order submissions and award each round at most once; client clocks and independent local score updates cannot settle competing claims.

The roadmap proposes synchronized rounds, a shared 30-second timeout, equal-score draws and a separate authoritative network service while retaining GitHub Pages for the frontend. These details, including latency arbitration, pause and reconnect/forfeit policies, remain to be settled before implementation. Battle requires a live connection; offline guarantees apply to solo play. Transient match coordination does not imply durable game recovery or saved scores. Keep solo input, timing and pause behavior intact when introducing battle-specific lifecycle handling. No battle functionality exists yet.

## Vocabulary and licensing

The following describes the current shipped dictionary, not a permanent restriction to SCOWL. The engine already accepts replacement pools, but the loader filenames, generator, UI credits and tests are still source-specific. The catalog/custom-build roadmap will address those couplings; neither feature is implemented yet. Catalog entries define target-pool breadth separately from accepted answers, and the builder chooses a dictionary per group. Uniform selection within each eligible pool remains required.

- Source is checksum-pinned **SCOWL 2020.12.07**. Targets: **34,679** words from cumulative levels **10, 20 and 35**. Accepted answers: **87,701** words through level **70**. A raw SCOWL level-35 source file does not include lower tiers by itself.
- Both banks have separate pools for lengths **4 through 10**. Include normal `words` categories for English, American, British (`-ise` and `-ize`), Canadian, and the generator's listed variant levels 1-2. Preserve inflections and regional spellings.
- The filter is exactly lowercase ASCII `^[a-z]{4,10}$`, applied before any case conversion; there is no accent normalization or manual/frequency/content curation. Name/upper/abbreviation/contraction/special categories and variant_3 files are excluded. SCOWL 35 reduces obscurity, but does not guarantee familiar targets.
- `puzzle-words.json` controls what is drawn; `words.json` controls alternative-answer acceptance. Do not substitute the broad bank if targets fail to load. The loader validates all required pools and target inclusion in accepted answers before enabling Start.
- Per-length counts, source files and hashes are in `dist/data/word-source.json` and checked by `tests/data.test.js`. Original 4-8-letter subsets are also pinned by tests. Update expectations only for intentional, reviewed data-policy changes.
- Preserve the generator's LF line endings, including the final newline in both dictionary JSON files: their hashes cover exact bytes. Windows Git's automatic CRLF conversion can cause checksum failures after checkout. Check line endings before changing expected hashes; do not silently change machine-wide Git settings.
- Change the generator rather than hand-editing generated JSON. It rebuilds both banks, metadata and `SCOWL-LICENSE.txt` together. Preserve the complete upstream notices and the statement that the data was extracted/filtered. No standalone license for the game code has been selected in this repository; do not treat the dictionary license as a license for all project code.

Rebuild only when data work calls for it:

```sh
node scripts/prepare-words.mjs
# Or use an existing checksum-matching archive without downloading:
node scripts/prepare-words.mjs --archive /path/to/scowl-2020.12.07.tar.gz
```

The normal command caches the archive in `vendor/`; `.gitignore` excludes that archive. The pinned tar is parsed in memory, and upstream scripts are never executed. The cache is unnecessary for playing, serving or testing the committed app.

## Run and validate

Use **Node.js 20+**; CI uses Node 22. There are no npm dependencies to install. Commands from the repository root:

```sh
node --test
node scripts/serve.mjs
# Alternatively, test the GitHub Pages subpath:
node scripts/serve.mjs --project-path
```

The server listens at `http://127.0.0.1:4173/`, or `http://127.0.0.1:4173/20words/` with `--project-path`. Stop your previous server or use another `PORT` before starting a second one on the same port. It binds to loopback only, so this URL is not directly reachable from a separate phone. It serves `dist/` with `Cache-Control: no-store`. Opening `index.html` via `file://` is not supported because the app uses modules and fetches JSON.

Check the actual shell and runtime availability before giving commands. The user has used **WSL**; Windows PowerShell syntax and paths will not work in its Linux shell. Codex's bundled Windows Node/Git are not necessarily on the user's WSL PATH. A Windows credential helper also needs Windows Git available; the working workaround used Windows `git.exe credential-manager` as the helper command, rather than invoking `git-credential-manager.exe` directly. Inspect current tooling/configuration before proposing another authentication change; keep credentials out of output and documentation.

Automated coverage is 24 engine tests, 7 data tests and 6 loader tests at the review baseline. It covers deadline boundaries, repeated-letter removal, alternative answers, shuffle, pause, independent draws, full 20-round completion, long-word pools, checksums and licensing. It does **not** exercise the DOM, real browser timers, focus, dialogs, visibility changes, responsive layout, hosting, or service workers.

For UI/lifecycle changes, complement the relevant Node tests with browser smoke checks:

1. Load at the repository subpath; verify startup and dictionary-error/retry behavior when relevant.
2. Exercise touch/click and typing, repeated letters, selected-letter suffix removal, Backspace, invalid answers and single-use shuffle. Check normal keyboard focus and the absence of global shuffle shortcuts.
3. Pause/resume, open/close dialogs, switch tabs/apps, and restart during feedback; confirm no hidden timer loss or stale round transition.
4. Verify 9- and 10-letter rounds at narrow mobile widths (including 320 px), results out of 20, word review and another fresh game. Check landscape/short-height layouts when styling changes.

Use temporary test fixtures or injected clocks where appropriate; do not ship fixed answers, shortened timers or test-only controls. Restore any temporary browser viewport and avoid disrupting a user-requested playtest server. Report what was actually verified; a Node pass is not a mobile/browser accessibility audit.

## Hosting and repository

The configured origin at review time is [andrewtam123/20words](https://github.com/andrewtam123/20words), on `main`. Recheck remotes/branch/status before Git operations; repository state and deployment status can change independently of these documents.

The authoritative workflow is **Check and publish GitHub Pages** in `.github/workflows/pages.yml`. It runs `npm test`, uploads **`dist/`**, and deploys successful `main` pushes/manual runs. Pull requests run checks without deployment. In repository Settings -> Pages, the source is **GitHub Actions**. Do not add GitHub's extra `static.yml` or Jekyll template: the existing workflow already publishes the correct directory.

The expected Pages address is `https://andrewtam123.github.io/20words/`; confirm live status from the current successful deployment rather than assuming it from configuration. A push to `main` can publish immediately. Commit the project sources, tests, generated data and workflow; publish only `dist/`.

## Review limitations

No full assistive-technology audit or new browser playthrough was performed during this documentation review. One concrete visual issue remains: `--muted: #73796f` on `--paper: #f7f6f0` is approximately **4.13:1** contrast, and is used for small text such as `.input-note`. This is below the **4.5:1** normal-text threshold in [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Do not claim full accessibility conformance. This records an existing finding outside the requested feature roadmap.
