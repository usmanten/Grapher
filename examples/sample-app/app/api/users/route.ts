import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { sendWelcomeEmail } from '@/lib/email';
import { signupSchema } from '@/lib/validation';

export async function GET() {
  const users = await db.user.findMany({ select: { id: true, email: true } });
  return NextResponse.json(users);
}

export async function POST(request: Request) {
  const { email, password } = signupSchema.parse(await request.json());
  const user = await db.user.create({ data: { email, passwordHash: await hash(password) } });
  await sendWelcomeEmail(user.email);
  return NextResponse.json({ id: user.id }, { status: 201 });
}

async function hash(password: string) {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(digest).toString('hex');
}
