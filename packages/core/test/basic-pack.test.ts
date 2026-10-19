import { afterEach, describe, expect, it } from 'vitest';

import { analyzeProject, type Graph, type LanguagePack } from '../src/index.js';
import { FileIndex, joinPath } from '../src/analyze/packs/basic/resolve.js';
import { FAKE_SECRET, makeProject, type Tree } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function graphOf(tree: Tree, packs?: readonly LanguagePack[]): Promise<Graph> {
  const created = await makeProject(tree);
  cleanups.push(created.cleanup);
  return (await analyzeProject(created.dir, packs ? { packs } : {})).graph;
}

/** Every file-to-file connection as `from -> to: label`. */
function links(graph: Graph): string[] {
  return graph.connections.map(
    (c) => `${c.from.replace('file:', '')} -> ${c.to.replace('file:', '')}: ${c.label}`,
  );
}

describe('basic pack', () => {
  it('maps Python imports: absolute, relative, packages and submodules', async () => {
    const graph = await graphOf({
      'app/__init__.py': '',
      'app/main.py': [
        'import os',
        'from app.db import connect',
        'from .models import User, Post',
        'from . import views',
        'import app.utils as u',
      ].join('\n'),
      'app/db.py': 'def connect(): pass',
      'app/models/__init__.py': 'class User: pass\nclass Post: pass',
      'app/views.py': 'from ..config import settings',
      'app/utils.py': '',
      'config.py': 'settings = {}',
      'tests/test_main.py': 'from app.main import thing',
    });
    expect(links(graph)).toEqual([
      'app/main.py -> app/db.py: uses connect',
      'app/main.py -> app/models/__init__.py: uses Post and User',
      'app/main.py -> app/utils.py: uses app.utils',
      'app/main.py -> app/views.py: uses views',
      'app/views.py -> config.py: uses settings',
    ]);
    expect(graph.nodes.map((n) => n.id)).not.toContain('file:tests/test_main.py');
    expect(graph.project.framework).toBe('unknown');
    expect(graph.warnings).toEqual([]);
  });

  it('maps Java imports under a source folder, including nested and static imports', async () => {
    const graph = await graphOf({
      'src/main/java/com/shop/App.java': [
        'package com.shop;',
        'import com.shop.cart.Cart;',
        'import com.shop.cart.Cart.Item;',
        'import static com.shop.util.Money.format;',
        'import com.shop.util.*;',
        'import java.util.List;',
      ].join('\n'),
      'src/main/java/com/shop/cart/Cart.java': 'package com.shop.cart;',
      'src/main/java/com/shop/util/Money.java': 'package com.shop.util;',
      'src/test/java/com/shop/AppTest.java': 'import com.shop.App;',
    });
    expect(links(graph)).toEqual([
      'src/main/java/com/shop/App.java -> src/main/java/com/shop/cart/Cart.java: uses Cart and Item',
      'src/main/java/com/shop/App.java -> src/main/java/com/shop/util/Money.java: uses Money',
    ]);
  });

  it('maps Go imports to every file of the package, using the module path from go.mod', async () => {
    const graph = await graphOf({
      'go.mod': 'module example.com/shop\n\ngo 1.22\n',
      'main.go': 'package main\nimport (\n  "fmt"\n  store "example.com/shop/internal/db"\n)\n',
      'internal/db/db.go': 'package db',
      'internal/db/query.go': 'package db',
      'internal/db/db_test.go': 'package db',
    });
    expect(links(graph)).toEqual([
      'main.go -> internal/db/db.go: uses store',
      'main.go -> internal/db/query.go: uses store',
    ]);
  });

  it('maps Rust modules and crate, self and super paths', async () => {
    const graph = await graphOf({
      'Cargo.toml': '[package]\nname = "shop"',
      'src/main.rs': 'mod models;\nmod api;\nmod inline { }\nuse crate::models::{User, Post};',
      'src/models.rs': 'pub struct User; pub struct Post;',
      'src/api/mod.rs': 'mod routes;\nuse super::models::User;',
      'src/api/routes.rs': 'use self::helpers::x;\nuse std::fmt;',
    });
    expect(links(graph)).toEqual([
      'src/api/mod.rs -> src/api/routes.rs: uses routes',
      'src/api/mod.rs -> src/models.rs: uses User',
      'src/main.rs -> src/api/mod.rs: uses api',
      'src/main.rs -> src/models.rs: uses Post, User and 1 more',
    ]);
  });

  it('maps C and C++ includes, ignoring system headers', async () => {
    const graph = await graphOf({
      'src/main.c': '#include <stdio.h>\n#include "util.h"\n#include "net/socket.h"',
      'src/util.h': '',
      'include/net/socket.h': '',
    });
    expect(links(graph)).toEqual([
      'src/main.c -> include/net/socket.h: uses socket.h',
      'src/main.c -> src/util.h: uses util.h',
    ]);
  });

  it('maps Ruby requires and PHP includes and namespaces', async () => {
    const graph = await graphOf({
      'lib/shop.rb': "require 'json'\nrequire_relative 'shop/cart'\nrequire 'shop/money'",
      'lib/shop/cart.rb': '',
      'lib/shop/money.rb': '',
      'routes/web.php': [
        '<?php',
        'use App\\Models\\User;',
        'use App\\Models\\{Post, Tag as T};',
        "require __DIR__ . '/../config.php';",
      ].join('\n'),
      'app/Models/User.php': '<?php',
      'app/Models/Post.php': '<?php',
      'config.php': '<?php',
    });
    expect(links(graph)).toEqual([
      'lib/shop.rb -> lib/shop/cart.rb: uses cart',
      'lib/shop.rb -> lib/shop/money.rb: uses money',
      'routes/web.php -> app/Models/Post.php: uses Post',
      'routes/web.php -> app/Models/User.php: uses User',
      'routes/web.php -> config.php: uses it',
    ]);
  });

  it('maps mixed projects: JavaScript keeps its full pack and other files get the basic one', async () => {
    const graph = await graphOf({
      'package.json': JSON.stringify({ name: 'mixed' }),
      'app/page.tsx': "import { x } from '../lib/x';\nexport default function P() { return x; }",
      'lib/x.ts': 'export const x = 1;',
      'scripts/seed.py': 'from helpers import load',
      'scripts/helpers.py': 'def load(): pass',
    });
    expect(graph.project).toEqual({ name: 'mixed', framework: 'next-app-router' });
    expect(links(graph)).toEqual([
      'app/page.tsx -> lib/x.ts: uses x',
      'scripts/seed.py -> scripts/helpers.py: uses load',
    ]);
  });

  it('shows the line behind each connection with secrets hidden', async () => {
    const graph = await graphOf({
      'main.py': `from db import connect  # key ${FAKE_SECRET}`,
      'db.py': '',
    });
    const code = graph.connections[0]?.locations[0]?.code ?? '';
    expect(code).toContain('from db import connect');
    expect(JSON.stringify(graph)).not.toContain(FAKE_SECRET);
  });

  it('gives a full pack the files it claims, ahead of the basic pack', async () => {
    const pythonPack: LanguagePack = {
      id: 'python-test',
      name: 'Python (test)',
      claims: (p) => p.endsWith('.py'),
      load: ({ paths }) =>
        Promise.resolve({
          files: paths.map((p) => ({
            node: { id: `file:${p}`, kind: 'file' as const, path: p, role: 'route' as const },
            text: '',
          })),
          problems: [],
          warnings: [],
          linkFiles: () => undefined,
          findSpecialParts: () => Promise.resolve(),
        }),
    };
    const { DEFAULT_PACKS } = await import('../src/index.js');
    const graph = await graphOf({ 'a.py': 'import b', 'b.py': '' }, [pythonPack, ...DEFAULT_PACKS]);
    expect(graph.nodes.map((n) => n.kind === 'file' && n.role)).toEqual(['route', 'route']);
    expect(graph.connections).toEqual([]);
  });
});

describe('import resolution', () => {
  it('joins paths and refuses to climb above the project root', () => {
    expect(joinPath('a/b', '../c', './d.py')).toBe('a/c/d.py');
    expect(joinPath('a', '../..', 'x')).toBeUndefined();
  });

  it('prefers the closest source folder, and only matches elsewhere when asked and unique', () => {
    const index = new FileIndex(['models.py', 'pkg/models.py', 'lib/only.h', 'x/dup.h', 'y/dup.h']);
    const any = () => true;
    expect(index.resolve('pkg/sub/a.py', [{ suffix: 'models.py' }], any)).toEqual([
      'pkg/models.py',
    ]);
    expect(index.resolve('src/a.c', [{ suffix: 'only.h' }], any)).toEqual([]);
    expect(index.resolve('src/a.c', [{ suffix: 'only.h', anywhere: true }], any)).toEqual([
      'lib/only.h',
    ]);
    expect(index.resolve('src/a.c', [{ suffix: 'dup.h', anywhere: true }], any)).toEqual([]);
  });
});
