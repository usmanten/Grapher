import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Post {
  id: string;
  title: string;
}

export default function Home() {
  const [posts, setPosts] = useState<Post[]>([]);

  useEffect(() => {
    void fetch('/api/posts')
      .then((res) => res.json())
      .then(setPosts);
  }, []);

  return (
    <ul>
      {posts.map((post) => (
        <li key={post.id}>
          <Link href={`/posts/${post.id}`}>{post.title}</Link>
        </li>
      ))}
    </ul>
  );
}
