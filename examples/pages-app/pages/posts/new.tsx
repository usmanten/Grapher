import { useRouter } from 'next/router';
import type { FormEvent } from 'react';

export default function NewPost() {
  const router = useRouter();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await fetch('/api/posts', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
    await router.push('/');
  }

  return (
    <form onSubmit={submit}>
      <input name="title" />
      <textarea name="body" />
      <button type="submit">Publish</button>
    </form>
  );
}
