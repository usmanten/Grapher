## What changed

<!-- A short description of the change, in plain language. -->

## Why

<!-- The problem this solves, or the decision behind it. Link an ADR if there is one. -->

## How to test

<!-- Exact commands a reviewer can run. -->

```sh
pnpm install
pnpm build
pnpm test
```

## Checklist

- [ ] Lint, typecheck, tests and build pass locally
- [ ] New logic has tests, and coverage holds
- [ ] Security check done: no secret values in output, no path traversal, no unsafe HTML
- [ ] Docs, README and CHANGELOG updated where needed
- [ ] ADR added for any significant decision
