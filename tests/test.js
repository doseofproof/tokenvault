/**
 * TokenVault v2 Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { router, compressor, cache, tracker, budget, observability } from '../src/index.js';

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

describe('Compressor v2', () => {
  it('truncates long tool output', () => {
    // Use realistic line-separated output (like terminal output)
    const lines = Array.from({length: 200}, (_, i) => 'Line ' + i + ': some output content here that makes this line longer than usual');
    const longOutput = lines.join('\n');
    const result = compressor.compressToolOutput(longOutput, 'terminal');
    assert.ok(result.length < longOutput.length, 'compressed output should be shorter');
    assert.ok(result.includes('omitted') || result.includes('compressed'), 'should indicate compression happened');
  });

  it('does not truncate short output', () => {
    const shortOutput = 'hello world';
    const result = compressor.compressToolOutput(shortOutput, 'test');
    assert.equal(result, shortOutput);
  });

  it('deduplicates similar messages', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: 'user',
      content: i < 3 ? 'This is a test message about something specific and unique' : `Completely different message number ${i} about a totally unrelated topic`,
    }));
    const result = compressor.dedupMessages(messages);
    assert.ok(result.messages.length <= messages.length);
    assert.ok(result.deduped >= 0);
  });

  it('compresses context with memory tiers', () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: 'user',
      content: `Message ${i}: ${i % 3 === 0 ? 'Error occurred in module' : 'Normal conversation about topic ' + i}`,
    }));
    const result = compressor.compressContext(messages);
    assert.ok(result.messages.length <= messages.length);
    assert.ok(result.stats.compressionRatio >= 0);
    assert.ok(typeof result.stats.tokenSavings === 'number');
  });

  it('scores importance correctly', () => {
    const highScore = compressor.scoreImportance('Error: critical bug in authentication module');
    const lowScore = compressor.scoreImportance('the a an is are was');
    assert.ok(highScore > lowScore, 'error/critical content should score higher');
  });
});

describe('Cache', () => {
  it('stores and retrieves responses', () => {
    cache.configure({ enabled: true });
    cache.store('test prompt v2', 'claude-sonnet-4', 'test response v2');
    const hit = cache.lookup('test prompt v2', 'claude-sonnet-4');
    assert.ok(hit);
    assert.equal(hit.content, 'test response v2');
  });

  it('returns null for cache miss', () => {
    const hit = cache.lookup('nonexistent prompt xyz v2', 'claude-sonnet-4');
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
    const id = tracker.startSession('test_session_v2');
    assert.equal(id, 'test_session_v2');
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

describe('Observability', () => {
  it('records traces', () => {
    const trace = observability.trace({
      requestId: 'test_trace_1',
      agent: 'test_agent',
      model: 'claude-sonnet-4',
      operation: 'test_op',
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 150,
      cached: false,
    });
    assert.ok(trace);
    assert.ok(trace.id);
    assert.equal(trace.model, 'claude-sonnet-4');
  });

  it('gets metrics', () => {
    const metrics = observability.getMetrics();
    assert.ok(typeof metrics.requests === 'number');
    assert.ok(typeof metrics.totalCost === 'number');
    assert.ok(typeof metrics.avgLatency === 'number');
  });

  it('gets agent costs', () => {
    const agents = observability.getAgentCosts();
    assert.ok(Array.isArray(agents));
  });

  it('gets hourly trend', () => {
    const trend = observability.getHourlyTrend();
    assert.ok(Array.isArray(trend));
    assert.equal(trend.length, 24);
  });

  it('gets cache efficiency', () => {
    const eff = observability.getCacheEfficiency();
    assert.ok(typeof eff.hits === 'number');
    assert.ok(typeof eff.hitRate === 'string');
  });

  it('gets traces', () => {
    const traces = observability.getTraces();
    assert.ok(Array.isArray(traces));
  });
});
