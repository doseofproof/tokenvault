/**
 * OpenAI Cache Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildOpenAIMessages,
  parseOpenAICacheUsage,
  evaluateOpenAICompressVsCache,
  validatePrefixStability,
} from '../src/openaiCache.js';

describe('OpenAI Cache — Build Messages', () => {
  it('enforces strict prefix ordering', () => {
    const result = buildOpenAIMessages({
      system: 'You are helpful.',
      tools: [{ name: 'z_tool', description: 'Z' }, { name: 'a_tool', description: 'A' }],
      messages: [{ role: 'user', content: 'hello' }],
    });
    assert.equal(result.messages[0].role, 'system');
    assert.equal(result.tools[0].function.name, 'a_tool');
    assert.equal(result.tools[1].function.name, 'z_tool');
    assert.equal(result.messages[1].role, 'user');
  });

  it('marks cacheable when >1024 tokens', () => {
    const result = buildOpenAIMessages({ system: 'word '.repeat(5000) });
    assert.ok(result._cacheable);
    assert.ok(result._estimatedTokens > 1024);
  });

  it('marks not cacheable when <1024 tokens', () => {
    const result = buildOpenAIMessages({ system: 'short' });
    assert.ok(!result._cacheable);
  });
});

describe('OpenAI Cache — Parse Usage', () => {
  it('parses cache hit', () => {
    const result = parseOpenAICacheUsage({
      usage: { prompt_tokens: 1500, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 1200 } },
    });
    assert.equal(result.cachedTokens, 1200);
    assert.ok(result.cacheHit);
    assert.ok(result.savings > 0);
  });

  it('parses cache miss', () => {
    const result = parseOpenAICacheUsage({
      usage: { prompt_tokens: 1500, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 0 } },
    });
    assert.equal(result.cachedTokens, 0);
    assert.ok(!result.cacheHit);
  });
});

describe('OpenAI Cache — Heuristic', () => {
  it('compresses when below threshold', () => {
    const r = evaluateOpenAICompressVsCache({ tokensAfter: 500, tokensSaved: 200, totalTokens: 1000 });
    assert.equal(r.action, 'compress');
  });

  it('caches when compression <50% (cache cheaper)', () => {
    const r = evaluateOpenAICompressVsCache({ tokensAfter: 1500, tokensSaved: 200, totalTokens: 1700 });
    assert.equal(r.action, 'cache');
  });

  it('compresses when compression >50% (beats cache)', () => {
    const r = evaluateOpenAICompressVsCache({ tokensAfter: 800, tokensSaved: 1200, totalTokens: 2000 });
    assert.equal(r.action, 'compress');
  });
});

describe('OpenAI Cache — Prefix Stability', () => {
  it('detects stable prefix', () => {
    assert.ok(validatePrefixStability('hello', 'hello').stable);
  });

  it('detects first request', () => {
    assert.ok(validatePrefixStability(null, 'hello').firstRequest);
  });

  it('detects divergence', () => {
    const r = validatePrefixStability('hello world', 'hello earth');
    assert.ok(!r.stable);
    assert.equal(r.divergencePoint, 6);
  });
});
