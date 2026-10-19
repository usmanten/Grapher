# 13. Map the Pages Router in the JavaScript pack

- Status: Accepted
- Date: 2026-10-19

## Context

Grapher was built for the Next.js App Router and only warned when it found a `pages/` folder. Many Next.js projects, including tutorials and older apps, still use the Pages Router, where the file name is the URL (`pages/about.tsx` is `/about`) and API routes live in `pages/api/` with one handler that checks `req.method`. Those projects got a map with no pages or routes, so links and `fetch` calls had nothing to connect to.

A `pages/` folder isn't only a Next.js thing: Vite and Create React App projects often keep their screens in `src/pages/` and route to them with a router library. Reading those as Next.js pages would give them URLs they don't have.

## Decision

- The JavaScript pack ([ADR 0010](0010-language-packs.md)) maps the Pages Router next to the App Router, in `next.ts`. No other pack or part of Grapher changes.
- `pages/` (or `src/pages/`) only counts when the project uses Next.js: `next` is listed in `package.json`, or the project has a `next.config` file. Otherwise those files stay plain components and modules.
- In `pages/`, `_app` and `_document` are layouts, files under `pages/api/` are API routes, and every other file is a page, as Next.js treats them. The URL comes from the file path, with `index` standing for its folder.
- A Pages Router route's methods are the ones its handler compares `req.method` with (`===`, `!==`, a `switch`, or `[...].includes(req.method)`). A handler that never checks has an empty list, shown as "API route at /api/x".
- `project.framework` gains `next-pages-router`. A project with both folders (one moving from one router to the other) has both mapped, and counts as `next-app-router`, the one Next.js recommends.
- The `pages-router` warning is removed, and `no-app-router` becomes `no-next-router`: it now shows only when there is neither an `app/` nor a `pages/` folder.

## Consequences

- Pages Router projects get the same map as App Router ones: pages, layouts, API routes with methods, links, `router.push` calls, `fetch` calls and database reads in `getServerSideProps`.
- `graph.json` changes in two small ways (a new `framework` value and different warning codes). Grapher writes `graph.json` fresh on every run, so `schemaVersion` stays 1.
- Custom `pageExtensions` (like `*.page.tsx`) in `next.config` aren't read, so in such projects helper files in `pages/` are shown as pages too.
- Methods chosen in ways Grapher doesn't read (like a lookup table of handlers) are missed and the route shows no methods. A `fetch` to it still connects.
