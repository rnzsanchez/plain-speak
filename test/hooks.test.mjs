import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const hook = (name, input, env = {}) =>
  execFileSync('node', [path.join(root, 'src', 'hooks', name)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-speak-test-'));
  fs.mkdirSync(path.join(dir, 'plain-speak'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'plain-speak', 'mode'), 'cte');
  return { CLAUDE_CONFIG_DIR: dir };
}

const FUSSY = 'Certainly! We should leverage this and it is important to note the tradeoff.';

test('injection is hidden from the user and carries the rules to the model', () => {
  const env = sandbox();
  const out = hook('session-start.js', { session_id: 's', source: 'startup' }, env);
  const json = JSON.parse(out);
  assert.equal(json.suppressOutput, true, 'must not appear in the transcript');
  assert.equal(json.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(json.hookSpecificOutput.additionalContext, /CTE Mode/);
});

test('an ordinary prompt produces no output at all', () => {
  const env = sandbox();
  hook('session-start.js', { session_id: 's', source: 'startup' }, env);
  const out = hook('prompt-submit.js', { session_id: 's', user_prompt: 'what is a CDN' }, env);
  assert.equal(out, '');
});

test('drift reinjects silently', () => {
  const env = sandbox();
  hook('stop.js', { session_id: 's', last_assistant_message: FUSSY }, env);
  const out = hook('prompt-submit.js', { session_id: 's', user_prompt: 'go on' }, env);
  const json = JSON.parse(out);
  assert.equal(json.suppressOutput, true);
  assert.match(json.hookSpecificOutput.additionalContext, /drifted/);
});

test('the Stop hook itself never emits anything', () => {
  const env = sandbox();
  assert.equal(hook('stop.js', { session_id: 's', last_assistant_message: FUSSY }, env), '');
});

test('a mode switch is the one thing the user sees', () => {
  const env = sandbox();
  const out = hook('prompt-submit.js', { session_id: 's', user_prompt: 'plain-speak normal' }, env);
  const json = JSON.parse(out);
  assert.equal(json.systemMessage, 'plain-speak: normal');
  assert.equal(fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR, 'plain-speak', 'mode'), 'utf8'), 'normal');
});

test('mentioning a mode does not switch it', () => {
  const env = sandbox();
  const out = hook(
    'prompt-submit.js',
    { session_id: 's', user_prompt: 'what does plain-speak off actually do?' },
    env
  );
  assert.equal(out, '', 'a question about the command is not the command');
  assert.equal(
    fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR, 'plain-speak', 'mode'), 'utf8'),
    'cte',
    'mode untouched'
  );
});

test('mode off silences everything', () => {
  const env = sandbox();
  fs.writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, 'plain-speak', 'mode'), 'off');
  assert.equal(hook('session-start.js', { session_id: 's', source: 'startup' }, env), '');
  assert.equal(hook('stop.js', { session_id: 's', last_assistant_message: FUSSY }, env), '');
  assert.equal(hook('prompt-submit.js', { session_id: 's', user_prompt: 'hi' }, env), '');
});

test('a Codex payload works unchanged', () => {
  const claude = sandbox();
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-speak-codex-test-'));
  fs.mkdirSync(path.join(codexHome, 'plain-speak'), { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'plain-speak', 'mode'), 'cte');
  const env = { ...claude, CODEX_HOME: codexHome, PLAIN_SPEAK_TARGET: 'codex' };
  hook('stop.js', { session_id: 'c', last_assistant_message: FUSSY }, env);
  // Codex names the field `prompt`, not `user_prompt`.
  const out = hook('prompt-submit.js', { session_id: 'c', prompt: 'keep going' }, env);
  assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /drifted/);
  assert.ok(fs.existsSync(path.join(codexHome, 'plain-speak', 'state.json')));
  assert.ok(!fs.existsSync(path.join(claude.CLAUDE_CONFIG_DIR, 'plain-speak', 'state.json')));
});

test('Codex plugin SessionStart refreshes its stable runtime only', () => {
  const claude = sandbox();
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-speak-codex-test-'));
  fs.mkdirSync(path.join(codexHome, 'plain-speak'), { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'plain-speak', 'mode'), 'cte');

  const out = hook(
    'session-start.js',
    { session_id: 'plugin', source: 'startup' },
    { ...claude, CODEX_HOME: codexHome, PLUGIN_ROOT: root }
  );

  assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /CTE Mode/);
  assert.ok(fs.existsSync(path.join(codexHome, 'plain-speak', 'bin', 'cli.js')));
  assert.equal(
    fs.readFileSync(path.join(claude.CLAUDE_CONFIG_DIR, 'plain-speak', 'mode'), 'utf8'),
    'cte'
  );
});
