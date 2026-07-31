'use strict';
// State lives in the active tool's config folder:
//   Claude Code — ~/.claude/plain-speak/
//   Codex       — ${CODEX_HOME:-~/.codex}/plain-speak/
//   mode        — one bare word, read by the bash statusline
//   state.json  — lifetime totals + recent per-session counters

const fs = require('fs');
const path = require('path');
const os = require('os');

const MODES = ['off', 'normal', 'cte'];
const ALIASES = { default: 'normal', max: 'cte', on: 'normal' };
// No cap: one that runs out stops correcting a model that is still drifting. Instead
// there is a threshold. Under it, correct on the next turn. Over it, back right off —
// wait several turns and send a one-line nudge instead of the whole ruleset. Repeated
// drift usually means the context has grown large, and hammering a big context with
// more context is the wrong answer.
const BACKOFF_AFTER = Number(process.env.PLAIN_SPEAK_BACKOFF_AFTER || 3);
const COOLDOWN_TURNS = 1;
const EASED_COOLDOWN_TURNS = 4;
// Backing off is right when the nudges are landing and the drift is occasional. It is
// exactly wrong when the model keeps drifting turn after turn: that is evidence the
// message is too weak, and answering it with a longer gap and a shorter message makes
// it worse. `streak` counts consecutive drifted turns, so the two cases are told apart
// rather than both being read as "stop nagging".
const ESCALATE_AFTER = Number(process.env.PLAIN_SPEAK_ESCALATE_AFTER || 2);
const streakOf = (session) => session.streak || 0;
const escalating = (session) => streakOf(session) >= ESCALATE_AFTER;
// Past the threshold plain-speak stops being aggressive: longer gap, shorter nudge —
// unless it is escalating, in which case it goes back to correcting every turn.
const easedOff = (session) => session.injections >= BACKOFF_AFTER && !escalating(session);
const cooldownFor = (session) => (easedOff(session) ? EASED_COOLDOWN_TURNS : COOLDOWN_TURNS);
const KEEP_SESSIONS = 50;

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function codexDir() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

// Everything lives in one folder so plain-speak leaves a single entry in
// each tool's config. PLUGIN_ROOT is Codex-only; npx hooks select Codex explicitly.
const isCodex = () => process.env.PLAIN_SPEAK_TARGET === 'codex' || Boolean(process.env.PLUGIN_ROOT);
const homeDir = (target) =>
  path.join(target === 'codex' || (!target && isCodex()) ? codexDir() : claudeDir(), 'plain-speak');
const modePath = (target) => path.join(homeDir(target), 'mode');
const storePath = (target) => path.join(homeDir(target), 'state.json');

function sanitizeId(id) {
  return String(id || 'unknown').replace(/[^A-Za-z0-9._-]/g, '') || 'unknown';
}

function normalizeMode(raw) {
  const m = String(raw || '').trim().toLowerCase();
  const resolved = ALIASES[m] || m;
  return MODES.includes(resolved) ? resolved : null;
}

// Refuse symlinks. The mode file is rendered to the terminal by the statusline
// on every keystroke; a symlink to another file would leak its bytes.
function writeSafe(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file);
  } catch {}
  fs.writeFileSync(file, contents, { mode: 0o600 });
}

function readSafe(file) {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

const projectFile = (target) =>
  target === 'codex' || (!target && isCodex()) ? '.plain-speak-codex-mode' : '.plain-speak-mode';

// Precedence: an env var beats a project pin, which beats the global setting. So one
// repo can sit in cte while everything else stays on normal, and a single shell can
// override both without touching either file.
function readMode(cwd = process.cwd(), target) {
  return (
    normalizeMode(process.env.PLAIN_SPEAK_MODE) ||
    (cwd ? normalizeMode(readSafe(path.join(cwd, projectFile(target)))) : null) ||
    normalizeMode(readSafe(modePath(target))) ||
    'normal'
  );
}

// Which of those three is actually in force — `status` reports it so a project pin is
// never a mystery.
function modeSource(cwd = process.cwd(), target) {
  if (normalizeMode(process.env.PLAIN_SPEAK_MODE)) return 'PLAIN_SPEAK_MODE';
  if (cwd && normalizeMode(readSafe(path.join(cwd, projectFile(target))))) {
    return `${projectFile(target)} in this project`;
  }
  return 'global';
}

function writeProjectMode(raw, cwd = process.cwd(), target) {
  const mode = normalizeMode(raw);
  if (!mode) throw new Error(`unknown mode "${raw}" — use ${MODES.join(', ')}`);
  writeSafe(path.join(cwd, projectFile(target)), mode);
  return mode;
}

function writeMode(raw, target) {
  const mode = normalizeMode(raw);
  if (!mode) throw new Error(`unknown mode "${raw}" — use ${MODES.join(', ')}`);
  writeSafe(modePath(target), mode);
  return mode;
}

const BLANK_SESSION = {
  turns: 0,
  drift: false,
  reason: null,
  trips: 0,
  streak: 0,
  injections: 0,
  lastInjectTurn: -1,
  mode: null,
  updatedAt: null,
};

const BLANK_STORE = {
  lastSessionId: null,
  lifetime: { turns: 0, trips: 0, injections: 0, sessions: 0 },
  sessions: {},
};

function readStore() {
  try {
    const parsed = JSON.parse(readSafe(storePath()));
    return {
      ...BLANK_STORE,
      ...parsed,
      lifetime: { ...BLANK_STORE.lifetime, ...(parsed.lifetime || {}) },
      sessions: parsed.sessions || {},
    };
  } catch {
    return structuredClone(BLANK_STORE);
  }
}

// Known ceiling: read-modify-write, no lock. Hooks for one session run sequentially,
// so the only racer is a second Claude Code window; worst case is one lost
// counter increment. Add a lockfile if that ever matters.
function writeStore(store) {
  const ids = Object.keys(store.sessions);
  if (ids.length > KEEP_SESSIONS) {
    const keep = ids
      .sort((a, b) => (store.sessions[b].updatedAt || 0) - (store.sessions[a].updatedAt || 0))
      .slice(0, KEEP_SESSIONS);
    store.sessions = Object.fromEntries(keep.map((id) => [id, store.sessions[id]]));
  }
  writeSafe(storePath(), JSON.stringify(store));
}

function readSession(id, store = readStore()) {
  return { ...BLANK_SESSION, ...(store.sessions[sanitizeId(id)] || {}) };
}

function saveSession(id, session, store = readStore()) {
  const key = sanitizeId(id);
  const isNew = !store.sessions[key];
  const bench = isBenchmark();
  store.sessions[key] = { ...session, bench, updatedAt: Date.now() };
  if (isNew && !bench) store.lifetime.sessions += 1;
  // Remembered so `stats` never reports a throwaway benchmark session as yours.
  if (!bench) store.lastSessionId = key;
  writeStore(store);
  return store;
}

// A benchmark spawns dozens of throwaway sessions with the hooks live, which is the
// point — but folding them into lifetime stats would make the numbers meaningless.
const isBenchmark = () => process.env.PLAIN_SPEAK_BENCH === '1';

function bumpLifetime(store, patch) {
  if (isBenchmark()) return store;
  for (const [k, v] of Object.entries(patch)) {
    store.lifetime[k] = (store.lifetime[k] || 0) + v;
  }
  return store;
}

// Drift alone is not enough to reinject. The cooldown stops two corrections landing
// back to back, and widens once the threshold is crossed.
function shouldReinject(session, maxRetries = Infinity) {
  if (!session.drift) return false;
  if (session.injections >= maxRetries) return false;
  // lastInjectTurn is the completed-turn count at the moment we injected, so a gap of
  // 1 means the injection landed on the turn that just finished.
  return session.turns - session.lastInjectTurn > cooldownFor(session);
}

// Called from the Stop hook once per turn with the drift verdict.
function recordTurn(session, verdict) {
  const next = { ...session, turns: session.turns + 1 };
  if (verdict.drift) {
    next.drift = true;
    next.reason = verdict.reason;
    next.trips = session.trips + 1;
    next.streak = streakOf(session) + 1;
  } else {
    next.drift = false;
    next.reason = null;
    // One clean turn is the only evidence that the correction landed.
    next.streak = 0;
  }
  return next;
}

module.exports = {
  easedOff,
  escalating,
  cooldownFor,
  claudeDir,
  codexDir,
  homeDir,
  modePath,
  readMode,
  writeMode,
  modeSource,
  writeProjectMode,
  readStore,
  readSession,
  saveSession,
  bumpLifetime,
  shouldReinject,
  recordTurn,
  readSafe,
};
