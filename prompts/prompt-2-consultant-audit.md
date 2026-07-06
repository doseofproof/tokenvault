# Prompt 2 — The Consultant Audit (Updated for Fable 5)

## Pre-Context (paste this first)

```
VERIFICATION NOTE: The CLAUDE.md v2.0.0 has been verified against the codebase. Two minor corrections:
1. `getApproxCost` (router.js line ~160) and `estimateModelCost` (observability.js line ~250) exist but are NOT exported — they're internal functions. If your audit references them, note they need to be exported for fleet-wide use.
2. The pricing duplication you flagged is CONFIRMED: router.js MODEL_TIERS and observability.js PRICING both contain claude-sonnet-4 pricing. This is the defect you described.
All other function references (evaluateCompressVsCache, recordCompressionShift, detectMutablePrompt, detectToolSchemaInstability, validatePrefixStability, getCacheHealth, buildOpenAIMessages, buildNIMRequest) are valid and exported.
```

## Prompt

```
You are a ruthlessly honest system architect conducting a one-time audit of our multi-agent deployment. Your reputation depends on finding every architectural weakness that will cause production failures when mid-tier models run our loops without human oversight.

CONTEXT: Read these files in this exact order:
1. ~/The-Brain/CLAUDE.md — the fleet operating standard v2.0.0 (read this FIRST — it defines the rules everything else must follow)
2. ~/The-Brain/00-System/PROTOCOL.md — canonical protocol (overrides CLAUDE.md if conflict)
3. ~/tokenvault/src/ — every file in the optimization pipeline:
   - router.js (model routing, 93% accuracy)
   - compressor.js (LLMLingua compression, 99.5%)
   - cacheMonitor.js (real-time cache tracking, compress-vs-cache heuristic)
   - promptCache.js (Anthropic automatic caching)
   - openaiCache.js (OpenAI prefix caching)
   - nimCache.js (NIM/Nous automatic caching)
   - cache.js (response caching, 90% hit rate)
   - budget.js (spending alerts)
   - observability.js (per-request tracing)
   - tracker.js (token usage tracking)
4. ~/.hermes/config.yaml — fleet configuration
5. ~/.hermes/plugins/ — all installed plugins (brain-ground, hermes-lcm, tokenvault)
6. ~/The-Brain/ — vault structure (explore the full directory tree, first 30 files)

AUDIT AREAS (examine each and score 1-10 for production readiness):

1. Context Lifecycle: Map every handoff point where context is created → compressed → cached → destroyed. For each handoff: what function handles it, what can go wrong, and is there a test covering the failure mode? Reference specific function names and line numbers.

2. Memory Durability: How does memory flow between sessions? What happens when compressor.js fires mid-conversation? Does cacheMonitor.js detect the invalidation? What's lost? Trace the exact code path from memory write to memory read.

3. Multi-Agent Isolation: When two agents share the same TokenVault instance (~/.hermes/tokenvault/), do their cache entries interfere? Can one agent's compression break another's cache anchor? Check cache.js for session-level isolation.

4. Failure Modes: List every scenario where the system degrades silently (no error, no alert, just worse output quality). For each: what breaks, why it's silent, how to detect it, and which CLAUDE.md rule prevents it.

5. Cost Bleed: Where are tokens being wasted that TokenVault isn't catching? Check: tool output verbosity, context that's cached but never reused, routing decisions that cost more than they save, compression that destroys signal.

6. CLAUDE.md Compliance: For each of the 9 HARD rules in CLAUDE.md Section A, verify: (a) does the code actually implement it? (b) is there a test? (c) what breaks if the rule is violated? Flag any rule that's aspirational but not enforced.

7. Provider Gap Analysis: Compare Anthropic (90% discount), OpenAI (50%), and NIM (automatic) — where does each provider's integration have unique risks? What's different about the failure modes?

OUTPUT FORMAT — Write ~/The-Brain/reports/architecture-audit-2026-07-06.md with:

SECTION 1 — Executive Summary (3 sentences max, brutal honesty)

SECTION 2 — Scorecard:
| Area | Score | Critical Issues | CLAUDE.md Rule Violated |
|------|-------|-----------------|------------------------|

SECTION 3 — Failure Mode Index:
For each silent failure: Trigger → What Breaks → Detection Method → CLAUDE.md Prevention

SECTION 4 — Ranked Roadmap (top 10 fixes):
For each: Problem | Root Cause | Fix | Estimated Effort | Which Model Can Execute | CLAUDE.md Rule Reference

SECTION 5 — Execution Steps for Items 1-3:
Write these so a mid-tier model (Claude Haiku or GPT-4o-mini) can follow them WITHOUT supervision. Include: exact file paths, exact function names, exact test commands, expected output.

SECTION 6 — Provider Risk Matrix:
| Provider | Unique Risk | Mitigation | Test to Verify |

Be brutal. If something is a 4/10, say it's a 4/10 and explain why it will fail in production. Do not soften the language. Every finding must reference a specific file, function, or line number — no vague claims.
```
