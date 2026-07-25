# Before you install

Both sides, measured where measurement was possible.

## What you get

| Upside | Grounding |
|---|---|
| Shorter answers on Opus and Sonnet | Measured, one 3-turn session per cell: Opus 5 cut output 45% (`normal`) and 52% (`cte`); Sonnet 5 cut 36% and 59%. That is the whole of the good news — see the row below. |
| The rules keep working | The point of the thing. Injected once, then re-sent only when a reply stops matching the mode — not on every prompt. |
| Checking costs no tokens | It is a text scan inside a `Stop` hook. No model call, nothing added to context. |
| Invisible | Verdicts and reinjections reach the model with `suppressOutput`, so nothing lands in your transcript. Asserted in `test/hooks.test.mjs`. |
| It replaces nothing | Only hook entries whose own command contains `plain-speak` are ever touched. A clean machine and a plugin-loaded one end up in the same state. |
| Per-project modes | A `.plain-speak-mode` file pins one repo; `PLAIN_SPEAK_MODE` overrides for one shell. Neither disturbs your global setting. |
| Nothing to trust but Node | Zero dependencies, one bash script, about 1,300 lines of source in total. |
| Reversible | `uninstall` restores your settings from the backup; `uninstall --purge` removes the data too. |

## What it costs

| Downside | Grounding |
|---|---|
| It adds to your settings | npx route only: three hook entries in `~/.claude/settings.json` and `~/.codex/hooks.json`. A backup of the original is written the first time it touches them. The plugin route edits nothing at all. |
| Two node starts per turn | Measured on an M-series Mac: `UserPromptSubmit` 79 ms, `Stop` 55 ms. A bare `node -e ''` is **76 ms** on the same machine, so nearly all of it is interpreter startup and plain-speak's own work is single-digit milliseconds. It is still ~135 ms of wall clock per turn. |
| The badge re-renders as you type | Measured at 27 ms, against 25 ms for `bash -c :`. Builtins only, one small file read, so roughly 2 ms is ours. |
| The checker is a heuristic | It will sometimes miss a fussy reply and sometimes flag one that needed a long sentence — `cte` more, since it trips on a single hit. Quoting a phrase no longer counts as using it, which removed the biggest false-positive source. |
| Terser is not always better | A short answer can drop context you wanted. `cte` especially. Use `normal`, or ask for detail and the checker stands down. |
| On most models it does not help | Measured across nine: Haiku 4.5 cut only 10%/5%. On GPT models `normal` made **five of six longer** (−16% to 0%), and `cte` was worse still on the 5.4 pair (−15%, −22%). Only Opus and Sonnet showed a real gain. Check your own model rather than assuming — `node bench/run.mjs --models <yours>`. |
| Codex asks for trust | Hooks must be trusted on first run. The installer does not bypass that prompt for you. |
| A benchmark run changes your live mode | It writes the global mode flag and restores it on exit. While it runs, your own sessions are scored against whatever mode the benchmark is testing. |
| Node 18+ on `PATH` | No dependencies, but the hooks need node. |

## Privacy

`~/.claude/plain-speak/state.json` holds counters — turns, drift trips, reinjections, a
`lengthRequested` boolean — and the reason for the last drift.

**No prompt text is ever written to disk.** The drift reason comes from a closed
vocabulary: which of plain-speak's own marker phrases matched, plus counts such as
"a 34-word sentence". It can record that the word *certainly* appeared, because
*certainly* is on plain-speak's own list — it never records arbitrary wording from your
prompt or from the reply.

The last 50 sessions are kept; older entries are pruned. `uninstall --purge` deletes
the lot.

## Living with your other tools

- Only hook entries whose own command contains `plain-speak` are added or removed. Every other hook on the same event is carried through untouched.
- A statusline you already have is left exactly as it was, unless you pass `--statusline`.
- Your plugins, permissions, environment, marketplaces and theme are not touched.
- Commands are namespaced and marked `disable-model-invocation`, so the model can never trigger them.
- Installing twice does not stack duplicate hooks.

If you already run your own always-on rules hook, plain-speak does **not** remove it.
Both fire, so the rules go in on every prompt as well as on drift — turn yours off if
you want the saving.

## Failure behaviour

Every hook is wrapped and always exits 0. A crash inside plain-speak costs you nothing
but the check — it cannot break a session, block a tool call, or stop a turn.

That silence hides bugs, so there is a way to see them:

```sh
PLAIN_SPEAK_DEBUG=1 claude   # hook errors go to stderr and the harness debug log
```
