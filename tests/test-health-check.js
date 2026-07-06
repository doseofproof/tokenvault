/**
 * TokenVault — cache-health-check skill tests (CLAUDE.md C1)
 *
 * Covers: runner executes cleanly · score bounds · status shape ·
 * critical-threshold incident note (via injected report + tmp dir — does not
 * pollute real cacheMonitor state).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { collectHealthReport, writeIncidentNote, shouldWriteIncident } from '../bin/health';
import cacheMonitor from '../src/cacheMonitor.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'health');

describe('cache-health-check — runner', () => {
  it('runs standalone without error and emits valid C1 JSON', () => {
    const out = execFileSync(process.execPath, [BIN, '--json'], { encoding: 'utf8' });
    const report = JSON.parse(out);
    assert.equal(report.skill, 'cache-health-check');
    assert.ok(['healthy', 'warning', 'degraded', 'critical'].includes(report.health));
    assert.equal(typeof report.action_taken, 'string');
    assert.equal(typeof report.escalated_to_dre, 'boolean');
  });

  it('health score is a number between 0 and 100', () => {
    const { report } = collectHealthReport();
    assert.equal(typeof report.score, 'number');
    assert.ok(report.score >= 0 && report.score <= 100, `score ${report.score} out of bounds`);
    assert.equal(typeof report.hit_rate_pct, 'number');
  });

  it('runs exactly the six B1 checks, in order', () => {
    const { report } = collectHealthReport();
    assert.equal(report.checks.length, 6);
    assert.deepEqual(report.checks.map(c => c.name), [
      '1_confirm_hit_rate', '2_mutable_prompts', '3_tool_schema_churn',
      '4_compression_shifts', '5_prefix_divergence', '6_ttl_gaps',
    ]);
  });
});

describe('cache-health-check — status shape', () => {
  it('getCacheStatus has the fields the checks depend on', () => {
    const status = cacheMonitor.getCacheStatus();
    assert.ok(status.session, 'session missing');
    assert.ok(status.invalidations, 'invalidations missing');
    for (const k of ['compressionShifts', 'mutablePrompts', 'toolSchemaChanges']) {
      assert.equal(typeof status.invalidations[k], 'number', `invalidations.${k} missing`);
    }
    assert.ok(Array.isArray(status.recentEvents), 'recentEvents missing');
  });

  it('C1 report invalidations mirror monitor invalidations', () => {
    const { report, status } = collectHealthReport();
    assert.deepEqual(report.invalidations, {
      compressionShifts: status.invalidations.compressionShifts || 0,
      mutablePrompts: status.invalidations.mutablePrompts || 0,
      toolSchemaChanges: status.invalidations.toolSchemaChanges || 0,
    });
  });
});

describe('cache-health-check — critical threshold', () => {
  it('shouldWriteIncident fires below 50 only', () => {
    assert.equal(shouldWriteIncident(49), true);
    assert.equal(shouldWriteIncident(30), true);
    assert.equal(shouldWriteIncident(50), false);
    assert.equal(shouldWriteIncident(100), false);
    assert.equal(shouldWriteIncident(undefined), false);
  });

  it('critical report writes a tv-cache-incident note (isolated tmp dir)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-health-test-'));
    const fakeReport = {
      skill: 'cache-health-check', at_request: 50, health: 'critical', score: 30,
      hit_rate_pct: 12.0,
      invalidations: { compressionShifts: 9, mutablePrompts: 3, toolSchemaChanges: 2 },
      divergence_vs_observability_pct: 0,
      action_taken: 'B1 executed', escalated_to_dre: true,
      checks: [{ name: '1_confirm_hit_rate', status: 'critical', detail: 'hit rate 12%' }],
    };
    const file = writeIncidentNote(fakeReport, { inboxDir: tmp });
    assert.ok(fs.existsSync(file), 'incident note not written');
    assert.ok(path.basename(file).startsWith('tv-cache-incident-'), 'wrong filename prefix');
    assert.ok(!path.basename(file).includes('token'), 'filename would hit .gitignore *token*');
    const body = fs.readFileSync(file, 'utf8');
    assert.ok(body.includes('score 30'), 'score missing from note');
    assert.ok(body.includes('status: draft'), 'PROTOCOL §4 draft status missing');
    // Append semantics: second write same day must not clobber the first.
    writeIncidentNote(fakeReport, { inboxDir: tmp });
    const body2 = fs.readFileSync(file, 'utf8');
    assert.ok(body2.length > body.length, 'second incident must append, not overwrite');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('detects mutable prompt via --system-file live probe', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-health-test-'));
    const promptFile = path.join(tmp, 'sys.txt');
    fs.writeFileSync(promptFile, 'You are an agent. session_id: xyz-9. timestamp: 2026-07-06T17:00:00');
    const out = execFileSync(process.execPath, [BIN, '--json', '--system-file', promptFile], { encoding: 'utf8' });
    const report = JSON.parse(out);
    const check2 = report.checks.find(c => c.name === '2_mutable_prompts');
    assert.equal(check2.status, 'fail');
    assert.ok(check2.live_probe.includes('session_id'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
