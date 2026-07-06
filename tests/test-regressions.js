/**
 * TokenVault Regression Tests — 2026-07-06
 *
 * Covers the fixes from The-Brain/reports/architecture-audit-2026-07-06.md
 * that shipped without tests (CLAUDE.md A1 back-fill):
 *   1. reorderEnabled must default to false (prefix stability, A5/A6)
 *   2. Pricing must come only from src/pricing.js (A8)
 *   3. optimize() must call the enforcement functions (A3/A5/A6/A7)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compressor, cacheMonitor } from '../src/index.js';
import { optimize } from '../src/index.js';
import { MODEL_PRICING, calculateCost } from '../src/pricing.js';
import tracker from '../src/tracker.js';

const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('Regression: reorderEnabled default (audit Bug 1)', () => {
  it('reorderEnabled is false by default', () => {
    assert.equal(compressor.getConfig().reorderEnabled, false,
      'reorderEnabled=true breaks OpenAI/NIM byte-exact prefix caching (openaiCache.js: history is NEVER reordered)');
  });

  it('compressContext preserves relative message order when compressing', () => {
    // 30 ordered messages; whatever is kept must appear in original order.
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `SEQ-${String(i).padStart(3, '0')} unique message body number ${i} with enough words to survive`,
    }));
    const { messages: out } = compressor.compressContext(messages);
    const seqs = out
      .map(m => (typeof m.content === 'string' ? m.content.match(/SEQ-(\d{3})/) : null))
      .filter(Boolean)
      .map(m => parseInt(m[1], 10));
    const sorted = [...seqs].sort((a, b) => a - b);
    assert.deepEqual(seqs, sorted, `kept messages out of order: ${seqs.join(',')}`);
  });
});

describe('Regression: pricing single source (audit Bug 2)', () => {
  it('no pricing literals exist outside pricing.js', () => {
    const offenders = [];
    for (const file of fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'))) {
      if (file === 'pricing.js') continue;
      const text = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
      // A pricing literal looks like: 'model-name': { input: N, output: N }
      if (/['"][\w./-]+['"]\s*:\s*\{\s*input:\s*[\d.]+\s*,\s*output:\s*[\d.]+/.test(text)) {
        offenders.push(file);
      }
    }
    assert.deepEqual(offenders, [],
      `pricing literals found outside pricing.js: ${offenders.join(', ')} — CLAUDE.md A8`);
  });

  it('tracker uses pricing.js values', () => {
    const cost = tracker.estimateCost('deepseek-v4-flash', 1_000_000, 1_000_000);
    const expected = calculateCost('deepseek-v4-flash', 1_000_000, 1_000_000);
    assert.equal(cost, expected);
    // FP-safe: 0.07 + 0.28 !== 0.35 exactly in IEEE754
    const manual = MODEL_PRICING['deepseek-v4-flash'].input + MODEL_PRICING['deepseek-v4-flash'].output;
    assert.ok(Math.abs(expected - manual) < 1e-12, `${expected} vs ${manual}`);
  });

  it('unknown model falls back to claude-sonnet-4 rates (documented defect A8)', () => {
    // This behavior is intentional-but-dangerous; the test pins it so any
    // change is deliberate. An unpriced model bills at sonnet-4 rates.
    assert.equal(
      calculateCost('model-that-does-not-exist', 1000, 1000),
      calculateCost('claude-sonnet-4', 1000, 1000)
    );
  });
});

describe('Regression: optimize() enforcement wiring (audit roadmap #2)', () => {
  it('detects mutable prompt content via detectMutablePrompt (A5)', () => {
    const res = optimize({
      prompt: 'summarize the quarterly report in one paragraph please',
      currentModel: 'claude-haiku',
      system: 'You are an agent. session_id: abc-123. current_time: 2026-07-06T16:00:00',
      agent: 'test-regressions',
    });
    assert.ok(res.enforcement.mutablePrompt, 'enforcement.mutablePrompt missing');
    assert.equal(res.enforcement.mutablePrompt.mutable, true);
    assert.ok(res.enforcement.mutablePrompt.detected.includes('session_id'));
  });

  it('passes clean static prompts (A5)', () => {
    const res = optimize({
      prompt: 'summarize the quarterly report in one paragraph please',
      currentModel: 'claude-haiku',
      system: 'You are a helpful assistant. Identity and rules only, fully static.',
      agent: 'test-regressions',
    });
    assert.equal(res.enforcement.mutablePrompt.mutable, false);
  });

  it('detects tool schema instability via detectToolSchemaInstability (A6)', () => {
    const toolsA = [{ name: 'alpha', description: 'a' }, { name: 'beta', description: 'b' }];
    const toolsB = [{ name: 'beta', description: 'b' }, { name: 'alpha', description: 'a' }];
    const res = optimize({
      prompt: 'summarize the quarterly report in one paragraph please',
      currentModel: 'claude-haiku',
      tools: toolsB,
      previousTools: toolsA,
      agent: 'test-regressions',
    });
    assert.ok(res.enforcement.toolSchema, 'enforcement.toolSchema missing');
    assert.equal(res.enforcement.toolSchema.stable, false, 'reordered tools must be flagged unstable');
  });

  it('gates compression on evaluateCompressVsCache and logs the shift (A3/A7)', () => {
    const before = cacheMonitor.getCacheStatus().invalidations.compressionShifts;
    // Large repetitive context: compressible, lands well above 1024 tokens.
    const context = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}: ` + 'meaningful unique context sentence with substance. '.repeat(20),
    }));
    const res = optimize({
      prompt: 'summarize the quarterly report in one paragraph please',
      currentModel: 'claude-haiku',
      context,
      agent: 'test-regressions',
    });
    assert.ok(res.enforcement.compressionDecision, 'compressionDecision missing');
    assert.ok(['compress', 'leave_padding', 'skip_compression'].includes(res.enforcement.compressionDecision.action));
    const after = cacheMonitor.getCacheStatus().invalidations.compressionShifts;
    if (res.compression && !res.compression.skipped) {
      assert.equal(after, before + 1, 'applied compression must record exactly one shift (A3)');
    } else {
      assert.equal(after, before, 'skipped compression must not record a shift');
      assert.ok(res.compression.reason, 'skip must carry the heuristic reason');
    }
    assert.ok(Array.isArray(res.compressedContext), 'caller must receive the context to send');
  });
});
