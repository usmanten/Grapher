import { builtinModules } from 'node:module';

/**
 * Packages Grapher recognizes by name. Adding support for a new service or
 * database is usually one line here.
 *
 * Prisma, Drizzle and Supabase are not listed: they have dedicated detectors
 * that know which tables the code reads and writes.
 */

export interface KnownService {
  kind: 'service';
  label: string;
}

export interface KnownDatabase {
  kind: 'database';
  /** Groups packages that talk to the same kind of database. */
  engine: string;
  label: string;
}

export type KnownPackage = KnownService | KnownDatabase;

const service = (label: string): KnownService => ({ kind: 'service', label });
const database = (engine: string, label: string): KnownDatabase => ({
  kind: 'database',
  engine,
  label,
});

export const KNOWN_PACKAGES: ReadonlyMap<string, KnownPackage> = new Map<string, KnownPackage>([
  // Payments
  ['stripe', service('Stripe')],
  ['@stripe/stripe-js', service('Stripe')],
  ['@lemonsqueezy/lemonsqueezy.js', service('Lemon Squeezy')],
  ['@paypal/checkout-server-sdk', service('PayPal')],
  // Email and messaging
  ['resend', service('Resend')],
  ['@sendgrid/mail', service('SendGrid')],
  ['nodemailer', service('Email (SMTP)')],
  ['postmark', service('Postmark')],
  ['twilio', service('Twilio')],
  ['pusher', service('Pusher')],
  ['pusher-js', service('Pusher')],
  // Auth
  ['next-auth', service('Auth.js')],
  ['@auth/core', service('Auth.js')],
  ['@clerk/nextjs', service('Clerk')],
  ['@auth0/nextjs-auth0', service('Auth0')],
  ['@kinde-oss/kinde-auth-nextjs', service('Kinde')],
  ['better-auth', service('Better Auth')],
  ['lucia', service('Lucia')],
  // AI
  ['openai', service('OpenAI')],
  ['@anthropic-ai/sdk', service('Anthropic')],
  ['@google/generative-ai', service('Google Gemini')],
  ['@google/genai', service('Google Gemini')],
  ['ai', service('Vercel AI SDK')],
  ['replicate', service('Replicate')],
  ['groq-sdk', service('Groq')],
  ['@mistralai/mistralai', service('Mistral')],
  // Storage and media
  ['@aws-sdk/client-s3', service('Amazon S3')],
  ['@vercel/blob', service('Vercel Blob')],
  ['uploadthing', service('UploadThing')],
  ['cloudinary', service('Cloudinary')],
  // Monitoring and analytics
  ['@sentry/nextjs', service('Sentry')],
  ['posthog-js', service('PostHog')],
  ['posthog-node', service('PostHog')],
  ['@vercel/analytics', service('Vercel Analytics')],
  // Search, CMS and other APIs
  ['algoliasearch', service('Algolia')],
  ['@sanity/client', service('Sanity')],
  ['next-sanity', service('Sanity')],
  ['contentful', service('Contentful')],
  ['@octokit/rest', service('GitHub API')],
  ['octokit', service('GitHub API')],
  ['@slack/web-api', service('Slack')],
  ['discord.js', service('Discord')],
  ['inngest', service('Inngest')],
  ['@trigger.dev/sdk', service('Trigger.dev')],
  ['@upstash/qstash', service('Upstash QStash')],
  // Firebase is both a database and other services; it is shown as one service.
  ['firebase', service('Firebase')],
  ['firebase-admin', service('Firebase')],
  ['convex', service('Convex')],
  // Databases
  ['pg', database('postgres', 'Postgres')],
  ['postgres', database('postgres', 'Postgres')],
  ['@neondatabase/serverless', database('postgres', 'Postgres (Neon)')],
  ['@vercel/postgres', database('postgres', 'Postgres (Vercel)')],
  ['mysql2', database('mysql', 'MySQL')],
  ['@planetscale/database', database('mysql', 'MySQL (PlanetScale)')],
  ['better-sqlite3', database('sqlite', 'SQLite')],
  ['@libsql/client', database('sqlite', 'SQLite (Turso)')],
  ['mongodb', database('mongodb', 'MongoDB')],
  ['mongoose', database('mongodb', 'MongoDB')],
  ['redis', database('redis', 'Redis')],
  ['ioredis', database('redis', 'Redis')],
  ['@upstash/redis', database('redis', 'Redis (Upstash)')],
  ['@vercel/kv', database('redis', 'Redis (Vercel KV)')],
]);

/**
 * Ordinary libraries that don't talk to anything outside the app. They are
 * neither shown nor sent anywhere for classification.
 */
const ORDINARY = new Set([
  'react',
  'react-dom',
  'next',
  'zod',
  'yup',
  'valibot',
  'clsx',
  'classnames',
  'tailwind-merge',
  'class-variance-authority',
  'lucide-react',
  'react-icons',
  'date-fns',
  'dayjs',
  'luxon',
  'lodash',
  'lodash-es',
  'nanoid',
  'uuid',
  'bcrypt',
  'bcryptjs',
  'jose',
  'jsonwebtoken',
  'framer-motion',
  'motion',
  'sonner',
  'react-hook-form',
  '@hookform/resolvers',
  'swr',
  '@tanstack/react-query',
  '@tanstack/react-table',
  'zustand',
  'jotai',
  'immer',
  'next-themes',
  'cmdk',
  'recharts',
  'axios',
  'ky',
  'server-only',
  'client-only',
  'superjson',
  '@prisma/client',
  'prisma',
  'drizzle-orm',
  'drizzle-kit',
  '@supabase/supabase-js',
  '@supabase/ssr',
  '@supabase/auth-helpers-nextjs',
]);

const NODE_BUILT_INS = new Set(builtinModules);

export function isOrdinaryPackage(name: string): boolean {
  return (
    ORDINARY.has(name) ||
    NODE_BUILT_INS.has(name) ||
    name.startsWith('@radix-ui/') ||
    name.startsWith('@types/')
  );
}
