'use client';

export function UserCard({ id, email }: { id: string; email: string }) {
  async function remove() {
    await fetch(`/api/users/${id}`, { method: 'DELETE' });
  }

  return (
    <div>
      <span>{email}</span>
      <button onClick={remove}>Delete</button>
    </div>
  );
}
