#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const state = require('../src/state');
const stats = require('../src/stats');
const claude = require('../src/install/claude');
const codex = require('../src/install/codex');

const USAGE = `plain-speak — terse-response modes with an active hygiene checker

  plain-speak install [--claude] [--codex]   wire up hooks and slash commands
  plain-speak install --statusline           also chain the badge onto your statusline
  plain-speak uninstall [--claude|--codex]   remove what it added
  plain-speak status [mode]                  show status, or switch mode
  plain-speak mode [off|normal|cte]          show or set the mode ("max" = cte)
  plain-speak badge                          print the statusline badge
  plain-speak stats [--session-file <path>]  token and drift report
  plain-speak doctor                         check the install

Modes: off (nothing) · normal (plain voice, the base) · cte (blunt, at twelve)
`;

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}
const has = (flag) => process.argv.includes(flag);

function main() {
  const cmd = process.argv[2];

  switch (cmd) {
    case 'install': {
      const both = !has('--claude') && !has('--codex');
      if (both || has('--claude')) claude.install({ chainStatusline: has('--statusline') });
      if (both || has('--codex')) codex.install();
      if (!state.readSafe(state.modePath())) state.writeMode('normal');
      console.log(`\nMode: ${state.readMode()}. Change it in a session: /plain-speak cte  (plugin installs: /plain-speak:mode cte)`);
      console.log('Restart Claude Code, or run /hooks once, to load the hooks.');
      return;
    }

    case 'uninstall': {
      const both = !has('--claude') && !has('--codex');
      if (both || has('--claude')) claude.uninstall({ keepRuntime: has('--claude') });
      if (both || has('--codex')) codex.uninstall();
      return;
    }

    // What /plain-speak runs. No argument: turn it on if it was off, then show
    // where things stand. With an argument: switch mode.
    case 'status': {
      const wanted = process.argv[3];
      let mode = state.readMode();
      if (wanted) mode = state.writeMode(wanted);
      else if (mode === 'off') mode = state.writeMode('normal');
      // Plugin installs namespace the commands; standalone ones do not.
      const plugin = Boolean(process.env.CLAUDE_PLUGIN_ROOT);
      const cmd = plugin ? '/plain-speak:mode' : '/plain-speak';
      const statsCmd = plugin ? '/plain-speak:stats' : '/plain-speak-stats';
      console.log(`plain-speak — ${mode}${mode === 'cte' ? ' 🧠' : ''}\n`);
      const row = (left, right) => console.log(`  ${left.padEnd(26)}${right}`);
      row(`${cmd} off`, 'nothing injected, nothing checked');
      row(`${cmd} normal`, 'plain voice, answer first, no fuss');
      row(`${cmd} cte`, 'same voice at twelve — short, blunt');
      row(statsCmd, 'token and drift report');
      return;
    }

    case 'mode': {
      const next = process.argv[3];
      if (!next) return console.log(state.readMode());
      console.log(state.writeMode(next));
      return;
    }

    case 'badge': {
      const script = path.join(__dirname, '..', 'src', 'plain-speak-statusline.sh');
      const r = spawnSync('bash', [script], { stdio: 'inherit' });
      process.exit(r.status || 0);
    }

    case 'stats': {
      const sessionId = arg('--session-id') || latestSessionId();
      const report = stats.report({
        sessionId,
        transcriptPath: arg('--session-file') || findTranscript(sessionId),
      });
      console.log(has('--json') ? JSON.stringify(report, null, 2) : stats.format(report));
      return;
    }

    case 'doctor':
      claude.doctor();
      codex.doctor();
      return;

    default:
      console.log(USAGE);
      process.exit(cmd ? 1 : 0);
  }
}

// Without --session-id, fall back to the most recently touched session so
// `plain-speak stats` still works from a plain shell.
function latestSessionId() {
  const store = state.readStore();
  return Object.entries(store.sessions).sort(
    (a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)
  )[0]?.[0];
}

// Claude Code stores transcripts at ~/.claude/projects/<slug>/<session-id>.jsonl,
// so the id is enough to find the token numbers.
function findTranscript(sessionId) {
  if (!sessionId) return null;
  const root = path.join(state.claudeDir(), 'projects');
  let projects = [];
  try {
    projects = fs.readdirSync(root);
  } catch {
    return null;
  }
  for (const p of projects) {
    const file = path.join(root, p, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

main();
