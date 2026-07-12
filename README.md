# TokenVault 🪙

**Token optimization plugin for Hermes Agent — track, compress, cache, and route to save on AI costs.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Zero-dependency Node.js (ESM) library + CLI. Every call goes through one pipeline: response cache lookup, complexity-based model routing, compress-vs-cache-aware context compression, and per-request tracing — with a kill switch (`tokenvault off`) that turns the whole thing into a passthrough.

## Install

```bash
git clone https://github.com/doseofproof/tokenvault.git
cd tokenvault
npm link          # exposes the `tokenvault` CLI

# or run directly without linking
node bin/tokenvault stats
```

Requires Node.js with ESM support (`"type": "module"`). No runtime dependencies.

## Programmatic API

`src/index.js` exports two pipeline functions, a report helper, and the underlying modules.

```js
import { optimize, record } from 'tokenvault';

// Before the LLM call
const opt = optimize({
  prompt: 'Summarize this log output',
  currentModel: 'claude-sonnet-4',
  context: messages,          // optional: [{ role, content }, ...]
  agent: 'log-bot',           // optional: cost attribution
  operation: 'summarize',     // optional: trace label
  system: systemPrompt,       // optional: enables mutable-prompt detection + cache isolation
  tools, previousTools,       // optional: tool-schema stability check
});

if (opt.cached) {
  use(opt.response);          // zero-cost cache hit; savings = real cost of the avoided call
} else {
  const res = await callLLM(opt.model, opt.compressedContext ?? messages);
  // After the call — records usage and caches the response
  record({
    model: opt.model,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    operation: 'summarize',
    response: res.text,
    prompt: 'Summarize this log output',
    agent: 'log-bot',
    latencyMs: res.latency,
    system: systemPrompt,
    tools,
  });
}
```

**`optimize(opts)`** returns:

- `model` — the routed model (cheapest tier that matches the prompt's complexity)
- `cached` / `response` / `savings` — cache hit, its content, and the real dollar cost of the call avoided
- `compression` / `compressedContext` — compression stats and the compressed messages, or `{ skipped: true, action, reason }` when the compress-vs-cache heuristic (or the >95%-ratio signal-destruction guard) says to leave context alone
- `enforcement` — `{ mutablePrompt, toolSchema, compressionDecision }` cache-hygiene checks
- `trace` — the observability trace entry
- `{ disabled: true }` (plus null/passthrough fields) when the kill switch is off — no routing, caching, compression, or accounting

**`record(opts)`** tracks usage, traces the request, and stores the response in the cache. No-op when disabled. Cache entries are isolated per `{system, tools, agent}` context — a response generated under one system prompt / tool set / agent is never served to another (security fix; applies to both exact and semantic matches).

**`getSavingsReport()`** returns totals: `totalCost`, `totalSaved`, `savingsRate`, `cacheEntries`, `cacheHits`, `cacheHitRate`, `dailyAverage`, `requests`, `avgLatency`, `errors`, `topAgents`.

**Named module exports:** `tracker`, `router`, `compressor`, `cache`, `budget`, `observability`, `promptCache`, `cacheMonitor`, `openaiCache`, `nimCache`.

## CLI

```bash
tokenvault stats                # savings summary (default command)
tokenvault daily                # daily breakdown (14 days)
tokenvault models               # per-model usage
tokenvault route "prompt"       # complexity tier + routed model (--json supported)
tokenvault cache                # cache entry/hit stats
tokenvault budget               # budget status
tokenvault budget daily=5.00    # set a budget limit (daily/weekly/monthly/alertThreshold)
tokenvault on                   # enable optimization
tokenvault off                  # kill switch: optimize()/record() become no-op passthroughs
tokenvault traces               # recent request traces
tokenvault agents               # per-agent cost breakdown
tokenvault hourly               # hourly cost trend (24h)
tokenvault alerts               # recent alerts
tokenvault clear                # delete usage stats and all cache entries
tokenvault help                 # usage (-h / --help)
```

Unknown commands print help and exit with code 1. `tokenvault off` writes `enabled: false` to `config.json`; the library re-reads it on every call, so the toggle takes effect without restarting anything.

**`bin/health`** — standalone cache-health checker (`node bin/health`, `--json` for machine output, `--system-file <path>` to probe a live system prompt for mutable content). Runs six cache-hygiene diagnostics and emits a scored report; scores below 50 also write an incident note to `~/The-Brain/01-Inbox/`.

## Provider prompt caching

Three modules target the native caching behavior of each provider (all exported from the package root):

- **`promptCache`** (Anthropic + dispatch) — `buildAnthropicMessages({system, messages, tools})` places a block-level `cache_control: { type: 'ephemeral' }` marker on the final system block, caching tools + system prompt as one prefix (needs a 1024+ token prefix). Also: `parseCacheUsage(response, provider)` (reads `cache_read_input_tokens` / `cached_tokens` and prices savings from `pricing.js`), `estimateCacheSavings()`, `getRecommendations()`, `PROVIDER_CONFIGS`.
- **`openaiCache`** — OpenAI caches automatically on byte-identical prefixes (1024+ tokens, 128-token increments, ~50% discount). `buildOpenAIMessages({system, tools, context, messages})` enforces the strict prefix order (system → alphabetically-sorted tools → static context → history → current turn). Also: `parseOpenAICacheUsage()`, `evaluateOpenAICompressVsCache()` (50% break-even), `validatePrefixStability()`.
- **`nimCache`** — NVIDIA NIM uses the OpenAI-compatible format with transparent automatic caching and no cache metrics in responses. `buildNIMRequest()` mirrors the OpenAI prefix ordering; `parseNIMResponse()` uses latency improvement as a cache-hit proxy; `evaluateNIMCompressVsCache()` prefers caching unless context nears the window limit.

## Configuration

Each module is configured in code via its `configure()` / setter (defaults shown):

```js
import { cache, router, compressor, budget } from 'tokenvault';

cache.configure({
  enabled: true,
  maxEntries: 1000,        // LRU-style prune by recency
  ttlHours: 24,
  maxResponseChars: 50000, // larger responses are not cached
});

router.configure({
  enabled: true,
  defaultTier: 'mid',
  forcePremium: [],        // regex strings: always route to premium
  forceCheap: [],          // regex strings: always route to cheap
});

compressor.configure({
  enabled: true,
  maxContextChars: 30000,
  maxToolOutputChars: 4000,
  dedupSimilarity: 0.80,   // MinHash similarity above which messages are dropped
  workingMemorySize: 5,    // L0: last N messages kept verbatim
  sessionMemorySize: 20,   // L1: lightly compressed
  longTermSize: 50,        // L2: heavily compressed
  reorderEnabled: false,   // off by default — reordering breaks OpenAI/NIM prefix caching
});

budget.setBudget({
  daily: 5.00,             // also: weekly, monthly, perSession (all $ limits, default null)
  alertThreshold: 0.8,     // warn at 80%
});
```

### Data directory

All state lives under `~/.hermes/tokenvault/` (override with the `TOKENVAULT_DATA_DIR` env var):

```
~/.hermes/tokenvault/
├── config.json          # on/off kill switch
├── usage.json           # token usage history
├── budget.json          # budget limits
├── metrics.json         # aggregate observability metrics
├── alerts.json          # alert rules + history
├── cache-monitor.json   # cache-hygiene event log
├── cache/               # response cache (index.json + one file per entry)
└── traces/              # per-day request traces
```

### Pricing

All model pricing lives in `src/pricing.js` (single source of truth). Unknown models are recorded at **$0 cost** with a one-time console warning — add new models to `src/pricing.js` to get real numbers.

### Tests

```bash
npm test           # hermetic — runs against a throwaway temp data dir, no network
npm run test:live  # real API calls; needs ANTHROPIC_API_KEY and/or OPENAI_API_KEY
```

## Caveats

- **Single-process assumption.** State files (usage, cache index, metrics) are read-modify-write JSON without locking. Concurrent writers can lose updates — run one optimizing process per data dir.
- Token counts in `optimize()` estimates use a rough 4-chars-per-token heuristic; `record()` with real usage numbers is the source of truth.

## License

MIT
