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
  // Use AUTOMATIC caching (top-level cache_control)
  // System prompt + tools must be >1024 tokens for caching to work
  const result = {
    system,
    messages,
    tools,
    cache_control: { type: 'ephemeral' },  // Automatic caching
    cacheMarkers: [{ type: 'automatic', description: 'System + tools cached automatically' }],
  };
  
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
  const result = { messages: [], cacheOptimized: true };
  
  // System message — keep it stable for caching
  if (system) {
    result.messages.push({
      role: 'system',
      content: typeof system === 'string' ? system : JSON.stringify(system),
    });
  }
  
  // Messages — keep prefix stable
  if (messages) {
    result.messages.push(...messages);
  }
  
  // Tools — keep them stable
  if (tools) {
    result.tools = tools;
  }
  
  return result;
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
    
    // Calculate savings
    const config = PROVIDER_CONFIGS.anthropic;
    result.savings = result.cacheRead * config.readDiscount * 0.003; // ~$3/M input
  } else if (provider === 'openai') {
    // OpenAI reports cached tokens in the prompt_tokens_details
    const details = usage.prompt_tokens_details || {};
    result.cacheRead = details.cached_tokens || 0;
    result.cacheHit = result.cacheRead > 0;
    
    const config = PROVIDER_CONFIGS.openai;
    result.savings = result.cacheRead * config.readDiscount * 0.0025; // ~$2.50/M input
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
  const costPerToken = provider === 'anthropic' ? 0.000003 : 0.0000025;
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
