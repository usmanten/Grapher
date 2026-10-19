# Pages app

A small Next.js Pages Router blog used by Grapher's tests. It is never installed or run; Grapher only reads its source.

It covers the Pages Router patterns Grapher detects: pages in `pages/` (including `index` files and a dynamic `[id]` page), `_app` wrapping every page, API routes in `pages/api/` that branch on `req.method`, a page loading data in `getServerSideProps`, client `fetch` calls and `router.push` to the app's own pages and routes, and Prisma.
