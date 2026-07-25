#!/usr/bin/env node
'use strict';
// UserPromptSubmit — the token-saving hook. It injects NOTHING on an ordinary
// prompt. Rules go back in only when the Stop hook flagged drift, or when the
// user switches mode mid-conversation.

const { run, rulesFor, inject, notify } = require('./lib');
const state = require('../state');
const { LENGTH_REQUESTED } = require('../drift');

// The whole prompt must be the command. Anchoring matters: without it, asking "what
// does plain-speak off do?" would silently switch the mode mid-conversation.
const SWITCH = /^\s*\/?plain[-\s]?speak\s+(off|on|normal|cte|max|default)\s*[.!]?\s*$/i;

run(({ sessionId, prompt }) => {
  const store = state.readStore();
  const session = state.readSession(sessionId, store);

  const match = prompt.match(SWITCH);
  if (match) {
    const mode = state.writeMode(match[1]);
    state.saveSession(sessionId, { ...session, mode, drift: false, reason: null }, store);
    if (mode === 'off') return notify('UserPromptSubmit', 'plain-speak: off');
    return notify(
      'UserPromptSubmit',
      `plain-speak: ${mode}`,
      `PLAIN-SPEAK MODE: ${mode}\n\n${rulesFor(mode)}`
    );
  }

  const mode = state.readMode();
  if (mode === 'off') return;

  // Remembered for the Stop hook, which never sees the prompt. Only the boolean
  // is stored, never the prompt text.
  const next = { ...session, mode, lengthRequested: LENGTH_REQUESTED.test(prompt) };

  if (!state.shouldReinject(session)) {
    state.saveSession(sessionId, next, store);
    return;
  }

  next.drift = false;
  next.reason = null;
  next.injections = session.injections + 1;
  next.lastInjectTurn = session.turns;
  state.bumpLifetime(store, { injections: 1 });
  state.saveSession(sessionId, next, store);

  // Once eased off, send a one-line nudge rather than the whole ruleset. If the model
  // keeps drifting the context is probably already large, and more context is not the
  // fix — a reminder costs ~30 tokens instead of ~200.
  const body = state.easedOff(session)
    ? `PLAIN-SPEAK reminder (${mode}): answer first, plain words, no filler, no wall of prose.`
    : rulesFor(mode);

  inject(
    'UserPromptSubmit',
    `PLAIN-SPEAK: last reply drifted — ${session.reason}. Back to ${mode}.\n\n${body}`
  );
});
