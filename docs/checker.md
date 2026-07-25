# The checker

Runs on every reply, in the `Stop` hook. No model call, no tokens, no output. You
never see it. It scores the reply, records a verdict, and stops.

It never blocks the turn. Making the model spend a whole extra turn being told to
be shorter would cost more than the drift did.

## What it scores

Tone, not length. A long, complete answer is fine. A fussy one is not.

Each hit is one point. The mode's threshold decides when the points mean drift, so
a single stray word never trips `normal`.

| Signal | Examples |
|---|---|
| Filler | "Certainly", "Great question", "I hope this helps", "feel free to" |
| Corporate register | leverage, utilize, facilitate, seamless, holistic, paradigm, synergy |
| Fussy phrasing | furthermore, moreover, subsequently, "it is important to note" |
| Robot register | "I have completed the task", "please be advised", "kindly" |
| Walls of prose | paragraphs of 2+ sentences and 25+ words, past the threshold |
| Long sentences | past the threshold |

## Thresholds

| Mode | Points to trip | Sentence words | Walls |
|---|---:|---:|---:|
| `normal` | 3 | 30 | 3 |
| `cte` | 1 | 8 | 1 |

Tables, lists, headings and quotes are the formats the rules ask for. They are not
counted as prose, and their sentence length is not measured.

Only walls count as paragraphs. Counting every prose block made `cte` flag replies
as short as "Done."

## When it stands down

Checked before anything else. Any hit means no verdict at all.

| Exemption | Trigger |
|---|---|
| `length-requested` | The prompt asked for detail, a walkthrough, a plan, a doc, a spec, or *why* |
| `code-heavy` | More than half the reply is inside fenced code blocks |
| `plan-mode` | The turn ran in plan mode |
| `mode-off` | Mode is `off` |

Only a boolean is carried from the prompt hook to the `Stop` hook. No prompt text
is ever stored.

## When it speaks up

On a trip, the next prompt carries the rules back plus a one-line reason — as
suppressed context, so it reaches the model and not your screen.

| Guard | Value |
|---|---|
| Back-to-back reinjections | never — one turn must pass |
| Clean reply | nothing to correct, so nothing is injected |
| Hard ceiling | none by default |

There is deliberately **no cap per session.** A cap that runs out stops correcting a
model that is still drifting, which is the opposite of the point. The cooldown is
what keeps it from nagging: at worst it costs one injection every other turn, and
only while the replies keep failing.

If you want a ceiling anyway:

```sh
PLAIN_SPEAK_MAX_RETRIES=3 claude   # stop after three, then leave it alone
```

## Where it can be wrong

It is a heuristic on phrasing, so it will occasionally miss a fussy reply and
occasionally flag one that genuinely needed a long sentence. `cte` more than
`normal`, because `cte` trips on a single hit. The budget and the cooldown exist so
that a false positive costs you one reinjection, not a nagging session.

## Tuning it

The thresholds and word lists are plain data at the top of
[`src/drift.js`](../src/drift.js). Edit, then `npm test` — the unit tests cover
every threshold, every exemption and the budget.
