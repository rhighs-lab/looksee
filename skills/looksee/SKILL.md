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

It writes a short review block into the global instruction file of every
agent installed on the machine, and reports `added: false` for the ones that
already had it. Pass `--local` to write this repo's `AGENTS.md` instead.

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

Wait for the next work item in the foreground. The command prints anything
unanswered, then blocks until an event arrives or the timeout runs out:

```bash
looksee listen --not-me --pending --wait 60
```

Run it again after each round of replies to pick up the next item.

Do not park `looksee listen` in the background instead. Output from a
background process does not start a new turn, so a listener running there
does not make you react to a new comment: you would only see it the next
time the user writes to you. Drop `--wait` only when the host can wake you
on process output.

When the review is still open and you are about to stop, say so: tell the
user that nothing has arrived yet and that they should send a message when
they have commented, or poll once more with `--wait`.

Each line is one JSON event and one work item. Every comment and every
`review.submitted` carries an `expects` hint telling you what to do:

| expects | Do |
| --- | --- |
| `apply or reply` | Apply the suggested lines, or say why not |
| `answer` | Reply with the answer |
| `fix and reply` | Change the code, then reply with what you did |
| `fix, reply and resolve every thread` | Handle every comment, then resolve it |
| `read, reply if asked` | Nothing unless asked |
| `none` | An approval. Pushing stays with the user |

Write back from the terminal:

```bash
looksee reply <id> "Applied in 3f2a1c"
looksee resolve <id>
```

## How to write a reply

The user reads your reply in a review pane next to the code, not in a chat.

- One line whenever one line does it. A short list only for genuinely
  separate items.
- Say what you did and where: "Fixed in src/cart.js:20, off-by-one."
- Plain words. No preamble, no restating the comment, no sign-off, no
  "Great catch".
- Did not make the change? Say so and why, in one line.
- Never hide a problem, a guess, or a risk to stay short. Say it plainly and
  be short everywhere else.
- Bodies are GitHub-flavored markdown: lists, tables, `code spans`, links
  and fenced blocks. A fence with a language (```ts) is syntax highlighted,
  so paste the snippet or diff instead of describing it. Write locations as
  `path:line`. A ```suggestion fence on a new-side line comment becomes an
  applicable suggestion.

Each poll with `--pending` replays anything still unanswered, so nothing is
lost between waits.

## More

`looksee agent` prints the full guide: every command, the event shapes, the
comment shape, and the session pin model. Read it when you need more than the
loop above.
