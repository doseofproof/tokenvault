---
name: tokenvault
description: Token optimization — track, compress, cache, and save 60-90% on AI costs
category: devops
---

# TokenVault — Token Optimization

## When to use

Use TokenVault before any LLM call to optimize costs and after calls to track usage.

## Quick commands

```bash
# Check how a prompt would be routed
node ~/tokenvault/bin/tokenvault route "your prompt here"

# See current savings
node ~/tokenvault/bin/tokenvault stats

# Daily breakdown
node ~/tokenvault/bin/tokenvault daily

# Per-model usage
node ~/tokenvault/bin/tokenvault models

# Cache stats
node ~/tokenvault/bin/tokenvault cache
```

## Integration pattern

For any task that involves LLM calls:

1. **Before calling:** Check routing with `tokenvault route`
2. **After calling:** The tracker records usage automatically
3. **Review:** `tokenvault stats` shows cumulative savings

## Cost tiers

| Tier | Use for | Models | Savings |
|------|---------|--------|---------|
| Premium | Architecture, security, complex reasoning | claude-sonnet-4, opus-4 | 0% |
| Mid | Code review, debugging, analysis | claude-haiku, gpt-4o-mini | 70% |
| Cheap | Formatting, lookup, simple Q&A | deepseek-v4-flash, gemini-flash | 90% |

## Pitfalls

- Don't route safety-critical or complex reasoning tasks to cheap models
- Cache TTL is 24h by default — adjust for stale data concerns
- Context compression may lose nuance — monitor output quality
