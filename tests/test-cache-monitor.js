/**
 * Cache Monitor Tests — compress-vs-cache micro-heuristic
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateCompressVsCache, recordCompressionShift, getCacheStatus, getCacheHealth } from '../src/cacheMonitor.js';

describe('Compress-vs-Cache Heuristic', () => {
  it('compresses when safely above threshold', () => {
    const result = evaluateCompressVsCache({ tokensAfter: 2000, tokensSaved: 500 });
    assert.equal(result.action, 'compress');
    assert.ok(result.reason.includes('2000'));
  });

  it('leaves padding when near threshold', () => {
    const result = evaluateCompressVsCache({ tokensAfter: 900, tokensSaved: 200 });
    assert.equal(result.action, 'leave_padding');
    assert.ok(result.reason.includes('900'));
    assert.ok(result.potentialCacheSavings > 0);
  });

  it('compresses when well below threshold', () => {
    const result = evaluateCompressVsCache({ tokensAfter: 500, tokensSaved: 300 });
    assert.equal(result.action, 'compress');
    assert.ok(result.reason.includes('500'));
  });

  it('skips compression when savings are minimal', () => {
    const result = evaluateCompressVsCache({ tokensAfter: 1500, tokensSaved: 50 });
    assert.equal(result.action, 'skip_compression');
    assert.ok(result.reason.includes('50'));
  });

  it('compresses when exactly at threshold', () => {
    const result = evaluateCompressVsCache({ tokensAfter: 1024, tokensSaved: 300 });
    assert.equal(result.action, 'compress');
  });

  it('leaves padding at 1000 tokens', () => {
    const result = evaluateCompressVsCache({ tokensAfter: 1000, tokensSaved: 300 });
    assert.equal(result.action, 'leave_padding');
  });
});

describe('Compression Shift Tracking', () => {
  it('returns decision on compression shift', () => {
    const result = recordCompressionShift({
      messagesBefore: 20,
      messagesAfter: 10,
      tokensSaved: 500,
      tokensAfter: 1500,
    });
    assert.ok(result.decision);
    assert.ok(result.recommendation);
  });

  it('tracks invalidation count', () => {
    const status1 = getCacheStatus();
    const count1 = status1.invalidations.compressionShifts;
    
    recordCompressionShift({
      messagesBefore: 15,
      messagesAfter: 8,
      tokensSaved: 400,
      tokensAfter: 1200,
    });
    
    const status2 = getCacheStatus();
    assert.ok(status2.invalidations.compressionShifts > count1);
  });
});

describe('Cache Health', () => {
  it('returns health report', () => {
    const health = getCacheHealth();
    assert.ok(health.health);
    assert.ok(typeof health.score === 'number');
    assert.ok(Array.isArray(health.recommendations));
  });
});
