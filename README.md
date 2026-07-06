# TokenVault 🪙

**Token optimization plugin for Hermes Agent — track, compress, cache, and save 60-90% on AI costs.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What it does

| Feature | How it saves | Typical savings |
|---------|-------------|-----------------|
| **Smart Model Routing** | Routes simple tasks to cheap models, hard tasks to premium | 60-90% |
| **Context Compression** | Deduplicates + truncates oversized context | 20-40% |
| **Response Caching** | Zero-cost on repeated queries | 100% on cache hits |
| **Real-time Tracking** | Know exactly what you're spending | Visibility |

## Install

```bash
# Clone and link
git clone https://github.com/doseofproof/tokenvault.git
cd tokenvault
npm link

# Or just use directly
node bin/tokenvault stats
```

## Quick Start

```bash
# See your current savings
tokenvault stats

# Check how a prompt would be routed
tokenvault route "hello"
tokenvault route "explain distributed system trade-offs"

# Daily breakdown
tokenvault daily

# Per-model usage
tokenvault models
```

## How Smart Routing Works

TokenVault classifies every prompt by complexity and routes to the cheapest model that can handle it:

| Tier | Complexity | Models | Cost/1M tokens |
|------|-----------|--------|----------------|
| **Premium** | Architecture, security audit, complex reasoning | claude-sonnet-4, opus-4, gpt-4o | $3-75 |
| **Mid** | Code review, debugging, analysis | claude-haiku, gpt-4o-mini, deepseek-v3 | $0.25-5 |
| **Cheap** | Formatting, lookup, simple Q&A | deepseek-v4-flash, gemini-flash | $0.07-0.30 |

**Example:** A "hello" prompt gets routed to deepseek-v4-flash instead of claude-sonnet-4 — **97% cheaper**.

## Integration with Hermes

### As a Hermes Plugin

Add to your `config.yaml`:

```yaml
plugins:
  - name: tokenvault
    path: /path/to/tokenvault/src/index.js
    config:
      enabled: true
      maxToolOutputChars: 4000
      maxContextChars: 30000
```

### As a Hermes Skill

```yaml
---
name: tokenvault
description: Token optimization — track, compress, cache, and save on AI costs
category: devops
---

# TokenVault Skill

Before any LLM call, run: `tokenvault route "prompt"` to check optimal model.
After calls, track usage with the tracker module.
View savings: `tokenvault stats`
```

## Configuration

```json
{
  "enabled": true,
  "maxToolOutputChars": 4000,
  "maxContextChars": 30000,
  "dedupSimilarity": 0.85,
  "cacheMaxEntries": 1000,
  "cacheTtlHours": 24
}
```

## Data Storage

All data is stored locally in `~/.hermes/tokenvault/`:

```
~/.hermes/tokenvault/
├── usage.json      # Token usage history
├── config.json     # Plugin configuration
└── cache/          # Cached responses
    ├── index.json
    └── *.json
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `tokenvault stats` | Show savings summary |
| `tokenvault daily` | Daily breakdown (14 days) |
| `tokenvault models` | Per-model usage |
| `tokenvault cache` | Cache hit/miss stats |
| `tokenvault route "prompt"` | Analyze prompt routing |
| `tokenvault on` | Enable optimization |
| `tokenvault off` | Disable optimization |
| `tokenvault clear` | Clear cache and stats |

## License

MIT
