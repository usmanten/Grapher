# 1. Record architecture decisions

- Status: Accepted
- Date: 2026-10-18

## Context

Grapher is built to help people understand codebases, so its own design should be easy to understand too. Decisions made early (like how secrets are handled) shape everything after them, and the reasons are easy to forget.

## Decision

Record each significant decision as a short Markdown file in `docs/decisions/`, using the format: context, decision, consequences.

## Consequences

New contributors can learn why things are the way they are without digging through old discussions. Writing a record takes a few minutes per decision.
