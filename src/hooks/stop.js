#!/usr/bin/env node
'use strict';
// Stop — the hygiene check. Reads the reply that just finished, scores it, and
// records the verdict. Emits nothing and never blocks: making the model spend a
// whole extra turn being told "be shorter" would cost more than the drift did.

const { run } = require('./lib');
const state = require('../state');
const drift = require('../drift');

run(({ sessionId, reply, permissionMode }) => {
  const mode = state.readMode();
  if (mode === 'off') return;

  const store = state.readStore();
  const session = state.readSession(sessionId, store);

  const verdict = drift.check({
    reply,
    mode,
    permissionMode,
    lengthRequested: Boolean(session.lengthRequested),
  });

  const next = state.recordTurn(session, verdict);
  next.mode = mode;
  next.lengthRequested = false;
  state.bumpLifetime(store, { turns: 1, trips: verdict.drift ? 1 : 0 });
  state.saveSession(sessionId, next, store);
});
