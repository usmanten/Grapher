import { describe, expect, it } from 'vitest';

import {
  fileRole,
  isCodeFile,
  matchRoute,
  UNKNOWN_SEGMENT,
  urlPathFor,
} from '../src/analyze/packs/javascript/next.js';

describe('fileRole', () => {
  it.each([
    ['app/page.tsx', undefined, 'page'],
    ['src/app/blog/[slug]/page.jsx', undefined, 'page'],
    ['app/layout.tsx', undefined, 'layout'],
    ['app/dashboard/template.tsx', undefined, 'layout'],
    ['app/api/users/route.ts', undefined, 'route'],
    ['middleware.ts', undefined, 'middleware'],
    ['src/middleware.js', undefined, 'middleware'],
    ['next.config.mjs', undefined, 'config'],
    ['tailwind.config.ts', undefined, 'config'],
    ['instrumentation.ts', undefined, 'config'],
    ['app/actions.ts', 'use server', 'server-actions'],
    ['components/Button.tsx', 'use client', 'component'],
    ['lib/db.ts', undefined, 'module'],
    ['components/page.tsx', undefined, 'component'],
  ] as const)('%s is a %s', (path, directive, role) => {
    expect(fileRole(path, directive)).toBe(role);
  });
});

describe('fileRole in a Pages Router project', () => {
  it.each([
    ['pages/index.tsx', 'page'],
    ['src/pages/blog/[slug].jsx', 'page'],
    ['pages/_error.tsx', 'page'],
    ['pages/_app.tsx', 'layout'],
    ['src/pages/_document.js', 'layout'],
    ['pages/api/users/[id].ts', 'route'],
    ['pages/blog/_app.tsx', 'page'],
    ['app/page.tsx', 'page'],
    ['components/Nav.tsx', 'component'],
  ] as const)('%s is a %s', (path, role) => {
    expect(fileRole(path, undefined, true)).toBe(role);
  });

  it('ignores pages/ outside Next.js projects', () => {
    expect(fileRole('src/pages/Home.tsx', undefined)).toBe('component');
  });
});

describe('isCodeFile', () => {
  it('accepts source files and rejects declarations and other files', () => {
    expect(['a.ts', 'b.tsx', 'c.js', 'd.mjs', 'e.cts'].every(isCodeFile)).toBe(true);
    expect(['next-env.d.ts', 'style.css', 'README.md', 'schema.prisma'].some(isCodeFile)).toBe(
      false,
    );
  });
});

describe('urlPathFor', () => {
  it.each([
    ['app/page.tsx', '/'],
    ['app/api/users/route.ts', '/api/users'],
    ['src/app/blog/[slug]/page.tsx', '/blog/[slug]'],
    ['app/(marketing)/about/page.tsx', '/about'],
    ['app/@modal/(.)photo/page.tsx', '/(.)photo'],
    ['pages/index.tsx', '/'],
    ['pages/about.tsx', '/about'],
    ['src/pages/blog/index.jsx', '/blog'],
    ['pages/blog/[...slug].tsx', '/blog/[...slug]'],
    ['pages/api/users/[id].ts', '/api/users/[id]'],
  ])('%s answers %s', (path, url) => {
    expect(urlPathFor(path)).toBe(url);
  });
});

describe('matchRoute', () => {
  const id = `/api/users/${UNKNOWN_SEGMENT}`;

  it('matches static paths exactly', () => {
    expect(matchRoute('/api/users', '/api/users')).toBeDefined();
    expect(matchRoute('/api/users', '/api/posts')).toBeUndefined();
    expect(matchRoute('/api/users', '/api/users/1')).toBeUndefined();
    expect(matchRoute('/', '/')).toBe(0);
  });

  it('matches dynamic segments, preferring static ones', () => {
    expect(matchRoute('/api/users/[id]', id)).toBeDefined();
    expect(matchRoute('/api/users/[id]', '/api/users/42')).toBeDefined();
    expect(matchRoute('/api/users/me', id)).toBeUndefined();
    const dynamic = matchRoute('/api/users/[id]', '/api/users/me') ?? -1;
    const exact = matchRoute('/api/users/me', '/api/users/me') ?? -1;
    expect(exact).toBeGreaterThan(dynamic);
  });

  it('matches catch-all and optional catch-all segments', () => {
    expect(matchRoute('/api/files/[...path]', '/api/files/a/b/c')).toBeDefined();
    expect(matchRoute('/api/files/[...path]', '/api/files')).toBeUndefined();
    expect(matchRoute('/docs/[[...slug]]', '/docs')).toBeDefined();
    expect(matchRoute('/docs/[[...slug]]', '/docs/a/b')).toBeDefined();
  });
});
