#!/usr/bin/env node
// Measures what a mode actually costs, per prompt and per session.
//
// Every run is a real multi-turn session, which is the whole point: rules are
// injected once at session start and then cache-read on later turns, exactly as
// they are in normal use. Measuring one-shot sessions makes cache-creation
// dominate the bill and buries the difference.
//
//   node bench/run.mjs --dry-run
//   node bench/run.mjs --models claude-haiku-4-5,gpt-5.4-mini --turns 3
//   node bench/run.mjs --modes normal,cte --prompts bench/prompts.txt

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const state = require('../src/state.js');

const CLAUDE_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];
const CODEX_MODELS = ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5'];
const isCodex = (m) => m.startsWith('gpt');

function flag(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const has = (name) => process.argv.includes(`--${name}`);
const list = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);

const models = list(flag('models', [...CLAUDE_MODELS, ...CODEX_MODELS].join(',')));
const modes = list(flag('modes', 'off,normal,cte'));
const turns = Number(flag('turns', 3));
const promptFile = flag('prompts', path.join(import.meta.dirname, 'prompts.txt'));
const outDir = flag('out', path.join(import.meta.dirname, 'results'));

const prompts = fs
  .readFileSync(promptFile, 'utf8')
  .split('\n')
  .map((p) => p.trim())
  .filter(Boolean)
  .slice(0, turns);

// Hooks stay live in the child — they are the thing under test — but this flag keeps
// the throwaway sessions out of the user's lifetime stats.
const BENCH_ENV = { ...process.env, PLAIN_SPEAK_BENCH: '1' };

function runClaude(prompt, model, sessionId) {
  const args = ['-p', prompt, '--model', model, '--output-format', 'json'];
  if (sessionId) args.push('--resume', sessionId);
  const r = spawnSync('claude', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: BENCH_ENV,
  });
  const json = JSON.parse(r.stdout);
  const u = json.usage || {};
  return {
    sessionId: json.session_id,
    outputTokens: u.output_tokens || 0,
    inputTokens: u.input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheCreate: u.cache_creation_input_tokens || 0,
    costUsd: json.total_cost_usd ?? null,
  };
}

function runCodex(prompt, model, started) {
  const args = started
    ? ['exec', 'resume', '--last', '--json', '-m', model, prompt]
    : ['exec', '--json', '-m', model, prompt];
  const r = spawnSync('codex', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: BENCH_ENV,
  });
  // Last token_count event of the turn carries that turn's usage.
  let last = null;
  for (const line of (r.stdout || '').split('\n')) {
    if (!line.includes('token_count')) continue;
    try {
      const info = JSON.parse(line)?.payload?.info?.last_token_usage;
      if (info) last = info;
    } catch {}
  }
  return {
    sessionId: 'last',
    outputTokens: (last?.output_tokens || 0) + (last?.reasoning_output_tokens || 0),
    inputTokens: last?.input_tokens || 0,
    cacheRead: last?.cached_input_tokens || 0,
    cacheCreate: 0,
    costUsd: null, // Codex does not report a price; compare tokens, not dollars.
  };
}

function session(model, mode) {
  state.writeMode(mode);
  const turnResults = [];
  let sessionId = null;
  for (const prompt of prompts) {
    const t = isCodex(model)
      ? runCodex(prompt, model, Boolean(sessionId))
      : runClaude(prompt, model, sessionId);
    sessionId = t.sessionId;
    turnResults.push({ prompt, ...t });
    process.stdout.write(`    ${String(t.outputTokens).padStart(6)} out  ${prompt.slice(0, 48)}\n`);
  }
  const sum = (k) => turnResults.reduce((a, t) => a + (t[k] || 0), 0);
  return {
    model,
    mode,
    turns: turnResults.length,
    outputTokens: sum('outputTokens'),
    outputPerTurn: Math.round(sum('outputTokens') / turnResults.length),
    inputTokens: sum('inputTokens'),
    cacheRead: sum('cacheRead'),
    cacheCreate: sum('cacheCreate'),
    costUsd: turnResults.some((t) => t.costUsd != null) ? sum('costUsd') : null,
    turnResults,
  };
}

const plan = models.flatMap((m) => modes.map((mode) => ({ model: m, mode })));

if (has('dry-run')) {
  console.log(`${plan.length} sessions × ${prompts.length} turns = ${plan.length * prompts.length} calls`);
  console.log(`models: ${models.join(', ')}`);
  console.log(`modes:  ${modes.join(', ')}`);
  console.log('\nprompts:');
  prompts.forEach((p) => console.log(`  ${p}`));
  console.log('\nEach call is a real API call and costs real money. Flagship models are');
  console.log('the expensive ones — narrow with --models and --turns first.');
  process.exit(0);
}

// The mode flag is global, so the run temporarily changes the live setting.
// Put it back no matter how we exit.
const previousMode = state.readMode();
const restore = () => state.writeMode(previousMode);
process.on('exit', restore);
process.on('SIGINT', () => process.exit(130));

fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

for (const { model, mode } of plan) {
  console.log(`\n${model} · ${mode}`);
  try {
    const result = session(model, mode);
    const file = path.join(outDir, `${stamp}-${model}-${mode}.json`);
    fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`  → ${result.outputTokens} output tokens total, saved ${path.basename(file)}`);
  } catch (err) {
    console.log(`  failed: ${err.message}`);
  }
}

console.log('\nRender the table with: node bench/report.mjs');
