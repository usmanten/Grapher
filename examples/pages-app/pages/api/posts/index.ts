import type { NextApiRequest, NextApiResponse } from 'next';

import { db } from '@/lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      res.json(await db.post.findMany());
      return;
    case 'POST': {
      const { title, body } = JSON.parse(String(req.body)) as { title: string; body: string };
      res.status(201).json(await db.post.create({ data: { title, body } }));
      return;
    }
    default:
      res.status(405).end();
  }
}
