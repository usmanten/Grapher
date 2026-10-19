import type { NextApiRequest, NextApiResponse } from 'next';

import { db } from '@/lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    res.status(405).end();
    return;
  }
  await db.post.delete({ where: { id: String(req.query.id) } });
  res.status(204).end();
}
