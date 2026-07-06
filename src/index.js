/**
 * TokenVault — Main plugin entry point
 * 
 * Token optimization plugin for Hermes Agent.
 * Tracks, compresses, caches, and routes to save 60-90% on AI costs.
 * 
 * Usage in Hermes:
 *   - Register as a plugin in config.yaml
 *   - Auto-hooks into LLM calls for optimization
 *   - CLI: `tokenvault stats` for dashboard
 * 
 * Usage standalone:
 *   import { tracker, router, compressor, cache } from './index.js';
 */

import tracker from './tracker.js';
import router from './router.js';
import compressor from './compressor.js';
import cache from './cache.js';

export { tracker, router, compressor, cache };

/**
 * Process a prompt through the optimization pipeline
 * Returns { model, cached, compressed }
 */
export function optimize({ prompt, currentModel, context }) {
  const result = {
    model: currentModel,
    cached: false,
    response: null,
    contextOriginal: context?.length || 0,
    contextCompressed: 0,
    savings: 0,
  };
  
  // Step 1: Check cache
  const cached = cache.lookup(prompt, currentModel);
  if (cached) {
    result.cached = true;
    result.response = cached.content;
    result.savings = tracker.estimateCost(currentModel, 2000, 1000);
    tracker.recordUsage({
      model: currentModel,
      inputTokens: 0,
      outputTokens: 0,
      operation: 'cache_hit',
      cached: true,
    });
    return result;
  }
  
  // Step 2: Route to optimal model
  result.model = router.selectModel(prompt, currentModel);
  const routing = router.estimateSavings(prompt, currentModel);
  result.savings = routing.savings;
  
  // Step 3: Compress context if provided
  if (context && context.length > 0) {
    const { messages, stats } = compressor.compressContext(context);
    result.contextCompressed = messages.length;
    result.compressionStats = stats;
  }
  
  return result;
}

/**
 * Record the outcome of an LLM call
 */
export function record({ model, inputTokens, outputTokens, operation, response, prompt }) {
  tracker.recordUsage({ model, inputTokens, outputTokens, operation });
  
  // Cache the response for future lookups
  if (response && prompt) {
    cache.store(prompt, model, response, { inputTokens, outputTokens });
  }
}

/**
 * Get a summary of potential savings
 */
export function getSavingsReport() {
  const totals = tracker.getTotals();
  const cacheStats = cache.getStats();
  const daily = tracker.getDailyStats(7);
  
  return {
    totalCost: totals.cost || 0,
    totalSaved: totals.saved || 0,
    savingsRate: (totals.cost || 0) + (totals.saved || 0) > 0
      ? ((totals.saved || 0) / ((totals.cost || 0) + (totals.saved || 0)) * 100).toFixed(1)
      : 0,
    cacheEntries: cacheStats.entries,
    cacheHits: cacheStats.totalHits,
    dailyAverage: daily.length > 0
      ? daily.reduce((s, d) => s + d.cost, 0) / daily.length
      : 0,
  };
}

export default {
  name: 'tokenvault',
  version: '1.0.0',
  optimize,
  record,
  getSavingsReport,
  tracker,
  router,
  compressor,
  cache,
};
