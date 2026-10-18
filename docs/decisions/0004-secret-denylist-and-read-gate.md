# 4. Secret files are denylisted and all reads go through one gate

- Status: Accepted
- Date: 2026-10-18

## Context

The most important promise Grapher makes is that it never shows a secret value. The safest way to keep a secret out of the output is to never read it in the first place.

## Decision

- A denylist of file names (`.env*` except templates like `.env.example`, keys, certificates, credential files) and credential folders (`.ssh`, `.aws`) is checked before anything else, including `.gitignore` negation rules.
- The scanner reads only `.gitignore` files. All other file contents are read through a single `SourceReader`, which only reads files the scan approved and re-checks the denylist, symlinks, size and project boundaries at read time.
- Symlinks are never followed.
- Source files named like `secrets.ts` are allowed. They usually just reference environment variables, and hardcoded values will be caught by snippet scrubbing.

## Consequences

- There is one small, well-tested place to audit for "what can Grapher read".
- A project that keeps code behind symlinks (rare in Next.js apps) will be partially mapped. The scan summary lists skipped symlinks so this is visible.
- The denylist will need updates as new credential file conventions appear.
