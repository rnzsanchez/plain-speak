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
  plain-speak commands                       install /plain-speak and /plain-speak-stats only
  plain-speak uninstall [--claude|--codex]   remove what it added
  plain-speak uninstall --purge              …and delete the mode and stats too
  plain-speak status [mode] [--project]      show status, or switch mode (--project pins this repo)
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

    // Plugin skills are always namespaced (/plain-speak:mode). Bare /plain-speak only
    // exists as a user-level skill, so this installs those copies without touching hooks.
    case 'commands': {
      const names = claude.installCommands();
      console.log(`installed: ${names.map((n) => `/${n}`).join(' ')}`);
      console.log('They load at the next session start, or after /reload-skills.');
      return;
    }

    case 'uninstall': {
      const both = !has('--claude') && !has('--codex');
      if (both || has('--claude')) claude.uninstall({ keepRuntime: has('--claude') });
      if (both || has('--codex')) codex.uninstall();
      if (has('--purge')) {
        fs.rmSync(state.homeDir(), { recursive: true, force: true });
        console.log('Purged ~/.claude/plain-speak — mode and stats are gone');
      }
      return;
    }

    // What /plain-speak runs. No argument: turn it on if it was off, then show
    // where things stand. With an argument: switch mode.
    case 'status': {
      const wanted = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
      let mode = state.readMode();
      let source = state.modeSource();
      if (wanted) {
        mode = has('--project') ? state.writeProjectMode(wanted) : state.writeMode(wanted);
        source = state.modeSource();
      } else if (mode === 'off' && source === 'global') {
        // No argument means "turn it on" — but only when the global setting is what
        // switched it off. An env var or project pin that says off is a decision.
        mode = state.writeMode('normal');
        source = state.modeSource();
      }
      // Name the commands the user actually has. CLAUDE_PLUGIN_ROOT is not exported to
      // skill Bash calls, so checking for the bare user-level command is the only
      // reliable signal — and the bare form wins when both exist.
      const bare = claude.hasBareCommands();
      const cmd = bare ? '/plain-speak' : '/plain-speak:mode';

      // Show what each mode sounds like rather than describing it. Same question, three
      // answers — that is the whole decision the user is making here.
      const SAMPLES = {
        off: 'Great question! Force-pushing is generally risky…',
        normal: 'No. Rewrites shared history. Use --force-with-lease.',
        cte: 'No. Breaks other clones. --force-with-lease.',
      };

      // Keep the source when it is not the global setting — a project pin that gives no
      // sign of itself is a mystery, and that was a documented promise.
      const from = source === 'global' ? '' : ` (from ${source})`;
      console.log(`plain-speak — ${mode}${mode === 'cte' ? ' 🧠' : ''}${from}\n`);
      console.log('  "Is it safe to force-push to a shared branch?"\n');
      const width = Math.max(...Object.keys(SAMPLES).map((m) => `${cmd} ${m}`.length)) + 2;
      for (const [m, sample] of Object.entries(SAMPLES)) {
        const marker = m === mode ? '▸' : ' ';
        console.log(`  ${marker} ${`${cmd} ${m}`.padEnd(width)}${sample}`);
      }
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
      // The harness exports the real session id, but it is only useful if we have
      // counters for it — otherwise report the last real session we do know about.
      const sessionId = arg('--session-id') || knownSession(process.env.CLAUDE_CODE_SESSION_ID);
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

function knownSession(id) {
  if (id && state.readStore().sessions[id]) return id;
  return latestSessionId();
}

// Last real session, benchmark runs excluded.
function latestSessionId() {
  const store = state.readStore();
  if (store.lastSessionId) return store.lastSessionId;
  return Object.entries(store.sessions)
    .filter(([, s]) => !s.bench)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))[0]?.[0];
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
