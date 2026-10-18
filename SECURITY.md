# Security policy

Grapher reads source code on your machine, so security is a core feature, not an add-on. The main promise is simple: **Grapher may show the name of a secret, but never its value.**

## Supported versions

Grapher is in early development. Only the latest release receives security fixes.

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |
| older   | No        |

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report privately through GitHub: go to the [Security tab](https://github.com/usmanten/grapher/security/advisories/new) and choose **Report a vulnerability**. Include:

- what you found and why it is a problem
- steps to reproduce, ideally with a small example project
- which version you tested

Never include real secrets in a report. Use made-up values.

You can expect an acknowledgement within 7 days. Once a fix is ready, it will be released and credited to you in the advisory, unless you prefer to stay anonymous.

## What counts as a vulnerability

Examples of issues we want to hear about:

- any way a secret value (from `.env` files, key files, or hardcoded in code) ends up in Grapher's output or in text sent for explanations
- reading files outside the project folder, for example through symlinks or `../` paths
- HTML or script injection in the generated viewer from crafted source code
- Grapher making network requests

## How Grapher protects you

The full threat model is in [docs/threat-model.md](docs/threat-model.md). In short:

- Secret files such as `.env`, `*.pem` and credential files are never opened.
- Every file read goes through a single gate that re-checks the rules at read time.
- Symlinks are never followed, and all paths are confined to the project folder.
- The Grapher program makes no network requests.
