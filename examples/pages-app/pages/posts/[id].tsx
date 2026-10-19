import type { GetServerSideProps } from 'next';

import { db } from '@/lib/db';

interface Props {
  title: string;
  body: string;
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ params }) => {
  const post = await db.post.findUnique({ where: { id: String(params?.id) } });
  return post ? { props: { title: post.title, body: post.body } } : { notFound: true };
};

export default function PostPage({ title, body }: Props) {
  return (
    <article>
      <h1>{title}</h1>
      <p>{body}</p>
    </article>
  );
}
