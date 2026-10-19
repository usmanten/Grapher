# 9. Write explanations through the user's Claude Code session

- Status: Accepted
- Date: 2026-10-18

## Context

Each connection needs a short plain-English explanation. Parsing finds the connections for free, but writing good explanations needs a language model. The plan says Grapher runs as a Claude Code command, so students don't need an API key, and [ADR 0003](0003-no-network-in-cli.md) says the CLI makes no network requests.

## Decision

- The `/grapher` command is a Claude Code command file. It tells the user's Claude Code session to run `grapher explain`, write the answer to `.grapher/answers.json`, and run `grapher explain --save`.
- The CLI and Claude exchange only text and one small file. The CLI never calls an AI service.
- The explain request holds the scrubbed graph data only (names, labels and one line of code per location), never whole files. It is checked for secrets before it is printed.
- The data is JSON between two marker lines that contain a random value, and both the request and the command tell Claude to treat it as data. Code can't close the data block early because it can't guess the marker.
- Answers are only accepted for connections that were asked about, are cleaned to plain text of at most 600 characters, and are refused in full if anything looks like a secret.
- Explanations are cached in `.grapher/explanations.json` under a fingerprint of the connection, so only new or changed connections are explained again.
- Requests are sent in batches of 40, so each answer stays small and a failure only costs one batch. (Changed in [ADR 0011](0011-fewer-steps-for-explanations.md): batches are now sized to fit Claude Code's output limit.)

We considered calling the Claude API directly (needs an API key, and code would leave the machine through Grapher itself) and asking Claude to edit `graph.json` (hard to validate and easy to corrupt).

## Consequences

- No API key and no network code in Grapher. The user's existing Claude Code session does the writing, and Claude Code's own permissions apply.
- Explanations depend on the model following the request. The CLI checks what comes back, so a bad answer is refused or trimmed rather than trusted.
- Until Grapher is published to npm, the command file points at the CLI's absolute path on the user's machine, so it is installed to the user's own `~/.claude/commands` folder, never into a project.
