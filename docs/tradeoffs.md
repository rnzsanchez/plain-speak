# Before you install

Both sides, measured where measurement was possible.

## What you get

| Upside | Grounding |
|---|---|
| Historic benchmark results | The published figures predate the current rules. Re-measure before using them for a decision. |
| The rules keep working | The point of the thing. Injected once, then re-sent only when a reply stops matching the mode — not on every prompt. |
| Checking costs no tokens | It is a text scan inside a `Stop` hook. No model call, nothing added to context. |
| Invisible | Verdicts and reinjections reach the model with `suppressOutput`, so nothing lands in your transcript. Asserted in `test/hooks.test.mjs`. |
| It replaces nothing | Only hook entries whose own command contains `plain-speak` are ever touched. A clean machine and a plugin-loaded one end up in the same state. |
| Per-project modes | Claude Code uses `.plain-speak-mode`; Codex uses `.plain-speak-codex-mode`. `PLAIN_SPEAK_MODE` overrides either for one shell. |
| Nothing to trust but Node | Zero dependencies, one bash script, about 1,000 lines of source in total. |
| Reversible | `uninstall` removes only plain-speak entries; `uninstall --purge` removes its data too. The original backup remains available. Uninstalling the plugin is separate, and done with your tool's own plugin command. |

## What it costs

| Downside | Grounding |
|---|---|
| It writes one settings line | The plugin declares its own hooks, so no hook entry is written anywhere. The mode command adds the badge to `~/.claude/settings.json` on Claude Code, in front of any statusline you already have, and backs the file up first. Codex gets no badge and only `[features] hooks = true`. |
| Two node starts per turn | Measured on an M-series Mac: `UserPromptSubmit` 79 ms, `Stop` 55 ms. A bare `node -e ''` is **76 ms** on the same machine, so nearly all of it is interpreter startup and plain-speak's own work is single-digit milliseconds. It is still ~135 ms of wall clock per turn. |
| The badge re-renders as you type | Measured at 27 ms, against 25 ms for `bash -c :`. Builtins only, one small file read, so roughly 2 ms is ours. |
| The checker is a heuristic | It will sometimes miss a fussy reply and sometimes flag one that needed a long sentence — `cte` more, since it trips on a single hit. Quoting a phrase no longer counts as using it, which removed the biggest false-positive source. |
| Terser is not always better | A short answer can drop context you wanted. `cte` especially. Ask for detail to skip shape checks; tone checks still apply. |
| On Codex it depends on reasoning effort | The GPT figures hold at pinned `medium`. Codex bills reasoning as output and no response rule governs how long a model thinks, so a different effort is a different measurement. `cte` on gpt-5.6-sol shortens the visible reply 8% while spiking reasoning enough to bill 33% more. Check your own model and effort — `node bench/run.mjs --models <yours> --repeat 5 --reasoning medium`. |
| Codex asks for trust | Hooks must be trusted on first run. The installer does not bypass that prompt for you. |
| A benchmark run overrides child sessions | It passes `PLAIN_SPEAK_MODE` only to benchmark children. Your live global mode file stays untouched. |
| Node 22+ on `PATH` | No dependencies, but the hooks need node. |

## Privacy

Each tool keeps its own counters:

| Tool | State |
|---|---|
| Claude Code | `~/.claude/plain-speak/state.json` |
| Codex | `~/.codex/plain-speak/state.json` |

Each file holds turns, drift trips, reinjections, a `lengthRequested` boolean and the
reason for the last drift. Changing or purging one does not affect the other.

**No prompt text is ever written to disk.** The drift reason comes from a closed
vocabulary: which of plain-speak's own marker phrases matched, plus counts such as
"a 34-word sentence". It can record that the word *certainly* appeared, because
*certainly* is on plain-speak's own list — it never records arbitrary wording from your
prompt or from the reply.

The last 50 sessions are kept; older entries are pruned. `uninstall --purge` deletes
the lot.

## Living with your other tools

- Only hook entries whose own command contains `plain-speak` are added or removed. Every other hook on the same event is carried through untouched.
- A statusline you already have keeps running: the badge is prepended, never substituted, and removing that one segment puts it back.
- Unrelated plugins, permissions, environment, marketplaces and theme are never touched.
- Claude Code commands are namespaced and marked `disable-model-invocation`. Codex uses skills or natural language, not custom slash commands.
- The mode command is idempotent: run it as often as you like and it changes nothing once the machine is right.

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
