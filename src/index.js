/**
 * TokenVault — Main plugin entry point v2
 * 
 * Token optimization plugin for Hermes Agent.
 * Tracks, compresses, caches, routes, and observes to save 60-90% on AI costs.
 * 
 * Modules:
 * - tracker: Real-time token usage tracking
 * - router: Smart model routing (simple→cheap, hard→premium)
 * - compressor: Advanced context compression (LLMLingua-style, hierarchical memory)
 * - cache: Response caching (content-hash + semantic)
 * - budget: Spending alerts
 * - observability: Tracing, metrics, alerting
 */

import { readFileSync } from 'fs';
import tracker from './tracker.js';
import router from './router.js';
import compressor from './compressor.js';
import cache from './cache.js';
import budget from './budget.js';
import observability from './observability.js';
import promptCache from './promptCache.js';
import cacheMonitor from './cacheMonitor.js';
import openaiCache from './openaiCache.js';
import nimCache from './nimCache.js';
import { isEnabled } from './paths.js';

// Single version source: package.json
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export { tracker, router, compressor, cache, budget, observability, promptCache, cacheMonitor, openaiCache, nimCache };

/**
 * Process a prompt through the full optimization pipeline
 * 
 * Pipeline:
 * 1. Check cache (zero-cost on hit)
 * 2. Classify task complexity
 * 3. Route to optimal model
 * 4. Compress context (dedup + tiers + reorder + trim)
 * 5. Record trace for observability
 */
export function optimize({ prompt, currentModel, context, agent, operation, system, tools, previousTools }) {
  // Kill switch (`tokenvault off`): pass through untouched — no routing,
  // no caching, no compression, no accounting.
  if (!isEnabled()) {
    return {
      model: currentModel,
      cached: false,
      response: null,
      compression: null,
      savings: 0,
      trace: null,
      enforcement: null,
      disabled: true,
    };
  }

  const startTime = Date.now();
  const result = {
    model: currentModel,
    cached: false,
    response: null,
    compression: null,
    savings: 0,
    trace: null,
    enforcement: {
      mutablePrompt: null,     // CLAUDE.md A5 — detectMutablePrompt()
      toolSchema: null,        // CLAUDE.md A6 — detectToolSchemaInstability()
      compressionDecision: null, // CLAUDE.md A3/A7 — evaluateCompressVsCache()
    },
  };

  // ── Enforcement (CLAUDE.md Section A) — run BEFORE anything is sent ──
  // A5: no mutable state in the stable prefix. Caller passes the system
  // prompt when available; detection also increments cacheMonitor invalidations.
  if (system) {
    result.enforcement.mutablePrompt = cacheMonitor.detectMutablePrompt(
      typeof system === 'string' ? system : JSON.stringify(system)
    );
  }

  // A6: tool schema stability vs previous request (deterministic serialization).
  if (tools && previousTools) {
    result.enforcement.toolSchema = cacheMonitor.detectToolSchemaInstability(previousTools, tools);
  }
  
  // Step 1: Check cache
  const cached = cache.lookup(prompt, currentModel, { system, tools, agent });
  if (cached) {
    result.cached = true;
    result.response = cached.content;

    // Savings = the real cost of the call we avoided. Use the token counts
    // recorded when the entry was stored; estimate from lengths if absent.
    const hitInputTokens = cached.tokens?.inputTokens
      || Math.round(prompt.length / 4);
    const hitOutputTokens = cached.tokens?.outputTokens
      || Math.round((typeof cached.content === 'string' ? cached.content.length : 0) / 4);
    result.savings = tracker.estimateCost(currentModel, hitInputTokens, hitOutputTokens);

    tracker.recordUsage({
      model: currentModel,
      inputTokens: hitInputTokens,
      outputTokens: hitOutputTokens,
      operation: 'cache_hit',
      cached: true,
    });

    observability.trace({
      agent,
      model: currentModel,
      operation: operation || 'cache_hit',
      inputTokens: hitInputTokens,
      outputTokens: hitOutputTokens,
      latencyMs: Date.now() - startTime,
      cached: true,
    });

    return result;
  }
  
  // Step 2: Route to optimal model
  result.model = router.selectModel(prompt, currentModel);
  const routing = router.estimateSavings(prompt, currentModel);
  result.savings = routing.savings;
  
  // Step 3: Compress context if provided — GATED by the compress-vs-cache
  // heuristic (CLAUDE.md A3/A7) and the B2 signal-destruction guard.
  if (context && context.length > 0) {
    const charLen = (m) =>
      typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length;
    const tokensBefore = Math.round(context.reduce((s, m) => s + charLen(m), 0) / 4);

    // Trial compression (not yet applied).
    const trial = compressor.compressContext(context);
    const tokensAfter = Math.round(trial.stats.finalChars / 4);
    const tokensSaved = tokensBefore - tokensAfter;

    // A3/A7: provider-matched heuristic decides compress vs leave padding.
    const decision = cacheMonitor.evaluateCompressVsCache({ tokensAfter, tokensSaved });
    result.enforcement.compressionDecision = decision;

    // B2: >95% compression ratio = presumptive signal destruction — never apply.
    const ratioTooHigh = parseFloat(trial.stats.compressionRatio) > 95;

    if (decision.action === 'compress' && !ratioTooHigh) {
      result.compression = trial.stats;
      result.compressedContext = trial.messages;
      // A3: every applied compression logs its shift + heuristic outcome.
      cacheMonitor.recordCompressionShift({
        messagesBefore: context.length,
        messagesAfter: trial.messages.length,
        tokensSaved,
        tokensAfter,
      });
    } else {
      // leave_padding / skip_compression / B2 guard: send context unmodified.
      result.compression = {
        skipped: true,
        action: ratioTooHigh ? 'b2_ratio_guard' : decision.action,
        reason: ratioTooHigh
          ? `compressionRatio ${trial.stats.compressionRatio}% > 95 (CLAUDE.md B2)`
          : decision.reason,
      };
      result.compressedContext = context;
    }
  }
  
  // Step 4: Record trace
  result.trace = observability.trace({
    agent,
    model: result.model,
    operation: operation || 'llm_call',
    inputTokens: prompt.length / 4, // rough estimate
    outputTokens: 0,
    latencyMs: Date.now() - startTime,
    cached: false,
  });
  
  return result;
}

/**
 * Record the outcome of an LLM call
 */
export function record({ model, inputTokens, outputTokens, operation, response, prompt, agent, latencyMs, system, tools }) {
  if (!isEnabled()) return;

  tracker.recordUsage({ model, inputTokens, outputTokens, operation });

  // Cache the response, keyed to the context it was generated under
  if (response && prompt) {
    cache.store(prompt, model, response, { inputTokens, outputTokens }, { system, tools, agent });
  }
  
  // Record trace
  observability.trace({
    agent,
    model,
    operation,
    inputTokens,
    outputTokens,
    latencyMs: latencyMs || 0,
    cached: false,
  });
}

/**
 * Get a comprehensive savings report
 */
export function getSavingsReport() {
  const totals = tracker.getTotals();
  const cacheStats = cache.getStats();
  const daily = tracker.getDailyStats(7);
  const metrics = observability.getMetrics();
  const cacheEfficiency = observability.getCacheEfficiency();
  const agents = observability.getAgentCosts();
  
  return {
    totalCost: totals.cost || 0,
    totalSaved: totals.saved || 0,
    savingsRate: (totals.cost || 0) + (totals.saved || 0) > 0
      ? ((totals.saved || 0) / ((totals.cost || 0) + (totals.saved || 0)) * 100).toFixed(1)
      : 0,
    cacheEntries: cacheStats.entries,
    cacheHits: cacheStats.totalHits,
    cacheHitRate: cacheEfficiency.hitRate,
    dailyAverage: daily.length > 0
      ? daily.reduce((s, d) => s + d.cost, 0) / daily.length
      : 0,
    requests: metrics.requests,
    avgLatency: metrics.avgLatency.toFixed(0),
    errors: metrics.errors,
    topAgents: agents.slice(0, 5),
  };
}

export default {
  name: 'tokenvault',
  version: pkg.version,
  optimize,
  record,
  getSavingsReport,
  tracker,
  router,
  compressor,
  cache,
  budget,
  observability,
  promptCache,
  cacheMonitor,
  openaiCache,
  nimCache,
};
