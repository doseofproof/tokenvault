---
status: resolved
type: incident
skill: cache-health-check
opened_at: 2026-07-06T22:47:20Z
resolved_at: 2026-07-07T03:07:27Z
verification: verified live via NIM smoke, cache-health CLI, and full test suite
---

# TokenVault cache-health incident — resolved

## Executive summary

The original C1 `critical` alert was real enough to investigate but **partly false-critical in how it graded post-restart state**. Two things were true at once:

1. A prior live provider window had genuinely poor cache performance and justified investigation.
2. The post-restart `critical` report was being exaggerated by **window mixing**: fresh session counters were compared against stale provider, invalidation, and lifetime observability history.

The shipped fix set removes the false-critical path, restores current-window accounting, canonicalizes OpenAI prompt construction, and adds a reusable live paid-provider smoke script.

Final verified state on this branch:

- `npm test` → **94 passed, 0 failed**
- `node scripts/nim-cache-smoke.mjs` (live NIM, `meta/llama-3.1-8b-instruct`) → **5/7 estimated hits**, **83.3% warm hit rate**, **71.4% overall hit rate**
- `node bin/health --json` → **healthy**, **score 100**, **divergence 0**

## What was wrong

### 1) Session-window accounting was inconsistent

Verified defects:

- `resetSession()` zeroed session counts but left `byProvider`, invalidations, and recent history inconsistent with a fresh window.
- `bin/health` compared a fresh session against **lifetime** observability totals.
- `getCacheHealth()` could grade a **0-request** session window as if it were an active cache failure.

This created a false-critical path after restart or reset.

### 2) OpenAI cache-shaping had drift risk

`src/promptCache.js` had separate OpenAI request-building logic instead of delegating to the canonical implementation in `src/openaiCache.js`, increasing the risk of prefix drift and inconsistent tool serialization.

### 3) The repo’s canonical test command was broken on Node 22

`package.json` used `node --test tests/`, which fails under Node 22 because the directory is treated like a module target. The command now enumerates test files correctly.

## Fixes shipped

| File | Fix |
|---|---|
| `src/promptCache.js` | Delegates OpenAI message building to canonical `openaiCache.js`; fixes OpenAI savings-unit mismatch |
| `src/cacheMonitor.js` | `resetSession()` now clears session + provider + invalidation state; 0-request windows no longer grade critical |
| `bin/health` | Uses current-session request window for `at_request` and divergence checks instead of lifetime observability totals |
| `package.json` | Fixes `npm test` on Node 22 with `node --test tests/*.js` |
| `tests/test-cache-monitor.js` | Adds regression coverage for zero-request windows and reset-window alignment |
| `tests/test-health-check.js` | Adds regression coverage for current-window `at_request` / divergence semantics |
| `tests/test-prompt-cache.js` | Adds regression coverage for canonical deterministic OpenAI message building |
| `scripts/nim-cache-smoke.mjs` | New live paid-provider smoke verifier for NIM / Nous Portal |

## Live verification

### 1) Full test suite

Command:

```bash
cd /Users/brassfieldventuresllc/tokenvault && npm test
```

Result:

- **94 tests passed**
- **0 failed**

### 2) Live paid-provider smoke

Command:

```bash
set -a && source /Users/brassfieldventuresllc/.hermes/profiles/observation/.env >/dev/null 2>&1 \
  && export TOKENVAULT_NIM_MODEL='meta/llama-3.1-8b-instruct' TOKENVAULT_SMOKE_REQUESTS='7' \
  && cd /Users/brassfieldventuresllc/tokenvault \
  && node scripts/nim-cache-smoke.mjs
```

Observed result:

| Request | Latency (ms) | Baseline improvement | Estimated cache hit |
|---|---:|---:|---:|
| 1 | 1120 | 0.0% | no |
| 2 | 1065 | 4.9% | no |
| 3 | 724 | 35.4% | yes |
| 4 | 896 | 20.0% | yes |
| 5 | 902 | 19.5% | yes |
| 6 | 899 | 19.7% | yes |
| 7 | 924 | 17.5% | yes |

Smoke summary:

```json
{
  "provider": "nvidia-nim",
  "model": "meta/llama-3.1-8b-instruct",
  "summary": {
    "request_count": 7,
    "warm_hit_rate_pct": 83.3,
    "overall_hit_rate_pct": 71.4,
    "min_latency_ms": 724,
    "max_latency_ms": 1120,
    "avg_latency_ms": 932.9
  },
  "cache_monitor": {
    "health": "healthy",
    "score": 100,
    "hitRate": "71.4%"
  }
}
```

Notes:

- The smoke prompt stayed **stable** and measured **9,648 prompt tokens** on every request.
- The first request is expected to warm the cache.
- NIM does not expose `cached_tokens`, so hit detection here is **latency-proxy based**, not token-counter based.
- `deepseek-ai/deepseek-v4-flash` initially returned worker exhaustion (`503`), so the final verified smoke used the live-available `meta/llama-3.1-8b-instruct` model.

### 3) Final health report

Command:

```bash
cd /Users/brassfieldventuresllc/tokenvault && node bin/health --json
```

Observed result:

```json
{
  "skill": "cache-health-check",
  "at_request": 7,
  "health": "healthy",
  "score": 100,
  "hit_rate_pct": 71.4,
  "invalidations": {
    "compressionShifts": 0,
    "mutablePrompts": 0,
    "toolSchemaChanges": 0
  },
  "divergence_vs_observability_pct": 0,
  "action_taken": "none required — healthy/watch",
  "escalated_to_dre": false
}
```

## Remaining limits

- Anthropic and OpenAI live smoke are still **unverified in this profile** because `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` were not present during this session.
- B1 checks **3** (tool schema churn) and **5** (prefix divergence) still need call-site wiring for full live probes; the offline runner reports counters plus guidance.
- Auto-fire on every 50 calls is still not wired into `optimize()`; `bin/health` remains manual / schedulable.

## Resolution

This incident is **resolved for the current branch and current profile’s paid NIM path**.

The false-critical grading path is fixed, the branch is test-green, and the live smoke window now produces a healthy C1 report with zero invalidations and zero divergence.
