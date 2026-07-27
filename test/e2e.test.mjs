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
  const {
    CLAUDE_CODE_SESSION_ID,
    PLAIN_SPEAK_MODE,
    PLAIN_SPEAK_BENCH,
    PLAIN_SPEAK_TARGET,
    PLUGIN_ROOT,
    ...clean
  } = process.env;
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

// What an older standalone install left behind. Built by hand, because the command that
// used to write it is gone — but the machines it ran on still exist, so cleaning up
// after it is still the job.
function legacyClaude(claudeDir, extra = {}) {
  const hooks = path.join(claudeDir, 'plain-speak', 'src', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  const ours = (script) => ({ hooks: [{ type: 'command', command: `node "${path.join(hooks, script)}"` }] });
  const settings = {
    ...extra,
    hooks: {
      ...(extra.hooks || {}),
      SessionStart: [...((extra.hooks || {}).SessionStart || []), ours('session-start.js')],
      UserPromptSubmit: [ours('prompt-submit.js')],
      Stop: [ours('stop.js')],
    },
  };
  fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(settings, null, 2));
  for (const name of ['plain-speak', 'plain-speak-stats']) {
    fs.mkdirSync(path.join(claudeDir, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'skills', name, 'SKILL.md'), `name: ${name}\n`);
  }
  return settings;
}

function legacyCodex(codexHome) {
  const hooks = path.join(codexHome, 'plain-speak', 'src', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, 'hooks.json'),
    JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: `node "${path.join(hooks, 'stop.js')}"` }] },
          { hooks: [{ type: 'command', command: 'node /somebody/else.js' }] },
        ],
      },
    })
  );
  fs.mkdirSync(path.join(codexHome, 'skills', 'plain-speak'), { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'skills', 'plain-speak', 'SKILL.md'), 'name: plain-speak\n');
}
const FUSSY = 'Certainly! We should leverage this and it is important to note the tradeoff.';


test('e2e: status re-arms the rules, and says nothing when the mode is off', () => {
  const { env } = sandbox();
  const armed = run(env, 'status', 'cte');
  assert.match(armed, /RULES/);
  assert.match(armed, /PLAIN-SPEAK MODE: cte/);
  assert.match(armed, /Head took hits/, "the mode's own rule text has to be in there");

  const off = run(env, 'status', 'off');
  assert.doesNotMatch(off, /RULES/, 'off means nothing to re-arm');
});

test('e2e: the mode command clears an older standalone install and leaves the rest alone', () => {
  const { env, claudeDir } = sandbox();
  const before = legacyClaude(claudeDir, {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'cat ~/.claude/response-rules.md' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }],
    },
    statusLine: { type: 'command', command: 'bash ~/mine.sh' },
    enabledPlugins: { 'someone-else@x': true },
    permissions: { defaultMode: 'auto' },
  });

  const out = run(env, 'status');
  assert.match(out, /removed 3 superseded hook entries/);
  assert.match(out, /badge added to the front of your statusline/);
  assert.match(out, /removed duplicate \/plain-speak \/plain-speak-stats/);

  const after = readJson(path.join(claudeDir, 'settings.json'));
  // Ours are gone from all three events — the plugin carries them now.
  for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
    const ours = (after.hooks[event] || []).flatMap((g) => g.hooks).filter((h) => h.command.includes('plain-speak'));
    assert.equal(ours.length, 0, `${event} still carries a standalone hook`);
  }
  // Theirs survive, including the one sharing an event with ours.
  assert.deepEqual(after.hooks.PreToolUse, before.hooks.PreToolUse);
  assert.ok(
    after.hooks.SessionStart.some((g) => g.hooks.some((h) => h.command.includes('response-rules.md'))),
    'a pre-existing hook must not be removed'
  );
  assert.deepEqual(after.enabledPlugins, before.enabledPlugins);
  assert.deepEqual(after.permissions, before.permissions);
  // The badge goes in front of their statusline, never instead of it.
  assert.match(after.statusLine.command, /plain-speak-statusline\.sh.*bash ~\/mine\.sh/);
  assert.ok(!fs.existsSync(path.join(claudeDir, 'skills', 'plain-speak')));
});

test('e2e: tidy is idempotent — a clean machine is silent and the badge never stacks', () => {
  const { env, claudeDir } = sandbox();
  const first = run(env, 'status');
  assert.match(first, /badge installed as your statusline/);

  const second = run(env, 'status');
  assert.doesNotMatch(second, /plain-speak: /, 'a machine that is already right says nothing');

  const command = readJson(path.join(claudeDir, 'settings.json')).statusLine.command;
  assert.equal((command.match(/plain-speak-statusline\.sh/g) || []).length, 1, 'the badge must not stack');
});

test('e2e: a statusline that already renders plugin badges is left alone', () => {
  const { env, claudeDir } = sandbox();
  // A statusline that runs every installed plugin's *-statusline.sh already draws our
  // badge. Adding ours in front of it would draw it twice.
  const theirs = path.join(claudeDir, 'their-statusline.sh');
  fs.writeFileSync(theirs, "#!/bin/bash\nfind \"$p\" -name '*-statusline.sh'\n");
  fs.writeFileSync(
    path.join(claudeDir, 'settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: `bash ${theirs}` } })
  );

  const out = run(env, 'status');
  assert.doesNotMatch(out, /badge/, 'it must not announce a badge it did not add');

  const after = readJson(path.join(claudeDir, 'settings.json'));
  assert.equal(after.statusLine.command, `bash ${theirs}`, 'their statusline must be untouched');
});

test('e2e: a plain statusline keeps working behind the badge', () => {
  const { env, claudeDir } = sandbox({
    settings: { statusLine: { type: 'command', command: 'bash ~/mine.sh' } },
  });
  run(env, 'status');
  const command = readJson(path.join(claudeDir, 'settings.json')).statusLine.command;
  assert.match(command, /plain-speak-statusline\.sh"; bash ~\/mine\.sh/);
});

test('e2e: under Codex, tidy clears its own wiring and switches hooks on', () => {
  const { env, claudeDir, codexHome } = sandbox();
  legacyCodex(codexHome);
  const codexEnv = { ...env, PLAIN_SPEAK_TARGET: 'codex' };

  const out = run(codexEnv, 'status');
  assert.match(out, /removed 1 superseded hook entry/);
  assert.match(out, /enabled \[features\] hooks = true/);
  assert.match(out, /removed duplicate \$plain-speak/);

  const hooks = readJson(path.join(codexHome, 'hooks.json')).hooks;
  const left = Object.values(hooks).flatMap((groups) => groups.flatMap((g) => g.hooks));
  assert.equal(left.length, 1, 'only the unrelated hook survives');
  assert.match(left[0].command, /somebody\/else/);
  assert.match(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'), /hooks = true/);
  // No badge for Codex, and the Claude side is not touched from a Codex session.
  assert.ok(!fs.existsSync(path.join(claudeDir, 'settings.json')));

  assert.doesNotMatch(run(codexEnv, 'status'), /plain-speak: /, 'second run must be silent');
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

test('e2e: Claude and Codex modes and project pins are isolated', () => {
  const { env, claudeDir, codexHome } = sandbox();
  const codexEnv = { ...env, PLAIN_SPEAK_TARGET: 'codex' };
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-proj-'));

  run(env, 'mode', 'normal');
  run(codexEnv, 'mode', 'cte');

  assert.equal(fs.readFileSync(path.join(claudeDir, 'plain-speak', 'mode'), 'utf8'), 'normal');
  assert.equal(fs.readFileSync(path.join(codexHome, 'plain-speak', 'mode'), 'utf8'), 'cte');
  assert.match(run(env, 'mode'), /normal/);
  assert.match(run(codexEnv, 'mode'), /cte/);
  assert.match(run(codexEnv, 'status'), /switch: plain speak off \| normal \| cte/);
  assert.doesNotMatch(run(codexEnv, 'status'), /\/plain-speak/);

  execFileSync('node', [cli, 'status', 'off', '--project'], {
    env,
    cwd: project,
    encoding: 'utf8',
  });
  execFileSync('node', [cli, 'status', 'normal', '--project'], {
    env: codexEnv,
    cwd: project,
    encoding: 'utf8',
  });

  assert.equal(fs.readFileSync(path.join(project, '.plain-speak-mode'), 'utf8'), 'off');
  assert.equal(fs.readFileSync(path.join(project, '.plain-speak-codex-mode'), 'utf8'), 'normal');
  assert.match(
    execFileSync('node', [cli, 'status'], { env, cwd: project, encoding: 'utf8' }),
    /off \(from \.plain-speak-mode/
  );
  assert.match(
    execFileSync('node', [cli, 'status'], { env: codexEnv, cwd: project, encoding: 'utf8' }),
    /normal \(from \.plain-speak-codex-mode/
  );
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
  assert.match(run(env, 'stats'), /stayed short/);
});

test('e2e: the savings figure counts prose only, and nets off what the rules cost', () => {
  const { env } = sandbox();
  run(env, 'mode', 'normal');

  // A transcript with one reply: 1,000 output tokens, split by size between what the
  // model said and the tool call it made.
  const file = path.join(env.CLAUDE_CONFIG_DIR, 'transcript.jsonl');
  const msg = (content) => ({
    type: 'assistant',
    message: {
      id: 'm1',
      model: 'claude-opus-5',
      usage: { output_tokens: 1000 },
      content: [content],
    },
  });
  fs.writeFileSync(
    file,
    [
      JSON.stringify(msg({ type: 'text', text: 'x'.repeat(250) })),
      JSON.stringify(msg({ type: 'tool_use', input: { cmd: 'y'.repeat(740) } })),
    ].join('\n')
  );

  // Through the module, not the CLI: `stats` finds its own transcript by session id,
  // and this needs a made-up one with a known split.
  const r = JSON.parse(
    execFileSync(
      'node',
      [
        '-e',
        `const s=require(${JSON.stringify(path.join(root, 'src', 'stats.js'))});
         console.log(JSON.stringify(s.report({sessionId:'x', transcriptPath:process.argv[1]})));`,
        file,
      ],
      { encoding: 'utf8', env, cwd: os.tmpdir() }
    )
  );
  assert.equal(r.session.transcript.outputTokens, 1000, 'usage is counted once per message');
  assert.ok(r.session.transcript.proseTokens < 400, 'the tool call is not prose');
  assert.ok(r.session.saved < r.session.transcript.outputTokens, 'never scaled across tool traffic');
  assert.equal(r.session.net, r.session.saved - r.session.spent);
});

test('e2e: uninstall puts the sandbox back, and --purge clears the data', () => {
  const existing = {
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] },
    statusLine: { type: 'command', command: 'bash ~/mine.sh' },
  };
  const { env, claudeDir, codexHome } = sandbox();
  legacyClaude(claudeDir, existing);
  legacyCodex(codexHome);
  // Give both tools something to keep, so --purge has data to remove.
  run(env, 'mode', 'cte');
  run({ ...env, PLAIN_SPEAK_TARGET: 'codex' }, 'mode', 'cte');
  // The badge is the one thing tidy adds, so uninstall has to take it back out.
  run(env, 'status');
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
  assert.ok(!fs.existsSync(path.join(codexHome, 'plain-speak')), '--purge removes Codex data');
});

test('e2e: Codex uninstall cleans skills and runtime without hooks.json', () => {
  const { env, codexHome } = sandbox();
  const codexEnv = { ...env, PLAIN_SPEAK_TARGET: 'codex' };
  legacyCodex(codexHome);
  run(codexEnv, 'mode', 'cte');
  fs.mkdirSync(path.join(codexHome, 'plain-speak', 'bin'), { recursive: true });
  fs.rmSync(path.join(codexHome, 'hooks.json'));

  run(env, 'uninstall', '--codex');

  assert.ok(!fs.existsSync(path.join(codexHome, 'skills', 'plain-speak')));
  assert.ok(!fs.existsSync(path.join(codexHome, 'plain-speak', 'bin')));
  assert.ok(fs.existsSync(path.join(codexHome, 'plain-speak', 'mode')));
});

test('e2e: with no Codex on the machine, tidy does nothing rather than failing', () => {
  const { env, claudeDir } = sandbox({ codex: false });
  const out = run({ ...env, PLAIN_SPEAK_TARGET: 'codex' }, 'status');
  assert.doesNotMatch(out, /plain-speak: /, 'nothing to tidy when there is no Codex');
  assert.match(out, /switch: plain speak/);
  assert.ok(!fs.existsSync(path.join(claudeDir, 'settings.json')), 'and Claude is left alone');
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
