import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { check } = require('../src/drift.js');
const { shouldReinject, recordTurn } = require('../src/state.js');

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

test('exemption: user asked for detail', () => {
  const r = check({ reply: FUSSY, mode: 'cte', prompt: 'explain in detail how this works' });
  assert.equal(r.drift, false);
  assert.equal(r.exempt, 'length-requested');
});

test('exemption: lengthRequested passed through from the prompt hook', () => {
  const r = check({ reply: FUSSY, mode: 'cte', lengthRequested: true });
  assert.equal(r.exempt, 'length-requested');
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

test('reinjection budget stops the nagging', () => {
  let s = recordTurn({ turns: 0, trips: 0, injections: 0, lastInjectTurn: -1, cleanStreak: 0 }, {
    drift: true,
    reason: 'x',
  });
  assert.equal(shouldReinject(s), true);

  // We inject now, so lastInjectTurn is the completed-turn count at this moment.
  s = { ...s, injections: 1, lastInjectTurn: s.turns };
  // That turn finishes and drifts again — too soon, cooldown holds.
  s = recordTurn(s, { drift: true, reason: 'x' });
  assert.equal(shouldReinject(s), false, 'no two reinjections back to back');

  // One more turn passes.
  s = recordTurn(s, { drift: true, reason: 'x' });
  assert.equal(shouldReinject(s), true, 'a turn later it may inject again');

  assert.equal(shouldReinject({ ...s, injections: 3 }), false, 'budget exhausted');
});

test('two clean turns refill the budget', () => {
  let s = { turns: 5, trips: 2, injections: 3, lastInjectTurn: 4, cleanStreak: 0 };
  s = recordTurn(s, { drift: false });
  assert.equal(s.injections, 3, 'one clean turn is not enough');
  s = recordTurn(s, { drift: false });
  assert.equal(s.injections, 0);
});
