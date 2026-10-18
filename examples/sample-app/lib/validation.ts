import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export function formatTitle(title: string) {
  return title.trim();
}
