/**
 * TokenVault — Real-time token usage tracker
 * 
 * Tracks tokens per session, task, model, and operation type.
 * Stores data locally in JSON for the CLI dashboard.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './paths.js';

const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

// Pricing imported from single source (pricing.js)
import { MODEL_PRICING, calculateCost } from './pricing.js';

let usage = { sessions: {}, daily: {}, totals: { input: 0, output: 0, cost: 0 } };
let currentSession = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function loadUsage() {
  ensureDir();
  try {
    if (fs.existsSync(USAGE_FILE)) {
      usage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    }
  } catch { /* fresh start */ }
  return usage;
}

function saveUsage() {
  ensureDir();
  fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2), { mode: 0o600 });
}

// calculateCost replaced by calculateCost from pricing.js

/**
 * Start tracking a new session
 */
export function startSession(sessionId) {
  loadUsage();
  currentSession = sessionId || `s_${Date.now()}`;
  if (!usage.sessions[currentSession]) {
    usage.sessions[currentSession] = {
      start: new Date().toISOString(),
      models: {},
      operations: [],
      totalInput: 0,
      totalOutput: 0,
      totalCost: 0,
    };
  }
  return currentSession;
}

/**
 * Record a token usage event
 */
export function recordUsage({ model, inputTokens, outputTokens, operation, cached = false }) {
  if (!currentSession) startSession();
  
  const cost = cached ? 0 : calculateCost(model, inputTokens, outputTokens);
  const saved = cached ? calculateCost(model, inputTokens, outputTokens) : 0;
  
  // Session totals
  const session = usage.sessions[currentSession];
  session.totalInput += inputTokens;
  session.totalOutput += outputTokens;
  session.totalCost += cost;
  
  // Per-model breakdown
  if (!session.models[model]) {
    session.models[model] = { input: 0, output: 0, cost: 0, calls: 0 };
  }
  session.models[model].input += inputTokens;
  session.models[model].output += outputTokens;
  session.models[model].cost += cost;
  session.models[model].calls++;
  
  // Operation log (retain last 1000 per session)
  session.operations.push({
    time: Date.now(),
    model,
    input: inputTokens,
    output: outputTokens,
    cost,
    saved,
    operation: operation || 'unknown',
    cached,
  });
  if (session.operations.length > 1000) {
    session.operations = session.operations.slice(-1000);
  }
  
  // Daily totals
  const today = new Date().toISOString().split('T')[0];
  if (!usage.daily[today]) {
    usage.daily[today] = { input: 0, output: 0, cost: 0, saved: 0, calls: 0 };
  }
  usage.daily[today].input += inputTokens;
  usage.daily[today].output += outputTokens;
  usage.daily[today].cost += cost;
  usage.daily[today].saved += saved;
  usage.daily[today].calls++;
  
  // Grand totals
  usage.totals.input += inputTokens;
  usage.totals.output += outputTokens;
  usage.totals.cost += cost;
  usage.totals.saved = (usage.totals.saved || 0) + saved;
  
  saveUsage();
  
  return { cost, saved, total: session.totalCost };
}

/**
 * Get current session stats
 */
export function getSessionStats() {
  if (!currentSession) return null;
  loadUsage();
  return usage.sessions[currentSession] || null;
}

/**
 * Get daily stats
 */
export function getDailyStats(days = 7) {
  loadUsage();
  const result = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    result.push({
      date: key,
      ...(usage.daily[key] || { input: 0, output: 0, cost: 0, saved: 0, calls: 0 }),
    });
  }
  return result.reverse();
}

/**
 * Get totals
 */
export function getTotals() {
  loadUsage();
  return usage.totals;
}

/**
 * Estimate cost for a given model and token counts (without recording)
 */
export function estimateCost(model, inputTokens, outputTokens) {
  return calculateCost(model, inputTokens, outputTokens);
}

/**
 * Get model pricing info
 */
export function getModelPricing() {
  return MODEL_PRICING;
}

export default {
  startSession,
  recordUsage,
  getSessionStats,
  getDailyStats,
  getTotals,
  estimateCost,
  getModelPricing,
};
