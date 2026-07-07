---
name: nim-cache-smoke
description: Use when you need a fast live paid-provider proof that TokenVault cache behavior recovered after a restart or fix, especially when Anthropic/OpenAI keys are unavailable.
triggers:
  - post_fix_verification
  - cache_health_warning
  - restart_verification
version: 1.0.0
status: live-verified on meta/llama-3.1-8b-instruct
owner: andre-brassfield
---

# nim-cache-smoke

## Overview

This workflow runs a fresh repeated-request smoke test against NVIDIA NIM / Nous Portal using a deliberately stable, cache-sized prompt and deterministic tool ordering. It is the fastest way to prove that TokenVault’s cache accounting and live provider behavior recovered after a fix.

The verifier lives at:

```bash
scripts/nim-cache-smoke.mjs
```

It does four things in one shot:

1. Resets the TokenVault cache-monitor session window.
2. Sends repeated requests with a large stable prefix.
3. Records provider events into `cacheMonitor` and `observability`.
4. Prints a JSON summary you can compare against `node bin/health --json`.

## When to use

Use this skill when:

- you fixed cache accounting, prompt stability, or tool-ordering bugs
- you restarted Hermes / TokenVault and need a fresh paid-provider window
- Anthropic/OpenAI keys are missing but NVIDIA / Nous Portal is available
- you need a lower-cost live smoke than a large Anthropic batch

Do **not** use this as your only proof when you specifically need Anthropic/OpenAI token-counter evidence; NIM does not return `cached_tokens`.

## One-shot command

```bash
set -a && source ~/.hermes/profiles/observation/.env >/dev/null 2>&1 \
  && export TOKENVAULT_NIM_MODEL='meta/llama-3.1-8b-instruct' TOKENVAULT_SMOKE_REQUESTS='7' \
  && cd ~/tokenvault && node scripts/nim-cache-smoke.mjs
```

Then immediately run:

```bash
cd ~/tokenvault && node bin/health --json
```

## Success criteria

A good recovery window usually has all of these:

- prompt tokens **> 1024** on every request
- first request warms the cache; later requests show repeated-request improvement
- `warm_hit_rate_pct` is materially above zero (the live-verified run reached **83.3%**)
- `node bin/health --json` reports:
  - `health` = `healthy` or `warning`
  - `score >= 90`
  - `divergence_vs_observability_pct = 0`
  - invalidations counters at zero or clearly explained

## How to interpret the JSON

### Per-request fields

- `latency_ms`: end-to-end latency for that request
- `prompt_tokens`: the cacheable prefix size; if this drops too low, the run is not meaningful
- `cached_estimate`: `true` when baseline latency improvement exceeds the NIM cache heuristic threshold
- `baseline_latency_improvement_pct`: improvement versus the **first** request; this is the primary signal
- `step_latency_improvement_pct`: improvement versus the immediately previous request; useful, but noisier

### Summary fields

- `warm_hit_rate_pct`: hit rate after excluding the first warm-up request
- `overall_hit_rate_pct`: hit rate across the entire batch
- `cache_monitor.health` / `score`: current TokenVault verdict for the same fresh window

## Live-verified baseline

The verified recovery run on this branch used:

- model: `meta/llama-3.1-8b-instruct`
- requests: `7`
- prompt tokens: `9648`
- warm hit rate: `83.3%`
- overall hit rate: `71.4%`
- follow-up `bin/health --json`: `healthy`, `score 100`, `divergence 0`

Use that as a sanity reference, not as a hard promise for every future run.

## Common pitfalls

1. **Wrong default model**: `deepseek-ai/deepseek-v4-flash` may return worker exhaustion (`503`) on a bad day. The verified default is `meta/llama-3.1-8b-instruct`.
2. **Reading step latency instead of baseline latency**: step-to-step latency can bounce; the stable signal is improvement versus request 1.
3. **Too-small prompt**: if the prefix is not comfortably cache-sized, the run proves little.
4. **Changing tools or prompt text between requests**: that destroys the point of the smoke test.
5. **Stopping after the smoke script**: always run `node bin/health --json` after the smoke to verify B1/C1 accounting alignment.
6. **Claiming Anthropic/OpenAI-style proof from NIM**: NIM smoke is latency-proxy evidence, not cached-token-counter evidence.

## Verification checklist

- [ ] Source the profile env before running
- [ ] Use a stable model known to be available
- [ ] Confirm prompt tokens stay above 1024
- [ ] Confirm the first request is the only expected warm-up miss
- [ ] Confirm later requests show baseline improvement consistent with cache reuse
- [ ] Run `node bin/health --json` immediately after the smoke
- [ ] Confirm `at_request` matches the smoke batch size
- [ ] Confirm divergence vs observability is 0
- [ ] Save the JSON output in the incident note if the run is part of a fix verification
