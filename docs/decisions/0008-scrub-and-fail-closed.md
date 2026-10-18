# 8. Scrub snippets and fail closed on output

- Status: Accepted
- Date: 2026-10-18

## Context

Secret files are never opened ([ADR 0004](0004-secret-denylist-and-read-gate.md)), but people also paste keys straight into code: `new Stripe('sk_live_…')`, a database URL with a password, an old key left in a comment. Showing code snippets in the viewer, and later sending them to Claude for explanations, could expose those.

## Decision

- Each connection location carries **one line** of code, cut to 160 characters. Less code means less to leak.
- Before a snippet leaves the parser, `scrub` replaces anything secret-looking with `[hidden]`. Detection covers published key formats, private key blocks, logins in URLs, values assigned to secret-sounding names, and long strings that mix letters, capitals and digits with high entropy (a measure of randomness).
- Everything Grapher is about to write goes through `assertNoSecrets`, using the same detectors. If anything matches, Grapher **writes nothing** and exits with an error. The error names where the problem is (like `connections[4].locations[1].code`) and what kind it is, but never the value, so the error itself can't leak it.
- Text that is already `[hidden]` is not flagged again.
- CI generates a project full of fake secrets at test time, runs Grapher on it, and fails if any fake value appears in the output.

## Consequences

- Some harmless strings will be hidden, like a long random test fixture. That's an acceptable cost; hiding too much is safer than too little.
- Hex hashes and UUIDs are not treated as secrets (no capital letters), which keeps commit hashes and IDs readable, but means a hex-only secret assigned to a neutral name could slip through scrubbing. Secret-sounding names still catch most of these.
- A secret-looking file or folder name stops the run with a clear message instead of being silently hidden, since a path can't be partly redacted without breaking links.
- The same detectors will check the text sent to Claude for explanations in the next step.
