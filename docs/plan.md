# Grapher: the plan

_The product plan for Grapher v0.x. Significant changes to it are recorded as ADRs in [decisions/](decisions/)._

## What it is

You type `/grapher` in Claude Code inside a Next.js project. Grapher maps how the project fits together and opens an interactive page where you can click any file to see what uses it and what it uses. That includes other files, API routes, the database, outside services, and settings (names only). Clicking a connection gives a plain-English explanation of 2–3 sentences and the exact lines of code.

**For:** students and people building with AI who aren't experts in project structure yet.
**Not for (for now):** senior engineers or huge enterprise codebases.

## Key decisions and why

| Decision                                                         | Why                                                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build our own tool, not extend Understand Anything               | Our focus is different: explaining each connection, beginners, guaranteed secret safety, and low cost                                            |
| Hybrid: code parsing finds the connections, Claude explains them | Parsing is exact and free, so every arrow is real and points to a line. Claude is better at explaining in plain English. Low token use is a goal |
| Run as a Claude Code command (`/grapher`)                        | Students already have Claude Code, so no API key or extra setup is needed                                                                        |
| Next.js (App Router) first, Python later                         | Usman builds in Next.js, and doing one stack well beats doing several badly                                                                      |
| File-first view, with "Trace full flow" and an Overview          | Beginners get lost in a specific file. One file's neighbors fit on a screen, while a whole-app graph becomes a hairball                          |
| One line per file pair, labeled by purpose in plain words        | "uses sendWelcomeEmail" says more to a beginner than separate "imports" and "calls" lines                                                        |
| Arrows point from the code doing the action to what it uses      | The chain reads as "what happens next" (form → route → email → Resend), and it's the common convention                                           |
| Secrets: names only, never values                                | Grapher never opens .env or key files, scrubs anything key-shaped from code snippets, and checks its own output before saving                    |

## How it will work under the hood

1. **Scan.** Walk the project, skipping `node_modules`, build output, anything in `.gitignore`, and secret files (`.env*`, `*.pem`, `*.key`, credentials files).
2. **Parse.** Use the TypeScript compiler (via ts-morph) instead of a generic parser. It understands Next.js path aliases like `@/lib/db`, so it knows exactly which file an import points to.
3. **Detect Next.js patterns:**
   - pages (`app/**/page.tsx`) and the components they display
   - API routes (`app/**/route.ts`) and their methods (GET, POST…)
   - `fetch("/api/...")` calls, matched to the route they hit
   - server actions and server components that read the database directly
   - database code, in three layers: (a) detailed detectors for **Prisma, Drizzle and Supabase** that know the table and whether code reads or writes; (b) a lookup list of known database and service packages (`pg`, `mongodb`, `mongoose`, `redis`, `firebase`, `stripe`, `openai`, `resend`…) that become simpler boxes; (c) any unknown package gets sent to Claude once, by name only, to classify, and is marked "identified by AI"
   - outside services: found the same way, from their SDK imports
   - App Router first. If a `pages/` folder is found, Grapher says Pages Router isn't fully supported yet. Pages Router support comes soon after.
   - testing uses a sample Next.js app that we build (it lives in the repo as a test fixture)
   - settings: `process.env.X` recorded as the name `X` only
4. **Build the graph.** Save it as `.grapher/graph.json`, with nodes, connections, and file:line for each connection.
5. **Explain.** Claude writes a short explanation for each connection that matters, seeing only a small, already-scrubbed code snippet. Results are cached by a fingerprint of the code, so re-running only re-explains what changed.
6. **Safety check.** Scan the finished output for anything that looks like a key or password, and refuse to save if something is found.
7. **View.** Write `.grapher/index.html`, a single page that opens in the browser and is built with React Flow for zoom and pan. It has the file tree, the file view, Trace full flow, the Overview, and the explanation panel with "open in VS Code" links.

## Build order

1. **Skeleton and scanner**: repo setup, the file walk with secret-file blocking from day one
2. **Connections without AI**: imports, pages, routes, fetch-to-route matching, database, services, settings
3. **Viewer**: turn the mockup into the real viewer, fed by `graph.json`
4. **Explanations**: the `/grapher` command in Claude Code, plus caching
5. **Secret safety**: snippet scrubbing, the final output check, and a test project full of fake secrets that must come out clean
6. **Real-world test**: run it on one of Usman's projects and tune it

Each step ends with something you can see and try.

## Later ideas

- A "what changed" view that compares the graph to the last commit, useful right after Claude makes a big change
- Python (FastAPI, Flask)
- Hover tooltips that teach concepts ("what's a component?")
- Watch mode that updates as you code
