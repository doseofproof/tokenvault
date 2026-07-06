/**
 * TokenVault Prompt Cache Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import promptCache, {
  buildAnthropicMessages,
  buildOpenAIMessages,
  parseCacheUsage,
  estimateCacheSavings,
  getRecommendations,
} from '../src/promptCache.js';
const { PROVIDER_CONFIGS } = promptCache;

describe('Prompt Cache — Anthropic', () => {
  it('uses block-level cache_control, never top-level (audit Bug 3 regression)', () => {
    const result = buildAnthropicMessages({
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 'tool1', description: 'First tool' }],
    });
    // Top-level cache_control is NOT part of the Anthropic Messages API.
    assert.equal(result.cache_control, undefined);
    // System becomes a block array; last block carries the marker.
    assert.ok(Array.isArray(result.system));
    const lastSystem = result.system[result.system.length - 1];
    assert.equal(lastSystem.cache_control.type, 'ephemeral');
    assert.equal(lastSystem.text, 'You are a helpful assistant.');
    assert.equal(result.messages.length, 1);
    assert.equal(result.tools.length, 1);
  });

  it('sorts tools alphabetically (CLAUDE.md A6 regression)', () => {
    const result = buildAnthropicMessages({
      system: 'You are helpful.',
      messages: [],
      tools: [
        { name: 'zeta_tool', description: 'Z' },
        { name: 'alpha_tool', description: 'A' },
      ],
    });
    assert.equal(result.tools[0].name, 'alpha_tool');
    assert.equal(result.tools[1].name, 'zeta_tool');
  });

  it('includes cache markers', () => {
    const result = buildAnthropicMessages({
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'hello' }],
    });
    assert.ok(result.cacheMarkers.length > 0);
    assert.ok(result.cacheMarkers.find(m => m.type === 'block'));
  });
});

describe('Prompt Cache — OpenAI', () => {
  it('builds messages correctly', () => {
    const result = buildOpenAIMessages({
      system: 'You are helpful.',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
    });
    assert.equal(result.messages.length, 3); // system + 2 messages
    assert.equal(result.messages[0].role, 'system');
    assert.ok(result.cacheOptimized);
  });

  it('includes tools', () => {
    const result = buildOpenAIMessages({
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 'tool1', description: 'First tool' }],
    });
    assert.ok(result.tools);
    assert.equal(result.tools.length, 1);
  });
});

describe('Prompt Cache — Usage Parsing', () => {
  it('parses Anthropic cache usage', () => {
    const response = {
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 800,
        cache_read_input_tokens: 200,
      },
    };
    const result = parseCacheUsage(response, 'anthropic');
    assert.equal(result.inputTokens, 1000);
    assert.equal(result.cacheCreation, 800);
    assert.equal(result.cacheRead, 200);
    assert.ok(result.cacheHit);
    assert.ok(result.savings > 0);
    // 1000x-overstatement regression (audit 2026-07-06 §3.3): savings for
    // 200 cached tokens at $3/M with 90% discount = 200 * 0.9 * 3/1e6 = $0.00054.
    // Savings can never exceed the full input cost of the cached tokens.
    assert.ok(result.savings < 200 * (3.00 / 1_000_000),
      `savings $${result.savings} exceeds full cost of cached tokens — unit bug`);
    assert.ok(Math.abs(result.savings - 0.00054) < 1e-9);
  });

  it('parses OpenAI cache usage', () => {
    const response = {
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 500,
        prompt_tokens_details: {
          cached_tokens: 600,
        },
      },
    };
    const result = parseCacheUsage(response, 'openai');
    assert.equal(result.inputTokens, 1000);
    assert.equal(result.cacheRead, 600);
    assert.ok(result.cacheHit);
    assert.ok(result.savings > 0);
  });

  it('handles missing usage', () => {
    const result = parseCacheUsage({}, 'anthropic');
    assert.equal(result, null);
  });
});

describe('Prompt Cache — Savings Estimation', () => {
  it('estimates Anthropic savings', () => {
    const result = estimateCacheSavings({
      provider: 'anthropic',
      inputTokens: 5000,
      messagesPerDay: 100,
    });
    assert.ok(result.cacheable);
    assert.ok(result.dailySavings > 0);
    assert.ok(result.monthlySavings > 0);
    assert.ok(parseFloat(result.savingsPercent) > 0);
  });

  it('estimates OpenAI savings', () => {
    const result = estimateCacheSavings({
      provider: 'openai',
      inputTokens: 5000,
      messagesPerDay: 100,
    });
    assert.ok(result.cacheable);
    assert.ok(result.dailySavings > 0);
  });

  it('rejects small contexts', () => {
    const result = estimateCacheSavings({
      provider: 'anthropic',
      inputTokens: 100, // Too small
      messagesPerDay: 100,
    });
    assert.ok(!result.cacheable);
    assert.ok(result.reason);
  });
});

describe('Prompt Cache — Recommendations', () => {
  it('returns recommendations for Anthropic', () => {
    const recs = getRecommendations('anthropic', { totalTokens: 5000, hasTools: true });
    assert.ok(recs.length > 0);
    assert.ok(recs.some(r => r.message.includes('cache_control')));
  });

  it('returns recommendations for OpenAI', () => {
    const recs = getRecommendations('openai', { totalTokens: 5000 });
    assert.ok(recs.length > 0);
    assert.ok(recs.some(r => r.message.includes('automatic')));
  });

  it('warns for unknown provider', () => {
    const recs = getRecommendations('unknown', {});
    assert.equal(recs.length, 1);
    assert.equal(recs[0].type, 'warning');
  });
});

describe('Prompt Cache — Provider Configs', () => {
  it('has configs for all providers', () => {
    assert.ok(PROVIDER_CONFIGS.anthropic);
    assert.ok(PROVIDER_CONFIGS.openai);
    assert.ok(PROVIDER_CONFIGS.nous);
    assert.ok(PROVIDER_CONFIGS.xai);
  });

  it('Anthropic config has correct values', () => {
    const config = PROVIDER_CONFIGS.anthropic;
    assert.equal(config.readDiscount, 0.90);
    assert.ok(config.supportsCacheControl);
  });

  it('OpenAI config has correct values', () => {
    const config = PROVIDER_CONFIGS.openai;
    assert.equal(config.readDiscount, 0.50);
    assert.ok(config.automatic);
  });
});
