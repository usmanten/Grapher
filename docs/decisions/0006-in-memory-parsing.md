# 6. Parse code in memory, from approved files only

- Status: Accepted
- Date: 2026-10-18

## Context

Grapher uses ts-morph (a friendlier layer over the TypeScript compiler) to find how files connect. By default, ts-morph and the compiler read from disk on their own: they follow imports, load `tsconfig.json` and anything it `extends`, and pull in type definitions from `node_modules`. Those reads would bypass the safe reader from [ADR 0004](0004-secret-denylist-and-read-gate.md), so the "what can Grapher read" question would no longer have one answer.

## Decision

- The ts-morph project uses an in-memory file system. Grapher adds only the code files the scan approved, read through the safe reader.
- `tsconfig.json` or `jsconfig.json` is read through the same reader, and only its `paths` and `baseUrl` are used. `extends` is not followed.
- Imports that point outside the approved files, including packages in `node_modules`, are recorded by package name and never opened.
- Type information from dependencies is not needed: detectors work from the shape of the code (an import of `@prisma/client`, a call like `db.user.findMany`), not from resolved types.

## Consequences

- Every byte Grapher parses has passed the secret and path checks, and the existing read-recording test still covers the whole pipeline.
- Aliases defined only in an extended config (for example a shared base config) are not resolved. Those imports show up as unresolved instead of as connections.
- Detection is based on recognizable patterns, so code that hides a database client behind several layers of wrappers may be mapped less precisely.
