# 12. Follow imports between a monorepo's own packages

- Status: Accepted
- Date: 2026-10-19

## Context

In a monorepo, each folder like `packages/core` has its own `package.json` and a name such as `@acme/core`. Other packages import it by that name, the same way they import a package downloaded from npm. Running Grapher on its own repository showed two problems:

- Imports like `@grapher/core` were treated as an outside library. The real link, from the CLI to the core package's files, was missing from the map.
- The viewer named files by their last two path parts, so `packages/cli/src/index.ts` and `packages/core/src/index.ts` were both shown as `src/index.ts`.

A package's `package.json` usually points at its built output (`dist/index.js`), which Grapher never reads, not at the source file.

## Decision

- The JavaScript pack reads every `package.json` in the project through the safe reader. It looks up the entry file from `exports` (including conditions like `import` or `types` and `./*` patterns), then `source`, `types`, `module` and `main`, then `src/index` and `index`.
- A target in a build folder (`dist`, `build`, `lib`, `out`, `esm`, `cjs`) is mapped to the same path under `src/`, and a built extension (`.js`, `.d.ts`) to the source ones. Only files the scanner approved can match, and a target that climbs out of its package folder with `..` is ignored.
- Each package's entry file is handed to the TypeScript compiler as a path alias, so detectors that follow code across files (for example a database client exported by `@acme/db`) work across packages too. The project's own `tsconfig.json` aliases win over these.
- Dependencies from every `package.json` count, not only the root one, so a database package used in one workspace package is still recognized.
- The viewer names a file by its last two path parts, and adds folders only when another file would get the same name. `packages/cli/src/index.ts` becomes `cli/src/index.ts`.

## Consequences

- On Grapher's own repository the CLI now links to `core/src/index.ts`, and `@grapher/core` no longer appears as an outside package.
- Each package's own `tsconfig.json` aliases (like `@/*` inside `apps/web`) are still not read; only the root one is. Next.js apps inside a monorepo folder (like `apps/web/app/`) are also not yet recognized as App Router apps. Both are left for later.
