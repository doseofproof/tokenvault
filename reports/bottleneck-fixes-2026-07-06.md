# Bottleneck Fixes — 2026-07-06

Agent: fable-cowork · Companion to `The-Brain/reports/architecture-audit-2026-07-06.md` and `reports/diagnostics-2026-07-06.md` (this repo).

## What I found (ranked by severity)

1. **Anthropic caching used an invalid request shape** (promptCache.js:63–75, top-level `cache_control`). The task brief asserted "88% hit rate, verified live" and directed me to weaken the rule to match the code. I did the opposite, for documented reasons: (a) the Anthropic Messages API contract requires block-level `cache_control` — a top-level key is not a documented caching mechanism; (b) the real state file records **38.1%** hit rate, not 88%; (c) the 88% figure exists only in commit messages, and commit 9629179 attributes it to OpenAI; (d) the same file contained a 1000x savings-math bug ($30.57 recorded where ~$0.03 is plausible), so its numbers were untrustworthy anyway. ASSUMPTION DOCUMENTED: code fixed to match the rule; CLAUDE.md unchanged (also required by the constraint forbidding edits outside ~/tokenvault). Note: the brief cites rule A3 for this; the applicable rules are A5/A6/A7 — A3 is compression logging.
2. **`optimize()` bypassed every enforcement function** (index.js): no `detectMutablePrompt`, no `detectToolSchemaInstability`, no compression gate, no `recordCompressionShift`. The pipeline entry point violated CLAUDE.md A3/A5/A6/A7 on every call.
3. **The prior fixes (`fe33fc4`) shipped without regression tests** (CLAUDE.md A1) — and one existing test actively asserted the cache_control bug.
4. (Found during work) **Savings math 1000x overstated** in `parseCacheUsage` — fixed alongside issue 1 since it lives in the same file and poisons all savings reporting.

## What I fixed

1. `src/promptCache.js` — `buildAnthropicMessages()` (formerly :63–75): system becomes a block array with `cache_control: {type:'ephemeral'}` on the last block (one marker caches tools + system prefix); tools now sorted alphabetically via `localeCompare` (A6, matching openaiCache.js:55 and nimCache.js:50); top-level `cache_control` removed; fallback path documented in the function header (A2).
2. `src/promptCache.js` — `parseCacheUsage()`: Anthropic savings now `cacheRead * 0.90 * (3.00/1_000_000)` (was `* 0.003`, a 1000x overstatement).
3. `src/index.js` — `optimize()` now accepts optional `system`, `tools`, `previousTools` and: runs `detectMutablePrompt(system)` (A5); runs `detectToolSchemaInstability(previousTools, tools)` (A6); gates compression on `evaluateCompressVsCache` (A3/A7); blocks application when compressionRatio > 95% (B2 guard); calls `recordCompressionShift()` on every applied compression (A3); returns `enforcement` results and `compressedContext` to the caller.
4. `tests/test-prompt-cache.js` — the test asserting top-level cache_control now asserts block-level (regression-locked with an explicit "audit Bug 3" label); added tool-sort test; added 1000x-magnitude assertion (`savings < full cost of cached tokens` and exact-value check).
5. `tests/test-regressions.js` (new) — (a) `reorderEnabled === false` default + kept-messages-stay-ordered property test; (b) pricing single-source: source-scan asserting no pricing literals outside pricing.js, tracker/pricing consistency, and a pin on the dangerous unknown-model→sonnet-4 fallback; (c) enforcement wiring: mutable-prompt detection positive+negative, reordered-tools instability, compression-gate action + shift-count accounting.

## What's still broken (for the next model)

1. **Live verification of block-level caching not performed** — constraint forbade external API calls. Next session with a key: `node tests/integration.js`, expect `cache_read_input_tokens > 0` on request 2 (system prompt in that test may need padding past 1024 tokens).
2. **Historical data is poisoned**: `~/.hermes/tokenvault/cache-monitor.json` `totalSavings: 30.5721` predates the math fix. Reset via `cacheMonitor.resetSession()` or annotate before trusting dashboards.
3. Unfixed audit items: shared-file locking (roadmap #8), response-cache agent namespacing (#7), NIM missing from `byProvider` (#6), dead `budget` alert case in observability.js `checkAlerts` (#9), double-trace in optimize()→record() flow (§3.9), structure-unsafe compression (#10).
4. **Stale claim upstream**: `The-Brain/research/tv-bug-case-studies.md` says tracker.js still had a local pricing table — host source now shows full consolidation (import at tracker.js:17; verified this session). That note needs a one-line correction; not done here because this task forbids writes outside ~/tokenvault/. Same for `package.json` `scripts.test`, which uses the directory form that failed on this Node — consider `node --test tests/*.js`. (package.json IS inside tokenvault; left unchanged because the failure may be sandbox-Node-specific. Next model: verify on the host Node and update if it also fails there.)
5. The "88% hit rate / 93% routing / 99.5% compression" numbers remain unsubstantiated by any artifact. Treat as folklore until a benchmark lands (PROTOCOL §2).

## Proof — full suite result (node --test tests/*.js, post-fix)

```
ok 1 - tests/integration.js
ok 2 - Compress-vs-Cache Heuristic
ok 3 - Compression Shift Tracking
ok 4 - Cache Health
ok 5 - NIM Cache — Build Request
ok 6 - NIM Cache — Parse Response
ok 7 - NIM Cache — Heuristic
ok 8 - OpenAI Cache — Build Messages
ok 9 - OpenAI Cache — Parse Usage
ok 10 - OpenAI Cache — Heuristic
ok 11 - OpenAI Cache — Prefix Stability
ok 12 - Prompt Cache — Anthropic
ok 13 - Prompt Cache — OpenAI
ok 14 - Prompt Cache — Usage Parsing
ok 15 - Prompt Cache — Savings Estimation
ok 16 - Prompt Cache — Recommendations
ok 17 - Prompt Cache — Provider Configs
ok 18 - Regression: reorderEnabled default (audit Bug 1)
ok 19 - Regression: pricing single source (audit Bug 2)
ok 20 - Regression: optimize() enforcement wiring (audit roadmap #2)
ok 21 - Router
ok 22 - Compressor v2
ok 23 - Cache
ok 24 - Tracker
ok 25 - Budget
ok 26 - Observability
# tests 82
# suites 25
# pass 82
# fail 0
# cancelled 0
# skipped 0
```

One test failed during development (FP equality `0.07+0.28 !== 0.35`) and was fixed before proceeding, per the task constraint.
