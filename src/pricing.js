/**
 * TokenVault — Single Source of Truth for Model Pricing
 * 
 * ALL pricing must come from this file. No other file should contain pricing data.
 * When adding a new model, update ONLY this file.
 */

export const MODEL_PRICING = {
  // Premium tier
  'claude-sonnet-4': { input: 3.00, output: 15.00 },
  'claude-opus-4': { input: 15.00, output: 75.00 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  
  // Mid tier
  'claude-haiku': { input: 0.25, output: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'deepseek-v3': { input: 0.27, output: 1.10 },
  
  // Cheap tier
  'deepseek-v4-flash': { input: 0.07, output: 0.28 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gpt-4o-mini-fast': { input: 0.15, output: 0.60 },
  'llama-3.1-8b': { input: 0.05, output: 0.20 },
  'mistral-7b': { input: 0.05, output: 0.20 },
};

/**
 * Calculate cost for a given model and token counts
 */
export function calculateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['claude-sonnet-4'];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/**
 * Get pricing for a model
 */
export function getPricing(model) {
  return MODEL_PRICING[model] || MODEL_PRICING['claude-sonnet-4'];
}

export default { MODEL_PRICING, calculateCost, getPricing };
