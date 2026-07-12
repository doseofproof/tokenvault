import { buildOpenAIMessages as buildCanonicalOpenAIMessages } from './openaiCache.js';
import { getPricing } from './pricing.js';

/**
 * TokenVault — Provider-Level Prompt Caching
 * 
 * Leverages native provider caching APIs for maximum savings:
 * 
 * Anthropic Claude:
 * - cache_control: { type: "ephemeral" } on message blocks
 * - 5-min TTL (free on write, ~10% cost on read)
 * - 1-hour TTL (2x write cost, ~10% read cost)
 * - Need 1024+ tokens prefix to trigger
 * 
 * OpenAI:
 * - Automatic (no code changes needed)
 * - Works for prompts >= 1024 tokens
 * - Caches in 128-token increments
 * - Cached tokens are 50% cheaper
 * 
 * Nous Portal / NIM:
 * - Inherits caching from underlying provider
 * - May support Anthropic-style cache_control
 */

const PROVIDER_CONFIGS = {
  anthropic: {
    name: 'Anthropic Claude',
    minTokensForCache: 1024,
    cacheTtl: '5m', // default: 5 minutes
    readDiscount: 0.90, // 90% cheaper on read
    writeCost: 0, // free for 5-min TTL
    writeCostLong: 1.25, // 2x for 1-hour TTL
    supportsCacheControl: true,
  },
  openai: {
    name: 'OpenAI',
    minTokensForCache: 1024,
    cacheIncrement: 128,
    readDiscount: 0.50, // 50% cheaper on read
    writeCost: 0, // free
    automatic: true,
  },
  nous: {
    name: 'Nous Portal',
    minTokensForCache: 1024,
    readDiscount: 0.90, // assumes Claude backend
    writeCost: 0,
    supportsCacheControl: true,
  },
  xai: {
    name: 'xAI Grok',
    readDiscount: 0.50,
    automatic: true,
    usesHeader: 'x-grok-conv-id',
  },
};

/**
 * Build Anthropic API messages with cache_control markers
 * 
 * Strategy: Mark the longest stable prefix as cacheable.
 * The system prompt + tool definitions are almost always the same,
 * so we cache everything up to the user's message.
 */
export function buildAnthropicMessages({ system, messages, tools }) {
  // BLOCK-LEVEL cache_control per the Anthropic Messages API contract.
  // The previous top-level `cache_control` key was Bug 3 in
  // The-Brain/reports/architecture-audit-2026-07-06.md: it is not part of the
  // API and never activated caching (live state file showed 38.1% hit rate,
  // consistent with partial/other-layer caching, not the claimed 88%).
  // Marker placement: last system block. Anthropic request order is
  // tools -> system -> messages, so one marker on the final system block
  // caches the tool definitions AND the system prompt in a single prefix.
  // System + tools must still total >= 1024 tokens (PROVIDER_CONFIGS.anthropic).
  // Fallback path (CLAUDE.md A2): on provider error the request is retried via
  // fallback_model in ~/.hermes/config.yaml (deepseek-v4-flash / opencode-go).
  const result = {
    messages: messages || [],
    cacheMarkers: [],
  };

  if (tools && tools.length > 0) {
    // Deterministic alphabetical ordering (CLAUDE.md A6) — matches
    // buildOpenAIMessages (openaiCache.js) and buildNIMRequest (nimCache.js).
    result.tools = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  }

  if (system) {
    const systemText = typeof system === 'string' ? system : JSON.stringify(system);
    result.system = [
      { type: 'text', text: systemText, cache_control: { type: 'ephemeral' } },
    ];
    result.cacheMarkers.push({
      type: 'block',
      location: 'system[last]',
      description: 'Caches tools + system prefix via marker on final system block',
    });
  }

  return result;
}

/**
 * Build OpenAI API request (automatic caching)
 * 
 * OpenAI's caching is automatic — we just need to ensure:
 * 1. Prompts are >= 1024 tokens
 * 2. Prefixes are stable across requests
 * 3. We track cache命中率 in usage responses
 */
export function buildOpenAIMessages({ system, messages, tools }) {
  // Keep promptCache.js and openaiCache.js on one canonical implementation so
  // prefix ordering and tool serialization cannot drift between call sites.
  const result = buildCanonicalOpenAIMessages({ system, tools, messages });
  return {
    ...result,
    cacheOptimized: result._cacheOptimized,
  };
}

/**
 * Parse cache usage from API response
 */
export function parseCacheUsage(response, provider) {
  const usage = response?.usage;
  if (!usage) return null;
  
  const result = {
    provider,
    inputTokens: usage.input_tokens || usage.prompt_tokens || 0,
    outputTokens: usage.output_tokens || usage.completion_tokens || 0,
    cacheCreation: 0,
    cacheRead: 0,
    cacheHit: false,
    savings: 0,
  };
  
  if (provider === 'anthropic') {
    result.cacheCreation = usage.cache_creation_input_tokens || 0;
    result.cacheRead = usage.cache_read_input_tokens || 0;
    result.cacheHit = result.cacheRead > 0;
    
    // Savings priced from pricing.js by the response's model (representative
    // fallback: claude-sonnet-4). Regression note: this previously used 0.003
    // (per-1K rate applied per-token), overstating savings 1000x — audit 2026-07-06 §3.3.
    const config = PROVIDER_CONFIGS.anthropic;
    const inputRate = (getPricing(response.model) || getPricing('claude-sonnet-4')).input / 1_000_000;
    result.savings = result.cacheRead * config.readDiscount * inputRate;
  } else if (provider === 'openai') {
    // OpenAI reports cached tokens in the prompt_tokens_details
    const details = usage.prompt_tokens_details || {};
    result.cacheRead = details.cached_tokens || 0;
    result.cacheHit = result.cacheRead > 0;
    
    const config = PROVIDER_CONFIGS.openai;
    const inputRate = (getPricing(response.model) || getPricing('gpt-4o')).input / 1_000_000;
    result.savings = result.cacheRead * config.readDiscount * inputRate;
  }
  
  return result;
}

/**
 * Estimate potential cache savings for a request
 */
export function estimateCacheSavings({ provider, inputTokens, messagesPerDay = 100 }) {
  const config = PROVIDER_CONFIGS[provider];
  if (!config) return null;
  
  // Assume 60% of input tokens are cacheable prefix
  const cacheableTokens = Math.floor(inputTokens * 0.6);
  
  if (cacheableTokens < (config.minTokensForCache || 0)) {
    return {
      provider,
      cacheable: false,
      reason: `Need ${config.minTokensForCache}+ tokens, only ${cacheableTokens} available`,
    };
  }
  
  // First request = cache write (full cost)
  // Subsequent requests = cache read (discounted)
  // Representative model per provider, priced from pricing.js
  const costPerToken = getPricing(provider === 'anthropic' ? 'claude-sonnet-4' : 'gpt-4o').input / 1_000_000;
  const fullCostPerDay = inputTokens * costPerToken * messagesPerDay;
  const cachedCostPerDay = (inputTokens * costPerToken) + (cacheableTokens * costPerToken * config.readDiscount * (messagesPerDay - 1));
  const savings = fullCostPerDay - cachedCostPerDay;
  const savingsPct = fullCostPerDay > 0 ? (savings / fullCostPerDay * 100).toFixed(1) : 0;
  
  return {
    provider,
    cacheable: true,
    cacheableTokens,
    dailySavings: savings,
    monthlySavings: savings * 30,
    savingsPercent: savingsPct,
    config,
  };
}

/**
 * Get provider-specific recommendations
 */
export function getRecommendations(provider, context) {
  const recommendations = [];
  const config = PROVIDER_CONFIGS[provider];
  
  if (!config) return [{ type: 'warning', message: `Unknown provider: ${provider}` }];
  
  // Check if context is large enough for caching
  const totalTokens = context?.totalTokens || 0;
  if (totalTokens < (config.minTokensForCache || 0)) {
    recommendations.push({
      type: 'warning',
      message: `Context too small for provider caching (${totalTokens} < ${config.minTokensForCache} tokens)`,
      action: 'Increase system prompt size or tool definitions',
    });
  }
  
  // Anthropic-specific
  if (provider === 'anthropic') {
    recommendations.push({
      type: 'tip',
      message: 'Mark system prompt + tools + conversation history with cache_control',
      savings: '~90% on cached tokens',
    });
    recommendations.push({
      type: 'tip',
      message: 'Use 5-min TTL (free) for interactive, 1-hour for long sessions',
      savings: '2x write cost for 1-hour TTL',
    });
  }
  
  // OpenAI-specific
  if (provider === 'openai') {
    recommendations.push({
      type: 'tip',
      message: 'Caching is automatic — just keep prefixes stable',
      savings: '~50% on cached tokens',
    });
    recommendations.push({
      type: 'tip',
      message: 'Ensure system prompt is >= 1024 tokens for reliable caching',
      savings: '128-token cache increments',
    });
  }
  
  // General
  if (context?.hasTools) {
    recommendations.push({
      type: 'tip',
      message: 'Tool definitions are great cache candidates — keep them stable',
      savings: 'Tool schemas rarely change between requests',
    });
  }
  
  return recommendations;
}

export default {
  buildAnthropicMessages,
  buildOpenAIMessages,
  parseCacheUsage,
  estimateCacheSavings,
  getRecommendations,
  PROVIDER_CONFIGS,
};
