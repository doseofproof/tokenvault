/**
 * NIM Cache Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildNIMRequest,
  parseNIMResponse,
  evaluateNIMCompressVsCache,
} from '../src/nimCache.js';

describe('NIM Cache — Build Request', () => {
  it('uses OpenAI format with system in messages', () => {
    const result = buildNIMRequest({
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'hello' }],
    });
    assert.equal(result.messages[0].role, 'system');
    assert.equal(result.messages[0].content, 'You are helpful.');
    assert.equal(result.messages[1].role, 'user');
  });

  it('sorts tools alphabetically', () => {
    const result = buildNIMRequest({
      system: 'You are helpful.',
      tools: [{ name: 'z_tool', description: 'Z' }, { name: 'a_tool', description: 'A' }],
      messages: [{ role: 'user', content: 'hello' }],
    });
    assert.equal(result.tools[0].function.name, 'a_tool');
    assert.equal(result.tools[1].function.name, 'z_tool');
  });

  it('marks cache strategy as automatic', () => {
    const result = buildNIMRequest({ system: 'test' });
    assert.equal(result._cacheStrategy, 'automatic');
  });
});

describe('NIM Cache — Parse Response', () => {
  it('estimates cache hit from latency improvement', () => {
    const result = parseNIMResponse({ usage: { prompt_tokens: 1000 } }, 1000);
    // 1000ms previous, no current latency → can't determine
    assert.ok(result);
  });

  it('detects cache hit from >15% latency improvement', () => {
    const result = parseNIMResponse({ usage: { prompt_tokens: 1000 }, _latency: 500 }, 1000);
    assert.ok(result.cacheHit);
  });

  it('detects cache miss from <15% latency improvement', () => {
    const result = parseNIMResponse({ usage: { prompt_tokens: 1000 }, _latency: 900 }, 1000);
    assert.ok(!result.cacheHit);
  });
});

describe('NIM Cache — Heuristic', () => {
  it('caches when within context window', () => {
    const result = evaluateNIMCompressVsCache({ tokensAfter: 5000, tokensSaved: 1000 });
    assert.equal(result.action, 'cache');
  });

  it('compresses when near context limit', () => {
    const result = evaluateNIMCompressVsCache({ tokensAfter: 120000, tokensSaved: 5000, contextWindow: 131072 });
    assert.equal(result.action, 'compress');
  });
});
