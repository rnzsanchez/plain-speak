'use strict';
// State lives in ~/.claude/plain-speak/:
//   mode        — one bare word, read by the bash statusline
//   state.json  — lifetime totals + recent per-session counters

const fs = require('fs');
const path = require('path');
const os = require('os');

const MODES = ['off', 'normal', 'cte'];
const ALIASES = { max: 'cte', on: 'normal', default: 'normal' };
// No cap by default. A cap that runs out stops correcting a model that is still
// drifting, which is the opposite of the point. The one-turn cooldown is what keeps
// it from nagging; set PLAIN_SPEAK_MAX_RETRIES to put a hard ceiling back.
const MAX_RETRIES = process.env.PLAIN_SPEAK_MAX_RETRIES
  ? Number(process.env.PLAIN_SPEAK_MAX_RETRIES)
  : Infinity;
const KEEP_SESSIONS = 50;

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Everything lives in one folder so plain-speak leaves a single entry in
// ~/.claude. The mode file is one bare word so the bash statusline needs no jq.
const homeDir = () => path.join(claudeDir(), 'plain-speak');
const modePath = () => path.join(homeDir(), 'mode');
const storePath = () => path.join(homeDir(), 'state.json');

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

function readMode() {
  return normalizeMode(readSafe(modePath())) || 'normal';
}

function writeMode(raw) {
  const mode = normalizeMode(raw);
  if (!mode) throw new Error(`unknown mode "${raw}" — use ${MODES.join(', ')}`);
  writeSafe(modePath(), mode);
  return mode;
}

const BLANK_SESSION = {
  turns: 0,
  drift: false,
  reason: null,
  trips: 0,
  injections: 0,
  lastInjectTurn: -1,
  cleanStreak: 0,
  mode: null,
  startedAt: null,
  updatedAt: null,
};

const BLANK_STORE = {
  version: 1,
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

// ponytail: read-modify-write, no lock. Hooks for one session run sequentially,
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
  store.sessions[key] = { ...session, updatedAt: Date.now() };
  if (isNew) {
    store.sessions[key].startedAt = session.startedAt || Date.now();
    store.lifetime.sessions += 1;
  }
  writeStore(store);
  return store;
}

function bumpLifetime(store, patch) {
  for (const [k, v] of Object.entries(patch)) {
    store.lifetime[k] = (store.lifetime[k] || 0) + v;
  }
  return store;
}

// Drift alone is not enough to reinject. The budget stops it nagging; the
// cooldown stops two reinjections landing back to back.
function shouldReinject(session, maxRetries = MAX_RETRIES) {
  if (!session.drift) return false;
  if (session.injections >= maxRetries) return false;
  // lastInjectTurn is the completed-turn count at the moment we injected, so
  // turns - 1 means the injection landed on the turn that just finished.
  if (session.lastInjectTurn >= session.turns - 1) return false;
  return true;
}

// Called from the Stop hook once per turn with the drift verdict.
function recordTurn(session, verdict) {
  const next = { ...session, turns: session.turns + 1 };
  if (verdict.drift) {
    next.drift = true;
    next.reason = verdict.reason;
    next.trips = session.trips + 1;
    next.cleanStreak = 0;
  } else {
    next.drift = false;
    next.reason = null;
    next.cleanStreak = session.cleanStreak + 1;
  }
  return next;
}

module.exports = {
  MODES,
  MAX_RETRIES,
  claudeDir,
  homeDir,
  modePath,
  storePath,
  normalizeMode,
  readMode,
  writeMode,
  readStore,
  writeStore,
  readSession,
  saveSession,
  bumpLifetime,
  shouldReinject,
  recordTurn,
  writeSafe,
  readSafe,
};
