import { UserCard } from '@/components/UserCard';
import { db } from '@/lib/db';

// A server component can read the database directly, with no API route in between.
export default async function DashboardPage() {
  const users = await db.user.findMany();
  return (
    <ul>
      {users.map((user) => (
        <UserCard key={user.id} id={user.id} email={user.email} />
      ))}
    </ul>
  );
}
