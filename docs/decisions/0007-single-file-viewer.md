# 7. Ship the viewer as one self-contained HTML file

- Status: Accepted
- Date: 2026-10-18

## Context

Users need to explore the graph in a browser. The page shows names and paths taken from their project, so it must not be possible for that data to run as code. Grapher also promises not to use the network, and a beginner shouldn't need to start a server just to look at their project.

## Decision

- The viewer is a React app using React Flow for zooming and panning. Vite bundles it, with all code and styles inlined, into one HTML template.
- `grapher graph` fills the template with the project's data and saves it as `.grapher/index.html`, which opens straight from disk.
- The data sits in a `<script type="application/json">` element, escaped so it can't close the element early.
- The page carries a Content Security Policy with `default-src 'none'`. Only the hashes of Grapher's own inlined script and stylesheet are allowed, so injected scripts, remote fonts and network requests are all blocked.
- No external fonts or assets are used. The page relies on system fonts.

We considered a local web server (more moving parts, a port to manage, a process to stop), and writing the page without a framework like the early mockup did (building HTML from strings is exactly where injection bugs come from).

## Consequences

- One file to open, share or delete, and it works offline.
- The page is around 450 KB, mostly React and React Flow. That's fine for a local file.
- Any change to the viewer's code changes the hashes, so the CSP is recomputed on every build by `scripts/finalize.js` instead of written by hand.
- Explanations from step 4 will be added to the same embedded data.
