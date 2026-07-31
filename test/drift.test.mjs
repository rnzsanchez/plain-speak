import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { check } = require('../src/drift.js');
const { shouldReinject, recordTurn, easedOff, cooldownFor } = require('../src/state.js');

const NORMAL_GOOD = `Yes. The index is on \`user_id\`.

| Table | Rows |
|---|---:|
| users | 12 |`;

const FUSSY = `Certainly! It is important to note that we should leverage the existing
abstraction here. Furthermore, in order to facilitate a seamless migration, one
could argue the holistic approach is best-in-class.

I hope this helps.`;

test('clean reply does not trip', () => {
  assert.equal(check({ reply: NORMAL_GOOD, mode: 'normal' }).drift, false);
});

test('fussy reply trips normal', () => {
  const r = check({ reply: FUSSY, mode: 'normal' });
  assert.equal(r.drift, true);
  assert.ok(r.points >= 3, `expected 3+ points, got ${r.points}`);
});

test('one stray marker does not trip normal, but does trip cte', () => {
  const reply = 'We can utilize the cache.';
  assert.equal(check({ reply, mode: 'normal' }).drift, false);
  assert.equal(check({ reply, mode: 'cte' }).drift, true);
});

test('cte trips on a long sentence, normal does not', () => {
  const reply =
    'The migration runs in three phases and each one writes a checkpoint so a ' +
    'failure only ever costs you the phase that was in flight.';
  assert.equal(check({ reply, mode: 'cte' }).drift, true);
  assert.equal(check({ reply, mode: 'normal' }).drift, false);
});

test('mode off never trips', () => {
  assert.equal(check({ reply: FUSSY, mode: 'off' }).exempt, 'mode-off');
});

test('exemption: user asked for detail skips shape checks', () => {
  const r = check({
    reply: 'The migration runs in three phases and each one writes a checkpoint.',
    mode: 'cte',
    prompt: 'explain in detail how this works',
  });
  assert.equal(r.drift, false);
  assert.equal(r.exempt, 'length-requested');
});

test('exemption: lengthRequested still catches bad tone', () => {
  const r = check({ reply: FUSSY, mode: 'cte', lengthRequested: true });
  assert.equal(r.drift, true);
});

test('exemption: plan mode', () => {
  assert.equal(check({ reply: FUSSY, mode: 'cte', permissionMode: 'plan' }).exempt, 'plan-mode');
});

test('exemption: code-heavy reply', () => {
  const reply = `Done.\n\n\`\`\`js\n${'const x = 1;\n'.repeat(40)}\`\`\``;
  assert.equal(check({ reply, mode: 'cte' }).exempt, 'code-heavy');
});

test('tables and lists are not prose paragraphs', () => {
  const reply = ['| a | b |', '|---|---|', '| 1 | 2 |', '', '- one', '- two', '', '- three'].join(
    '\n'
  );
  assert.equal(check({ reply, mode: 'cte' }).drift, false);
});

test('cte shape boundaries match its rules', () => {
  assert.equal(check({ reply: 'One two three four five six seven eight.', mode: 'cte' }).drift, false);
  assert.equal(
    check({ reply: 'One two three four five six seven eight nine.', mode: 'cte' }).drift,
    true
  );

  const wall = [
    'Alpha beta gamma delta epsilon zeta eta.',
    'Theta iota kappa lambda mu nu xi.',
    'Omicron pi rho sigma tau upsilon phi.',
    'Chi psi omega red blue green black.',
  ].join(' ');
  assert.equal(check({ reply: wall, mode: 'cte' }).drift, false);
  assert.equal(check({ reply: `${wall}\n\n${wall}`, mode: 'cte' }).drift, true);
});

test('naming a marker phrase is not using it', () => {
  const talkingAbout = [
    'The checker catches `leverage`, `utilize` and `it is important to note`.',
    '',
    '> Certainly! I would be happy to help with that.',
    '',
    'That is the whole list.',
  ].join('\n');
  assert.equal(check({ reply: talkingAbout, mode: 'normal' }).drift, false);

  // …but actually writing that way still trips.
  const usingThem =
    'Certainly! We should leverage this and it is important to note the tradeoff.';
  assert.equal(check({ reply: usingThem, mode: 'normal' }).drift, true);
});

test('the cooldown stops two reinjections landing back to back', () => {
  let s = recordTurn({ turns: 0, trips: 0, injections: 0, lastInjectTurn: -1, cleanStreak: 0 }, {
    drift: true,
    reason: 'x',
  });
  assert.equal(shouldReinject(s), true);

  // We inject now, so lastInjectTurn is the completed-turn count at this moment.
  s = { ...s, injections: 1, lastInjectTurn: s.turns };
  s = recordTurn(s, { drift: true, reason: 'x' });
  assert.equal(shouldReinject(s), false, 'too soon');

  s = recordTurn(s, { drift: true, reason: 'x' });
  assert.equal(shouldReinject(s), true, 'a turn later it may inject again');
});

test('a clean turn stops it, drift starts it again — no cap to run out', () => {
  let s = { turns: 9, trips: 4, injections: 4, lastInjectTurn: 6, cleanStreak: 0 };
  s = recordTurn(s, { drift: false });
  assert.equal(shouldReinject(s), false, 'clean reply, nothing to correct');

  s = recordTurn(s, { drift: true, reason: 'x' });
  assert.equal(shouldReinject(s), true, 'still corrects after many injections');
});

test('past the threshold it eases off instead of stopping', () => {
  const base = { trips: 9, injections: 3, lastInjectTurn: 6, cleanStreak: 0, drift: true };
  assert.equal(easedOff(base), true);
  assert.equal(cooldownFor(base), 4, 'gap widens once eased off');

  // Under the old one-turn cooldown this would have injected; now it waits.
  assert.equal(shouldReinject({ ...base, turns: 8 }), false);
  assert.equal(shouldReinject({ ...base, turns: 9 }), false);
  // Four turns after the last correction it speaks up again — it never gives up.
  assert.equal(shouldReinject({ ...base, turns: 11 }), true);
  assert.equal(shouldReinject({ ...base, turns: 40, injections: 20 }), true);
});

test('an explicit ceiling is still honoured when asked for', () => {
  const s = { turns: 20, trips: 4, injections: 3, lastInjectTurn: 6, cleanStreak: 0, drift: true };
  assert.equal(shouldReinject(s, 3), false, 'ceiling reached');
  assert.equal(shouldReinject(s, 5), true, 'below the ceiling, and past the wider cooldown');
});

test('consecutive drift escalates instead of easing off', () => {
  const { escalating } = require('../src/state.js');
  // Eased off, and the nudges are landing: one isolated trip, no streak.
  const easing = { trips: 9, injections: 5, lastInjectTurn: 6, streak: 1, drift: true };
  assert.equal(easedOff(easing), true, 'one trip is not a pattern');
  assert.equal(escalating(easing), false);
  assert.equal(cooldownFor(easing), 4);

  // Drift on consecutive turns means the quiet nudge is not working.
  const stuck = { ...easing, streak: 2 };
  assert.equal(escalating(stuck), true);
  assert.equal(easedOff(stuck), false, 'a streak overrides the backoff');
  assert.equal(cooldownFor(stuck), 1, 'back to correcting every turn');
  assert.equal(shouldReinject({ ...stuck, turns: 8 }), true);
});

test('the streak counts consecutive drift and one clean turn clears it', () => {
  let s = { turns: 0, trips: 0, injections: 0, lastInjectTurn: -1, streak: 0 };
  s = recordTurn(s, { drift: true, reason: 'x' });
  s = recordTurn(s, { drift: true, reason: 'x' });
  assert.equal(s.streak, 2, 'two drifted turns running');

  s = recordTurn(s, { drift: false });
  assert.equal(s.streak, 0, 'a clean turn is the evidence the correction landed');
});
