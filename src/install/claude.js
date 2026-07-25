'use strict';
// Claude Code wiring: three hooks, a badge chained onto whatever statusline is
// already there, and the /plain-speak slash commands.

const fs = require('fs');
const path = require('path');
const state = require('../state');
const {
  copyRuntime,
  copySkills,
  removeSkills,
  runtimeDir,
  HOOK_EVENTS,
  isOurs,
  readJson,
  writeJson,
} = require('./shared');

const settingsPath = () => path.join(state.claudeDir(), 'settings.json');
const skillsDir = () => path.join(state.claudeDir(), 'skills');

function install({ chainStatusline = false } = {}) {
  const dir = copyRuntime();
  const settings = readJson(settingsPath(), {});
  settings.hooks = settings.hooks || {};

  for (const [event, script] of Object.entries(HOOK_EVENTS)) {
    const command = `node "${path.join(dir, 'src', 'hooks', script)}"`;
    // Drop only our own entries, so reinstalling never stacks duplicates. Every
    // other hook on the event is carried through untouched.
    const kept = (settings.hooks[event] || [])
      .map((group) => ({
        ...group,
        hooks: (group.hooks || []).filter((h) => !isOurs(h.command)),
      }))
      .filter((group) => group.hooks.length > 0);
    settings.hooks[event] = [...kept, { hooks: [{ type: 'command', command }] }];
  }

  // Your statusline is yours. If one is already configured we do not touch it —
  // rearranging someone's status bar is not this installer's business. Pass
  // --statusline to chain the badge on anyway, or place `badge` wherever your own
  // statusline wants it.
  const badge = `bash "${path.join(dir, 'src', 'plain-speak-statusline.sh')}"`;
  const existing = settings.statusLine && settings.statusLine.command;
  let badgeNote;
  if (!existing) {
    settings.statusLine = { type: 'command', command: badge };
    badgeNote = 'badge installed as your statusline';
  } else if (existing.includes('plain-speak')) {
    badgeNote = 'badge already in your statusline';
  } else if (chainStatusline) {
    settings.statusLine = { type: 'command', command: `${badge}; ${existing}` };
    badgeNote = 'badge prepended to your existing statusline';
  } else {
    badgeNote = `statusline left alone — add it yourself with: ${badge}`;
  }

  writeJson(settingsPath(), settings);
  fs.mkdirSync(skillsDir(), { recursive: true });
  const skills = copySkills(skillsDir());

  console.log(`Claude Code: hooks + badge wired, runtime at ${dir}`);
  console.log(`  commands: ${skills.map((s) => `/${s}`).join(' ')}`);
  console.log(`  ${badgeNote}`);
  console.log(`  settings backed up to ${settingsPath()}.plain-speak-backup`);
  console.log('  nothing else in your settings was changed');
}

function uninstall({ keepRuntime = false } = {}) {
  const settings = readJson(settingsPath(), null);
  if (settings && settings.hooks) {
    for (const event of Object.keys(HOOK_EVENTS)) {
      settings.hooks[event] = (settings.hooks[event] || [])
        .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h.command)) }))
        .filter((g) => g.hooks.length > 0);
      if (settings.hooks[event].length === 0) delete settings.hooks[event];
    }
    const cmd = settings.statusLine && settings.statusLine.command;
    if (cmd && cmd.includes('plain-speak')) {
      const rest = cmd
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s && !s.includes('plain-speak'))
        .join('; ');
      if (rest) settings.statusLine.command = rest;
      else delete settings.statusLine;
    }
    writeJson(settingsPath(), settings);
  }
  removeSkills(skillsDir());
  // Codex hooks point at the same runtime copy, so only a full uninstall removes it.
  if (!keepRuntime) {
    for (const sub of ['src', 'bin', 'modes']) {
      fs.rmSync(path.join(runtimeDir(), sub), { recursive: true, force: true });
    }
  }
  console.log('Claude Code: hooks, badge and commands removed (state.json and mode kept)');
}

function doctor() {
  const settings = readJson(settingsPath(), {});
  const hooks = settings.hooks || {};
  console.log('Claude Code');
  for (const event of Object.keys(HOOK_EVENTS)) {
    const wired = (hooks[event] || []).some((g) => (g.hooks || []).some((h) => isOurs(h.command)));
    console.log(`  ${wired ? 'ok  ' : 'MISS'} ${event}`);
  }
  const cmd = (settings.statusLine && settings.statusLine.command) || '';
  console.log(`  ${cmd.includes('plain-speak') ? 'ok  ' : 'none'} statusline badge`);
  for (const name of ['plain-speak', 'plain-speak-stats']) {
    const there = fs.existsSync(path.join(skillsDir(), name, 'SKILL.md'));
    console.log(`  ${there ? 'ok  ' : 'MISS'} /${name}`);
  }
  console.log(`  mode: ${state.readMode()}`);
}

module.exports = { install, uninstall, doctor };
