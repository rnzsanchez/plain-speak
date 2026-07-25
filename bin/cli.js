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

  plain-speak install [--claude] [--codex]   wire up hooks and slash commands
  plain-speak install --statusline           also chain the badge onto your statusline
  plain-speak uninstall [--claude|--codex]   remove what it added
  plain-speak uninstall --purge              …and delete the mode and stats too
  plain-speak status [mode] [--project]      show status, or switch mode (--project pins this repo)
  plain-speak mode [off|normal|cte]          show or set the mode ("max" = cte)
  plain-speak badge                          print the statusline badge
  plain-speak stats [--json]                 token and drift report
  plain-speak doctor                         check the install

Modes: off (nothing) · normal (plain voice, the base) · cte (blunt, at twelve)
`;

const has = (flag) => process.argv.includes(flag);

function main() {
  const cmd = process.argv[2];

  switch (cmd) {
    case 'install': {
      const both = !has('--claude') && !has('--codex');
      if (both || has('--claude')) claude.install({ chainStatusline: has('--statusline') });
      if (both || has('--codex')) codex.install();
      if (!state.readSafe(state.modePath())) state.writeMode('normal');
      const how = claude.hasBareCommands() || codex.hasBareCommands() ? '/plain-speak cte' : '/plain-speak:mode cte';
      console.log(`\nMode: ${state.readMode()}. Change it in a session: ${how}`);
      console.log('Restart Claude Code, or run /hooks once, to load the hooks.');
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
      // Name the commands the user actually has. CLAUDE_PLUGIN_ROOT settles it when the
      // harness exports it; otherwise the only signal is which bare skill exists on disk,
      // and Codex counts too — it has no namespace, so its form is always the bare one.
      const bare = !process.env.CLAUDE_PLUGIN_ROOT && (claude.hasBareCommands() || codex.hasBareCommands());
      const cmd = bare ? '/plain-speak' : '/plain-speak:mode';

      // Show what the mode sounds like rather than describing it. Verbatim openers from
      // one real run of the same question through Opus 5, with that reply's own token
      // count — invented samples would be a claim about the modes that nothing backs.
      const SAMPLES = {
        off: ['Redis is an in-memory key-value store. That\'s the whole trick: your…', '1,765 tokens'],
        normal: ['Redis keeps data in RAM, not on disk. That\'s the whole trick. A…', '1,466 tokens · 17% shorter'],
        cte: ['Redis = in-memory key-value store. Cache = you put stuff there…', '1,195 tokens · 32% shorter'],
      };

      // Keep the source when it is not the global setting — a project pin that gives no
      // sign of itself is a mystery, and that was a documented promise.
      const from = source === 'global' ? '' : ` (from ${source})`;
      console.log(`plain-speak — ${mode}${mode === 'cte' ? ' 🧠' : ''}${from}\n`);
      console.log('  "explain to me how redis cache works" — asked for real, Opus 5');
      console.log(`  → ${SAMPLES[mode][0]}`);
      console.log(`    ${SAMPLES[mode][1]}\n`);
      console.log(`  switch: ${cmd} off | normal | cte    (--project pins this repo)`);

      // A skill's stdout is tool output, so printing the ruleset puts it back in context.
      // That is the reinit: bare /plain-speak re-arms the rules mid-session, and a switch
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
