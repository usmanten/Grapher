# 10. Read each language through a language pack

- Status: Accepted
- Date: 2026-10-18

## Context

Grapher started as a Next.js tool, so its reader was written for JavaScript and TypeScript only. The next step is more languages (Python first, then Java and others). Everything after the reader, from the graph and labels to the explanations, secret checks and viewer, already works the same whatever the language. Bolting each new language onto the JavaScript code as a special case would mean untangling them later.

## Decision

- Every language is read by a **language pack** (`packages/core/src/analyze/pack.ts`). A pack answers three questions: which files are mine (`claims`, `load`), which file uses which (`linkFiles`), and what the special parts are, like routes, databases, services and settings (`findSpecialParts`). Packs add nodes and connections through the shared `GraphBuilder`, and use the shared `file:<path>` node ids.
- The existing ts-morph and Next.js code is pack #1 (`packs/javascript`), unchanged in behavior. ts-morph stays: it resolves `tsconfig` path aliases and powers the Next.js detectors, which a general-purpose parser would have to rebuild.
- A **basic pack** (`packs/basic`) covers files no full pack claims. It parses Python, Java, Go, Rust, C and C++, Ruby and PHP with Tree-sitter and maps which file uses which. It finds no special parts. Packs are tried in order, and the basic pack is last, so a full pack for a language takes its files over as soon as it is added.
- Tree-sitter comes from `@vscode/tree-sitter-wasm`, Microsoft's prebuilt WebAssembly bundle of the runtime and grammars. It needs no compiler at install time and loads grammar files from the local install. Grapher reads the grammar bytes itself, so the loader never takes its browser `fetch` path ([ADR 0003](0003-no-network-in-cli.md)).

## Consequences

- Adding a language means writing one pack and listing it in `DEFAULT_PACKS`, with no change to the rest of Grapher.
- Projects in other languages get a useful map right away, but without routes, databases or settings until their full pack exists.
- The basic pack follows imports by matching file paths, not by running the language's own module rules, so unusual setups (custom Python paths, C include folders set in build files) can miss some connections. A missed import leaves a connection out; it never invents one between unrelated files.
- The Tree-sitter bundle adds about 20 MB to the install.
- User code is still read only through the safe reader ([ADR 0004](0004-secret-denylist-and-read-gate.md)); each pack gets the same reader.
