/**
 * TokenVault — OpenAI Prompt Cache Integration
 * 
 * OpenAI uses AUTOMATIC prefix caching:
 * - No explicit markers needed
 * - Caches in 128-token increments beyond 1024 tokens
 * - Cached tokens are 50% cheaper
 * - Prefix must be EXACTLY the same (byte-for-byte)
 * 
 * Strict ordering required:
 * 1. System Prompt (static)
 * 2. Tools Schema (deterministic JSON)
 * 3. Static Context (memory, vault reads)
 * 4. Conversation History (oldest → newest)
 * 5. Current Turn (variable)
 */

const OPENAI_CACHE_CONFIG = {
  minTokensForCache: 1024,
  cacheIncrement: 128,
  readDiscount: 0.50, // 50% cheaper on cached tokens
  ttl: '5-10 minutes', // In-memory, not user-configurable
};

/**
 * Build OpenAI messages with strict prefix ordering
 * 
 * Enforces the exact order required for automatic caching:
 * 1. System prompt (static, never changes mid-session)
 * 2. Tools (deterministic JSON serialization)
 * 3. Static context (memory blocks, vault reads)
 * 4. History (oldest to newest)
 * 5. Current turn (only variable part)
 */
export function buildOpenAIMessages({ system, tools, context, messages }) {
  const result = {
    messages: [],
    tools: undefined,
    _cacheOptimized: true,
    _prefixLength: 0,
  };
  
  // Step 1: System prompt (STATIC — never change mid-session)
  if (system) {
    result.messages.push({
      role: 'system',
      content: typeof system === 'string' ? system : JSON.stringify(system),
    });
    result._prefixLength += result.messages[0].content.length;
  }
  
  // Step 2: Tools (DETERMINISTIC — sort by name, stable serialization)
  if (tools && tools.length > 0) {
    // Sort tools alphabetically by name for deterministic ordering
    const sortedTools = [...tools].sort((a, b) => a.name.localeCompare(b.name));
    result.tools = sortedTools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema || tool.parameters || {},
      },
    }));
    // Add tool schema to prefix length estimate
    result._prefixLength += JSON.stringify(result.tools).length;
  }
  
  // Step 3: Static context (memory blocks, vault reads — rarely change)
  if (context && context.length > 0) {
    for (const ctx of context) {
      result.messages.push({
        role: 'system', // Use system role for static context blocks
        content: ctx.content || JSON.stringify(ctx),
      });
      result._prefixLength += result.messages[result.messages.length - 1].content.length;
    }
  }
  
  // Step 4: Conversation history (oldest → newest — NEVER reorder)
  if (messages && messages.length > 0) {
    for (const msg of messages) {
      result.messages.push({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
      result._prefixLength += result.messages[result.messages.length - 1].content.length;
    }
  }
  
  // Estimate token count (rough: 4 chars ≈ 1 token)
  result._estimatedTokens = Math.ceil(result._prefixLength / 4);
  result._cacheable = result._estimatedTokens >= OPENAI_CACHE_CONFIG.minTokensForCache;
  
  return result;
}

/**
 * Parse OpenAI cache usage from API response
 */
export function parseOpenAICacheUsage(response) {
  const usage = response?.usage;
  if (!usage) return null;
  
  const details = usage.prompt_tokens_details || {};
  const cachedTokens = details.cached_tokens || 0;
  const totalPromptTokens = usage.prompt_tokens || 0;
  
  // Calculate savings
  const costPerToken = 0.0025 / 1000; // ~$2.50/M for gpt-4o
  const fullCost = totalPromptTokens * costPerToken;
  const cachedCost = cachedTokens * costPerToken * OPENAI_CACHE_CONFIG.readDiscount;
  const savings = fullCost - cachedCost;
  
  return {
    provider: 'openai',
    promptTokens: totalPromptTokens,
    completionTokens: usage.completion_tokens || 0,
    cachedTokens,
    cacheHit: cachedTokens > 0,
    cacheHitRate: totalPromptTokens > 0 ? (cachedTokens / totalPromptTokens * 100).toFixed(1) : 0,
    savings,
    fullCost,
    cachedCost,
  };
}

/**
 * OpenAI-specific compress-vs-cache heuristic
 * 
 * OpenAI offers 50% discount (vs Anthropic's 90%).
 * The math is different:
 * - Compression saves 100% of tokens
 * - Caching saves 50% of tokens
 * - If compression achieves >50% reduction, it's cheaper than caching
 */
export function evaluateOpenAICompressVsCache({ tokensAfter, tokensSaved, totalTokens }) {
  const CACHE_THRESHOLD = 1024;
  const COMPRESSION_BREAK_EVEN = 0.50; // If compression removes >50%, it beats caching
  
  const compressionRatio = totalTokens > 0 ? tokensSaved / totalTokens : 0;
  
  // If we're below cache threshold, compress (cache won't help)
  if (tokensAfter < CACHE_THRESHOLD) {
    return {
      action: 'compress',
      reason: `${tokensAfter} tokens below ${CACHE_THRESHOLD} threshold — cache won't apply`,
      savingsComparison: 'Compression saves 100%, caching not available',
    };
  }
  
  // If compression achieves >50% reduction, it's cheaper than 50% cache discount
  if (compressionRatio > COMPRESSION_BREAK_EVEN) {
    return {
      action: 'compress',
      reason: `Compression removes ${(compressionRatio * 100).toFixed(0)}% — cheaper than 50% cache discount`,
      savingsComparison: `Compression: ${(compressionRatio * 100).toFixed(0)}% saved vs Caching: 50% saved`,
    };
  }
  
  // If compression is <50%, caching is cheaper
  if (compressionRatio <= COMPRESSION_BREAK_EVEN && tokensAfter >= CACHE_THRESHOLD) {
    return {
      action: 'cache',
      reason: `Compression only removes ${(compressionRatio * 100).toFixed(0)}% — 50% cache discount is cheaper`,
      savingsComparison: `Caching: 50% saved vs Compression: ${(compressionRatio * 100).toFixed(0)}% saved`,
    };
  }
  
  return {
    action: 'compress',
    reason: 'Default to compression',
  };
}

/**
 * Validate prefix stability for OpenAI caching
 * Call this before each request to ensure nothing mutated the prefix
 */
export function validatePrefixStability(previousPrefix, currentPrefix) {
  if (!previousPrefix) return { stable: true, firstRequest: true };
  
  if (previousPrefix === currentPrefix) {
    return { stable: true, length: currentPrefix.length };
  }
  
  // Find where the divergence starts
  let divergencePoint = 0;
  for (let i = 0; i < Math.min(previousPrefix.length, currentPrefix.length); i++) {
    if (previousPrefix[i] !== currentPrefix[i]) {
      divergencePoint = i;
      break;
    }
  }
  
  return {
    stable: false,
    divergencePoint,
    previousLength: previousPrefix.length,
    currentLength: currentPrefix.length,
    recommendation: `Prefix mutated at position ${divergencePoint}. Cache will miss for everything after this point.`,
  };
}

export default {
  buildOpenAIMessages,
  parseOpenAICacheUsage,
  evaluateOpenAICompressVsCache,
  validatePrefixStability,
  OPENAI_CACHE_CONFIG,
};
