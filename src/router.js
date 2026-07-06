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
  // Premium tier — needs the best (checked FIRST)
  hard: [
    /\barchitect/i, /\bdesign\b.*\b(system|schema|database|architecture)\b/i,
    /\bsecurity\b.*\baudit\b/i, /\balgorithm\b.*\boptimi/i,
    /\bdistributed\b.*\bsystem\b/i, /\bdatabase\b.*\bmigrat/i,
    /\btrade.?offs?\b/i, /\brace\b.*\bcondition\b/i,
    /\bcritical\b.*\breasoning/i, /\bcomplex\b.*\b(reasoning|logic|problem)\b/i,
    /\bwrite\b.*\bnovel\b/i, /\bcreative\b.*\bwriting\b.*\blong/i,
    /\bmulti.?step\b.*\breasoning/i, /\bmath\b.*\bproof\b/i,
    /\blegal\b.*\banaly/i, /\bfinancial\b.*\bmodel/i,
    /\bthreat\b.*\bmodel/i, /\bpenetration\b.*\btest/i,
    /\boptimize\b.*\bperformance\b.*\bcritical/i,
    /\bexplain\b.*\bwhy\b.*\b(different|better|worse)/i,
    /\bcompare\b.*\b(trade|approach|method)/i,
    /\bimplications?\b/i, /\bpropose\b.*\barchitectural/i,
    /\bcomprehensive\b.*\b(test|review|audit|analysis)/i,
  ],
  // Mid tier — needs good reasoning (checked SECOND)
  medium: [
    /\bcode\b.*\breview\b/i, /\bdebug\b/i, /\bexplain\b.*\bcode\b/i,
    /\brefactor/i, /\btest\b.*\bwrit/i, /\bdocument/i,
    /\bsummarize\b.*\blong/i, /\banalyz/i, /\bresearch\b/i,
    /\bplan\b/i, /\bstrateg/i, /\bimplement\b/i, /\bbuild\b.*\bfeature\b/i,
    /\bfix\b.*\bbug\b/i, /\btranslate\b.*\bcode\b/i,
    /\bsql\b.*\bquery\b/i, /\bapi\b.*\bdesign\b/i,
    /\breview\b/i, /\bfunction\b/i, /\bmodule\b/i,
    /\bexplain\b.*\bhow\b/i, /\bhow\b.*\bdoes\b/i,
    /\bwrite\b.*\btest/i, /\bcreate\b.*\b(script|dashboard|monitoring|system)/i,
    /\bmodify\b/i, /\bchange\b.*\bcode/i,
    /\bunderstand\b/i, /\bwhy\b.*\bhappening/i, /\bwhat\b.*\bmean\b/i,
    /\bpull\b.*\brequest\b/i, /\bimplement\b.*\b(caching|layer|system)/i,
    /\bconfigure\b/i, /\bsetup\b/i, /\bdeploy\b/i,
  ],
  // Cheap tier — simple tasks (checked LAST)
  simple: [
    /\bformat\b/i, /\blint\b/i, /\bsort\b/i, /\bcount\b/i,
    /\bfind\b.*\bfile\b/i, /\bwhat\b.*\bis\b/i,
    /\blist\b/i, /\bstatus\b/i, /\bcheck\b/i, /\bverify\b/i,
    /\brename\b/i, /\bmove\b.*\bfile\b/i,
    /\bgit\b.*\b(status|log|commit|push|pull|diff)\b/i,
    /\bconvert\b.*\bjson\b/i, /\bsimple\b/i, /\bquick\b/i,
    /\bhello\b/i, /\bhi\b/i, /\bthanks\b/i, /\byes\b/i, /\bno\b/i, /\bok\b/i,
    /\btype\b/i, /\bcat\b/i, /\bls\b/i, /\bfind\b/i,
    /\bhello\b/i, /\bprint\b/i, /\becho\b/i, /\bdate\b/i,
  ],
};

// Model tiers
const MODEL_TIERS = {
  premium: ['claude-sonnet-4', 'claude-opus-4', 'gpt-4o', 'gpt-4-turbo'],
  mid: ['claude-haiku', 'gpt-4o-mini', 'gemini-1.5-pro', 'deepseek-v3'],
  cheap: ['deepseek-v4-flash', 'gemini-1.5-flash', 'gpt-4o-mini-fast', 'llama-3.1-8b', 'mistral-7b'],
  simple: ['deepseek-v4-flash', 'gemini-1.5-flash', 'gpt-4o-mini-fast', 'llama-3.1-8b', 'mistral-7b'],
  hard: ['claude-sonnet-4', 'claude-opus-4', 'gpt-4o', 'gpt-4-turbo'],
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
  
  // Score each tier — but hard wins immediately if matched
  let hardMatch = false;
  let mediumMatch = false;
  let simpleMatch = false;
  
  for (const pattern of COMPLEXITY_PATTERNS.hard) {
    if (pattern.test(text)) { hardMatch = true; break; }
  }
  if (hardMatch) return 'hard';
  
  for (const pattern of COMPLEXITY_PATTERNS.medium) {
    if (pattern.test(text)) { mediumMatch = true; break; }
  }
  if (mediumMatch) return 'medium';
  
  for (const pattern of COMPLEXITY_PATTERNS.simple) {
    if (pattern.test(text)) { simpleMatch = true; break; }
  }
  
  // Fallback: use prompt length heuristic
  const words = text.split(/\s+/).length;
  if (words > 200) return 'hard';
  if (words > 50) return 'medium';
  return 'simple';
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
