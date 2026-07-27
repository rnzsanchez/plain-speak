'use strict';
// Codex CLI wiring. Same three events, same payload shape, so the same hook
// scripts run unchanged — only the config format differs.

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  removeSkills,
  HOOK_EVENTS,
  isOurs,
  readJson,
  writeJson,
} = require('./shared');

const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const hooksPath = () => path.join(codexHome(), 'hooks.json');
const configPath = () => path.join(codexHome(), 'config.toml');

// Scoped to the [features] table. A bare /hooks = true/ search would match the key in
// somebody else's table and skip the edit, leaving hooks quietly disabled.
function featureEnabled(toml) {
  const section = toml.split(/^\[/m).find((s) => s.startsWith('features]'));
  return Boolean(section && /^\s*hooks\s*=\s*true/m.test(section));
}

// Same scoping reason as featureEnabled: the plugin's own table, not a stray key.
function pluginInstalled(toml) {
  const section = toml.split(/^\[/m).find((s) => s.startsWith('plugins."plain-speak@'));
  return Boolean(section && /^\s*enabled\s*=\s*true/m.test(section));
}

function enableHooksFeature() {
  const file = configPath();
  let toml = '';
  try {
    toml = fs.readFileSync(file, 'utf8');
  } catch {}
  if (featureEnabled(toml)) return false;

  if (/^\[features\]/m.test(toml)) {
    toml = toml.replace(/^\[features\]/m, '[features]\nhooks = true');
  } else {
    toml += `${toml.endsWith('\n') || !toml ? '' : '\n'}\n[features]\nhooks = true\n`;
  }
  fs.mkdirSync(codexHome(), { recursive: true });
  const backup = `${file}.plain-speak-backup`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  fs.writeFileSync(file, toml);
  return true;
}

// The Codex counterpart of the Claude tidy: clear what an older standalone install left
// in hooks.json and skills/, and make sure hooks are switched on at all. No badge —
// Codex builds its own status line and takes no command to render one.
function tidy() {
  const notes = [];
  if (!fs.existsSync(codexHome())) return notes;

  const config = readJson(hooksPath(), null);
  let stale = 0;
  if (config && config.hooks) {
    for (const event of Object.keys(HOOK_EVENTS)) {
      const groups = config.hooks[event] || [];
      const ours = groups.flatMap((g) => g.hooks || []).filter((h) => isOurs(h.command)).length;
      if (!ours) continue;
      stale += ours;
      const kept = groups
        .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h.command)) }))
        .filter((g) => g.hooks.length > 0);
      if (kept.length) config.hooks[event] = kept;
      else delete config.hooks[event];
    }
    if (stale) {
      writeJson(hooksPath(), config);
      notes.push(`removed ${stale} superseded hook ${stale === 1 ? 'entry' : 'entries'} — the plugin carries them now`);
    }
  }

  // Without this the plugin's own hooks never run, and nothing says why.
  if (enableHooksFeature()) notes.push('enabled [features] hooks = true in config.toml');

  const removed = removeSkills(path.join(codexHome(), 'skills'));
  if (removed.length) notes.push(`removed duplicate ${removed.map((n) => `$${n}`).join(' ')}`);

  return notes;
}

function uninstall() {
  const config = readJson(hooksPath(), null);
  if (config && config.hooks) {
    for (const event of Object.keys(HOOK_EVENTS)) {
      config.hooks[event] = (config.hooks[event] || [])
        .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h.command)) }))
        .filter((g) => g.hooks.length > 0);
      if (config.hooks[event].length === 0) delete config.hooks[event];
    }
    writeJson(hooksPath(), config);
  }
  removeSkills(path.join(codexHome(), 'skills'));
  for (const sub of ['src', 'bin', 'modes']) {
    fs.rmSync(path.join(codexRuntimeDir(), sub), { recursive: true, force: true });
  }
  console.log('Codex: hooks and skills removed ([features] hooks left enabled)');
}

function doctor() {
  if (!fs.existsSync(codexHome())) return console.log('Codex\n  not installed');
  const config = readJson(hooksPath(), {});
  const hooks = config.hooks || {};
  let toml = '';
  try {
    toml = fs.readFileSync(configPath(), 'utf8');
  } catch {}
  // A plugin install wires its hooks from the plugin's own manifest, so hooks.json is
  // empty by design. Reporting MISS there makes a healthy install look broken.
  const plugin = pluginInstalled(toml);
  console.log('Codex');
  for (const event of Object.keys(HOOK_EVENTS)) {
    const wired = (hooks[event] || []).some((g) => (g.hooks || []).some((h) => isOurs(h.command)));
    if (wired) console.log(`  ok   ${event}`);
    else console.log(`  ${plugin ? 'ok  ' : 'MISS'} ${event}${plugin ? ' (from the plugin)' : ''}`);
  }
  console.log(`  ${featureEnabled(toml) ? 'ok  ' : 'MISS'} [features] hooks`);
}

const codexRuntimeDir = () => path.join(codexHome(), 'plain-speak');

module.exports = { tidy, uninstall, doctor };
