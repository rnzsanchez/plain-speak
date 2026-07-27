'use strict';
// Codex CLI wiring. Same three events, same payload shape, so the same hook
// scripts run unchanged — only the config format differs.

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  copyRuntime,
  copySkills,
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

function install() {
  if (!fs.existsSync(codexHome())) {
    console.log('Codex: not installed (no ~/.codex) — skipped');
    return;
  }
  const dir = copyRuntime('codex');
  const config = readJson(hooksPath(), {});
  config.hooks = config.hooks || {};

  for (const [event, script] of Object.entries(HOOK_EVENTS)) {
    const command = `PLAIN_SPEAK_TARGET=codex node "${path.join(dir, 'src', 'hooks', script)}"`;
    const kept = (config.hooks[event] || [])
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h.command)) }))
      .filter((g) => g.hooks.length > 0);
    config.hooks[event] = [...kept, { hooks: [{ type: 'command', command }] }];
  }

  writeJson(hooksPath(), config);
  const flipped = enableHooksFeature();
  const skillsDir = path.join(codexHome(), 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  const skills = copySkills(skillsDir);

  console.log(`Codex: hooks wired at ${hooksPath()}`);
  console.log(`  skills: ${skills.map((s) => `$${s}`).join(' ')}`);
  if (flipped) console.log('  enabled [features] hooks = true in config.toml');
  // Codex asks the user to trust hook sources on first run. Prompting is the
  // point of that check, so the installer tells you rather than bypassing it.
  console.log('  first Codex run will ask you to trust these hooks — accept once');
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
  console.log('Codex');
  for (const event of Object.keys(HOOK_EVENTS)) {
    const wired = (hooks[event] || []).some((g) => (g.hooks || []).some((h) => isOurs(h.command)));
    console.log(`  ${wired ? 'ok  ' : 'MISS'} ${event}`);
  }
  let toml = '';
  try {
    toml = fs.readFileSync(configPath(), 'utf8');
  } catch {}
  console.log(`  ${featureEnabled(toml) ? 'ok  ' : 'MISS'} [features] hooks`);
}

const codexRuntimeDir = () => path.join(codexHome(), 'plain-speak');

module.exports = { install, uninstall, doctor };
