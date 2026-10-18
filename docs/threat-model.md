# Threat model

Grapher runs on a developer's machine, reads their source code, and produces a page that may be shared or explained by an AI assistant. This document lists what we protect, where the trust boundaries are, and how each threat is handled. It is updated as new stages are built.

## Assets

1. **Secret values**: API keys, database passwords and tokens in `.env` files, key files, or hardcoded in source.
2. **Source code**: the user's code should not leave their machine through Grapher.
3. **The user's machine**: Grapher should not read or write outside the project folder or its own output folder.
4. **The viewer's browser**: the generated page must not run code taken from the project.

## Trust boundaries

| Boundary          | Untrusted side                                                                       | Notes                                           |
| ----------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Local file system | Everything inside the project, including file names, `.gitignore` files and symlinks | A cloned repository can be crafted by anyone    |
| Explanation step  | Code snippets sent to the Claude Code session                                        | Comments in code may try to inject instructions |
| Browser           | All graph data shown in the viewer                                                   | Code snippets may contain HTML or script        |

## Threats and mitigations

| Threat                                                | Mitigation                                                                                                                                                                          | Status           |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| A secret file is read and its value shown             | Denylist of secret file names and credential folders. The scanner never opens them, and the safe reader refuses them again at read time. A test records every file read to prove it | Done             |
| A `.gitignore` negation re-includes a secret file     | The denylist is checked before `.gitignore` rules                                                                                                                                   | Done             |
| A symlink leads outside the project or to a secret    | Symlinks are never followed. The reader checks the real path is inside the project at read time                                                                                     | Done             |
| A file is swapped for a symlink between scan and read | The reader re-checks `lstat` and the real path just before reading                                                                                                                  | Done             |
| `../` paths escape the project                        | The reader only reads paths the scan approved, and confirms the resolved path is inside the root                                                                                    | Done             |
| Huge or generated files exhaust memory                | Per-file size limit and a total file limit                                                                                                                                          | Done             |
| A secret hardcoded in source appears in a snippet     | Snippet scrubbing for known key formats and high-entropy strings                                                                                                                    | Planned (step 5) |
| A secret slips through into the output                | A final scan of `graph.json`, `index.html` and explanation input. Grapher refuses to write output if anything matches                                                               | Planned (step 5) |
| Connection strings expose passwords                   | Record the database type and host only, and strip credentials                                                                                                                       | Planned (step 2) |
| Prompt injection through code comments                | Snippets are passed to the explanation step clearly marked as data, with a fixed output format                                                                                      | Planned (step 4) |
| HTML or script injection in the viewer                | Everything is escaped, there is no `dangerouslySetInnerHTML`, a strict CSP is used, and embedded JSON is escaped for `</script>`                                                    | Planned (step 3) |
| Code sent over the network                            | The Grapher program makes no network requests. A test fails if any source uses a networking API                                                                                     | Done             |
| A malicious dependency                                | Few dependencies, lockfile installs, Dependabot, dependency review, audit and CodeQL in CI                                                                                          | Done             |

## Out of scope

- Secrets the user deliberately pastes into code comments or file names. These are reduced by scrubbing but cannot be fully prevented.
- A compromised machine or Node.js runtime.
