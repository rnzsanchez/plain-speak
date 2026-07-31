#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const state = require('../src/state');
const stats = require('../src/stats');
const claude = require('../src/install/claude');
const codex = require('../src/install/codex');
const { rulesFor } = require('../src/hooks/lib');

const USAGE = `plain-speak — terse-response modes with an active hygiene checker

  plain-speak uninstall [--claude|--codex]   remove an older standalone install
  plain-speak uninstall --purge              …and delete the mode and stats too
  plain-speak status [mode] [--project]      show status, or switch mode (--project pins this repo)
  plain-speak mode [off|normal|cte]          show or set the mode ("max" = cte)
  plain-speak badge                          print the statusline badge
  plain-speak stats [--json]                 token and drift report
  plain-speak doctor                         check the install

Modes: off (nothing) · normal (plain voice, the base) · cte (short, clear, everyday)
`;

const has = (flag) => process.argv.includes(flag);

function main() {
  const cmd = process.argv[2];

  switch (cmd) {
    case 'uninstall': {
      const both = !has('--claude') && !has('--codex');
      if (both || has('--claude')) claude.uninstall();
      if (both || has('--codex')) codex.uninstall();
      if (has('--purge')) {
        if (both || has('--claude')) {
          fs.rmSync(state.homeDir('claude'), { recursive: true, force: true });
          console.log('Purged ~/.claude/plain-speak — mode and stats are gone');
        }
        if (both || has('--codex')) {
          fs.rmSync(state.homeDir('codex'), { recursive: true, force: true });
          console.log('Purged ~/.codex/plain-speak — mode and stats are gone');
        }
      }
      return;
    }

    // What the mode skill runs. No argument: turn it on if it was off, then show
    // where things stand. With an argument: switch mode.
    case 'status': {
      // The plugin cannot wire a statusline or clear what an older standalone install
      // left behind, so the mode command does it — once, only when something differs,
      // and only for the tool it is running under.
      const codexHere =
        process.env.PLAIN_SPEAK_TARGET === 'codex' || Boolean(process.env.PLUGIN_ROOT);
      for (const note of codexHere ? codex.tidy() : claude.tidy()) console.log(`plain-speak: ${note}`);

      const wanted = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
      let mode = state.readMode();
      let source = state.modeSource();
      if (wanted) {
        if (has('--project')) state.writeProjectMode(wanted);
        else state.writeMode(wanted);
        // Read it back rather than trusting the write: PLAIN_SPEAK_MODE and a project pin
        // both outrank the global file, and the rules printed below have to be the ones
        // the hooks will actually enforce.
        mode = state.readMode();
        source = state.modeSource();
      } else if (mode === 'off' && source === 'global') {
        // No argument means "turn it on" — but only when the global setting is what
        // switched it off. An env var or project pin that says off is a decision.
        mode = state.writeMode('normal');
        source = state.modeSource();
      }
      const cmd = codexHere
        ? 'plain speak'
        : claude.hasBareCommands()
          ? '/plain-speak'
          : '/plain-speak:init';

      // Keep the source when it is not the global setting — a project pin that gives no
      // sign of itself is a mystery, and that was a documented promise.
      const from = source === 'global' ? '' : ` (from ${source})`;
      console.log(`plain-speak — ${mode}${mode === 'cte' ? ' 🧠' : ''}${from}\n`);
      console.log('  Benchmarks are being refreshed for these rules.\n');
      console.log(`  switch: ${cmd} off | normal | cte    (--project pins this repo)`);

      // A skill's stdout is tool output, so printing the ruleset puts it back in context.
      // That is the reinit: the mode skill re-arms the rules mid-session, and a switch
      // has to send the new mode's rules or nothing changes until the next drift trip.
      const rules = mode === 'off' ? '' : rulesFor(mode);
      if (rules) {
        console.log('\nRULES — for the assistant, not for display\n');
        console.log(`PLAIN-SPEAK MODE: ${mode}\n\n${rules}`);
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
      // The last real session we have counters for. Every Stop hook records one, so
      // this is the session that just ran.
      const sessionId = latestSessionId();
      const report = stats.report({ sessionId, transcriptPath: findTranscript(sessionId) });
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
