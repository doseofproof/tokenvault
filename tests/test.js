/**
 * TokenVault Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { router, compressor, cache, tracker, budget } from '../src/index.js';

describe('Router', () => {
  it('classifies simple tasks', () => {
    assert.equal(router.classifyTask('hello'), 'simple');
    assert.equal(router.classifyTask('what is 2+2'), 'simple');
    assert.equal(router.classifyTask('git status'), 'simple');
    assert.equal(router.classifyTask('format this json'), 'simple');
  });

  it('classifies medium tasks', () => {
    assert.equal(router.classifyTask('review this code for bugs'), 'medium');
    assert.equal(router.classifyTask('debug the error in main.js'), 'medium');
    assert.equal(router.classifyTask('explain how this function works'), 'medium');
    assert.equal(router.classifyTask('write tests for the API'), 'medium');
  });

  it('classifies hard tasks', () => {
    assert.equal(router.classifyTask('design a distributed system architecture'), 'hard');
    assert.equal(router.classifyTask('security audit of the codebase'), 'hard');
    assert.equal(router.classifyTask('compare trade-offs between approaches'), 'hard');
  });

  it('selects cheap model for simple tasks', () => {
    const model = router.selectModel('hello', 'claude-sonnet-4');
    assert.ok(['deepseek-v4-flash', 'gemini-1.5-flash'].includes(model));
  });

  it('selects premium model for hard tasks', () => {
    const model = router.selectModel('design a distributed system architecture', 'deepseek-v4-flash');
    assert.ok(['claude-sonnet-4', 'claude-opus-4', 'gpt-4o'].includes(model));
  });

  it('keeps current model if in right tier', () => {
    const model = router.selectModel('hello', 'deepseek-v4-flash');
    assert.equal(model, 'deepseek-v4-flash');
  });

  it('estimates savings correctly', () => {
    const savings = router.estimateSavings('hello', 'claude-sonnet-4');
    assert.ok(savings.savings > 0, 'should have positive savings');
    assert.ok(savings.percentage > 50, 'should save > 50%');
  });
});

describe('Compressor', () => {
  it('truncates long tool output', () => {
    const longOutput = 'x'.repeat(5000);
    const result = compressor.compressToolOutput(longOutput, 'test');
    assert.ok(result.length < longOutput.length);
    assert.ok(result.includes('truncated'));
  });

  it('does not truncate short output', () => {
    const shortOutput = 'hello world';
    const result = compressor.compressToolOutput(shortOutput, 'test');
    assert.equal(result, shortOutput);
  });

  it('deduplicates similar messages', () => {
    const messages = [
      { role: 'user', content: 'hello world how are you today' },
      { role: 'user', content: 'hello world how are you today' },
      { role: 'user', content: 'completely different message about something else entirely' },
    ];
    const result = compressor.dedupMessages(messages);
    assert.ok(result.messages.length <= messages.length);
  });

  it('compresses context', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: 'user',
      content: 'Message ' + i + ' with content about topic ' + (i % 3),
    }));
    const result = compressor.compressContext(messages);
    assert.ok(result.messages.length <= messages.length);
    assert.ok(result.stats.compressionRatio >= 0);
  });
});

describe('Cache', () => {
  it('stores and retrieves responses', () => {
    cache.configure({ enabled: true });
    cache.store('test prompt 123', 'claude-sonnet-4', 'test response 123');
    const hit = cache.lookup('test prompt 123', 'claude-sonnet-4');
    assert.ok(hit);
    assert.equal(hit.content, 'test response 123');
  });

  it('returns null for cache miss', () => {
    const hit = cache.lookup('nonexistent prompt xyz', 'claude-sonnet-4');
    assert.equal(hit, null);
  });

  it('returns stats', () => {
    const stats = cache.getStats();
    assert.ok(typeof stats.entries === 'number');
    assert.ok(typeof stats.totalHits === 'number');
  });
});

describe('Tracker', () => {
  it('starts a session', () => {
    const id = tracker.startSession('test_session_1');
    assert.equal(id, 'test_session_1');
  });

  it('records usage', () => {
    const result = tracker.recordUsage({
      model: 'claude-sonnet-4',
      inputTokens: 1000,
      outputTokens: 500,
      operation: 'test',
    });
    assert.ok(typeof result.cost === 'number');
    assert.ok(result.cost >= 0);
  });

  it('gets session stats', () => {
    const stats = tracker.getSessionStats();
    assert.ok(stats);
    assert.ok(stats.totalInput >= 0);
  });

  it('gets totals', () => {
    const totals = tracker.getTotals();
    assert.ok(typeof totals.input === 'number');
    assert.ok(typeof totals.output === 'number');
    assert.ok(typeof totals.cost === 'number');
  });
});

describe('Budget', () => {
  it('sets and gets budget', () => {
    budget.setBudget({ daily: 5.00, alertThreshold: 0.8 });
    const b = budget.getBudget();
    assert.equal(b.daily, 5.00);
    assert.equal(b.alertThreshold, 0.8);
  });

  it('checks budget status', () => {
    const status = budget.getStatus();
    assert.ok(status);
    assert.ok(Array.isArray(status.alerts));
  });
});
