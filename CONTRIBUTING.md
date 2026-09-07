# Contributing

Bug reports, ideas and patches are all welcome. Open an issue before a large
change so we can agree on the shape of it first.

## Setup

Node 24, and [pnpm](https://pnpm.io). The published CLI supports Node 20 or newer;
the development and release tools require Node 24.

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

## Releases

Packages are published to npm, the registry used by pnpm.

1. Run `pnpm changeset` alongside each user-facing change. Select `patch` for
   fixes, `minor` for features, or `major` for breaking changes, and write the
   changelog entry. Commit the generated `.changeset/*.md` file with the code.
   Documentation, tests, and CI-only changes do not need a release entry.
2. Merge the change into `main`. The release workflow opens or updates a
   version PR, combining pending changesets into the next semver version and
   `CHANGELOG.md`. Do not edit the version manually during normal development.
3. Merge the version PR. CI checks, builds, and publishes the unpublished
   version, then creates a Git tag and GitHub release. Already-published
   versions are skipped. Publishing is triggered by commits on `main`, not tags.

For a local preview, `pnpm run version-packages` applies pending changesets and
updates the lockfile. This consumes the entries; normally let the release PR
perform this step. Changesets chooses version numbers from the bump types you
select, not from commit messages.

### One-time setup

- In GitHub **Settings → Actions → General**, enable **Allow GitHub Actions to
  create and approve pull requests**. If organization policy disables it, an
  organization owner must enable it in the organization's Actions settings first.
- In npm's settings for `@rhighs-lab/looksee`, add a **GitHub Actions trusted
  publisher**: organization/user `rhighs-lab`, repository `looksee`, workflow
  filename `release.yml`, and no environment name. Allow publishing. No
  `NPM_TOKEN` secret is needed. See the [npm trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).
- The package must already exist on npm before configuring its trusted publisher
  (the current `0.1.0` release does). For a new package, publish its first version
  manually, then configure trust.

The workflow follows the [Changesets automation guide](https://changesets.dev/guide/automating).
Only the publish job can request npm credentials; it publishes the archive
produced by the successful checks and build. If publishing fails, fix the
reported cause and rerun the workflow on `main` from GitHub Actions. Do not bump
the version just to retry. Check the workflow logs and npm version after the
first release; a successful local build does not verify registry authentication.
