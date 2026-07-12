# TokenVault — Engineering Backlog

Generated 2026-07-11 from the first gstack specialist pass over this repo: `/health`
(code quality), `/cso` (security, OWASP + STRIDE), and `/devex-review` (developer
experience). All findings are evidence-backed with file:line references; the three
reports were merged and deduplicated below, ordered by leverage.

Baseline at time of audit: 94/94 tests passing, zero npm dependencies, clean git
history (no secrets), no lint or typecheck gate.

---

## P0 — Correctness and integrity of the core product claims

### 1. Cache can serve a different prompt's answer across agent contexts (HIGH, security + correctness)
The cache key is sha256 of `model::prompt` only (`src/cache.js:58-64`) — it ignores
`system`, `tools`, `context`, and `agent`. On an exact miss, a Jaccard ≥ 0.85 fuzzy
fallback (`src/cache.js:125-157`) returns a *different* prompt's stored response.
A response generated under a privileged system prompt can bleed into an
unprivileged agent context (confused-deputy), and the fuzzy path is a
cache-poisoning primitive.
**Fix:** include a digest of `{system, tools, context}` in the cache key; remove the
0.85 fuzzy path or gate it behind ≥ 0.98 similarity plus an identical context digest.
**Effort:** M

### 2. ✅ DONE (2026-07-11) — Savings accounting is broken end-to-end — cache hits record $0 saved
On a cache hit, `src/index.js:72-90` records `inputTokens: 0, outputTokens: 0`, so
`tracker.js:68-69` and `observability.js:102-103` compute saved = cost(0,0) = 0.
`usage.totals.saved`, `tokenvault stats`, and `getSavingsReport()` never increment
from cache hits; the `result.savings` shown to callers is a hardcoded 2000/1000-token
guess. Compounding: `pricing.js:33` silently prices unknown models as claude-sonnet-4
(10-60x misreporting on typos), and five files hardcode their own prices in violation
of pricing.js's "single source of truth" (`promptCache.js:147,156,182-184`,
`openaiCache.js:109`, `cacheMonitor.js:237`, `router.js:73-77`).
**Fix:** pass the cached entry's stored real token counts through the hit path; route
all savings math through pricing.js; flag unknown models explicitly instead of the
premium fallback. Add an integration test asserting `totals.saved > 0` after a hit.
**Effort:** M

### 3. ✅ DONE (2026-07-11) — `npm test` writes to the live data store and can spend real API money
Five modules hardcode `~/.hermes/tokenvault` with no env override (`src/tracker.js:12`,
`src/cache.js:14`, `src/budget.js:12`, `src/observability.js:19`, `src/cacheMonitor.js:16`),
so every test run corrupts real usage/savings numbers (verified live during the audit).
`tests/integration.js` makes real `fetch` calls to api.anthropic.com / api.openai.com
when keys are exported, and the `tests/*.js` glob includes it.
**Fix:** add a `TOKENVAULT_DATA_DIR` env override consumed by all five modules; point
tests at a temp dir; move `integration.js` behind a separate `npm run test:live`.
**Effort:** M

### 4. ✅ DONE (2026-07-11) — `tokenvault off` does nothing — the kill switch is never read
`bin/tokenvault:309-310` writes `enabled` to `config.json`, but no src module reads
that file (grep-verified). Disabled users still get silent rerouting and caching.
**Fix:** load config.json in a shared config module and honor `enabled` in `optimize()`;
test both states.
**Effort:** S

## P1 — Security hardening and known-broken surfaces

### 5. ✅ DONE (2026-07-11) — Python plugin: latent code-injection sink and broken-by-construction methods
*(Note: the three broken bridge methods now return explicit structured "not implemented" errors — the CLI lacks cache-lookup/trace/compress commands to wire them to; that CLI surface is future work.)*
`plugin/plugin.py:46-128` interpolates untrusted tool-call params (`prompt`, `model`,
`agent`, `operation`) via f-strings into `python -c` source. Currently unreachable
only because the snippets `import` JavaScript files and die on ImportError first —
it becomes RCE the moment the bridge is repaired. `compress()` has never worked
(no Python tests exist). Related CLI issue: `bin/tokenvault` exits 0 on unknown
commands, so `plugin.py`'s `subprocess.run` can't distinguish success from typo.
**Fix:** route all plugin methods through `run_cli` (argv, no `-c` interpolation) or
pass data via stdin JSON; fix or delete `compress()`; exit 1 on unknown CLI commands.
**Effort:** S-M

### 6. Storage hygiene: world-readable secrets at rest, orphaned files, unbounded growth
(a) All persistence uses default modes — cached LLM responses and prompt previews
land 0644 in `~/.hermes/tokenvault` (`src/cache.js:26,174,186` and siblings); any
local UID can read them. (b) TTL/count pruning deletes index entries but never
unlinks the `${key}.json` response files (`src/cache.js:41-53`) — unbounded disk
growth. (c) `alerts.json` grows per-trace with no cap (`src/observability.js:291-301`);
`metrics.hourly` and `session.operations` are never pruned; every event does a full
synchronous read-modify-rewrite with no locking (last-writer-wins across concurrent
agents).
**Fix:** create the data dir 0700 and files 0600; unlink evicted response files in
`saveCache`; cap alerts/hourly/operations arrays; document the single-process
assumption or add a lockfile.
**Effort:** M

## P2 — Correctness cleanups (small, mechanical)

### 7. Router and monitor dead code that changes behavior
`src/router.js:119-122` computes `simpleMatch` but never uses it — simple prompts
fall through to word-count and can route mid-tier (~10x cost). `classifyTask`
returns `'medium'` but `MODEL_TIERS` has no such key (works only via `|| mid`
fallback). The "critical" invalidation-spike alert can never fire — the filter
matches substring `'invalidation'` but events are emitted as `compression_shift`
etc. (`src/cacheMonitor.js:349-351` vs `:173,:290,:316`). `trimContext` duplicates
the system prompt when few-but-huge messages exceed maxChars
(`src/compressor.js:355-357,385`).
**Fix:** honor `simpleMatch`, normalize tier names, match real invalidation event
types, guard the trimContext short-array path. Add classification/regression tests.
**Effort:** S

## P3 — Docs, API surface, and contributor experience

### 8. Docs and API surface don't match the shipped library
The spec the code enforces ("CLAUDE.md Section A/B/C", cited from `src/index.js`,
`bin/health`, tests) lives outside the repo in a personal vault — contributors can't
resolve it. README documents config keys that don't exist, omits the programmatic
API and ~1,100 lines of provider caching, and lists a partial CLI table. Named vs
default exports disagree (`src/index.js:25` vs `:209-221`); `openaiCache`/`nimCache`
aren't exported at all; three conflicting version strings (package.json 1.0.0,
index.js 2.0.0, CLI "v2").
**Fix:** vendor the spec into `docs/spec.md`; rewrite README against the real surface;
unify exports and derive one version from package.json.
**Effort:** M

### 9. Personal-environment leakage blocks any second contributor
`bin/health:174-175` writes incident reports to `~/The-Brain/01-Inbox/` (nonexistent
on other machines); `skills/extract-approach/SKILL.md` is about a personal vault.
**Fix:** configurable incident-output path with an in-repo default (`./reports/`);
move personal-vault material out of the library.
**Effort:** S

### 10. No mechanical guardrails — add a lint/typecheck gate
The 9.2/10 health composite rests entirely on unit tests that pass around the bugs
above. No eslint/biome, no tsc. Most P2 findings (unused vars, dead branches,
string/number drift) are mechanically catchable.
**Fix:** add eslint + `tsc --checkJs` (JSDoc types) to `npm test` or a pre-commit gate.
**Effort:** S

---

## Explicitly clean (verified by /cso)
Supply chain (zero dependencies, no install scripts), secrets (code + git history),
shell injection (no shell=True, argv-only subprocess), SSRF (one hardcoded NVIDIA
endpoint), ReDoS (all regexes linear), CI/CD (none present).
