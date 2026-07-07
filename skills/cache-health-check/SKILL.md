---
name: cache-health-check
description: Use when you need a current-window cache-health verdict for TokenVault — six B1 diagnostic checks, C1 JSON output, incident escalation below score 50, and post-fix live verification guidance.
triggers:
  - every_50_calls
  - manual
  - post_fix_verification
version: 1.1.0
status: updated after live NIM verification
owner: andre-brassfield
---

# cache-health-check (CLAUDE.md Section C1)

## Overview

This skill produces the exact C1 cache-health report for TokenVault and explains how to verify that the result reflects the **current request window**, not stale lifetime state. It is the primary diagnostic for B1 cache incidents.

## When it fires

1. **Automatically**: intended for every 50 requests via `getMetrics().requests % 50 === 0`, but this hook is **not yet wired** into `src/index.js optimize()`.
2. **Manually**: run `node ~/tokenvault/bin/health` for human-readable output or `node ~/tokenvault/bin/health --json` for exact C1 JSON.
3. **After a cache fix or restart**: run the live smoke verifier first, then run `bin/health` on the fresh window.

## Manual commands

```bash
# Exact C1 JSON
cd ~/tokenvault && node bin/health --json

# Optional live mutable-prompt probe
cd ~/tokenvault && node bin/health --json --system-file /path/to/system.txt

# Live paid-provider smoke for a fresh window (NIM / Nous Portal)
set -a && source ~/.hermes/profiles/observation/.env >/dev/null 2>&1 \
  && export TOKENVAULT_NIM_MODEL='meta/llama-3.1-8b-instruct' TOKENVAULT_SMOKE_REQUESTS='7' \
  && cd ~/tokenvault && node scripts/nim-cache-smoke.mjs
```

## What it checks — the six B1 checks, in order

1. **Confirm the number**: `getCacheHealth()` hit rate and score, cross-checked against the **current-session observability slice**. Divergence > 10 points means one recorder is being skipped.
2. **Mutable prompts**: `invalidations.mutablePrompts` plus optional `detectMutablePrompt()` live probe when `--system-file` is supplied.
3. **Tool schema churn**: `invalidations.toolSchemaChanges`. Live comparison still requires the previous and current tool arrays at the call site.
4. **Compression invalidation**: `invalidations.compressionShifts` versus request count. Too many shifts means compression is destroying cacheability.
5. **Prefix divergence**: currently advisory only from the offline runner; use `validatePrefixStability()` at the call site to locate the divergence point.
6. **TTL gaps**: inter-request gaps beyond the 5-minute TTL in recent events; hits across those gaps are structurally impossible.

## Important behavior changes (post-fix)

- `resetSession()` now clears **session**, **provider**, **invalidations**, and **recent events** so the next report is a true fresh window.
- `bin/health` now uses the **current session window** for `at_request` and divergence checks.
- **0-request windows are not graded critical**. They return healthy/warning guidance to collect a real window before judging hit rate.

## What “healthy” means

A healthy post-fix window should usually look like this:

- `score >= 90`
- `divergence_vs_observability_pct = 0`
- invalidations counters at or near zero
- a live smoke or real provider batch shows repeated requests with stable-prefix behavior

For NIM smoke runs specifically, the first request is expected to miss and later requests should show **baseline latency improvement > 15%** on a stable prompt.

## What it does when critical

If `score < 50`, the runner writes an incident note with the six checks and raw report. Do **not** solve a critical report by loosening thresholds. Fix the cause: mutable prompts, tool churn, compression shifts, or empty/stale accounting.

## Common pitfalls

1. **Trusting a no-traffic window**: if there were 0 current requests, collect a fresh provider window before concluding anything about hit rate.
2. **Using step-to-step latency on NIM**: compare each request to the first warm-up request; single-step latency can bounce around.
3. **Forgetting model availability**: `deepseek-ai/deepseek-v4-flash` may return worker exhaustion; the verified default smoke model is `meta/llama-3.1-8b-instruct`.
4. **Assuming NIM gives cached-token counters**: it does not. NIM smoke verification is latency-proxy based.
5. **Skipping the health CLI after smoke**: the smoke proves repeated-request behavior; `bin/health --json` proves B1/C1 accounting is aligned.

## Remaining limits

1. Auto-trigger is still unwired.
2. Checks 3 and 5 still need call-site state for full live probes.
3. Anthropic/OpenAI live smoke still requires those API keys to exist in the runtime profile.

## Verification checklist

- [ ] Run `node scripts/nim-cache-smoke.mjs` on a fresh window
- [ ] Confirm prompt tokens are comfortably above 1024
- [ ] Confirm repeated requests keep the same stable prefix and tool ordering
- [ ] Run `node bin/health --json`
- [ ] Confirm `at_request` matches the fresh session window
- [ ] Confirm divergence vs observability is 0 or near 0
- [ ] Confirm invalidations are zero or explicitly explained
- [ ] If the score is < 50, write/escalate the incident note instead of tuning thresholds
