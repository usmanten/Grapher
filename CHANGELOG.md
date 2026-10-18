# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scanner that lists the files Grapher may analyze and reports what it skips and why.
- Secret-file protection: `.env` files, keys, certificates and credential files are never opened.
- `.gitignore` support, including nested files and negation rules.
- A single safe reader for file contents that refuses secret files, symlinks, paths outside the project and oversized files.
- `grapher scan [folder]` command with a readable summary and `--json` output.
- `grapher graph [folder]` maps a Next.js App Router project and saves `.grapher/graph.json` (`--json` prints it instead).
- Connection detection without AI: imports (including `@/` path aliases), pages and the components they display, API routes and their methods, `fetch`/axios/ky calls matched to the route they hit, server actions, Prisma, Drizzle and Supabase tables with read/save/delete, known outside services and databases, and settings from `process.env` (names only).
- Interactive viewer saved to `.grapher/index.html`: a file tree, a file view showing what uses a file and what it uses, Trace full flow, an Overview, and an explanation panel with "open in VS Code" links. Works offline, follows the system's light or dark theme, and lists protected secret files by name only.
- `/grapher` command for Claude Code, installed with `grapher setup`. Claude writes a two or three sentence explanation for each connection, shown in the viewer. Explanations are saved and only rewritten when the code behind a connection changes.
- `grapher explain` and `grapher explain --save`, the steps `/grapher` runs.
- Each connection now carries the line of code behind it, shown in the viewer. Anything key-shaped in it is replaced with `[hidden]`.
- A final safety check: if anything Grapher is about to save looks like a secret, it saves nothing and says where the problem is without repeating the value.
- A CI job that runs Grapher on a generated project full of fake secrets and fails if any of them reach the output.
- A JSON Schema for `graph.json` and a sample Next.js app used for integration and snapshot tests.
- A warning when a project uses the Pages Router, which is not fully supported yet.
- CI with linting, type checks, tests with coverage, CodeQL, dependency review, a dependency audit and secret scanning.
