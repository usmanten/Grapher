import Link from 'next/link';

export function Nav() {
  return (
    <nav>
      <Link href="/">Posts</Link>
      <Link href="/posts/new">Write a post</Link>
    </nav>
  );
}
