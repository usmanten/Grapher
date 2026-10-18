'use server';

import { db } from '@/lib/db';
import { formatTitle } from '@/lib/validation';

export async function createPost(form: FormData) {
  await db.post.create({
    data: { title: formatTitle(String(form.get('title'))), authorId: String(form.get('authorId')) },
  });
}
