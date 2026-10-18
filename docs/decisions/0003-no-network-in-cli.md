# 3. The CLI makes no network requests

- Status: Accepted
- Date: 2026-10-18

## Context

Grapher reads private source code. Users need to trust that their code isn't uploaded anywhere. Explanations need an LLM, which would normally mean an API key and network calls.

## Decision

The Grapher program itself never makes network requests. Explanations are written by the Claude Code session the user is already running, through the `/grapher` command, working from Grapher's redacted output. A test fails if any package source uses a networking API.

## Consequences

- Users don't need an API key, and the network surface of Grapher itself is zero.
- Grapher's explanation feature depends on Claude Code. A standalone mode with its own API key could be added later, as an opt-in, with this decision revisited.
