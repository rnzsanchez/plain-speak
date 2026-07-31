'use strict';
// Shared hook plumbing. Claude Code and Codex fire the same three events with
// near-identical payloads — the only difference that matters is the prompt field
// name (`user_prompt` vs `prompt`), so one adapter covers both tools.

const fs = require('fs');
const path = require('path');

const MODES_DIR = path.join(__dirname, '..', '..', 'modes');

// Returns null when there is nothing usable, so the hook can decline to act rather
// than guessing. Acting on a payload we could not read is how you get state written
// under a session id of "unknown".
function readInput() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalize(data) {
  return {
    sessionId:
      typeof data.session_id === 'string' && /^[A-Za-z0-9._-]+$/.test(data.session_id)
        ? data.session_id
        : null,
    prompt: data.user_prompt || data.prompt || '',
    reply: data.last_assistant_message || '',
    permissionMode: data.permission_mode || '',
    cwd: data.cwd || process.cwd(),
  };
}

function rulesFor(mode) {
  try {
    return fs.readFileSync(path.join(MODES_DIR, `${mode}.md`), 'utf8').trim();
  } catch {
    return '';
  }
}

// Plain stdout would work, but it shows up in the transcript. The hygiene work is
// meant to be invisible: `additionalContext` reaches the model, `suppressOutput`
// keeps it out of the user's view. Both tools accept this envelope.
function inject(hookEventName, text) {
  if (!text) return;
  process.stdout.write(
    JSON.stringify({
      suppressOutput: true,
      hookSpecificOutput: { hookEventName, additionalContext: text },
    })
  );
}

// For the one thing the user did ask to see: their own mode switch.
function notify(hookEventName, message, context) {
  process.stdout.write(
    JSON.stringify({
      suppressOutput: true,
      systemMessage: message,
      hookSpecificOutput: { hookEventName, additionalContext: context || '' },
    })
  );
}

// A hook that throws is a hook that breaks someone's session, so everything is wrapped
// and every path exits 0. Silence makes bugs invisible, though — PLAIN_SPEAK_DEBUG=1
// puts the error on stderr, which the harness shows in its debug log.
function run(fn, { emptyJsonOnCodex = false } = {}) {
  try {
    const data = readInput();
    const input = data && typeof data === 'object' ? normalize(data) : null;
    if (input && input.sessionId) fn(input);
  } catch (err) {
    if (process.env.PLAIN_SPEAK_DEBUG === '1') {
      process.stderr.write(`plain-speak hook failed: ${err && err.stack ? err.stack : err}\n`);
    }
  }
  // Codex Stop rejects an empty stdout stream, while Claude's Stop hook wants no
  // visible output. `{}` is the smallest valid Codex response and changes nothing.
  if (emptyJsonOnCodex && (process.env.PLAIN_SPEAK_TARGET === 'codex' || process.env.PLUGIN_ROOT)) {
    process.stdout.write('{}');
  }
  process.exit(0);
}

module.exports = { run, rulesFor, inject, notify };
