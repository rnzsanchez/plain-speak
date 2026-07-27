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
  const dir = copyRuntime('claude');
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

  // The plugin already carries the commands as /plain-speak:init and /plain-speak:stats.
  // Copying user-level ones on top shows every command twice in the picker, so don't.
  let commands = '/plain-speak:init /plain-speak:stats (from the plugin)';
  if (pluginInstalled(settings)) {
    // An earlier npx install may have left user-level copies behind. Leaving them is
    // what puts every command in the picker twice, so clear them on the way past.
    removeSkills(skillsDir());
  } else {
    fs.mkdirSync(skillsDir(), { recursive: true });
    commands = copySkills(skillsDir())
      .map((s) => `/${s}`)
      .join(' ');
  }

  console.log(`Claude Code: hooks + badge wired, runtime at ${dir}`);
  console.log(`  commands: ${commands}`);
  console.log(`  ${badgeNote}`);
  console.log(`  settings backed up to ${settingsPath()}.plain-speak-backup`);
  console.log('  nothing else in your settings was changed');
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
  removeSkills(skillsDir());
  for (const sub of ['src', 'bin', 'modes']) {
    fs.rmSync(path.join(runtimeDir('claude'), sub), { recursive: true, force: true });
  }
  console.log('Claude Code: hooks, badge and commands removed (state.json and mode kept)');
}

function doctor() {
  const settings = readJson(settingsPath(), {});
  const hooks = settings.hooks || {};
  // A plugin install wires its hooks from the plugin's own manifest, so settings.json
  // is empty by design. Reporting MISS there makes a healthy install look broken.
  const plugin = pluginInstalled(settings);
  console.log('Claude Code');
  for (const event of Object.keys(HOOK_EVENTS)) {
    const wired = (hooks[event] || []).some((g) => (g.hooks || []).some((h) => isOurs(h.command)));
    if (wired) console.log(`  ok   ${event}`);
    else console.log(`  ${plugin ? 'ok  ' : 'MISS'} ${event}${plugin ? ' (from the plugin)' : ''}`);
  }
  const cmd = (settings.statusLine && settings.statusLine.command) || '';
  if (cmd.includes('plain-speak')) console.log('  ok   statusline badge');
  else if (plugin) console.log('  ok   statusline badge (from the plugin, if yours renders them)');
  else console.log('  none statusline badge');
  if (plugin) {
    console.log('  ok   /plain-speak:init /plain-speak:stats (from the plugin)');
  } else {
    for (const name of ['plain-speak', 'plain-speak-stats']) {
      const there = fs.existsSync(path.join(skillsDir(), name, 'SKILL.md'));
      console.log(`  ${there ? 'ok  ' : 'none'} /${name}`);
    }
  }
  console.log(`  mode: ${state.readMode(process.cwd(), 'claude')}`);
}

const hasBareCommands = () => fs.existsSync(path.join(skillsDir(), 'plain-speak', 'SKILL.md'));

// `plain-speak@plain-speak` is the marketplace form; match any owner. The value matters:
// disabling a plugin leaves the key behind set to false, and a disabled plugin provides
// no commands, so treating it as installed would leave the user with none at all.
const pluginInstalled = (settings) =>
  Object.entries(settings.enabledPlugins || {}).some(([k, on]) => on && k.startsWith('plain-speak@'));

module.exports = { install, uninstall, doctor, hasBareCommands, pluginInstalled };
