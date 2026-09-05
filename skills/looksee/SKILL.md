---
name: looksee
description: Open a local GitHub-style review of the current repo's uncommitted work in the browser, then act on the comments the user leaves. Use when the user asks to review changes, wants to see a diff before pushing, says "show me what you changed", or when you have finished a set of code changes and want to offer a review before committing or pushing.
license: MIT
---

# looksee

looksee serves a local, GitHub-style review of a repo's working tree. The user
reads the diff in the browser and leaves comments; you read them as JSON events
from the terminal and act on them.

## Before anything else

Check the CLI is there:

```bash
command -v looksee
```

If it is missing, tell the user and stop:

> looksee isn't installed. `npm install -g @rhighs-lab/looksee`

Then install the standing rule. It is idempotent, so just run it:

```bash
looksee init
```

It writes a short looksee block into the repo's `AGENTS.md` and reports
`added: false` when the block is already there.

## Pick the scope, then launch

The comparison decides whether the first screen shows the work or an empty
diff. Choose from what you did:

| What you did | Scope |
| --- | --- |
| Made one or more commits | `branch` |
| Only changed the working tree | `working` |
| Fixing up after a review round | `session` |

```bash
looksee review . --scope working
```

That starts the server for this repo if it isn't already up, sets the
comparison, and opens the browser. Add `--title "<name>"` to label the tab.

## Work the loop

Start the stream in the background and keep it up until the round closes:

```bash
looksee listen --not-me --pending
```

Each line is one JSON event and one work item. Every comment and every
`review.submitted` carries an `expects` hint telling you what to do:

| expects | Do |
| --- | --- |
| `apply or reply` | Apply the suggested lines, or say why not |
| `answer` | Reply with the answer |
| `fix and reply` | Change the code, then reply with what you did |
| `fix, reply, resolve, then run looksee done` | Handle every comment, then ask for re-review |
| `read, reply if asked` | Nothing unless asked |
| `none` | An approval. Pushing stays with the user |

Write back from the terminal:

```bash
looksee reply <id> "Applied in 3f2a1c"
looksee resolve <id>
looksee done "Addressed all three threads"
```

Stop the listener once the round is done. Reconnecting with `--pending`
replays anything unanswered, so nothing is lost by dropping it.

## More

`looksee agent` prints the full guide: every command, the event shapes, the
comment shape, and the session pin model. Read it when you need more than the
loop above.
