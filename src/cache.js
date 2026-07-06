/**
 * TokenVault — Response Cache
 * 
 * Caches LLM responses to avoid redundant API calls.
 * Uses content hashing for deduplication.
 * Supports TTL-based expiration.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const CACHE_DIR = path.join(os.homedir(), '.hermes', 'tokenvault', 'cache');
const CACHE_INDEX = path.join(CACHE_DIR, 'index.json');

let cache = {};
let config = {
  enabled: true,
  maxEntries: 1000,
  ttlHours: 24,
  maxResponseChars: 50000,
};

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadCache() {
  ensureDir();
  try {
    if (fs.existsSync(CACHE_INDEX)) {
      cache = JSON.parse(fs.readFileSync(CACHE_INDEX, 'utf8'));
    }
  } catch { /* fresh */ }
  return cache;
}

function saveCache() {
  ensureDir();
  // Prune expired entries
  const now = Date.now();
  const ttlMs = config.ttlHours * 3600 * 1000;
  for (const [key, entry] of Object.entries(cache)) {
    if (now - entry.time > ttlMs) delete cache[key];
  }
  // Prune by count
  const entries = Object.entries(cache).sort((a, b) => b[1].time - a[1].time);
  if (entries.length > config.maxEntries) {
    cache = Object.fromEntries(entries.slice(0, config.maxEntries));
  }
  fs.writeFileSync(CACHE_INDEX, JSON.stringify(cache, null, 2));
}

/**
 * Generate cache key from prompt + model
 */
function cacheKey(prompt, model) {
  const hash = crypto.createHash('sha256')
    .update(`${model}::${prompt}`)
    .digest('hex')
    .substring(0, 16);
  return hash;
}

/**
 * Look up a cached response
 */
export function lookup(prompt, model) {
  if (!config.enabled) return null;
  
  loadCache();
  const key = cacheKey(prompt, model);
  const entry = cache[key];
  
  if (!entry) return null;
  
  // Check TTL
  const age = Date.now() - entry.time;
  if (age > config.ttlHours * 3600 * 1000) {
    delete cache[key];
    return null;
  }
  
  // Read cached response
  const responsePath = path.join(CACHE_DIR, `${key}.json`);
  try {
    const response = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
    entry.hits = (entry.hits || 0) + 1;
    entry.lastHit = Date.now();
    saveCache();
    return response;
  } catch {
    delete cache[key];
    return null;
  }
}

/**
 * Store a response in cache
 */
export function store(prompt, model, response, tokens = {}) {
  if (!config.enabled) return;
  if (!response || response.length > config.maxResponseChars) return;
  
  loadCache();
  const key = cacheKey(prompt, model);
  
  // Store response to file
  const responsePath = path.join(CACHE_DIR, `${key}.json`);
  fs.writeFileSync(responsePath, JSON.stringify({
    content: response,
    model,
    tokens,
    cachedAt: new Date().toISOString(),
  }));
  
  // Update index
  cache[key] = {
    model,
    time: Date.now(),
    hits: 0,
    promptPreview: prompt.substring(0, 100),
    responseSize: response.length,
  };
  
  saveCache();
}

/**
 * Get cache stats
 */
export function getStats() {
  loadCache();
  const entries = Object.values(cache);
  const totalHits = entries.reduce((s, e) => s + (e.hits || 0), 0);
  const totalSize = entries.reduce((s, e) => s + (e.responseSize || 0), 0);
  
  return {
    entries: entries.length,
    totalHits,
    totalSize,
    hitRate: entries.length > 0 ? (totalHits / entries.length).toFixed(2) : 0,
  };
}

/**
 * Clear cache
 */
export function clear() {
  cache = {};
  ensureDir();
  // Remove response files
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
  for (const f of files) {
    fs.unlinkSync(path.join(CACHE_DIR, f));
  }
  saveCache();
}

/**
 * Configure cache
 */
export function configure(opts) {
  Object.assign(config, opts);
}

export function getConfig() {
  return { ...config };
}

export default {
  lookup,
  store,
  getStats,
  clear,
  configure,
  getConfig,
};
