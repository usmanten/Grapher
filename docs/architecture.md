# Architecture

Grapher turns a Next.js project into a graph of how its pieces connect, and explains each connection in plain English. This document describes how the code is organized and how data flows through it. Product decisions live in [plan.md](plan.md), and the reasoning behind significant choices lives in [decisions/](decisions/).

## Pipeline

```mermaid
flowchart LR
  A[Project folder] --> B[Scan]
  B --> C[Read source safely]
  C --> D[Parse and detect connections]
  D --> E[Build graph.json]
  E --> F[Explain connections]
  F --> G[Output safety check]
  G --> H[Viewer index.html]
```

| Stage        | Status  | What it does                                                                                         |
| ------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| Scan         | Done    | Lists the files that may be analyzed, skipping secrets, dependencies, build output and ignored files |
| Read safely  | Done    | The only way to read file contents. Re-checks every rule at read time                                |
| Parse        | Planned | Uses ts-morph to resolve imports, including path aliases like `@/lib/db`                             |
| Detect       | Planned | Finds pages, API routes, fetch calls, server actions, database code, outside services and settings   |
| Graph        | Planned | Writes a versioned `graph.json` with nodes, connections and file:line locations                      |
| Explain      | Planned | The `/grapher` command in Claude Code writes short explanations from scrubbed snippets               |
| Safety check | Planned | Scans everything Grapher writes for secret-like values and refuses to save if any are found          |
| Viewer       | Planned | A single self-contained HTML page built with React and React Flow                                    |

## Packages

```
packages/
  core/   scanning, analysis and safety checks; everything that touches user files
  cli/    the `grapher` command, a thin layer over core
```

`core` has no knowledge of the terminal, and `cli` has no knowledge of file rules. This keeps the security-sensitive code in one place, where it is easiest to test and review.

## The scanner (`packages/core/src/scan`)

- **`scan.ts`** walks the project from the root. It lists directories, reads `.gitignore` files, and records every file it approves along with everything it skips and why. It reads no other file contents.
- **`denylist.ts`** decides which files are secret (`.env*`, keys, certificates, credential files) and which folders only hold credentials (`.ssh`, `.aws`). Secret files are skipped even if a `.gitignore` rule would include them.
- **`gitignore.ts`** applies root and nested `.gitignore` files the way git does, including `!` negation.
- **`reader.ts`** is the single gate for reading file contents. It only reads files the scan approved, and at read time it checks again that the file is not secret, not a symlink, not too large, and still inside the project.
- **`fs.ts`** is the small file-system interface everything above uses. Tests swap in a recording version to prove which files were opened.

### Why symlinks are never followed

A symlink can point anywhere, including outside the project or at a secret file with an innocent name. Skipping them entirely is simpler and safer than trying to resolve and re-check them. The project root itself may be a symlink. It is resolved once, up front.

## Data model

`ScanResult` is the contract between the scanner and later stages:

```ts
interface ScanResult {
  root: string; // absolute, symlink-resolved project root
  files: { path: string; size: number }[]; // relative paths with forward slashes, sorted
  skipped: { path: string; reason: SkipReason }[];
  truncated: boolean; // true if the scan hit the file limit
}
```

Paths are relative and use forward slashes on every platform, so output is stable across machines and easy to diff.
