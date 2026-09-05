# Contributing

Bug reports, ideas and patches are all welcome. Open an issue before a large
change so we can agree on the shape of it first.

## Setup

Node 20 or newer, and [pnpm](https://pnpm.io).

```bash
git clone https://github.com/rhighs-lab/looksee && cd looksee
pnpm install              # installs and builds
pnpm dev                  # daemon on 4711, vite client on 5173
```

`pnpm dev` serves the client from vite with hot reload and points it at the
daemon. Run `pnpm looksee review ../some-repo` to review a real working tree.

## Layout

| Path | What lives there |
| --- | --- |
| `src/server` | Hono daemon, git plumbing, watcher, CLI |
| `src/client` | React app: components, stores, styles |
| `src/shared/protocol.ts` | Types the server and client both depend on |
| `skills/looksee` | Agent skill shipped with the package |
| `test/unit` | vitest suites |
| `design/brand` | Logo masters, exports and favicons |

## Before you open a pull request

```bash
pnpm test
pnpm run typecheck
pnpm run lint
```

All three must pass. `pnpm run lint:fix` applies what Biome can fix on its own.

## Style

Formatting is Biome's, 80 columns, and not up for debate — run the formatter.
Beyond that:

- Functional components with hooks, no classes.
- Explicit types at module boundaries; no `any`.
- Short conventional names (`cfg`, `req`, `ctx`, `opts`) where they are clear.
- Comments explain why something is the way it is, never what the code does.
- Reuse `src/client/ui` rather than styling a new button.

## Commits

One logical change per commit. Write the subject in the imperative and use the
body to say why the change exists, not what the diff already shows.
