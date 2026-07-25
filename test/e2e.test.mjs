// End-to-end: install into a sandbox, drive a whole session through the real hooks,
// then uninstall and check the sandbox is as we found it. Nothing here touches the
// machine's real config — every test gets its own CLAUDE_CONFIG_DIR and CODEX_HOME.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const cli = path.join(root, 'bin', 'cli.js');

function sandbox({ settings, codex = true } = {}) {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-claude-'));
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-codex-'));
  if (!codex) fs.rmSync(codexHome, { recursive: true, force: true });
  if (settings) {
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(settings, null, 2));
  }
  // The harness exports CLAUDE_CODE_SESSION_ID for the real session; leaving it in a
  // sandbox env would point `stats` at a session the sandbox has never heard of.
  const { CLAUDE_CODE_SESSION_ID, PLAIN_SPEAK_MODE, PLAIN_SPEAK_BENCH, ...clean } = process.env;
  return {
    env: { ...clean, CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexHome },
    claudeDir,
    codexHome,
  };
}

const run = (env, ...args) =>
  execFileSync('node', [cli, ...args], { encoding: 'utf8', env, cwd: os.tmpdir() });

const hook = (env, name, input, cwd = os.tmpdir()) =>
  execFileSync('node', [path.join(root, 'src', 'hooks', name)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env,
    cwd,
  });

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const FUSSY = 'Certainly! We should leverage this and it is important to note the tradeoff.';

test('e2e: install wires both tools and leaves everything else alone', () => {
  const existing = {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'cat ~/.claude/response-rules.md' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }],
    },
    statusLine: { type: 'command', command: 'bash ~/my-statusline.sh' },
    enabledPlugins: { 'someone-else@x': true },
    permissions: { defaultMode: 'auto' },
  };
  const { env, claudeDir, codexHome } = sandbox({ settings: existing });
  const out = run(env, 'install');

  assert.match(out, /hooks \+ badge wired/);
  assert.match(out, /nothing else in your settings was changed/);

  const after = readJson(path.join(claudeDir, 'settings.json'));

  // Ours are present on all three events.
  for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
    const wired = after.hooks[event].some((g) =>
      g.hooks.some((h) => h.command.includes('plain-speak'))
    );
    assert.ok(wired, `${event} not wired`);
  }

  // Theirs survive untouched — including the response-rules hook we no longer remove.
  assert.deepEqual(after.hooks.PreToolUse, existing.hooks.PreToolUse);
  assert.ok(
    after.hooks.SessionStart.some((g) =>
      g.hooks.some((h) => h.command.includes('response-rules.md'))
    ),
    'a pre-existing hook must not be removed'
  );
  assert.deepEqual(after.statusLine, existing.statusLine, 'statusline must not be touched');
  assert.deepEqual(after.enabledPlugins, existing.enabledPlugins);
  assert.deepEqual(after.permissions, existing.permissions);

  // Commands, runtime and Codex.
  assert.ok(fs.existsSync(path.join(claudeDir, 'skills', 'plain-speak', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(claudeDir, 'skills', 'plain-speak-stats', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(claudeDir, 'plain-speak', 'bin', 'cli.js')));
  const codexHooks = readJson(path.join(codexHome, 'hooks.json'));
  assert.equal(Object.keys(codexHooks.hooks).length, 3);
  assert.match(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'), /hooks = true/);

  // A frontmatter name must match its directory or the command never loads.
  const skill = fs.readFileSync(path.join(claudeDir, 'skills', 'plain-speak', 'SKILL.md'), 'utf8');
  assert.match(skill, /^name: plain-speak$/m);

  assert.match(run(env, 'doctor'), /ok {3}SessionStart/);
});

test('e2e: with the plugin enabled, the installer leaves the commands to it', () => {
  const { env, claudeDir } = sandbox({
    settings: { enabledPlugins: { 'plain-speak@plain-speak': true } },
  });
  // An older npx install left these behind. Upgrading has to clear them, or the user
  // sees both /plain-speak and /plain-speak:mode in the picker.
  const stale = path.join(claudeDir, 'skills', 'plain-speak');
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, 'SKILL.md'), 'stale\n');

  const out = run(env, 'install', '--claude');

  assert.match(out, /from the plugin/);
  assert.ok(!fs.existsSync(stale), 'the stale user-level copy must be removed');
  // Hooks still get wired — only the commands are the plugin's job.
  assert.ok(readJson(path.join(claudeDir, 'settings.json')).hooks.Stop.length > 0);
  assert.match(run(env, 'status'), /switch: \/plain-speak:mode/);
  assert.match(run(env, 'doctor'), /ok {3}\/plain-speak:mode/);
});

test('e2e: a disabled plugin provides nothing, so the commands are installed', () => {
  const { env, claudeDir } = sandbox({
    settings: { enabledPlugins: { 'plain-speak@plain-speak': false } },
  });
  run(env, 'install', '--claude');
  assert.ok(fs.existsSync(path.join(claudeDir, 'skills', 'plain-speak', 'SKILL.md')));
});

test('e2e: status re-arms the rules, and says nothing when the mode is off', () => {
  const { env } = sandbox();
  const armed = run(env, 'status', 'cte');
  assert.match(armed, /RULES/);
  assert.match(armed, /PLAIN-SPEAK MODE: cte/);
  assert.match(armed, /Head took hits/, "the mode's own rule text has to be in there");

  const off = run(env, 'status', 'off');
  assert.doesNotMatch(off, /RULES/, 'off means nothing to re-arm');
});

test('e2e: --statusline chains, and a second install does not duplicate', () => {
  const { env, claudeDir } = sandbox({
    settings: { statusLine: { type: 'command', command: 'bash ~/mine.sh' } },
  });
  run(env, 'install', '--claude', '--statusline');
  const chained = readJson(path.join(claudeDir, 'settings.json')).statusLine.command;
  assert.match(chained, /plain-speak-statusline\.sh.*bash ~\/mine\.sh/);

  run(env, 'install', '--claude', '--statusline');
  const after = readJson(path.join(claudeDir, 'settings.json'));
  const count = after.hooks.Stop.flatMap((g) => g.hooks).filter((h) =>
    h.command.includes('plain-speak')
  ).length;
  assert.equal(count, 1, 'reinstalling must not stack hooks');
  assert.equal(
    (after.statusLine.command.match(/plain-speak-statusline\.sh/g) || []).length,
    1,
    'reinstalling must not stack the badge'
  );
});

test('e2e: a whole session — inject once, stay silent, correct on drift, then ease off', () => {
  const { env } = sandbox();
  run(env, 'mode', 'normal');

  // Session start: the rules go in exactly once, hidden from the user.
  const start = JSON.parse(hook(env, 'session-start.js', { session_id: 'e2e', source: 'startup' }));
  assert.equal(start.suppressOutput, true);
  assert.match(start.hookSpecificOutput.additionalContext, /Response Rules/);

  // A clean exchange costs nothing.
  assert.equal(hook(env, 'prompt-submit.js', { session_id: 'e2e', user_prompt: 'port 3000?' }), '');
  hook(env, 'stop.js', { session_id: 'e2e', last_assistant_message: 'Use `lsof -i :3000`.' });
  assert.equal(hook(env, 'prompt-submit.js', { session_id: 'e2e', user_prompt: 'kill it?' }), '');

  // A fussy reply earns a correction on the next prompt.
  hook(env, 'stop.js', { session_id: 'e2e', last_assistant_message: FUSSY });
  const corrected = JSON.parse(
    hook(env, 'prompt-submit.js', { session_id: 'e2e', user_prompt: 'and then?' })
  );
  assert.equal(corrected.suppressOutput, true);
  assert.match(corrected.hookSpecificOutput.additionalContext, /drifted/);
  assert.match(corrected.hookSpecificOutput.additionalContext, /Response Rules/);

  // Immediately drifting again must not produce a second correction.
  hook(env, 'stop.js', { session_id: 'e2e', last_assistant_message: FUSSY });
  assert.equal(
    hook(env, 'prompt-submit.js', { session_id: 'e2e', user_prompt: 'again?' }),
    '',
    'cooldown must hold'
  );

  // Keep drifting: it corrects again, and past the threshold sends a nudge, not the
  // whole ruleset.
  let easedBody = null;
  for (let i = 0; i < 12; i += 1) {
    hook(env, 'stop.js', { session_id: 'e2e', last_assistant_message: FUSSY });
    const out = hook(env, 'prompt-submit.js', { session_id: 'e2e', user_prompt: `more ${i}` });
    if (!out) continue;
    const body = JSON.parse(out).hookSpecificOutput.additionalContext;
    if (/reminder/.test(body)) easedBody = body;
  }
  assert.ok(easedBody, 'it must still correct after many drifts — there is no cap');
  assert.doesNotMatch(easedBody, /Response Rules/, 'eased-off corrections send the short nudge');
});

test('e2e: exemptions and quoting keep it quiet', () => {
  const { env } = sandbox();
  run(env, 'mode', 'cte');

  const cases = [
    ['length requested', { user_prompt: 'explain in detail how TCP works' }, FUSSY],
    ['plan mode', { permission_mode: 'plan' }, FUSSY],
    ['quoting a marker', {}, 'Catches `leverage` and `utilize`.\n\n> Certainly! Happy to help.'],
  ];

  for (const [name, extra, reply] of cases) {
    const id = `ex-${name.replace(/\W/g, '')}`;
    hook(env, 'prompt-submit.js', { session_id: id, user_prompt: extra.user_prompt || 'go' });
    hook(env, 'stop.js', { session_id: id, last_assistant_message: reply, ...extra });
    assert.equal(
      hook(env, 'prompt-submit.js', { session_id: id, user_prompt: 'next' }),
      '',
      `${name} must not trigger a correction`
    );
  }
});

test('e2e: mode precedence — env beats project, project beats global', () => {
  const { env } = sandbox();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-proj-'));
  run(env, 'mode', 'normal');

  execFileSync('node', [cli, 'status', 'cte', '--project'], { env, cwd: project, encoding: 'utf8' });
  assert.equal(fs.readFileSync(path.join(project, '.plain-speak-mode'), 'utf8'), 'cte');

  const inProject = execFileSync('node', [cli, 'status'], { env, cwd: project, encoding: 'utf8' });
  assert.match(inProject, /cte .*from \.plain-speak-mode/);
  assert.match(run(env, 'status'), /plain-speak — normal/, 'global is untouched');

  const withEnv = execFileSync('node', [cli, 'status'], {
    env: { ...env, PLAIN_SPEAK_MODE: 'off' },
    cwd: project,
    encoding: 'utf8',
  });
  assert.match(withEnv, /off \(from PLAIN_SPEAK_MODE\)/);

  // A project pin must reach the hooks, not just the CLI.
  const out = hook(env, 'session-start.js', { session_id: 'p1', source: 'startup' }, project);
  assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /CTE Mode/);
});

test('e2e: switching mode by typing, but only when the prompt is the command', () => {
  const { env } = sandbox();
  run(env, 'mode', 'normal');

  const switched = JSON.parse(
    hook(env, 'prompt-submit.js', { session_id: 'sw', user_prompt: 'plain-speak cte' })
  );
  assert.equal(switched.systemMessage, 'plain-speak: cte');
  assert.match(run(env, 'mode'), /cte/);

  assert.equal(
    hook(env, 'prompt-submit.js', {
      session_id: 'sw',
      user_prompt: 'what does plain-speak off actually do?',
    }),
    ''
  );
  assert.match(run(env, 'mode'), /cte/, 'a question must not switch the mode');
});

test('e2e: badge reflects the mode and disappears when off', () => {
  const { env } = sandbox();
  for (const [mode, expected] of [
    ['normal', /\[PLAIN-SPEAK\]/],
    ['cte', /\[PLAIN-SPEAK 🧠 CTE\]/],
  ]) {
    run(env, 'mode', mode);
    assert.match(run(env, 'badge'), expected);
  }
  run(env, 'mode', 'off');
  assert.equal(run(env, 'badge').trim(), '');
});

test('e2e: off means silent everywhere', () => {
  const { env } = sandbox();
  run(env, 'mode', 'off');
  assert.equal(hook(env, 'session-start.js', { session_id: 'o', source: 'startup' }), '');
  assert.equal(hook(env, 'stop.js', { session_id: 'o', last_assistant_message: FUSSY }), '');
  assert.equal(hook(env, 'prompt-submit.js', { session_id: 'o', user_prompt: 'hi' }), '');
});

test('e2e: stats reports the real session, never a benchmark one', () => {
  const { env } = sandbox();
  run(env, 'mode', 'normal');

  hook({ ...env, PLAIN_SPEAK_BENCH: '1' }, 'stop.js', {
    session_id: 'bench-session',
    last_assistant_message: 'Yes.',
  });
  hook(env, 'stop.js', { session_id: 'real-session', last_assistant_message: 'Yes.' });

  const store = readJson(path.join(env.CLAUDE_CONFIG_DIR, 'plain-speak', 'state.json'));
  assert.equal(store.lastSessionId, 'real-session');
  assert.equal(store.sessions['bench-session'].bench, true);
  assert.equal(store.lifetime.turns, 1, 'benchmark turns must not count');

  const report = JSON.parse(run(env, 'stats', '--json'));
  assert.equal(report.session.turns, 1);
  assert.match(run(env, 'stats'), /holding/);
});

test('e2e: uninstall puts the sandbox back, and --purge clears the data', () => {
  const existing = {
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] },
    statusLine: { type: 'command', command: 'bash ~/mine.sh' },
  };
  const { env, claudeDir } = sandbox({ settings: existing });

  run(env, 'install', '--statusline');
  run(env, 'uninstall');

  const after = readJson(path.join(claudeDir, 'settings.json'));
  assert.deepEqual(after.hooks, existing.hooks, 'their hooks come back untouched');
  assert.deepEqual(after.statusLine, existing.statusLine, 'their statusline comes back');
  assert.ok(!fs.existsSync(path.join(claudeDir, 'skills', 'plain-speak')));
  assert.ok(
    fs.existsSync(path.join(claudeDir, 'plain-speak', 'state.json')) ||
      fs.existsSync(path.join(claudeDir, 'plain-speak', 'mode')),
    'data is kept without --purge'
  );

  run(env, 'uninstall', '--purge');
  assert.ok(!fs.existsSync(path.join(claudeDir, 'plain-speak')), '--purge removes the data');
});

test('e2e: install with no Codex present skips it instead of failing', () => {
  const { env, claudeDir } = sandbox({ codex: false });
  const out = run(env, 'install');
  assert.match(out, /Codex: not installed/);
  assert.ok(fs.existsSync(path.join(claudeDir, 'plain-speak', 'bin', 'cli.js')));
});

test('e2e: a hook fed garbage still exits 0 and stays silent', () => {
  const { env } = sandbox();
  for (const name of ['session-start.js', 'prompt-submit.js', 'stop.js']) {
    const out = execFileSync('node', [path.join(root, 'src', 'hooks', name)], {
      input: '{not json',
      encoding: 'utf8',
      env,
    });
    assert.equal(out, '', `${name} must stay quiet on bad input`);
  }
});
