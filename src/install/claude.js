'use strict';
// Claude Code wiring: three hooks, a badge chained onto whatever statusline is
// already there, and the /plain-speak-stats skill.

const fs = require('fs');
const path = require('path');
const state = require('../state');
const { copyRuntime, runtimeDir, HOOK_EVENTS, isOurs, readJson, writeJson } = require('./shared');

const settingsPath = () => path.join(state.claudeDir(), 'settings.json');
const skillDir = () => path.join(state.claudeDir(), 'skills', 'plain-speak-stats');

const SKILL = `---
name: plain-speak-stats
description: Token and drift report for plain-speak — this session plus lifetime.
disable-model-invocation: true
allowed-tools: Bash
---

Run this and show the output exactly as printed, with no commentary:

\`\`\`sh
node "$HOME/.claude/plain-speak/bin/cli.js" stats
\`\`\`
`;

function install() {
  const dir = copyRuntime();
  const settings = readJson(settingsPath(), {});
  settings.hooks = settings.hooks || {};

  for (const [event, script] of Object.entries(HOOK_EVENTS)) {
    const command = `node "${path.join(dir, 'src', 'hooks', script)}"`;
    // Drop our own entries and any v1 `cat ~/.claude/response-rules.md` hook, so
    // reinstalling never stacks duplicates and the old always-on rules stop firing.
    const kept = (settings.hooks[event] || [])
      .map((group) => ({
        ...group,
        hooks: (group.hooks || []).filter((h) => !isOurs(h.command)),
      }))
      .filter((group) => group.hooks.length > 0);
    settings.hooks[event] = [...kept, { hooks: [{ type: 'command', command }] }];
  }

  const badge = `bash "${path.join(dir, 'src', 'statusline.sh')}"`;
  const existing = settings.statusLine && settings.statusLine.command;
  if (!existing) {
    settings.statusLine = { type: 'command', command: badge };
  } else if (!existing.includes('plain-speak')) {
    // Prepend, so the badge sits at the front of the first line and the user's
    // own statusline keeps rendering untouched.
    settings.statusLine = { type: 'command', command: `${badge}; ${existing}` };
  }

  writeJson(settingsPath(), settings);
  fs.mkdirSync(skillDir(), { recursive: true });
  fs.writeFileSync(path.join(skillDir(), 'SKILL.md'), SKILL);

  console.log(`Claude Code: hooks + badge wired, runtime at ${dir}`);
  console.log('  /plain-speak-stats installed');
}

function uninstall() {
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
  fs.rmSync(skillDir(), { recursive: true, force: true });
  fs.rmSync(path.join(runtimeDir(), 'src'), { recursive: true, force: true });
  fs.rmSync(path.join(runtimeDir(), 'bin'), { recursive: true, force: true });
  fs.rmSync(path.join(runtimeDir(), 'modes'), { recursive: true, force: true });
  console.log('Claude Code: hooks, badge and skill removed (state.json and mode kept)');
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
  console.log(`  ${cmd.includes('plain-speak') ? 'ok  ' : 'MISS'} statusline badge`);
  console.log(`  ${fs.existsSync(path.join(skillDir(), 'SKILL.md')) ? 'ok  ' : 'MISS'} /plain-speak-stats`);
  console.log(`  mode: ${state.readMode()}`);
}

module.exports = { install, uninstall, doctor };
