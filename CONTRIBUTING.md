# Contributing to Grapher

Thanks for your interest in improving Grapher. This guide covers how to set up the project, the conventions we follow, and how changes get merged.

## Setup

You need Node.js 22 or newer and pnpm (the version is pinned in `package.json`, so `corepack enable` will pick it up).

```sh
git clone https://github.com/usmanten/grapher.git
cd grapher
corepack enable
pnpm install
pnpm build
```

## Scripts

| Command              | What it does                                          |
| -------------------- | ----------------------------------------------------- |
| `pnpm build`         | Compiles every package to `dist/`                     |
| `pnpm typecheck`     | Type checks packages and tests                        |
| `pnpm lint`          | Runs ESLint with zero warnings allowed                |
| `pnpm format`        | Formats the code with Prettier                        |
| `pnpm test`          | Runs the test suite                                   |
| `pnpm test:coverage` | Runs tests with coverage (80% minimum for core)       |
| `pnpm test:e2e`      | Opens the viewer in a browser and clicks through it   |
| `pnpm grapher`       | Runs the built CLI, for example `pnpm grapher scan .` |

## Project layout

- `packages/core`: scanning, analysis and safety checks. Everything that touches user files lives here.
- `packages/cli`: the `grapher` command-line interface.
- `packages/viewer`: the interactive page Grapher writes to `.grapher/index.html` (React and React Flow, bundled into one file).
- `examples/sample-app`: a small Next.js app used by the integration and browser tests.
- `docs/`: the plan, architecture, threat model and decision records.

See [docs/architecture.md](docs/architecture.md) for how the pieces fit together.

## Conventions

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`, `refactor:`. Keep each commit to one logical change, and explain _why_ in the body when it isn't obvious.
- **Branches** are named after the change: `feat/route-detection`, `fix/gitignore-negation`.
- **Code**: TypeScript strict mode, no `any` without a comment explaining why, small functions, and comments that explain intent rather than restate the code.
- **Tests**: new logic comes with tests. Fake secrets in tests are assembled at runtime (see `packages/core/test/helpers.ts`); never commit a string that looks like a real key.
- **Decisions**: significant design choices get a short record in [docs/decisions/](docs/decisions/).

## Pull requests

1. Branch from `main` and keep the PR focused on one thing.
2. Fill in the PR template, including exact commands to test the change.
3. Make sure `pnpm build && pnpm typecheck && pnpm lint && pnpm test` passes locally. For viewer changes, also run `pnpm test:e2e` (run `pnpm --filter @grapher/viewer exec playwright install chromium` once first).
4. Add an entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).
5. CI must be green before review. The maintainer reviews and merges.

## Branch protection

The `main` branch should be protected with these settings (Settings → Rules → Rulesets, or Settings → Branches):

- Require a pull request before merging
- Require status checks to pass: `Check (Node 22)`, `Check (Node 24)`, `Secret scan (gitleaks)`, `Dependency audit`, `Analyze (JavaScript and TypeScript)`, `Review new dependencies`
- Require branches to be up to date before merging
- Do not allow force pushes or deletions

## Security

Grapher's core promise is that it never exposes secret values. If you find a way it could, please report it privately as described in [SECURITY.md](SECURITY.md) rather than opening a public issue.
