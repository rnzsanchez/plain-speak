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
//
// Runs in a clean room: its own Claude and Codex homes under ~/.plain-speak-bench,
// holding nothing but plain-speak, and an empty working directory. Each home needs one
// interactive login before the first run — the harness prints the command and stops.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CLAUDE_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];
// Every chat model Codex offers locally, from ~/.codex/models_cache.json.
// codex-auto-review is excluded — it is a review harness, not a chat model.
const CODEX_MODELS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
];
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
// Codex bills reasoning as output, but no response rule governs how long a model thinks.
// Inheriting the operator's effort setting therefore measures reasoning as much as reply
// length, so --reasoning pins it per run and the level is recorded with the result.
const reasoning = flag('reasoning', null);
const promptFile = flag('prompts', path.join(import.meta.dirname, 'prompts.txt'));
const outDir = flag('out', path.join(import.meta.dirname, 'results'));

const prompts = fs
  .readFileSync(promptFile, 'utf8')
  .split('\n')
  .map((p) => p.trim())
  .filter(Boolean)
  .slice(0, turns);

// A clean room, because the operator's own config is a confound. Run under the machine's
// real home and every `off` baseline inherits whatever the user already told the model —
// a global CLAUDE.md that says "be terse", plugins that inject at session start — which
// makes the measured cut a floor rather than the effect of these rules. So each child
// gets its own CLAUDE_CONFIG_DIR and CODEX_HOME holding nothing but plain-speak, and runs
// from an empty directory so no project CLAUDE.md or AGENTS.md is discovered.
//
// The homes persist between runs because each needs an interactive login once:
//   CLAUDE_CONFIG_DIR=<home>/claude claude    → /login
//   CODEX_HOME=<home>/codex codex login
// --isolated is the strict form and needs one interactive login per home. The default
// uses the machine's own homes, because that is where the credentials are: it keeps the
// operator's global rules in the baseline, which understates the cut. Either way the
// children run from an empty directory, so no project CLAUDE.md or AGENTS.md is read,
// and every cell and repeat starts a brand-new session.
const isolated = has('isolated');
const benchHome = flag('home', path.join(os.homedir(), '.plain-speak-bench'));
const SCRATCH = path.join(benchHome, 'scratch');
const CLAUDE_HOME = isolated
  ? path.join(benchHome, 'claude')
  : process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const CODEX_HOME = isolated
  ? path.join(benchHome, 'codex')
  : process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

// Hooks stay live in the child — they are the thing under test — but this flag keeps
// the throwaway sessions out of the user's lifetime stats.
// Setting CLAUDE_CONFIG_DIR at all — even to its own default path — stops Claude Code
// reading credentials from the OS keychain, and every call comes back "Not logged in"
// with zero tokens. So the child only gets these when --isolated asked for a separate
// home that was logged into on purpose.
const BENCH_ENV = {
  ...process.env,
  PLAIN_SPEAK_BENCH: '1',
  ...(isolated ? { CLAUDE_CONFIG_DIR: CLAUDE_HOME, CODEX_HOME } : {}),
};

// The mode goes to the child as an environment variable, which outranks both the global
// flag and a project pin (src/state.js). Earlier versions wrote the global flag and put
// it back on exit; a run killed halfway then left the operator in whatever mode it had
// reached. Nothing is written now, so there is nothing to restore.
const envFor = (mode) => ({ ...BENCH_ENV, PLAIN_SPEAK_MODE: mode });

function runClaude(prompt, model, sessionId, env) {
  const args = ['-p', prompt, '--model', model, '--output-format', 'json'];
  if (sessionId) args.push('--resume', sessionId);
  const r = spawnSync('claude', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env,
    cwd: SCRATCH,
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

function runCodex(prompt, model, threadId, env) {
  // --skip-git-repo-check: benchmark prompts are generic questions, so the run may
  // sit anywhere. Without it Codex refuses outright ("not inside a trusted directory").
  // No --sandbox flag: `codex exec` accepts `-s` but `codex exec resume` does not, so
  // passing it makes turn 1 succeed and every later turn of the same session die with
  // "unexpected argument '-s'". The prompts are questions and call no tools, so the
  // default policy is fine — and identical on every turn, which matters more.
  // -c has to sit after the subcommand. Before it, codex stops recognising `exec` and
  // falls back to reading the prompt from stdin, which hangs the same way the missing
  // 'ignore' did. Unlike -s, both `exec` and `exec resume` accept it.
  const cfg = reasoning ? ['-c', `model_reasoning_effort="${reasoning}"`] : [];
  const args = threadId
    ? ['exec', 'resume', threadId, ...cfg, '--json', '--skip-git-repo-check', '-m', model, prompt]
    : ['exec', ...cfg, '--json', '--skip-git-repo-check', '-m', model, prompt];

  // stdio stdin MUST be 'ignore'. With a pipe, `codex exec` treats stdin as extra
  // prompt input and blocks waiting for EOF — it prints "Reading additional input
  // from stdin..." and never returns. That silently produced whole runs of zeros.
  const r = spawnSync('codex', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env,
    cwd: SCRATCH,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
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
  const env = envFor(mode);
  const turnResults = [];
  let sessionId = null;
  for (const prompt of prompts) {
    const t = isCodex(model)
      ? runCodex(prompt, model, sessionId, env)
      : runClaude(prompt, model, sessionId, env);
    sessionId = t.sessionId;
    // The id is needed to resume the next turn, not to keep. Saved results go in a
    // public repo, and a real session id is not something the numbers need.
    const { sessionId: _drop, ...turn } = t;
    turnResults.push({ prompt, ...turn });
    process.stdout.write(`    ${String(t.outputTokens).padStart(6)} out  ${prompt.slice(0, 48)}\n`);
  }
  const sum = (k) => turnResults.reduce((a, t) => a + (t[k] || 0), 0);
  // Presence, not truthiness. `|| null` turned a real zero into "not reported", and the
  // --repeat median then sorted those nulls to the front and threw away the runs that
  // did report. Claude reports neither field; Codex reports both, sometimes as zero.
  const reported = (k) => turnResults.some((t) => t[k] != null);
  return {
    model,
    mode,
    ...(reasoning && isCodex(model) ? { reasoningEffort: reasoning } : {}),
    turns: turnResults.length,
    outputTokens: sum('outputTokens'),
    outputPerTurn: Math.round(sum('outputTokens') / turnResults.length),
    visibleOutputTokens: reported('visibleOutputTokens') ? sum('visibleOutputTokens') : null,
    reasoningTokens: reported('reasoningTokens') ? sum('reasoningTokens') : null,
    inputTokens: sum('inputTokens'),
    cacheRead: sum('cacheRead'),
    cacheCreate: sum('cacheCreate'),
    costUsd: turnResults.some((t) => t.costUsd != null) ? sum('costUsd') : null,
    turnResults,
  };
}

// Set the clean homes up, and refuse to run half-configured. A missing login shows up
// as a cell of zeros an hour later, which reads as a measurement forever after.
function preflight() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  if (!isolated) {
    console.log('Running under your own Claude and Codex config: global rules and plugins');
    console.log('are in the baseline too. `--isolated` measures plain-speak alone.\n');
    return;
  }
  const needClaude = models.some((m) => !isCodex(m));
  const needCodex = models.some(isCodex);

  const cli = path.join(import.meta.dirname, '..', 'bin', 'cli.js');
  const install = (args) =>
    spawnSync('node', [cli, 'install', ...args], { env: BENCH_ENV, stdio: 'ignore' });

  if (needClaude) {
    if (!fs.existsSync(path.join(CLAUDE_HOME, '.credentials.json')) && !loggedIn(CLAUDE_HOME)) {
      fail(`the benchmark's Claude home is not logged in.\n\n  CLAUDE_CONFIG_DIR=${CLAUDE_HOME} claude\n\nthen /login, then quit. It is a separate login on purpose: your own config carries\nglobal rules and plugins that would shape the "off" baseline.`);
    }
    install(['--claude']);
  }
  if (needCodex) {
    if (!fs.existsSync(path.join(CODEX_HOME, 'auth.json'))) {
      fail(`the benchmark's Codex home is not logged in.\n\n  CODEX_HOME=${CODEX_HOME} codex login`);
    }
    install(['--codex']);
  }
}

// The account record, not the secret: Claude Code keeps credentials in the OS keychain
// and only the account marker in the config dir.
function loggedIn(home) {
  try {
    return Boolean(JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).oauthAccount);
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(`\nbench: ${message}\n`);
  process.exit(1);
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

preflight();

fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const median = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

// A field the model never reports stays null; one it reports as zero stays a number.
// Feeding nulls to median() would sort them as zeros and drag the figure down.
const medianReported = (xs) => (xs.every((x) => x == null) ? null : median(xs.map((x) => x || 0)));

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
      result.visibleOutputTokens = medianReported(runs.map((x) => x.visibleOutputTokens));
      result.reasoningTokens = medianReported(runs.map((x) => x.reasoningTokens));
    }
    if (!result.outputTokens) throw new Error('zero output tokens — refusing to save a bogus result');
    // The effort goes in the name too. A `none` run and a `medium` run of the same cell
    // are different experiments, and a listing that hides that invites comparing them.
    const file = path.join(
      outDir,
      `${stamp}-${model}-${mode}${result.reasoningEffort ? `-effort-${result.reasoningEffort}` : ''}.json`
    );
    fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`  → ${result.outputTokens} output tokens total, saved ${path.basename(file)}`);
  } catch (err) {
    console.log(`  failed: ${err.message}`);
  }
}

console.log('\nRender the table with: node bench/report.mjs');
