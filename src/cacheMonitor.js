/**
 * TokenVault — Real-Time Cache Monitor
 * 
 * Surfaces provider-level cache hit rates during live agent loops.
 * Tracks:
 * - Anthropic cache_control effectiveness
 * - OpenAI automatic cache命中率
 * - Per-request cache savings
 * - Cache invalidation events (compression shifts)
 */

import fs from 'fs';
import path from 'path';
import { getPricing } from './pricing.js';
import { DATA_DIR } from './paths.js';

const CACHE_MONITOR_FILE = path.join(DATA_DIR, 'cache-monitor.json');

let monitor = {
  // Session-level stats
  session: {
    startTime: Date.now(),
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheWrites: 0, // New cache entries created
    totalSavings: 0,
    hitRate: 0,
  },
  
  // Per-provider stats
  byProvider: {
    anthropic: { requests: 0, hits: 0, misses: 0, writes: 0, savings: 0 },
    openai: { requests: 0, hits: 0, misses: 0, writes: 0, savings: 0 },
    nous: { requests: 0, hits: 0, misses: 0, writes: 0, savings: 0 },
    xai: { requests: 0, hits: 0, misses: 0, writes: 0, savings: 0 },
  },
  
  // Cache invalidation tracking
  invalidations: {
    compressionShifts: 0,
    mutablePrompts: 0,
    toolSchemaChanges: 0,
  },
  
  // Recent events (last 100)
  recentEvents: [],
  
  // Alert thresholds
  alerts: {
    hitRateBelow: 0.3, // Alert if hit rate drops below 30%
    invalidationSpike: 10, // Alert if >10 invalidations in window
  },
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadMonitor() {
  ensureDir();
  try {
    if (fs.existsSync(CACHE_MONITOR_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CACHE_MONITOR_FILE, 'utf8'));
      // Merge with defaults (handles new fields)
      monitor = { ...monitor, ...saved, session: { ...monitor.session, ...saved.session }, byProvider: { ...monitor.byProvider, ...saved.byProvider } };
    }
  } catch { /* fresh */ }
}

function saveMonitor() {
  ensureDir();
  fs.writeFileSync(CACHE_MONITOR_FILE, JSON.stringify(monitor, null, 2));
}

function addEvent(type, data) {
  monitor.recentEvents.push({
    time: Date.now(),
    type,
    ...data,
  });
  // Keep only last 100 events
  if (monitor.recentEvents.length > 100) {
    monitor.recentEvents = monitor.recentEvents.slice(-100);
  }
}

// ═══════════════════════════════════════════════════════════
// Cache Hit Tracking
// ═══════════════════════════════════════════════════════════

/**
 * Record a cache event from API response
 */
export function recordCacheEvent({ provider, cached, tokens, savings }) {
  loadMonitor();
  
  monitor.session.totalRequests++;
  
  if (cached) {
    monitor.session.cacheHits++;
    monitor.session.totalSavings += savings || 0;
  } else {
    monitor.session.cacheMisses++;
  }
  
  // Update hit rate
  monitor.session.hitRate = monitor.session.totalRequests > 0
    ? (monitor.session.cacheHits / monitor.session.totalRequests * 100).toFixed(1)
    : 0;
  
  // Per-provider
  if (provider && monitor.byProvider[provider]) {
    const p = monitor.byProvider[provider];
    p.requests++;
    if (cached) {
      p.hits++;
      p.savings += savings || 0;
    } else {
      p.misses++;
    }
  }
  
  // Add event
  addEvent(cached ? 'cache_hit' : 'cache_miss', {
    provider,
    tokens,
    savings,
  });
  
  saveMonitor();
  
  // Check alerts
  checkAlerts();
  
  return {
    hitRate: monitor.session.hitRate,
    totalHits: monitor.session.cacheHits,
    totalMisses: monitor.session.cacheMisses,
    totalSavings: monitor.session.totalSavings,
  };
}

/**
 * Record a cache write (new entry created)
 */
export function recordCacheWrite({ provider, tokens }) {
  loadMonitor();
  
  monitor.session.cacheWrites++;
  
  if (provider && monitor.byProvider[provider]) {
    monitor.byProvider[provider].writes++;
  }
  
  addEvent('cache_write', { provider, tokens });
  saveMonitor();
}

// ═══════════════════════════════════════════════════════════
// Cache Invalidation Tracking (The Three Silent Killers)
// ═══════════════════════════════════════════════════════════

/**
 * Track compression-induced cache invalidation
 * When compressor.js fires and shifts context, it invalidates cache
 */
export function recordCompressionShift({ messagesBefore, messagesAfter, tokensSaved, tokensAfter }) {
  loadMonitor();
  
  monitor.invalidations.compressionShifts++;
  
  addEvent('compression_shift', {
    messagesBefore,
    messagesAfter,
    tokensSaved,
    tokensAfter,
    impact: 'Cache invalidated for all messages after compression breakpoint',
  });
  
  saveMonitor();
  
  // Compress-vs-cache micro-heuristic
  const decision = evaluateCompressVsCache({
    tokensAfter,
    tokensSaved,
    provider: 'anthropic', // Default to Anthropic
  });
  
  return {
    invalidations: monitor.invalidations.compressionShifts,
    recommendation: decision.recommendation,
    decision: decision.action,
  };
}

/**
 * Compress-vs-cache micro-heuristic
 * 
 * The threshold collision: compressor.js truncates context to save tokens,
 * but if it drops below 1024 tokens, the request loses Anthropic's 90% cache
 * discount. This function decides whether to compress or leave padding.
 * 
 * Strategy:
 * - If tokensAfter >= 1024: compress (savings from compression > cache benefit)
 * - If tokensAfter < 1024 AND tokensAfter > 800: leave padding (close to threshold)
 * - If tokensAfter < 800: compress (too small for cache to matter anyway)
 * - If tokensSaved < 200: skip compression (not worth the cache invalidation)
 */
export function evaluateCompressVsCache({ tokensAfter, tokensSaved, provider = 'anthropic' }) {
  const CACHE_THRESHOLD = 1024;
  const NEAR_THRESHOLD = 800; // If within 200 tokens of threshold, leave padding
  const MIN_SAVINGS_FOR_COMPRESS = 200; // Minimum tokens saved to justify compression
  
  // If compression doesn't save much, skip it (avoid cache invalidation)
  if (tokensSaved < MIN_SAVINGS_FOR_COMPRESS) {
    return {
      action: 'skip_compression',
      reason: `Only ${tokensSaved} tokens saved — not worth invalidating cache`,
      recommendation: `Skip compression: ${tokensSaved} tokens saved < ${MIN_SAVINGS_FOR_COMPRESS} threshold`,
      savingsImpact: 0,
    };
  }
  
  // If we're comfortably above threshold, compress
  if (tokensAfter >= CACHE_THRESHOLD) {
    return {
      action: 'compress',
      reason: `${tokensAfter} tokens after compression — safely above ${CACHE_THRESHOLD} threshold`,
      recommendation: `Compress: ${tokensSaved} tokens saved, ${tokensAfter} remaining`,
      savingsImpact: tokensSaved,
    };
  }
  
  // If we're near the threshold but above minimum, leave padding
  if (tokensAfter >= NEAR_THRESHOLD && tokensAfter < CACHE_THRESHOLD) {
    // ~$0.0027 per request at sonnet-4 input rates with the 90% cache discount
    const potentialCacheSavings = CACHE_THRESHOLD * (getPricing('claude-sonnet-4').input / 1_000_000) * 0.9;
    return {
      action: 'leave_padding',
      reason: `${tokensAfter} tokens is within 200 of ${CACHE_THRESHOLD} threshold — leave padding for cache hit`,
      recommendation: `Skip compression: keep ${CACHE_THRESHOLD}+ tokens to maintain 90% cache discount`,
      savingsImpact: potentialCacheSavings,
      potentialCacheSavings,
    };
  }
  
  // If we're well below threshold, cache doesn't apply anyway — compress
  if (tokensAfter < NEAR_THRESHOLD) {
    return {
      action: 'compress',
      reason: `${tokensAfter} tokens is below cache threshold — cache won't apply anyway`,
      recommendation: `Compress: ${tokensAfter} tokens too small for cache benefit`,
      savingsImpact: tokensSaved,
    };
  }
  
  // Default: compress
  return {
    action: 'compress',
    reason: 'Default to compression',
    recommendation: `Compress: ${tokensSaved} tokens saved`,
    savingsImpact: tokensSaved,
  };
}

/**
 * Track mutable prompt detection
 * Dynamic timestamps, request IDs, changing memory snapshots break cache
 */
export function detectMutablePrompt(systemPrompt) {
  const mutablePatterns = [
    { pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, name: 'timestamp' },
    { pattern: /request[_-]?id[:\s]+\S+/i, name: 'request_id' },
    { pattern: /session[_-]?id[:\s]+\S+/i, name: 'session_id' },
    { pattern: /current[_-]?time[:\s]+\S+/i, name: 'current_time' },
    { pattern: /timestamp[:\s]+\S+/i, name: 'timestamp_field' },
    { pattern: /\buuid\b[:\s]+\S+/i, name: 'uuid' },
  ];
  
  const detected = [];
  for (const { pattern, name } of mutablePatterns) {
    if (pattern.test(systemPrompt)) {
      detected.push(name);
    }
  }
  
  if (detected.length > 0) {
    loadMonitor();
    monitor.invalidations.mutablePrompts++;
    addEvent('mutable_prompt', { detected });
    saveMonitor();
    
    return {
      mutable: true,
      detected,
      recommendation: 'Move mutable content AFTER the stable prefix. Keep identity + rules at top, dynamic state at bottom.',
    };
  }
  
  return { mutable: false, detected: [] };
}

/**
 * Track tool schema stability
 * Non-deterministic serialization breaks cache
 */
export function detectToolSchemaInstability(tools1, tools2) {
  if (!tools1 || !tools2) return { stable: true };
  
  const json1 = JSON.stringify(tools1);
  const json2 = JSON.stringify(tools2);
  
  if (json1 !== json2) {
    loadMonitor();
    monitor.invalidations.toolSchemaChanges++;
    addEvent('tool_schema_change', {
      diff: Math.abs(json1.length - json2.length),
    });
    saveMonitor();
    
    return {
      stable: false,
      recommendation: 'Sort tool definitions alphabetically by name. Serialize deterministically.',
    };
  }
  
  return { stable: true };
}

// ═══════════════════════════════════════════════════════════
// Monitoring & Alerts
// ═══════════════════════════════════════════════════════════

function checkAlerts() {
  loadMonitor();
  
  const alerts = [];
  
  // Low hit rate alert
  if (monitor.session.totalRequests >= 10 && parseFloat(monitor.session.hitRate) < monitor.alerts.hitRateBelow * 100) {
    alerts.push({
      type: 'low_hit_rate',
      message: `Cache hit rate ${monitor.session.hitRate}% is below ${(monitor.alerts.hitRateBelow * 100).toFixed(0)}% threshold`,
      level: 'warning',
    });
  }
  
  // Invalidation spike
  const recentInvalidations = monitor.recentEvents.filter(
    e => e.type.includes('invalidation') && Date.now() - e.time < 60000
  ).length;
  if (recentInvalidations > monitor.alerts.invalidationSpike) {
    alerts.push({
      type: 'invalidation_spike',
      message: `${recentInvalidations} invalidations in last minute (threshold: ${monitor.alerts.invalidationSpike})`,
      level: 'critical',
    });
  }
  
  return alerts;
}

/**
 * Get real-time cache status
 */
export function getCacheStatus() {
  loadMonitor();
  
  const sessionDuration = (Date.now() - monitor.session.startTime) / 1000;
  
  return {
    session: {
      duration: `${(sessionDuration / 60).toFixed(1)} min`,
      requests: monitor.session.totalRequests,
      hitRate: monitor.session.hitRate + '%',
      hits: monitor.session.cacheHits,
      misses: monitor.session.cacheMisses,
      writes: monitor.session.cacheWrites,
      savings: '$' + monitor.session.totalSavings.toFixed(4),
    },
    byProvider: Object.entries(monitor.byProvider)
      .filter(([_, v]) => v.requests > 0)
      .map(([name, v]) => ({
        name,
        requests: v.requests,
        hitRate: v.requests > 0 ? (v.hits / v.requests * 100).toFixed(1) + '%' : 'N/A',
        hits: v.hits,
        misses: v.misses,
        writes: v.writes,
        savings: '$' + v.savings.toFixed(4),
      })),
    invalidations: monitor.invalidations,
    alerts: checkAlerts(),
    recentEvents: monitor.recentEvents.slice(-10),
  };
}

/**
 * Get cache health report
 */
export function getCacheHealth() {
  loadMonitor();
  
  const hitRate = parseFloat(monitor.session.hitRate);
  const totalInvalidations = Object.values(monitor.invalidations).reduce((a, b) => a + b, 0);
  const requests = monitor.session.totalRequests || 0;

  if (requests === 0) {
    return {
      health: totalInvalidations > 0 ? 'warning' : 'healthy',
      score: totalInvalidations > 0 ? 80 : 100,
      hitRate: hitRate + '%',
      invalidations: totalInvalidations,
      recommendations: [
        'No session requests yet — collect a fresh cacheable window before grading hit rate',
        ...(monitor.invalidations.mutablePrompts > 0 ? ['Move mutable content after stable prefix'] : []),
        ...(monitor.invalidations.toolSchemaChanges > 0 ? ['Determinize tool schema serialization'] : []),
        ...(monitor.invalidations.compressionShifts > 0 ? ['Re-anchor cache_control after compression'] : []),
      ],
    };
  }
  
  let health = 'healthy';
  let score = 100;
  
  if (hitRate < 30) { health = 'critical'; score -= 40; }
  else if (hitRate < 50) { health = 'degraded'; score -= 20; }
  else if (hitRate < 70) { health = 'warning'; score -= 10; }
  
  if (totalInvalidations > 20) { health = 'degraded'; score -= 20; }
  if (monitor.invalidations.mutablePrompts > 5) { score -= 15; }
  if (monitor.invalidations.toolSchemaChanges > 5) { score -= 15; }
  
  return {
    health,
    score: Math.max(0, score),
    hitRate: hitRate + '%',
    invalidations: totalInvalidations,
    recommendations: [
      ...(monitor.invalidations.mutablePrompts > 0 ? ['Move mutable content after stable prefix'] : []),
      ...(monitor.invalidations.toolSchemaChanges > 0 ? ['Determinize tool schema serialization'] : []),
      ...(hitRate < 50 ? ['Check for context compression cache invalidation'] : []),
      ...(monitor.invalidations.compressionShifts > 0 ? ['Re-anchor cache_control after compression'] : []),
    ],
  };
}

/**
 * Reset session stats
 */
export function resetSession() {
  loadMonitor();
  monitor.session = {
    startTime: Date.now(),
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheWrites: 0,
    totalSavings: 0,
    hitRate: 0,
  };
  monitor.byProvider = {
    anthropic: { requests: 0, hits: 0, misses: 0, writes: 0, savings: 0 },
    openai: { requests: 0, hits: 0, misses: 0, writes: 0, savings: 0 },
    nous: { requests: 0, hits: 0, misses: 0, writes: 0, savings: 0 },
    xai: { requests: 0, hits: 0, misses: 0, writes: 0, savings: 0 },
  };
  monitor.invalidations = {
    compressionShifts: 0,
    mutablePrompts: 0,
    toolSchemaChanges: 0,
  };
  monitor.recentEvents = [];
  saveMonitor();
}

export default {
  recordCacheEvent,
  evaluateCompressVsCache,
  recordCacheWrite,
  recordCompressionShift,
  detectMutablePrompt,
  detectToolSchemaInstability,
  getCacheStatus,
  getCacheHealth,
  resetSession,
};
