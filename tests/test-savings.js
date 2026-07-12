/**
 * Savings accounting and kill-switch tests.
 *
 * Uses its own isolated data dir (set before importing src modules, which
 * capture DATA_DIR at import time).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenvault-test-'));
process.env.TOKENVAULT_DATA_DIR = dataDir;

const { optimize, record } = await import('../src/index.js');
const tracker = (await import('../src/tracker.js')).default;

const CONFIG_FILE = path.join(dataDir, 'config.json');

describe('Savings accounting on cache hits', () => {
  it('records real avoided cost, and totals.saved increments', () => {
    const prompt = 'summarize the architecture of the billing subsystem in detail';
    const model = 'claude-sonnet-4';

    record({
      model,
      inputTokens: 1200,
      outputTokens: 800,
      operation: 'llm_call',
      response: 'The billing subsystem has three layers...',
      prompt,
    });

    const savedBefore = tracker.getTotals().saved || 0;
    const result = optimize({ prompt, currentModel: model });

    assert.equal(result.cached, true);
    const expected = tracker.estimateCost(model, 1200, 800);
    assert.equal(result.savings, expected);
    assert.ok(result.savings > 0, 'cache hit must report non-zero savings');

    const savedAfter = tracker.getTotals().saved || 0;
    assert.ok(savedAfter > savedBefore,
      `totals.saved must increment on cache hit (${savedBefore} -> ${savedAfter})`);
  });
});

describe('Kill switch (tokenvault off)', () => {
  before(() => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ enabled: false }));
  });
  after(() => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ enabled: true }));
  });

  it('optimize() passes through untouched when disabled', () => {
    const result = optimize({
      prompt: 'architect a distributed system for real-time analytics',
      currentModel: 'claude-opus-4',
    });
    assert.equal(result.disabled, true);
    assert.equal(result.model, 'claude-opus-4', 'no rerouting when disabled');
    assert.equal(result.cached, false);
    assert.equal(result.savings, 0);
  });

  it('record() is a no-op when disabled', () => {
    const before_ = JSON.stringify(tracker.getTotals());
    record({
      model: 'claude-sonnet-4',
      inputTokens: 5000,
      outputTokens: 5000,
      operation: 'llm_call',
      response: 'should not be recorded',
      prompt: 'should not be cached either',
    });
    assert.equal(JSON.stringify(tracker.getTotals()), before_,
      'totals must not change while disabled');
  });
});
