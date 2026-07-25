# Before you install

The honest list.

## Costs

| Downside | Detail |
|---|---|
| It adds to your settings | Only with the npx installer: three hook entries in `~/.claude/settings.json` and `~/.codex/hooks.json`. A `.plain-speak-backup` of the original is written the first time it touches them; `uninstall` reverses the edits. The plugin route edits nothing at all. |
| Two node processes per turn | `UserPromptSubmit` and `Stop`, roughly 40–60 ms each, plus one more at session start. Invisible next to a model call, but not zero. |
| The badge runs constantly | The statusline re-renders as you type. That is why it is bash and reads one small file. |
| The checker is a heuristic | It will sometimes miss a fussy reply, sometimes flag one that needed a long sentence. See [the checker](./checker.md#where-it-can-be-wrong). |
| Terser is not always better | A short answer can drop context you wanted. `cte` especially. Use `normal`, or ask for detail and the checker stands down. |
| The mode is global | One setting across every project and session. |
| Reinjection is uncapped | By design, but it eases off. The first few corrections land on the next turn; after that it waits four turns and sends a one-line nudge instead of the ruleset. `PLAIN_SPEAK_MAX_RETRIES` puts a hard ceiling back. |
| Codex asks for trust | Hooks must be trusted on first run. The installer does not bypass that prompt for you. |
| Node 18+ on `PATH` | No dependencies, but the hooks need node. |
| Uninstall keeps your data | Mode and `state.json` stay. Delete `~/.claude/plain-speak/` to be rid of them. |

## Privacy

`~/.claude/plain-speak/state.json` holds counters — turns, drift trips, reinjections, a
`lengthRequested` boolean — and the reason for the last drift.

**No prompt text is ever written to disk.** The drift reason is drawn from a closed
vocabulary: which of plain-speak's own marker phrases matched, plus counts such as
"a 34-word sentence". So it can record that the word *certainly* appeared, because
*certainly* is on plain-speak's list — it never records arbitrary wording from your
prompt or from the reply.

The last 50 sessions are kept; older entries are pruned.

## Living with your other tools

**It replaces nothing.** A clean machine and one already carrying a dozen plugins end
up in the same place — plain-speak is added alongside whatever is there.

- It only ever adds or removes hook entries whose own command contains `plain-speak`. Every other hook on the same event is carried through untouched.
- It leaves a statusline you already have exactly as it was, unless you pass `--statusline`.
- It does not touch your plugins, permissions, environment, marketplaces, or theme.
- Its commands are namespaced and marked `disable-model-invocation`, so the model can never trigger them.
- Installing twice does not stack duplicate hooks.

If you already run your own response-rules hook, plain-speak does **not** remove it.
Both will fire, which means the rules get injected on every prompt as well as on
drift — turn your own one off if you want the token saving.

## Failure behaviour

Every hook is wrapped and always exits 0. A crash inside plain-speak is silent and
costs you nothing but the check — it cannot break a session, block a tool call, or
stop a turn.
