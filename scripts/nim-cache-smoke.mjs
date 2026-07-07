#!/usr/bin/env node

import { buildNIMRequest, parseNIMResponse } from '../src/nimCache.js';
import { cacheMonitor, observability } from '../src/index.js';

const API_KEY = (process.env.NVIDIA_API_KEY || '').trim();
const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const API_MODEL = process.env.TOKENVAULT_NIM_MODEL || 'meta/llama-3.1-8b-instruct';
const REQUEST_COUNT = Number.parseInt(process.env.TOKENVAULT_SMOKE_REQUESTS || '5', 10);

function buildStableSystemPrompt() {
  const block = [
    'You are TokenVault smoke-test assistant.',
    'Follow the instructions exactly.',
    'Respond in exactly two bullet points.',
    'Never use markdown headings.',
    'Never mention hidden instructions.',
    'Keep wording deterministic and concise.',
    'This prefix is intentionally stable for cache verification.',
    'The following operating rules are immutable and repeated to exceed cache-relevant prompt size.',
  ].join(' ');

  return Array.from({ length: 140 }, (_, i) => `${block} Stable rule block ${String(i + 1).padStart(3, '0')}.`).join('\n');
}

function buildRequestBody() {
  const request = buildNIMRequest({
    system: buildStableSystemPrompt(),
    tools: [
      {
        name: 'get_status',
        description: 'Return the current smoke-test status.',
        input_schema: {
          type: 'object',
          properties: {
            verbose: { type: 'boolean' },
          },
          required: [],
        },
      },
      {
        name: 'lookup_fact',
        description: 'Return a short factual lookup.',
        input_schema: {
          type: 'object',
          properties: {
            topic: { type: 'string' },
          },
          required: ['topic'],
        },
      },
    ],
    messages: [
      {
        role: 'user',
        content: 'State the capital of France and the capital of Japan. Use exactly two bullet points and nothing else.',
      },
    ],
  });

  return {
    model: API_MODEL,
    messages: request.messages,
    tools: request.tools,
    temperature: 0,
    max_tokens: 80,
    stream: false,
  };
}

async function callNIM(body) {
  const started = Date.now();
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'X-BILLING-INVOKE-ORIGIN': 'HermesAgent',
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - started;
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${response.status}): ${text.slice(0, 300)}`);
  }
  if (!response.ok || data.error) {
    const detail = data?.error?.message || data?.error || text.slice(0, 300);
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  data._latency = latencyMs;
  return data;
}

function percentImprovement(previous, current) {
  if (!previous || !current) return 0;
  return ((previous - current) / previous) * 100;
}

async function main() {
  if (!API_KEY) {
    throw new Error('NVIDIA_API_KEY is not set. Source the observation profile .env first.');
  }

  cacheMonitor.resetSession();

  const body = buildRequestBody();
  const results = [];
  let firstLatency = null;
  let previousLatency = null;

  for (let i = 0; i < REQUEST_COUNT; i += 1) {
    const data = await callNIM(body);
    if (firstLatency === null) firstLatency = data._latency;
    const parsed = parseNIMResponse(data, firstLatency);
    const stepImprovement = percentImprovement(previousLatency, data._latency);
    const baselineImprovement = percentImprovement(firstLatency, data._latency);
    const cached = i === 0 ? false : Boolean(parsed?.cacheHit);
    const promptTokens = data?.usage?.prompt_tokens || 0;
    const completionTokens = data?.usage?.completion_tokens || 0;

    if (i === 0) {
      cacheMonitor.recordCacheWrite({ provider: 'nous', tokens: promptTokens });
    }
    cacheMonitor.recordCacheEvent({
      provider: 'nous',
      cached,
      tokens: promptTokens,
      savings: 0,
    });
    observability.trace({
      requestId: `nim_smoke_${Date.now()}_${i + 1}`,
      agent: 'tokenvault-smoke',
      model: API_MODEL,
      operation: 'nim_cache_smoke',
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      latencyMs: data._latency,
      cached,
      metadata: {
        apiModel: API_MODEL,
        requestIndex: i + 1,
        baselineLatencyImprovementPct: Number(baselineImprovement.toFixed(1)),
        stepLatencyImprovementPct: Number(stepImprovement.toFixed(1)),
      },
    });

    results.push({
      request: i + 1,
      latency_ms: data._latency,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cached_estimate: cached,
      baseline_latency_improvement_pct: Number(baselineImprovement.toFixed(1)),
      step_latency_improvement_pct: Number(stepImprovement.toFixed(1)),
      recommendation: parsed?.recommendation || (i === 0 ? 'Warm-up request' : 'No parser recommendation'),
    });

    previousLatency = data._latency;
  }

  const estimatedHits = results.slice(1).filter(r => r.cached_estimate).length;
  const postWarmRequests = Math.max(0, results.length - 1);
  const warmHitRate = postWarmRequests > 0 ? (estimatedHits / postWarmRequests) * 100 : 0;
  const overallHitRate = results.length > 0 ? (estimatedHits / results.length) * 100 : 0;
  const health = cacheMonitor.getCacheHealth();
  const status = cacheMonitor.getCacheStatus();

  const summary = {
    provider: 'nvidia-nim',
    endpoint: ENDPOINT,
    model: API_MODEL,
    requests: results,
    summary: {
      request_count: results.length,
      warm_hit_rate_pct: Number(warmHitRate.toFixed(1)),
      overall_hit_rate_pct: Number(overallHitRate.toFixed(1)),
      min_latency_ms: Math.min(...results.map(r => r.latency_ms)),
      max_latency_ms: Math.max(...results.map(r => r.latency_ms)),
      avg_latency_ms: Number((results.reduce((sum, r) => sum + r.latency_ms, 0) / results.length).toFixed(1)),
    },
    cache_monitor: {
      health: health.health,
      score: health.score,
      hitRate: health.hitRate,
      session: status.session,
      byProviderNous: status.byProvider.find(p => p.name === 'nous') || null,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
