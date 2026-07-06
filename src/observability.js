/**
 * TokenVault — Observability Module
 * 
 * Production-grade tracing, metrics, and alerting for AI agent token usage.
 * 
 * Features:
 * - Per-request tracing (latency, tokens, cost, cache hits)
 * - Agent-level cost attribution
 * - Real-time metrics aggregation
 * - Alert rules (budget, latency, error rate)
 * - Exportable traces (JSON/NDJSON for dashboards)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { calculateCost } from "./pricing.js";

const DATA_DIR = path.join(os.homedir(), '.hermes', 'tokenvault');
const TRACES_DIR = path.join(DATA_DIR, 'traces');
const METRICS_FILE = path.join(DATA_DIR, 'metrics.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');

let metrics = {
  requests: 0,
  totalTokens: 0,
  totalCost: 0,
  totalSaved: 0,
  cacheHits: 0,
  cacheMisses: 0,
  avgLatency: 0,
  errors: 0,
  byAgent: {},
  byModel: {},
  byOperation: {},
  hourly: {},
};

let alertRules = [
  { id: 'budget_daily', type: 'budget', threshold: 5.0, period: 'daily', enabled: true },
  { id: 'latency_p99', type: 'latency', threshold: 30000, enabled: true },
  { id: 'error_rate', type: 'error_rate', threshold: 0.1, window: 60, enabled: true },
  { id: 'cache_hit_rate', type: 'cache_hit_rate', threshold: 0.3, window: 60, enabled: true },
];

let alerts = [];

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TRACES_DIR)) fs.mkdirSync(TRACES_DIR, { recursive: true });
}

function loadMetrics() {
  ensureDir();
  try {
    if (fs.existsSync(METRICS_FILE)) {
      metrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
    }
  } catch { /* fresh */ }
  return metrics;
}

function saveMetrics() {
  ensureDir();
  fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2));
}

function loadAlerts() {
  try {
    if (fs.existsSync(ALERTS_FILE)) {
      alerts = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
    }
  } catch { /* fresh */ }
}

function saveAlerts() {
  ensureDir();
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
}

// ═══════════════════════════════════════════════════════════
// Tracing
// ═══════════════════════════════════════════════════════════

/**
 * Record a completed request trace
 */
export function trace({
  requestId,
  agent,
  model,
  operation,
  inputTokens,
  outputTokens,
  latencyMs,
  cached = false,
  error = null,
  metadata = {},
}) {
  loadMetrics();
  
  const cost = cached ? 0 : calculateCost(model, inputTokens, outputTokens);
  const saved = cached ? calculateCost(model, inputTokens, outputTokens) : 0;
  
  // Update global metrics
  metrics.requests++;
  metrics.totalTokens += inputTokens + outputTokens;
  metrics.totalCost += cost;
  metrics.totalSaved += saved;
  if (cached) metrics.cacheHits++;
  else metrics.cacheMisses++;
  if (error) metrics.errors++;
  
  // Latency (running average)
  metrics.avgLatency = metrics.avgLatency === 0
    ? latencyMs
    : metrics.avgLatency * 0.9 + latencyMs * 0.1;
  
  // Per-agent
  if (agent) {
    if (!metrics.byAgent[agent]) metrics.byAgent[agent] = { requests: 0, tokens: 0, cost: 0, saved: 0 };
    metrics.byAgent[agent].requests++;
    metrics.byAgent[agent].tokens += inputTokens + outputTokens;
    metrics.byAgent[agent].cost += cost;
    metrics.byAgent[agent].saved += saved;
  }
  
  // Per-model
  if (!metrics.byModel[model]) metrics.byModel[model] = { requests: 0, tokens: 0, cost: 0 };
  metrics.byModel[model].requests++;
  metrics.byModel[model].tokens += inputTokens + outputTokens;
  metrics.byModel[model].cost += cost;
  
  // Per-operation
  if (operation) {
    if (!metrics.byOperation[operation]) metrics.byOperation[operation] = { requests: 0, tokens: 0, cost: 0, latency: 0 };
    metrics.byOperation[operation].requests++;
    metrics.byOperation[operation].tokens += inputTokens + outputTokens;
    metrics.byOperation[operation].cost += cost;
    metrics.byOperation[operation].latency = metrics.byOperation[operation].latency * 0.9 + latencyMs * 0.1;
  }
  
  // Hourly bucket
  const hour = new Date().toISOString().replace(/:\d{2}:\d{2}.\d{3}Z$/, ':00:00');
  if (!metrics.hourly[hour]) metrics.hourly[hour] = { requests: 0, tokens: 0, cost: 0, errors: 0 };
  metrics.hourly[hour].requests++;
  metrics.hourly[hour].tokens += inputTokens + outputTokens;
  metrics.hourly[hour].cost += cost;
  if (error) metrics.hourly[hour].errors++;
  
  saveMetrics();
  
  // Write trace file
  const traceEntry = {
    id: requestId || `tr_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    time: new Date().toISOString(),
    agent,
    model,
    operation,
    inputTokens,
    outputTokens,
    cost,
    saved,
    latencyMs,
    cached,
    error,
    metadata,
  };
  
  const traceFile = path.join(TRACES_DIR, `${new Date().toISOString().split('T')[0]}.jsonl`);
  fs.appendFileSync(traceFile, JSON.stringify(traceEntry) + '\n');
  
  // Check alert rules
  checkAlerts(traceEntry);
  
  return traceEntry;
}

/**
 * Get recent traces
 */
export function getTraces(date, limit = 100) {
  const traceFile = path.join(TRACES_DIR, `${date || new Date().toISOString().split('T')[0]}.jsonl`);
  try {
    const lines = fs.readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l));
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// Metrics
// ═══════════════════════════════════════════════════════════

/**
 * Get current metrics snapshot
 */
export function getMetrics() {
  loadMetrics();
  return { ...metrics };
}

/**
 * Get agent-level cost breakdown
 */
export function getAgentCosts() {
  loadMetrics();
  const agents = Object.entries(metrics.byAgent);
  return agents
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.cost - a.cost);
}

/**
 * Get hourly cost trend (last 24h)
 */
export function getHourlyTrend() {
  loadMetrics();
  const now = new Date();
  const hours = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(d.getHours() - i);
    const key = d.toISOString().replace(/:\d{2}:\d{2}.\d{3}Z$/, ':00:00');
    hours.push({
      hour: key,
      ...(metrics.hourly[key] || { requests: 0, tokens: 0, cost: 0, errors: 0 }),
    });
  }
  return hours;
}

/**
 * Get cache efficiency stats
 */
export function getCacheEfficiency() {
  loadMetrics();
  const total = metrics.cacheHits + metrics.cacheMisses;
  return {
    hits: metrics.cacheHits,
    misses: metrics.cacheMisses,
    hitRate: total > 0 ? (metrics.cacheHits / total * 100).toFixed(1) : 0,
    saved: metrics.totalSaved,
  };
}

// ═══════════════════════════════════════════════════════════
// Alerts
// ═══════════════════════════════════════════════════════════

/**
 * Check alert rules against a new trace
 */
function checkAlerts(traceEntry) {
  loadAlerts();
  
  for (const rule of alertRules) {
    if (!rule.enabled) continue;
    
    let triggered = false;
    let message = '';
    
    switch (rule.type) {
      case 'latency':
        if (traceEntry.latencyMs > rule.threshold) {
          triggered = true;
          message = `Latency ${traceEntry.latencyMs}ms exceeds ${rule.threshold}ms`;
        }
        break;
      case 'error_rate': {
        const recent = getTraces(null, rule.window * 10);
        const errors = recent.filter(t => t.error).length;
        const rate = recent.length > 0 ? errors / recent.length : 0;
        if (rate > rule.threshold) {
          triggered = true;
          message = `Error rate ${(rate * 100).toFixed(1)}% exceeds ${(rule.threshold * 100).toFixed(1)}%`;
        }
        break;
      }
      case 'cache_hit_rate': {
        const efficiency = getCacheEfficiency();
        if (parseFloat(efficiency.hitRate) < rule.threshold * 100) {
          triggered = true;
          message = `Cache hit rate ${efficiency.hitRate}% below ${(rule.threshold * 100).toFixed(0)}%`;
        }
        break;
      }
    }
    
    if (triggered) {
      alerts.push({
        time: new Date().toISOString(),
        ruleId: rule.id,
        message,
        level: 'warning',
      });
    }
  }
  
  saveAlerts();
}

/**
 * Get recent alerts
 */
export function getAlerts(limit = 50) {
  loadAlerts();
  return alerts.slice(-limit);
}

/**
 * Set alert rules
 */
export function setAlertRule(rule) {
  const idx = alertRules.findIndex(r => r.id === rule.id);
  if (idx >= 0) {
    alertRules[idx] = { ...alertRules[idx], ...rule };
  } else {
    alertRules.push(rule);
  }
}

export function getAlertRules() {
  return [...alertRules];
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

// calculateCost replaced by calculateCost from pricing.js

export default {
  trace,
  getTraces,
  getMetrics,
  getAgentCosts,
  getHourlyTrend,
  getCacheEfficiency,
  getAlerts,
  setAlertRule,
  getAlertRules,
};
