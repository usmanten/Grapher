/** Joins words the way people write lists: "a", "a and b", "a, b and c". */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/** Lists up to `max` names, then says how many more there are. */
export function listNames(names: readonly string[], max = 2): string {
  if (names.length <= max) return joinAnd(names);
  const rest = names.length - max;
  return `${names.slice(0, max).join(', ')} and ${rest} more`;
}

/** A readable plural for a database model name: user → users, category → categories. */
export function pluralize(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}
