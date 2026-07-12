/**
 * Cache integrity tests — cross-context isolation.
 *
 * A response generated under one system prompt / tool set / agent must
 * never be served to a request with a different context, exactly or via
 * the semantic fallback.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.TOKENVAULT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenvault-iso-'));

const cache = (await import('../src/cache.js')).default;
const { optimize, record } = await import('../src/index.js');

const MODEL = 'claude-sonnet-4';

describe('Cache context isolation', () => {
  it('same prompt + same context hits', () => {
    const ctx = { system: 'You are a helpful assistant', tools: ['read_file'], agent: 'agent-a' };
    cache.store('list the project files please', MODEL, 'file1, file2', {}, ctx);
    const hit = cache.lookup('list the project files please', MODEL, ctx);
    assert.ok(hit, 'identical context must hit');
    assert.equal(hit.content, 'file1, file2');
  });

  it('same prompt + different system prompt misses', () => {
    const privileged = { system: 'You may access secrets', tools: ['read_secrets'], agent: 'agent-a' };
    const unprivileged = { system: 'You are read-only', tools: [], agent: 'agent-b' };
    cache.store('show me the deployment credentials summary', MODEL, 'SECRET-DERIVED-RESPONSE', {}, privileged);
    const hit = cache.lookup('show me the deployment credentials summary', MODEL, unprivileged);
    assert.equal(hit, null, 'privileged response must not bleed into a different context');
  });

  it('semantic fallback never crosses contexts, even for near-identical prompts', () => {
    const ctxA = { system: 'admin context', tools: ['deploy'], agent: 'ops' };
    const ctxB = { system: 'guest context', tools: [], agent: 'guest' };
    cache.store('summarize the quarterly billing revenue report', MODEL, 'ADMIN-ANSWER', {}, ctxA);
    // Same keyword fingerprint (word order ignored), different context
    const hit = cache.lookup('summarize the quarterly revenue billing report', MODEL, ctxB);
    assert.equal(hit, null, 'semantic match must require identical context digest');
  });

  it('semantic fallback rejects merely-similar prompts within the same context', () => {
    const ctx = { system: 'same context', tools: [], agent: 'a1' };
    cache.store('explain the retry logic in the payment worker queue', MODEL, 'ANSWER-A', {}, ctx);
    // Overlapping but materially different ask (old 0.85 threshold matched this class)
    const hit = cache.lookup('explain the retry logic in the email worker queue', MODEL, ctx);
    assert.equal(hit, null, 'sub-threshold similarity must miss');
  });

  it('end-to-end: optimize() only reuses a response recorded under the same context', () => {
    const prompt = 'describe the incident response runbook for outages';
    record({
      model: MODEL, inputTokens: 500, outputTokens: 300,
      operation: 'llm_call', response: 'PRIVILEGED-RUNBOOK', prompt,
      system: 'You have access to internal runbooks', tools: ['runbook_read'], agent: 'sre',
    });

    const other = optimize({ prompt, currentModel: MODEL, system: 'public docs only', agent: 'support' });
    assert.equal(other.cached, false, 'different context must not be served the cached response');

    const same = optimize({
      prompt, currentModel: MODEL,
      system: 'You have access to internal runbooks', tools: ['runbook_read'], agent: 'sre',
    });
    assert.equal(same.cached, true, 'identical context must still hit');
    assert.equal(same.response, 'PRIVILEGED-RUNBOOK');
  });
});
