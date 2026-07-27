'use strict';
// Claude Code wiring: three hooks, a badge chained onto whatever statusline is
// already there, and the /plain-speak slash commands.

const fs = require('fs');
const os = require('os');
const path = require('path');
const state = require('../state');
const {
  copyRuntime,
  removeSkills,
  runtimeDir,
  HOOK_EVENTS,
  isOurs,
  readJson,
  writeJson,
} = require('./shared');

const settingsPath = () => path.join(state.claudeDir(), 'settings.json');
const skillsDir = () => path.join(state.claudeDir(), 'skills');

// A statusline can render plugin badges itself, by globbing `*-statusline.sh` under each
// installed plugin. Putting our badge in front of one of those draws it twice, so read
// the scripts the statusline actually runs and look for that glob.
// ponytail: matches the `*-statusline.sh` convention only. A statusline that finds plugin
// badges some other way would still double up; teach it that shape when one turns up.
function rendersPluginBadges(command) {
  for (const token of command.split(/[\s;|&]+/)) {
    if (!/\.(sh|bash)$/.test(token)) continue;
    const file = token.replace(/^["']|["']$/g, '').replace(/^~/, os.homedir());
    try {
      if (fs.readFileSync(file, 'utf8').includes('-statusline.sh')) return true;
    } catch {}
  }
  return false;
}

// Everything the plugin cannot do for itself, done once when the mode command runs:
// clear the wiring an older standalone install left behind, and put the badge in the
// statusline. Idempotent — it writes only what differs and returns what it changed, so
// a machine that is already right says nothing at all.
//
// The badge points at the copied runtime rather than the plugin root on purpose: the
// plugin root carries a version in its path, so a settings.json pointing there breaks
// on the next update. The copy is at a fixed path and gets refreshed here.
function tidy() {
  const notes = [];
  const dir = copyRuntime('claude');
  const settings = readJson(settingsPath(), {});
  let changed = false;

  // Hooks come from the plugin now. Entries left by an older standalone install fire
  // the same three hooks a second time, which injects the rules twice.
  let stale = 0;
  for (const event of Object.keys(HOOK_EVENTS)) {
    const groups = (settings.hooks && settings.hooks[event]) || [];
    const ours = groups.flatMap((g) => g.hooks || []).filter((h) => isOurs(h.command)).length;
    if (!ours) continue;
    stale += ours;
    const kept = groups
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h.command)) }))
      .filter((g) => g.hooks.length > 0);
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
    changed = true;
  }
  if (stale) notes.push(`removed ${stale} superseded hook ${stale === 1 ? 'entry' : 'entries'} — the plugin carries them now`);

  const badge = `bash "${path.join(dir, 'src', 'plain-speak-statusline.sh')}"`;
  const existing = settings.statusLine && settings.statusLine.command;
  if (!existing) {
    settings.statusLine = { type: 'command', command: badge };
    notes.push('badge installed as your statusline');
    changed = true;
  } else if (!existing.includes('plain-speak') && !rendersPluginBadges(existing)) {
    // Yours stays yours — the badge goes in front of it, never instead of it. The badge
    // script emits its own trailing space, so the two never run together.
    settings.statusLine = { ...settings.statusLine, type: 'command', command: `${badge}; ${existing}` };
    notes.push('badge added to the front of your statusline');
    changed = true;
  }

  if (changed) writeJson(settingsPath(), settings);

  // The plugin namespaces its own commands, so user-level copies from an older install
  // put every command in the picker twice.
  const removed = removeSkills(skillsDir());
  if (removed.length) notes.push(`removed duplicate ${removed.map((n) => `/${n}`).join(' ')}`);

  return notes;
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

module.exports = { tidy, uninstall, doctor, hasBareCommands, pluginInstalled };
