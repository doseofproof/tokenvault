/**
 * TokenVault — Smart Model Router
 * 
 * Routes tasks to the cheapest model that can handle them.
 * Saves 60-90% by using expensive models only when needed.
 * 
 * Strategy:
 * - Simple tasks (formatting, lookup, short Q&A) → cheap models
 * - Medium tasks (code review, analysis) → mid-tier models  
 * - Hard tasks (architecture, complex reasoning) → premium models
 */

// Task complexity classification
const COMPLEXITY_PATTERNS = {
  // Premium tier — needs the best
  hard: [
    /architect/i, /design.*system/i, /refactor.*complex/i, /security.*audit/i,
    /algorithm.*optimi/i, /distributed.*system/i, /database.*migrat/i,
    /explain.*why.*different/i, /compare.*trade.?off/i, /debug.*race.*condition/i,
    /write.*novel/i, /creative.*writing.*long/i, /multi.*step.*reasoning/i,
    /math.*proof/i, /legal.*analy/i, /financial.*model/i,
  ],
  // Mid tier — needs good reasoning
  medium: [
    /code.*review/i, /debug/i, /explain.*code/i, /refactor/i, /test.*writ/i,
    /document/i, /summarize.*long/i, /analyz/i, /compar/i, /research/i,
    /plan/i, /strateg/i, /implement/i, /build.*feature/i, /fix.*bug/i,
    /translate.*code/i, /sql.*query/i, /api.*design/i,
  ],
  // Cheap tier — simple tasks
  simple: [
    /format/i, /lint/i, /sort/i, /count/i, /find.*file/i, /what.*is/i,
    /list/i, /status/i, /check/i, /verify/i, /rename/i, /move.*file/i,
    /git.*status/i, /git.*log/i, /ls/i, /cat/i, /head/i, /tail/i,
    /convert.*json/i, /parse/i, /extract/i, /simple/i, /quick/i,
    /hello/i, /hi/i, /thanks/i, /yes/i, /no/i, /ok/i,
  ],
};

// Model tiers
const MODEL_TIERS = {
  premium: ['claude-sonnet-4', 'claude-opus-4', 'gpt-4o', 'gpt-4-turbo'],
  mid: ['claude-haiku', 'gpt-4o-mini', 'gemini-1.5-pro', 'deepseek-v3'],
  cheap: ['deepseek-v4-flash', 'gemini-1.5-flash', 'gpt-4o-mini-fast', 'llama-3.1-8b', 'mistral-7b'],
};

// Cost per tier (approximate average per 1M tokens)
const TIER_COST = {
  premium: 20.00,
  mid: 1.50,
  cheap: 0.15,
};

let config = {
  enabled: true,
  defaultTier: 'mid',
  // Override: always use premium for these patterns
  forcePremium: [],
  // Override: always use cheap for these patterns  
  forceCheap: [],
  // Savings tracking
  stats: { routed: 0, saved: 0 },
};

/**
 * Classify task complexity
 */
export function classifyTask(prompt) {
  const text = prompt.toLowerCase();
  
  // Check forced overrides first
  for (const pattern of config.forcePremium) {
    if (new RegExp(pattern, 'i').test(text)) return 'hard';
  }
  for (const pattern of config.forceCheap) {
    if (new RegExp(pattern, 'i').test(text)) return 'simple';
  }
  
  // Score each tier
  let scores = { hard: 0, medium: 0, simple: 0 };
  
  for (const pattern of COMPLEXITY_PATTERNS.hard) {
    if (pattern.test(text)) scores.hard++;
  }
  for (const pattern of COMPLEXITY_PATTERNS.medium) {
    if (pattern.test(text)) scores.medium++;
  }
  for (const pattern of COMPLEXITY_PATTERNS.simple) {
    if (pattern.test(text)) scores.simple++;
  }
  
  // Prompt length heuristic — longer prompts tend to be more complex
  const words = text.split(/\s+/).length;
  if (words > 200) scores.hard += 2;
  else if (words > 50) scores.medium += 1;
  else if (words < 10) scores.simple += 2;
  
  // Pick winner
  if (scores.hard > scores.medium && scores.hard > scores.simple) return 'hard';
  if (scores.simple > scores.medium && scores.simple > scores.hard) return 'simple';
  return 'medium';
}

/**
 * Select the best model for a task
 */
export function selectModel(prompt, currentModel) {
  if (!config.enabled) return currentModel;
  
  const tier = classifyTask(prompt);
  const models = MODEL_TIERS[tier] || MODEL_TIERS.mid;
  
  // Prefer the user's current model if it's in this tier
  if (models.includes(currentModel)) return currentModel;
  
  // Otherwise pick the cheapest in the tier
  return models[0];
}

/**
 * Calculate potential savings from routing
 */
export function estimateSavings(prompt, currentModel) {
  const tier = classifyTask(prompt);
  const targetModel = selectModel(prompt, currentModel);
  
  if (targetModel === currentModel) return { savings: 0, percentage: 0 };
  
  // Estimate based on typical 2K input / 1K output
  const inputTokens = 2000;
  const outputTokens = 1000;
  
  const currentCost = getApproxCost(currentModel, inputTokens, outputTokens);
  const newCost = getApproxCost(targetModel, inputTokens, outputTokens);
  
  return {
    savings: currentCost - newCost,
    percentage: currentCost > 0 ? ((currentCost - newCost) / currentCost * 100) : 0,
    from: currentModel,
    to: targetModel,
    tier,
  };
}

function getApproxCost(model, input, output) {
  // Import pricing from tracker
  const PRICING = {
    'claude-sonnet-4': { input: 3.00, output: 15.00 },
    'claude-opus-4': { input: 15.00, output: 75.00 },
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4-turbo': { input: 10.00, output: 30.00 },
    'claude-haiku': { input: 0.25, output: 1.25 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gemini-1.5-pro': { input: 1.25, output: 5.00 },
    'deepseek-v3': { input: 0.27, output: 1.10 },
    'deepseek-v4-flash': { input: 0.07, output: 0.28 },
    'gemini-1.5-flash': { input: 0.075, output: 0.30 },
    'gpt-4o-mini-fast': { input: 0.15, output: 0.60 },
    'llama-3.1-8b': { input: 0.05, output: 0.20 },
    'mistral-7b': { input: 0.05, output: 0.20 },
  };
  const p = PRICING[model] || PRICING['claude-sonnet-4'];
  return (input * p.input + output * p.output) / 1_000_000;
}

/**
 * Update config
 */
export function configure(opts) {
  Object.assign(config, opts);
}

export function getConfig() {
  return { ...config };
}

export default {
  classifyTask,
  selectModel,
  estimateSavings,
  configure,
  getConfig,
  MODEL_TIERS,
};
