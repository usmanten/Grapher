# 2. Parse code for connections, use an LLM only to explain

- Status: Accepted
- Date: 2026-10-18

## Context

Similar tools take one of two approaches. Some ask an LLM to read the whole repository and draw the diagram. That works on any language, but it is slow, costs a lot of tokens, and sometimes invents or misses connections. Others parse code only, which is exact but produces graphs without explanations a beginner can follow.

## Decision

Grapher finds every connection by parsing code with the TypeScript compiler (through ts-morph), so each arrow is real and points to a file and line. An LLM is only used to write a short plain-English explanation of a connection that already exists, from a small, scrubbed snippet. Packages Grapher doesn't recognize may be classified by name only.

We use ts-morph rather than a generic parser like tree-sitter because Next.js projects rely on TypeScript path aliases (`@/lib/db`), and the TypeScript compiler resolves those exactly.

## Consequences

- Graphs are accurate and cheap to rebuild. Explanations can be cached by the content of the code they describe.
- Each framework pattern (routes, server actions, database clients) needs its own detector, which is more work than one LLM prompt.
- Supporting a new language means adding a new parser, not just changing a prompt.
