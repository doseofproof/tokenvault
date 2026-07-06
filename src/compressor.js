/**
 * TokenVault — Context Compressor
 * 
 * Intelligently compresses context before sending to LLMs.
 * Strategies:
 * 1. Tool output truncation — cap oversized tool results
 * 2. Duplicate removal — deduplicate similar messages
 * 3. Summary injection — replace old context with summaries
 * 4. Smart trimming — keep the most relevant parts
 */

const DEFAULT_CONFIG = {
  maxToolOutputChars: 4000,       // Max chars per tool output
  maxContextChars: 30000,         // Max total context
  dedupSimilarity: 0.85,         // Dedup threshold (Jaccard)
  summaryThreshold: 5,            // Summarize after N old messages
  keepRecent: 3,                  // Always keep last N messages verbatim
  enabled: true,
};

let config = { ...DEFAULT_CONFIG };

/**
 * Compress a tool output before it enters context
 */
export function compressToolOutput(output, toolName) {
  if (!config.enabled) return output;
  if (output.length <= config.maxToolOutputChars) return output;
  
  const truncated = output.substring(0, config.maxToolOutputChars);
  const saved = output.length - config.maxToolOutputChars;
  
  return truncated + `\n\n[TokenVault: truncated ${saved} chars — full output available via tool re-call]`;
}

/**
 * Deduplicate similar messages in context
 */
export function dedupMessages(messages) {
  if (!config.enabled || messages.length < 3) return messages;
  
  const seen = [];
  const result = [];
  let deduped = 0;
  
  for (const msg of messages) {
    const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    const words = new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    
    let isDuplicate = false;
    for (const s of seen) {
      const similarity = jaccard(words, s);
      if (similarity > config.dedupSimilarity) {
        isDuplicate = true;
        deduped++;
        break;
      }
    }
    
    if (!isDuplicate) {
      seen.push(words);
      result.push(msg);
    }
  }
  
  return { messages: result, deduped };
}

function jaccard(a, b) {
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Smart context trimming — keep the most important parts
 */
export function trimContext(messages, maxChars) {
  maxChars = maxChars || config.maxContextChars;
  
  const totalChars = messages.reduce((sum, m) => {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + text.length;
  }, 0);
  
  if (totalChars <= maxChars) return { messages, trimmed: 0 };
  
  // Always keep system prompt (first message) and recent messages
  const systemPrompt = messages[0];
  const recent = messages.slice(-config.keepRecent);
  const middle = messages.slice(1, -config.keepRecent);
  
  const fixedChars = (typeof systemPrompt?.content === 'string' ? systemPrompt.content.length : 0) +
    recent.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0);
  
  const budget = maxChars - fixedChars;
  
  // Prioritize by recency — keep newer messages, summarize older ones
  let kept = [];
  let runningChars = 0;
  
  for (let i = middle.length - 1; i >= 0; i--) {
    const text = typeof middle[i].content === 'string' ? middle[i].content : JSON.stringify(middle[i].content);
    if (runningChars + text.length <= budget) {
      kept.unshift(middle[i]);
      runningChars += text.length;
    }
  }
  
  const trimmedMessages = [systemPrompt, ...kept, ...recent].filter(Boolean);
  const trimmed = messages.length - trimmedMessages.length;
  
  return { messages: trimmedMessages, trimmed };
}

/**
 * Compress full context pipeline
 */
export function compressContext(messages, opts = {}) {
  let result = [...messages];
  let stats = { original: messages.length, deduped: 0, trimmed: 0 };
  
  // Step 1: Dedup
  const deduped = dedupMessages(result);
  result = deduped.messages;
  stats.deduped = deduped.deduped;
  
  // Step 2: Trim
  const trimmed = trimContext(result, opts.maxChars);
  result = trimmed.messages;
  stats.trimmed = trimmed.trimmed;
  
  stats.final = result.length;
  stats.compressionRatio = stats.original > 0 ? ((1 - stats.final / stats.original) * 100).toFixed(1) : 0;
  
  return { messages: result, stats };
}

/**
 * Configure compressor
 */
export function configure(opts) {
  Object.assign(config, opts);
}

export function getConfig() {
  return { ...config };
}

export default {
  compressToolOutput,
  dedupMessages,
  trimContext,
  compressContext,
  configure,
  getConfig,
};
