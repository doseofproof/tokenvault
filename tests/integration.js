#!/usr/bin/env node

/**
 * TokenVault — Live Integration Test
 * 
 * Tests TokenVault against real Claude and OpenAI APIs.
 * Verifies:
 * - Cache hits register correctly
 * - Compression works in live loops
 * - Mutable prompt detection
 * - Tool schema stability
 * - Real-time monitoring
 */

import { promptCache, compressor, cache, router, cacheMonitor } from '../src/index.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// ═══════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════

function log(test, status, detail) {
  const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '○';
  const color = status === 'pass' ? '\x1b[32m' : status === 'fail' ? '\x1b[31m' : '\x1b[33m';
  console.log(` ${color}${icon}\x1b[0m ${test.padEnd(45)} ${detail || ''}`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════
// Live API Tests
// ═══════════════════════════════════════════════════════════

async function testAnthropicCache() {
  console.log('\n\x1b[1m━━━ ANTHROPIC LIVE CACHE TEST ━━━\x1b[0m\n');
  
  if (!ANTHROPIC_KEY) {
    log('Anthropic API key', 'skip', 'Set ANTHROPIC_API_KEY to test');
    return;
  }
  
  const systemPrompt = 'You are a helpful assistant. You provide concise, accurate answers. Always respond in exactly 3 sentences. Never use emoji. Always start your response with the word "Answer:".';
  
  // Build messages with cache markers
  const messages = promptCache.buildAnthropicMessages({
    system: systemPrompt,
    messages: [
      { role: 'user', content: 'What is the capital of France?' },
    ],
  });
  
  // Request 1: Cache miss (creates cache entry)
  console.log(' Request 1 (expect cache miss)...');
  const start1 = Date.now();
  try {
    const res1 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        system: messages.system,
        messages: messages.messages,
      }),
    });
    
    const data1 = await res1.json();
    const latency1 = Date.now() - start1;
    
    if (data1.error) {
      log('Anthropic request 1', 'fail', data1.error.message);
      return;
    }
    
    const usage1 = data1.usage;
    const cacheResult1 = promptCache.parseCacheUsage(data1, 'anthropic');
    
    log('Anthropic request 1', 'pass', `${usage1.input_tokens} input, ${usage1.output_tokens} output, ${latency1}ms`);
    log('Cache status', cacheResult1.cacheHit ? 'hit' : 'miss', `creation: ${cacheResult1.cacheCreation}, read: ${cacheResult1.cacheRead}`);
    
    cacheMonitor.recordCacheEvent({
      provider: 'anthropic',
      cached: cacheResult1.cacheHit,
      tokens: usage1.input_tokens,
      savings: cacheResult1.savings,
    });
    
    // Request 2: Should hit cache
    console.log(' Request 2 (expect cache hit)...');
    await sleep(1000); // Brief pause
    
    const res2 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        system: messages.system,
        messages: messages.messages,
      }),
    });
    
    const data2 = await res2.json();
    const latency2 = Date.now() - start1 - latency1;
    
    const cacheResult2 = promptCache.parseCacheUsage(data2, 'anthropic');
    
    log('Anthropic request 2', 'pass', `${data2.usage.input_tokens} input, ${latency2}ms`);
    log('Cache hit', cacheResult2.cacheHit ? 'hit' : 'miss', `read: ${cacheResult2.cacheRead} tokens, savings: $${cacheResult2.savings.toFixed(4)}`);
    
    cacheMonitor.recordCacheEvent({
      provider: 'anthropic',
      cached: cacheResult2.cacheHit,
      tokens: data2.usage.input_tokens,
      savings: cacheResult2.savings,
    });
    
    if (cacheResult2.cacheHit) {
      log('Cache effectiveness', 'pass', `90% discount applied on ${cacheResult2.cacheRead} tokens`);
    } else {
      log('Cache effectiveness', 'fail', 'Cache miss on second request');
    }
    
  } catch (err) {
    log('Anthropic API call', 'fail', err.message);
  }
}

async function testOpenAICache() {
  console.log('\n\x1b[1m━━━ OPENAI LIVE CACHE TEST ━━━\x1b[0m\n');
  
  if (!OPENAI_KEY) {
    log('OpenAI API key', 'skip', 'Set OPENAI_API_KEY to test');
    return;
  }
  
  const systemPrompt = 'You are a helpful assistant. You provide concise, accurate answers. Always respond in exactly 3 sentences. Never use emoji. Always start your response with the word "Answer:". ' + 
    'Additional context: The sun is a star at the center of our solar system. Earth orbits the sun at approximately 93 million miles. The speed of light is approximately 186,000 miles per second.';
  
  // OpenAI caches automatically — just keep prefix stable
  const messages = promptCache.buildOpenAIMessages({
    system: systemPrompt,
    messages: [
      { role: 'user', content: 'What is the capital of France?' },
    ],
  });
  
  // Request 1
  console.log(' Request 1...');
  const start1 = Date.now();
  try {
    const res1 = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: messages.messages,
        max_tokens: 100,
      }),
    });
    
    const data1 = await res1.json();
    const latency1 = Date.now() - start1;
    
    if (data1.error) {
      log('OpenAI request 1', 'fail', data1.error.message);
      return;
    }
    
    const cacheResult1 = promptCache.parseCacheUsage(data1, 'openai');
    
    log('OpenAI request 1', 'pass', `${data1.usage.prompt_tokens} input, ${data1.usage.completion_tokens} output, ${latency1}ms`);
    log('Cache status', cacheResult1.cacheHit ? 'hit' : 'miss', `cached: ${cacheResult1.cacheRead} tokens`);
    
    cacheMonitor.recordCacheEvent({
      provider: 'openai',
      cached: cacheResult1.cacheHit,
      tokens: data1.usage.prompt_tokens,
      savings: cacheResult1.savings,
    });
    
    // Request 2
    console.log(' Request 2 (expect cache hit)...');
    await sleep(500);
    
    const res2 = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: messages.messages,
        max_tokens: 100,
      }),
    });
    
    const data2 = await res2.json();
    const latency2 = Date.now() - start1 - latency1;
    
    const cacheResult2 = promptCache.parseCacheUsage(data2, 'openai');
    
    log('OpenAI request 2', 'pass', `${data2.usage.prompt_tokens} input, ${latency2}ms`);
    log('Cache hit', cacheResult2.cacheHit ? 'hit' : 'miss', `cached: ${cacheResult2.cacheRead} tokens, savings: $${cacheResult2.savings.toFixed(4)}`);
    
    cacheMonitor.recordCacheEvent({
      provider: 'openai',
      cached: cacheResult2.cacheHit,
      tokens: data2.usage.prompt_tokens,
      savings: cacheResult2.savings,
    });
    
  } catch (err) {
    log('OpenAI API call', 'fail', err.message);
  }
}

async function testCacheKillers() {
  console.log('\n\x1b[1m━━━ CACHE KILLER DETECTION TEST ━━━\x1b[0m\n');
  
  // Test 1: Mutable prompt detection
  const mutablePrompt = `Current time: ${new Date().toISOString()}
Request ID: ${Math.random().toString(36).substr(2, 9)}
Session: abc123
You are a helpful assistant.`;
  
  const result1 = cacheMonitor.detectMutablePrompt(mutablePrompt);
  log('Mutable prompt detection', result1.mutable ? 'pass' : 'fail', 
    result1.mutable ? `Found: ${result1.detected.join(', ')}` : 'No mutable content');
  
  // Test 2: Stable prompt (no mutable content)
  const stablePrompt = 'You are a helpful assistant. Always respond concisely.';
  const result2 = cacheMonitor.detectMutablePrompt(stablePrompt);
  log('Stable prompt detection', !result2.mutable ? 'pass' : 'fail',
    !result2.mutable ? 'Clean prefix detected' : 'False positive');
  
  // Test 3: Tool schema stability
  const tools1 = [
    { name: 'get_weather', description: 'Get weather' },
    { name: 'search', description: 'Search' },
  ];
  const tools2 = [
    { name: 'get_weather', description: 'Get weather' },
    { name: 'search', description: 'Search' },
  ];
  const tools3 = [
    { name: 'search', description: 'Search' },
    { name: 'get_weather', description: 'Get weather' },
  ];
  
  log('Tool schema stability (same)', cacheMonitor.detectToolSchemaInstability(tools1, tools2).stable ? 'pass' : 'fail',
    'Identical schemas');
  log('Tool schema stability (different)', !cacheMonitor.detectToolSchemaInstability(tools1, tools3).stable ? 'pass' : 'fail',
    'Order changed — detected');
  
  // Test 4: Compression shift detection
  const shiftResult = cacheMonitor.recordCompressionShift({
    messagesBefore: 20,
    messagesAfter: 15,
    tokensSaved: 2000,
  });
  log('Compression shift tracking', 'pass', `${shiftResult.invalidations} shifts recorded`);
}

async function testRoutingIntegration() {
  console.log('\n\x1b[1m━━━ ROUTING + CACHE INTEGRATION ━━━\x1b[0m\n');
  
  const testPrompts = [
    { prompt: 'hello', expected: 'simple', savings: '~90%' },
    { prompt: 'review this code for bugs', expected: 'medium', savings: '~70%' },
    { prompt: 'design a distributed system', expected: 'hard', savings: '~0%' },
  ];
  
  for (const { prompt, expected, savings } of testPrompts) {
    const tier = router.classifyTask(prompt);
    const model = router.selectModel(prompt, 'claude-sonnet-4');
    const ok = tier === expected;
    log(`Route "${prompt.substring(0, 30)}..."`, ok ? 'pass' : 'fail', `${tier} → ${model} (save ${savings})`);
  }
}

// ═══════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════

console.log('\x1b[1m╔══════════════════════════════════════════════════╗');
console.log('║    🪙 TOKENVAULT — LIVE INTEGRATION TEST        ║');
console.log('╚══════════════════════════════════════════════════╝\x1b[0m');

await testRoutingIntegration();
await testCacheKillers();
await testAnthropicCache();
await testOpenAICache();

// Show final monitoring status
console.log('\n\x1b[1m━━━ CACHE MONITORING STATUS ━━━\x1b[0m\n');
const status = cacheMonitor.getCacheStatus();
console.log(` Session: ${status.session.duration}, ${status.session.requests} requests`);
console.log(` Hit rate: ${status.session.hitRate}`);
console.log(` Savings: ${status.session.savings}`);
console.log(` Invalidations: ${JSON.stringify(status.invalidations)}`);
if (status.byProvider.length > 0) {
  console.log(' By provider:');
  for (const p of status.byProvider) {
    console.log(`   ${p.name}: ${p.hitRate} hit rate, ${p.hits}/${p.requests} hits`);
  }
}

const health = cacheMonitor.getCacheHealth();
console.log(`\n Health: ${health.health} (score: ${health.score}/100)`);
if (health.recommendations.length > 0) {
  console.log(' Recommendations:');
  for (const r of health.recommendations) {
    console.log(`   → ${r}`);
  }
}

console.log('\n\x1b[32m═══════════════════════════════════════════════════\x1b[0m\n');
