'use strict';

const fs = require('fs');
const path = require('path');
const state = require('../state');

const PKG_ROOT = path.join(__dirname, '..', '..');

const HOOK_EVENTS = {
  SessionStart: 'session-start.js',
  UserPromptSubmit: 'prompt-submit.js',
  Stop: 'stop.js',
};

const runtimeDir = () => state.homeDir();

// `npx plain-speak install` runs from a temp npm cache that can be pruned at any
// time, so the hooks can't point at it. Copy what they need somewhere stable.
function copyRuntime() {
  const dir = runtimeDir();
  for (const sub of ['src', 'modes', 'bin']) {
    fs.rmSync(path.join(dir, sub), { recursive: true, force: true });
    fs.cpSync(path.join(PKG_ROOT, sub), path.join(dir, sub), { recursive: true });
  }
  fs.chmodSync(path.join(dir, 'src', 'statusline.sh'), 0o755);
  return dir;
}

// Slash commands. Every one is namespaced and marked disable-model-invocation, so
// they only ever run when the user asks for them.
function copySkills(targetSkillsDir) {
  const src = path.join(PKG_ROOT, 'skills');
  const names = fs.readdirSync(src);
  for (const name of names) {
    const dest = path.join(targetSkillsDir, name);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(path.join(src, name), dest, { recursive: true });
  }
  return names;
}

function removeSkills(targetSkillsDir) {
  let names = [];
  try {
    names = fs.readdirSync(targetSkillsDir).filter((n) => n.startsWith('plain-speak'));
  } catch {
    return;
  }
  for (const name of names) {
    fs.rmSync(path.join(targetSkillsDir, name), { recursive: true, force: true });
  }
}

// Only ever our own entries. Everything else in someone's config — other
// plugins, other hooks, their statusline — is left exactly as it was.
function isOurs(command) {
  return typeof command === 'string' && command.includes('plain-speak');
}

// The one exception: the hand-rolled `cat ~/.claude/response-rules.md` hook that
// this package replaces. Removing it is announced, never silent, and the settings
// backup is written first.
function isLegacy(command) {
  return typeof command === 'string' && /response-rules\.md/.test(command);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Keep a one-shot backup the first time we touch someone's settings.
  const backup = `${file}.plain-speak-backup`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

module.exports = {
  PKG_ROOT,
  HOOK_EVENTS,
  runtimeDir,
  copyRuntime,
  copySkills,
  removeSkills,
  isOurs,
  isLegacy,
  readJson,
  writeJson,
};
