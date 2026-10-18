import { describe, expect, it } from 'vitest';

import { GraphBuilder } from '../src/analyze/builder.js';
import { joinAnd, listNames, pluralize } from '../src/analyze/labels.js';

describe('labels', () => {
  it('joins lists the way people write them', () => {
    expect(joinAnd([])).toBe('');
    expect(joinAnd(['a'])).toBe('a');
    expect(joinAnd(['a', 'b'])).toBe('a and b');
    expect(joinAnd(['a', 'b', 'c'])).toBe('a, b and c');
    expect(listNames(['a', 'b', 'c', 'd'])).toBe('a, b and 2 more');
  });

  it.each([
    ['user', 'users'],
    ['category', 'categories'],
    ['day', 'days'],
    ['address', 'addresses'],
    ['match', 'matches'],
  ])('pluralizes %s as %s', (word, plural) => {
    expect(pluralize(word)).toBe(plural);
  });
});

describe('GraphBuilder', () => {
  const loc = (line: number) => ({ path: 'a.ts', line, role: 'use' as const });

  it('merges everything between one pair of nodes into a single connection', () => {
    const builder = new GraphBuilder();
    builder.connect({
      from: 'file:a.ts',
      to: 'file:b.ts',
      kind: 'uses',
      name: 'x',
      location: loc(3),
    });
    builder.connect({
      from: 'file:a.ts',
      to: 'file:b.ts',
      kind: 'displays',
      name: 'Y',
      location: loc(1),
    });
    builder.connect({ from: 'file:a.ts', to: 'file:b.ts', kind: 'uses', location: loc(3) });

    const { connections } = builder.build({ name: 'p', framework: 'unknown' });

    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ kind: 'displays', label: 'displays' });
    expect(connections[0]?.locations.map((l) => l.line)).toEqual([1, 3]);
  });

  it('labels unused imports, requests and database operations', () => {
    const builder = new GraphBuilder();
    builder.connect({ from: 'a', to: 'b', kind: 'uses', location: loc(1) });
    builder.connect({ from: 'a', to: 'r', kind: 'requests', detail: 'GET', location: loc(1) });
    builder.connect({ from: 'a', to: 'r', kind: 'requests', detail: 'POST', location: loc(2) });
    builder.connect({ from: 'a', to: 'q', kind: 'requests', location: loc(1) });
    builder.connect({
      from: 'a',
      to: 'db',
      kind: 'writes',
      operation: 'deletes',
      detail: 'users',
      location: loc(1),
    });
    builder.connect({ from: 'c', to: 'db', kind: 'reads', operation: 'reads', location: loc(1) });
    builder.connect({ from: 'a', to: 's', kind: 'uses-service', location: loc(1) });
    builder.connect({ from: 'a', to: 'a', kind: 'uses', location: loc(1) });

    const labels = Object.fromEntries(
      builder.build({ name: 'p', framework: 'unknown' }).connections.map((c) => [c.id, c.label]),
    );

    expect(labels).toEqual({
      'a->b': 'imports but never uses',
      'a->r': 'sends GET and POST requests to',
      'a->q': 'sends a request to',
      'a->db': 'deletes from users',
      'c->db': 'reads from',
      'a->s': 'uses service',
    });
  });

  it('keeps at most five locations per connection', () => {
    const builder = new GraphBuilder();
    for (let line = 1; line <= 8; line++) {
      builder.connect({ from: 'a', to: 'b', kind: 'uses', name: 'x', location: loc(line) });
    }
    expect(
      builder.build({ name: 'p', framework: 'unknown' }).connections[0]?.locations,
    ).toHaveLength(5);
  });
});
