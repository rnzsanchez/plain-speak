#!/usr/bin/env node
'use strict';
// SessionStart — inject the active mode's rules once. This is the only
// unconditional injection; every later one has to be earned by a drift trip.

const { run, rulesFor, emit } = require('./lib');
const state = require('../state');

run(({ sessionId }) => {
  const mode = state.readMode();
  if (mode === 'off') return;

  const store = state.readStore();
  const session = state.readSession(sessionId, store);
  state.saveSession(sessionId, { ...session, mode }, store);

  const rules = rulesFor(mode);
  if (rules) emit(`PLAIN-SPEAK MODE: ${mode}\n\n${rules}`);
});
