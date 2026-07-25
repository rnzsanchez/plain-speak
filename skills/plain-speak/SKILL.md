---
name: plain-speak
description: Show the active plain-speak mode and how to change it.
disable-model-invocation: true
allowed-tools: Bash
---

Run this:

```sh
node "$HOME/.claude/plain-speak/bin/cli.js" mode
```

Then show the user the current mode and this table, with no other commentary:

| Command | Voice |
|---|---|
| `/plain-speak-mode off` | Nothing injected, nothing checked. |
| `/plain-speak-mode normal` | The base. Plain voice, answer first, full thoughts fine, no fuss. |
| `/plain-speak-mode cte` | Caveman, turned to twelve. Short. Blunt. Fragments. |

Also mention: `/plain-speak-stats` for token and drift numbers, `/plain-speak-doctor`
to check the install.
