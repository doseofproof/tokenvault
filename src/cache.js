/**
 * TokenVault — Response Cache
 * 
 * Caches LLM responses to avoid redundant API calls.
 * Uses content hashing for deduplication.
 * Supports TTL-based expiration.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from './paths.js';

const CACHE_DIR = path.join(DATA_DIR, 'cache');
const CACHE_INDEX = path.join(CACHE_DIR, 'index.json');

let cache = {};
let config = {
  enabled: true,
  maxEntries: 1000,
  ttlHours: 24,
  maxResponseChars: 50000,
};

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
}

function safeUnlinkResponse(key) {
  try { fs.unlinkSync(path.join(CACHE_DIR, `${key}.json`)); } catch { /* already gone */ }
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
  // Prune expired entries (and their response files)
  const now = Date.now();
  const ttlMs = config.ttlHours * 3600 * 1000;
  for (const [key, entry] of Object.entries(cache)) {
    if (now - entry.time > ttlMs) {
      delete cache[key];
      safeUnlinkResponse(key);
    }
  }
  // Prune by count (and unlink evicted response files)
  const entries = Object.entries(cache).sort((a, b) => b[1].time - a[1].time);
  if (entries.length > config.maxEntries) {
    for (const [key] of entries.slice(config.maxEntries)) safeUnlinkResponse(key);
    cache = Object.fromEntries(entries.slice(0, config.maxEntries));
  }
  fs.writeFileSync(CACHE_INDEX, JSON.stringify(cache, null, 2), { mode: 0o600 });
}

/**
 * Digest of the request context (system prompt, tool config, agent).
 * Two requests only share cache entries when this digest matches —
 * a response generated under one system prompt / tool set / agent
 * must never be served to another.
 */
function contextDigest(context = {}) {
  const canonical = JSON.stringify({
    system: context.system ?? null,
    tools: context.tools ?? null,
    agent: context.agent ?? null,
  });
  return crypto.createHash('sha256')
    .update(canonical)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Generate cache key from prompt + model + context digest
 */
function cacheKey(prompt, model, ctxDigest) {
  const hash = crypto.createHash('sha256')
    .update(`${model}::${ctxDigest}::${prompt}`)
    .digest('hex')
    .substring(0, 16);
  return hash;
}

/**
 * Generate keyword fingerprint for semantic matching
 * Extracts meaningful words, removes stopwords, normalizes
 */
function fingerprint(prompt) {
  const stopwords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about', 'against', 'up', 'down', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'myself', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'what', 'which', 'who', 'whom']);
  
  return prompt.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w))
    .sort()
    .join(' ');
}

/**
 * Jaccard similarity between two sets
 */
function jaccard(a, b) {
  const setA = new Set(a.split(' '));
  const setB = new Set(b.split(' '));
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Semantic fallback threshold. 0.98 (near-identical keyword sets) — the old
// 0.85 served materially different prompts' responses. Candidates must also
// share the exact context digest; see contextDigest().
const SEMANTIC_MATCH_THRESHOLD = 0.98;

/**
 * Look up a cached response (exact match first, then semantic similarity).
 * `context` = { system, tools, agent } — entries are isolated per context.
 */
export function lookup(prompt, model, context = {}) {
  if (!config.enabled) return null;

  loadCache();

  // Step 1: Exact match
  const ctxDigest = contextDigest(context);
  const key = cacheKey(prompt, model, ctxDigest);
  const entry = cache[key];
  
  if (entry) {
    // Check TTL
    const age = Date.now() - entry.time;
    if (age > config.ttlHours * 3600 * 1000) {
      delete cache[key];
    } else {
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
      }
    }
  }
  
  // Step 2: Semantic similarity (Jaccard on keyword fingerprints)
  const queryFp = fingerprint(prompt);
  let bestMatch = null;
  let bestScore = 0;
  
  for (const [k, e] of Object.entries(cache)) {
    if (e.model !== model) continue; // Same model only
    if (e.contextKey !== ctxDigest) continue; // Same system/tools/agent context only

    const age = Date.now() - e.time;
    if (age > config.ttlHours * 3600 * 1000) continue;

    const entryFp = e.fingerprint || '';
    if (!entryFp) continue;

    const score = jaccard(queryFp, entryFp);
    if (score > bestScore && score >= SEMANTIC_MATCH_THRESHOLD) {
      bestScore = score;
      bestMatch = k;
    }
  }
  
  if (bestMatch) {
    const responsePath = path.join(CACHE_DIR, `${bestMatch}.json`);
    try {
      const response = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
      cache[bestMatch].hits = (cache[bestMatch].hits || 0) + 1;
      cache[bestMatch].lastHit = Date.now();
      saveCache();
      return response;
    } catch {
      delete cache[bestMatch];
    }
  }
  
  return null;
}

/**
 * Store a response in cache
 */
export function store(prompt, model, response, tokens = {}, context = {}) {
  if (!config.enabled) return;
  if (!response || response.length > config.maxResponseChars) return;

  loadCache();
  const ctxDigest = contextDigest(context);
  const key = cacheKey(prompt, model, ctxDigest);
  
  // Store response to file
  const responsePath = path.join(CACHE_DIR, `${key}.json`);
  fs.writeFileSync(responsePath, JSON.stringify({
    content: response,
    model,
    tokens,
    cachedAt: new Date().toISOString(),
  }), { mode: 0o600 });
  
  // Update index
  cache[key] = {
    model,
    contextKey: ctxDigest, // Isolates entries per system/tools/agent context
    time: Date.now(),
    hits: 0,
    promptPreview: prompt.substring(0, 100),
    responseSize: response.length,
    fingerprint: fingerprint(prompt), // For semantic matching
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
