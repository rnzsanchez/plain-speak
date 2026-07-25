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
  fs.chmodSync(path.join(dir, 'src', 'plain-speak-statusline.sh'), 0o755);
  return dir;
}

// A plugin install already namespaces commands as /plain-speak:<name>, so the skills
// are named short — `mode`, `stats`. A standalone install has no namespace, so bare
// `/mode` and `/stats` would be rude to everything else on the machine: prefix them
// on the way in, and rewrite the frontmatter name to match the directory.
const STANDALONE_NAMES = { mode: 'plain-speak', stats: 'plain-speak-stats' };
const standaloneName = (name) => STANDALONE_NAMES[name] || `plain-speak-${name}`;

function copySkills(targetSkillsDir) {
  const src = path.join(PKG_ROOT, 'skills');
  const installed = [];
  for (const name of fs.readdirSync(src)) {
    const renamed = standaloneName(name);
    const dest = path.join(targetSkillsDir, renamed);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(path.join(src, name), dest, { recursive: true });

    const skillFile = path.join(dest, 'SKILL.md');
    const body = fs.readFileSync(skillFile, 'utf8').replace(
      new RegExp(`^name: ${name}$`, 'm'),
      `name: ${renamed}`
    );
    fs.writeFileSync(skillFile, body);
    installed.push(renamed);
  }
  return installed;
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
  copySkills,
  removeSkills,
  isOurs,
  readJson,
  writeJson,
};
