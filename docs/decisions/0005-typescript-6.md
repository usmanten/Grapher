# 5. Stay on TypeScript 6 for now

- Status: Accepted
- Date: 2026-10-18

## Context

TypeScript 7, the native compiler, is available. typescript-eslint, which provides our type-aware lint rules, supports TypeScript versions below 6.1. ts-morph bundles its own compiler, so it is not affected.

## Decision

Pin TypeScript to `~6.0.3` until typescript-eslint supports TypeScript 7.

## Consequences

Builds use the slower JavaScript-based compiler, which doesn't matter at this project's size. Dependabot will propose the upgrade, and this record should be superseded when we move.
