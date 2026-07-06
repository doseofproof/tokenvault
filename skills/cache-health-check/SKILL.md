---
name: cache-health-check
description: Automated cache health monitoring that runs every 50 LLM calls — six B1 diagnostic checks, C1 JSON report, incident escalation below score 50
triggers:
  - every_50_calls
  - manual
version: 1.0.0
status: draft pending G10 second-agent verification
owner: andre-brassfield
---

# cache-health-check (CLAUDE.md Section C1)

Correction to the task brief: this skill-pack is defined in CLAUDE.md Section **C1**, not C3 (C3 is model-rotation).

## When it fires

1. Automatically: when `getMetrics().requests % 50 === 0` (observability.js). NOT YET WIRED — auto-fire needs a one-line hook in `src/index.js optimize()`, which this task was forbidden to modify. Until then, schedule via cron or run after work batches.
2. Manually: `node ~/tokenvault/bin/health` (human-readable) or `node ~/tokenvault/bin/health --json` (exact C1 shape). Optional: `--system-file <path>` runs the check-2 live probe on a prompt file. Note: the brief suggested `node bin/tokenvault health`; that would modify the existing CLI (forbidden), so the runner is the standalone `bin/health`.

## What it checks — the six B1 checks, in CLAUDE.md order

1. **Confirm the number**: `getCacheHealth()` score + hit rate; cross-checked against `getCacheEfficiency()` (observability). Divergence > 10 points = one recorder is being skipped — flagged in the report (C1 step 2).
2. **Mutable prompts**: `invalidations.mutablePrompts` counter; live `detectMutablePrompt()` probe when `--system-file` given. Fix: CLAUDE.md A5 (move mutable content below stable prefix).
3. **Tool schema churn**: `invalidations.toolSchemaChanges` counter. Live probe (`detectToolSchemaInstability(prev, curr)`) requires the last two tool arrays, which are not persisted — reported as `unavailable_offline`. Fix: A6.
4. **Compression invalidation**: `invalidations.compressionShifts` vs request count; > 1 shift per 10 requests = fail (B1.4). Fix: reduce frequency, re-anchor cache_control.
5. **Prefix divergence**: requires previous/current serialized prefixes (not persisted); report points to `validatePrefixStability()` (openaiCache.js:179) for call-site use.
6. **TTL gaps**: inter-request gaps in `recentEvents` exceeding the 5-minute Anthropic/Nous TTL — hits across those gaps are structurally impossible (B1.6).

## What it outputs

The exact C1 JSON object (`skill, at_request, health, score, hit_rate_pct, invalidations, divergence_vs_observability_pct, action_taken, escalated_to_dre`) plus a `checks[]` array with per-check `status` (`pass|warning|fail|info|error|degraded|critical`) and `detail`. Classification: score ≥ 90 healthy · 70–89 watch · < 70 act (C1 step 3).

## What it does when critical

If score < 50: appends an incident note to `~/The-Brain/01-Inbox/tv-cache-incident-YYYY-MM-DD.md` (status: draft per PROTOCOL §4; `tv-` prefix avoids the `.gitignore *token*` ambush; append-not-overwrite for same-day repeats) containing the six check results and raw report, and sets `escalated_to_dre: true`. Per B1 step 7: escalate — do NOT tune alert thresholds to silence the alarm. If the vault is not present (sandbox), the note falls back to `~/tokenvault/reports/`. C1 step 5's audit-log append (`~/.hermes/state/brain-ground-audit.jsonl`) is left to the brain-ground plugin, which owns that file.

## Functions used vs created

Pre-existing (verified by export grep before writing): `getCacheHealth`, `getCacheStatus`, `detectMutablePrompt`, `detectToolSchemaInstability`, `evaluateCompressVsCache` (cacheMonitor.js); `getCacheEfficiency`, `getMetrics` (observability.js); `validatePrefixStability` (openaiCache.js — referenced, call-site only). Created new, in bin/health only: `collectHealthReport()`, `writeIncidentNote()`, `shouldWriteIncident()`, `main()`. No existing file was modified.

## Known limits (for the next model)

1. Auto-trigger unwired (needs the one-line optimize() hook — roadmap follow-up).
2. Checks 3 and 5 are counter-only offline; making them live requires persisting the last request's tool array + prefix hash (small cacheMonitor extension, not done here).
3. `getCacheHealth()` hit rate is cumulative since state-file creation (audit §3.12) — a healthy score can mask a bad recent window until `resetSession()` is wired to session boundaries.
