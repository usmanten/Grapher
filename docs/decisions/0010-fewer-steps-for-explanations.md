# 10. Fewer steps for explanations

- Status: Accepted
- Date: 2026-10-18

## Context

The map takes about a second, but a first `/grapher` run spent one to two minutes writing explanations. Timing real runs showed where the time went:

- Requests of 40 connections meant 3 to 4 rounds, and every round cost Claude extra steps: run `grapher explain`, write the answer, run the save.
- Claude repeated each connection's long id (like `file:app/page.tsx->file:lib/db.ts`) as the key of every answer, about a fifth of everything it wrote.
- Claude often tried to write the answer with a shell command first. Claude Code blocks that, so the whole answer was written a second time.
- Claude Code shows a command's output in full only up to about 30,000 characters. A longer request is saved to a file that Claude has to open, which is one more step.

## Decision

- Each request holds as many connections as fit in about 24,000 characters, instead of a fixed 40.
- Connections are numbered 1, 2, 3 in the request, and Claude answers by number. Grapher keeps which connection each number stands for in `.grapher/request.json`, together with its fingerprint. An answer for a connection whose code changed after the request is skipped, so it can't land on the wrong line.
- The request data is one compact line per connection, without Grapher's own ids and fingerprints.
- `grapher explain --save` prints the next request straight away, so a round is "write, then save".
- The request and the `/grapher` command both say to write the answer with the Write tool.

## Consequences

Measured with Sonnet, two runs each, from an empty cache:

| Project                               | Before                         | After                |
| ------------------------------------- | ------------------------------ | -------------------- |
| Grapher itself (96 connections)       | 97 s, 16-18 steps, $0.39-0.43  | 53 s, 8 steps, $0.19 |
| A Next.js shop site (152 connections) | 116 s, 11-14 steps, $0.45-0.51 | 62 s, 6 steps, $0.25 |

- Most of what's left is Claude writing the explanations themselves, so the next gains would come from a faster model or writing fewer explanations, not from fewer steps.
- The answer format changed from ids to numbers. An `answers.json` left over from an older version is refused as "not asked about" and the connections are simply asked again.
