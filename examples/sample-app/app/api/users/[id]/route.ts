import { db } from '@/lib/db';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.user.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
