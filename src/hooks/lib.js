'use strict';
// Shared hook plumbing. Claude Code and Codex fire the same three events with
// near-identical payloads — the only difference that matters is the prompt field
// name (`user_prompt` vs `prompt`), so one adapter covers both tools.

const fs = require('fs');
const path = require('path');

const MODES_DIR = path.join(__dirname, '..', '..', 'modes');

function readInput() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalize(data) {
  return {
    sessionId: data.session_id || 'unknown',
    prompt: data.user_prompt || data.prompt || '',
    reply: data.last_assistant_message || '',
    permissionMode: data.permission_mode || '',
    cwd: data.cwd || process.cwd(),
    transcriptPath: data.transcript_path || '',
    source: data.source || '',
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

// A hook that throws is a hook that breaks someone's session. Everything is
// wrapped, and every path exits 0.
function run(fn) {
  try {
    fn(normalize(readInput()));
  } catch {}
  process.exit(0);
}

module.exports = { run, rulesFor, inject, notify, normalize, readInput };
