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
//   node bench/run.mjs --models claude-opus-5 --repeat 5   (median of 5, less noise)

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
// One run per cell is noisy: model output length varies between identical calls.
// --repeat runs each cell several times and reports the median.
const repeat = Math.max(1, Number(flag('repeat', 1)));
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
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!r.stdout) throw new Error(`claude produced no output: ${(r.stderr || '').trim().slice(0, 300)}`);
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

function runCodex(prompt, model, threadId) {
  // --skip-git-repo-check: benchmark prompts are generic questions, so the run may
  // sit anywhere. Without it Codex refuses outright ("not inside a trusted directory").
  const args = threadId
    ? ['exec', 'resume', threadId, '--json', '--skip-git-repo-check', '-m', model, prompt]
    : ['exec', '--json', '--skip-git-repo-check', '-m', model, prompt];

  // stdio stdin MUST be 'ignore'. With a pipe, `codex exec` treats stdin as extra
  // prompt input and blocks waiting for EOF — it prints "Reading additional input
  // from stdin..." and never returns. That silently produced whole runs of zeros.
  const r = spawnSync('codex', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: BENCH_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // The --json stream is not the session-file format: usage arrives on a
  // `turn.completed` event, and the thread id on `thread.started`.
  let usage = null;
  let thread = threadId || null;
  for (const line of (r.stdout || '').split('\n')) {
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'thread.started' && event.thread_id) thread = event.thread_id;
    if (event.type === 'turn.completed' && event.usage) usage = event.usage;
  }

  if (!usage) {
    throw new Error(
      `codex reported no usage (exit ${r.status}): ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`
    );
  }

  return {
    sessionId: thread,
    // Reasoning tokens are billed as output, so they belong in the billed figure — but
    // response rules do not govern how long a model thinks, so they are also recorded
    // separately. Comparing Codex totals against Claude's without splitting these out
    // measures reasoning effort as much as reply length.
    outputTokens: (usage.output_tokens || 0) + (usage.reasoning_output_tokens || 0),
    visibleOutputTokens: usage.output_tokens || 0,
    reasoningTokens: usage.reasoning_output_tokens || 0,
    inputTokens: usage.input_tokens || 0,
    cacheRead: usage.cached_input_tokens || 0,
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
      ? runCodex(prompt, model, sessionId)
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
    visibleOutputTokens: sum('visibleOutputTokens') || null,
    reasoningTokens: sum('reasoningTokens') || null,
    inputTokens: sum('inputTokens'),
    cacheRead: sum('cacheRead'),
    cacheCreate: sum('cacheCreate'),
    costUsd: turnResults.some((t) => t.costUsd != null) ? sum('costUsd') : null,
    turnResults,
  };
}

const plan = models.flatMap((m) => modes.map((mode) => ({ model: m, mode })));

if (has('dry-run')) {
  console.log(
    `${plan.length} cells × ${repeat} run${repeat === 1 ? '' : 's'} × ${prompts.length} turns = ${plan.length * repeat * prompts.length} calls`
  );
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

const median = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

for (const { model, mode } of plan) {
  console.log(`\n${model} · ${mode}`);
  try {
    const runs = [];
    for (let i = 0; i < repeat; i += 1) {
      if (repeat > 1) console.log(`  run ${i + 1}/${repeat}`);
      runs.push(session(model, mode));
    }
    const result = runs[0];
    if (repeat > 1) {
      result.runs = runs.length;
      result.outputPerTurnRuns = runs.map((x) => x.outputPerTurn);
      result.outputPerTurn = median(result.outputPerTurnRuns);
      result.outputTokens = median(runs.map((x) => x.outputTokens));
    }
    if (!result.outputTokens) throw new Error('zero output tokens — refusing to save a bogus result');
    const file = path.join(outDir, `${stamp}-${model}-${mode}.json`);
    fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`  → ${result.outputTokens} output tokens total, saved ${path.basename(file)}`);
  } catch (err) {
    console.log(`  failed: ${err.message}`);
  }
}

console.log('\nRender the table with: node bench/report.mjs');
