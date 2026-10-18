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

| Threat                                                | Mitigation                                                                                                                                                                                                                                                | Status |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| A secret file is read and its value shown             | Denylist of secret file names and credential folders. The scanner never opens them, and the safe reader refuses them again at read time. A test records every file read to prove it                                                                       | Done   |
| A `.gitignore` negation re-includes a secret file     | The denylist is checked before `.gitignore` rules                                                                                                                                                                                                         | Done   |
| A symlink leads outside the project or to a secret    | Symlinks are never followed. The reader checks the real path is inside the project at read time                                                                                                                                                           | Done   |
| A file is swapped for a symlink between scan and read | The reader re-checks `lstat` and the real path just before reading                                                                                                                                                                                        | Done   |
| `../` paths escape the project                        | The reader only reads paths the scan approved, and confirms the resolved path is inside the root                                                                                                                                                          | Done   |
| Huge or generated files exhaust memory                | Per-file size limit and a total file limit                                                                                                                                                                                                                | Done   |
| A secret hardcoded in source appears in a snippet     | Each snippet is one line. Known key formats, private keys, URL logins, secret-named assignments and random-looking strings are replaced with `[hidden]`                                                                                                   | Done   |
| A secret slips through into the output                | A final scan of `graph.json`, the viewer's data, the explain request sent to Claude and Claude's answers. Grapher writes nothing if anything matches. CI runs a fake-secrets project                                                                      | Done   |
| Connection strings expose passwords                   | Databases are recorded by type only, and settings by name only. Outside web services are recorded by host, with any login (`user:pass@`) and query string removed                                                                                         | Done   |
| Prompt injection through code comments                | Snippets are JSON inside marker lines with a random value the code can't guess, and the command tells Claude to treat them as data. Answers must be a JSON object of plain text for ids that were asked about, capped in length, and are rendered as text | Done   |
| Package names leak information to Claude              | Only the names of packages the code imports are sent, never code, file names or settings. Names must be valid npm package names, and the request is checked for secrets before it is printed                                                              | Done   |
| A tampered `.grapher/packages.json`                   | Entries are cleaned on load: valid package names only, one of four kinds, plain-text labels of at most 40 characters. A bad entry is dropped and the package is asked about again                                                                         | Done   |
| HTML or script injection in the viewer                | React escapes all text and raw HTML is never set. Embedded JSON is escaped for `</script>`. A hash-based CSP allows only Grapher's own script and blocks all network access                                                                               | Done   |
| Code sent over the network                            | The Grapher program makes no network requests. A test fails if any source uses a networking API                                                                                                                                                           | Done   |
| A malicious dependency                                | Few dependencies, lockfile installs, Dependabot, dependency review, audit and CodeQL in CI                                                                                                                                                                | Done   |

## Out of scope

- Secrets the user deliberately pastes into code comments or file names. These are reduced by scrubbing but cannot be fully prevented.
- A compromised machine or Node.js runtime.
