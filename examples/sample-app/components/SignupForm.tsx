'use client';

import { useState } from 'react';

export function SignupForm() {
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(form: FormData) {
    const res = await fetch('/api/users', {
      method: 'POST',
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    });
    if (!res.ok) setError('Could not sign up');
  }

  return (
    <form action={onSubmit}>
      <input name="email" type="email" />
      <input name="password" type="password" />
      <button type="submit">Sign up</button>
      {error && <p>{error}</p>}
    </form>
  );
}
