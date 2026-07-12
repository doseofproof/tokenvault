/**
 * TokenVault — Nous Portal / NVIDIA NIM Integration
 * 
 * NIM inherits the OpenAI-compatible API format but:
 * - No explicit cache_control markers (unlike Anthropic)
 * - No cached_tokens in usage response (unlike OpenAI)
 * - Caching is automatic and transparent
 * - Latency improvement is the only observable indicator
 * 
 * Strategy:
 * - Use OpenAI-compatible message format
 * - Maintain strict prefix ordering (same as OpenAI)
 * - Track latency reduction as cache hit proxy
 * - No cache_control needed — NIM handles it internally
 */

const NIM_CONFIG = {
  name: 'NVIDIA NIM',
  endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
  caching: 'automatic', // No explicit markers needed
  discount: 'unknown', // NIM doesn't report cache metrics
  latencyImprovement: 0.20, // Observed ~20-30% improvement
  format: 'openai', // Uses OpenAI-compatible API
};

/**
 * Build NIM-compatible request (OpenAI format)
 * 
 * NIM uses OpenAI's API format but caching is automatic.
 * Just maintain strict prefix ordering.
 */
export function buildNIMRequest({ system, tools, messages }) {
  const result = {
    messages: [],
    tools: undefined,
    _provider: 'nim',
    _cacheStrategy: 'automatic',
  };
  
  // System message (NIM uses system role in messages array)
  if (system) {
    result.messages.push({
      role: 'system',
      content: typeof system === 'string' ? system : JSON.stringify(system),
    });
  }
  
  // Tools (OpenAI format)
  if (tools && tools.length > 0) {
    const sortedTools = [...tools].sort((a, b) => a.name.localeCompare(b.name));
    result.tools = sortedTools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema || tool.parameters || {},
      },
    }));
  }
  
  // Messages
  if (messages && messages.length > 0) {
    for (const msg of messages) {
      result.messages.push({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    }
  }
  
  return result;
}

/**
 * Parse NIM response
 * 
 * NIM doesn't report cache metrics, so we use latency as a proxy.
 * Significant latency reduction on repeated requests = cache hit.
 */
export function parseNIMResponse(response, previousLatency) {
  const usage = response?.usage;
  if (!usage) return null;
  
  const latencyImproved = previousLatency ? 
    (previousLatency - (response._latency || 0)) / previousLatency : 0;
  
  // Estimate cache hit based on latency improvement
  const estimatedCacheHit = latencyImproved > 0.15; // >15% improvement = likely cache hit
  
  return {
    provider: 'nim',
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    cachedTokens: 0, // NIM doesn't report this
    cacheHit: estimatedCacheHit,
    latencyImprovement: (latencyImproved * 100).toFixed(1) + '%',
    recommendation: estimatedCacheHit ? 
      'Cache likely active — latency improved by ' + (latencyImproved * 100).toFixed(0) + '%' :
      'No cache indication — first request or cache miss',
  };
}

/**
 * NIM-specific compress-vs-cache heuristic
 * 
 * Since NIM caching is automatic and free (no explicit cost difference),
 * we always prefer caching over compression when possible.
 * Only compress when context exceeds the model's context window.
 */
export function evaluateNIMCompressVsCache({ tokensAfter, contextWindow = 131072 }) {
  // NIM models typically have large context windows
  if (tokensAfter >= contextWindow * 0.8) {
    return {
      action: 'compress',
      reason: `${tokensAfter} tokens approaching ${contextWindow} context limit`,
    };
  }
  
  // Otherwise, let NIM handle caching automatically
  return {
    action: 'cache',
    reason: `NIM caches automatically — ${tokensAfter} tokens within context window`,
  };
}

export default {
  buildNIMRequest,
  parseNIMResponse,
  evaluateNIMCompressVsCache,
  NIM_CONFIG,
};
