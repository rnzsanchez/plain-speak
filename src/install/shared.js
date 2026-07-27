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

const runtimeDir = (target) => state.homeDir(target);

// `npx plain-speak install` runs from a temp npm cache that can be pruned at any
// time, so the hooks can't point at it. Copy what they need somewhere stable.
function copyRuntime(target) {
  const dir = runtimeDir(target);
  for (const sub of ['src', 'modes', 'bin']) {
    fs.rmSync(path.join(dir, sub), { recursive: true, force: true });
    fs.cpSync(path.join(PKG_ROOT, sub), path.join(dir, sub), { recursive: true });
  }
  fs.chmodSync(path.join(dir, 'src', 'plain-speak-statusline.sh'), 0o755);
  return dir;
}

// Returns what it removed, so a caller that only wants to report real changes can tell
// the difference between "cleaned two" and "there was nothing there".
function removeSkills(targetSkillsDir) {
  let names = [];
  try {
    names = fs.readdirSync(targetSkillsDir).filter((n) => n.startsWith('plain-speak'));
  } catch {
    return [];
  }
  for (const name of names) {
    fs.rmSync(path.join(targetSkillsDir, name), { recursive: true, force: true });
  }
  return names;
}

// Only ever our own entries. Installing is purely additive: every other hook, every
// other plugin, and your statusline are left exactly as they were. Nothing is
// replaced, so a fresh machine and a fully-loaded one behave the same.
function isOurs(command) {
  return typeof command === 'string' && command.includes('plain-speak');
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
  HOOK_EVENTS,
  runtimeDir,
  copyRuntime,
  removeSkills,
  isOurs,
  readJson,
  writeJson,
};
