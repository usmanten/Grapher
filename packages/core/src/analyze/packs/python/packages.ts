import type { Node } from '@vscode/tree-sitter-wasm';

import type { GraphNode } from '../../../graph/types.js';
import type { IdentifiedPackages, KnownPackage } from '../../known-packages.js';
import type { Findings, PyFile, PyImport, PyProject } from './project.js';
import { PYTHON_STDLIB } from './stdlib.js';
import { all, inImport, lineOf } from './syntax.js';

const service = (label: string): KnownPackage => ({ kind: 'service', label });
const database = (engine: string, label: string): KnownPackage => ({
  kind: 'database',
  engine,
  label,
});

/**
 * Python packages Grapher recognizes, by the name they are imported with.
 * Dotted names match a part of a package, like `google.cloud.storage`.
 * SQLAlchemy and the Django ORM are not listed: they have their own detector.
 */
export const KNOWN_PYTHON_PACKAGES: ReadonlyMap<string, KnownPackage> = new Map([
  // Payments
  ['stripe', service('Stripe')],
  ['paypalrestsdk', service('PayPal')],
  // Email and messaging
  ['sendgrid', service('SendGrid')],
  ['resend', service('Resend')],
  ['postmarker', service('Postmark')],
  ['mailchimp_transactional', service('Mailchimp')],
  ['twilio', service('Twilio')],
  ['pusher', service('Pusher')],
  ['slack_sdk', service('Slack')],
  ['discord', service('Discord')],
  ['telegram', service('Telegram')],
  ['flask_mail', service('Email (SMTP)')],
  ['smtplib', service('Email (SMTP)')],
  // AI
  ['openai', service('OpenAI')],
  ['anthropic', service('Anthropic')],
  ['google.generativeai', service('Google Gemini')],
  ['google.genai', service('Google Gemini')],
  ['groq', service('Groq')],
  ['mistralai', service('Mistral')],
  ['cohere', service('Cohere')],
  ['replicate', service('Replicate')],
  ['langchain_openai', service('OpenAI')],
  ['langchain_anthropic', service('Anthropic')],
  // Cloud and storage
  ['boto3', service('AWS')],
  ['botocore', service('AWS')],
  ['google.cloud.storage', service('Google Cloud Storage')],
  ['azure.storage.blob', service('Azure Blob Storage')],
  ['cloudinary', service('Cloudinary')],
  ['firebase_admin', service('Firebase')],
  // Auth
  ['auth0', service('Auth0')],
  ['clerk_backend_api', service('Clerk')],
  // Monitoring
  ['sentry_sdk', service('Sentry')],
  ['posthog', service('PostHog')],
  // Background jobs
  ['celery', service('Celery')],
  // Other APIs
  ['github', service('GitHub API')],
  ['algoliasearch', service('Algolia')],
  ['shippo', service('Shippo')],
  // Databases
  ['sqlite3', database('sqlite', 'SQLite')],
  ['aiosqlite', database('sqlite', 'SQLite')],
  ['psycopg2', database('postgres', 'Postgres')],
  ['psycopg', database('postgres', 'Postgres')],
  ['asyncpg', database('postgres', 'Postgres')],
  ['pymysql', database('mysql', 'MySQL')],
  ['MySQLdb', database('mysql', 'MySQL')],
  ['mysql.connector', database('mysql', 'MySQL')],
  ['pymongo', database('mongodb', 'MongoDB')],
  ['motor', database('mongodb', 'MongoDB')],
  ['mongoengine', database('mongodb', 'MongoDB')],
  ['beanie', database('mongodb', 'MongoDB')],
  ['redis', database('redis', 'Redis')],
  ['elasticsearch', database('elasticsearch', 'Elasticsearch')],
  ['supabase', database('supabase', 'Supabase')],
  ['pinecone', database('pinecone', 'Pinecone')],
  ['chromadb', database('chroma', 'Chroma')],
]);

/**
 * Ordinary Python libraries that don't talk to anything outside the app.
 * They are neither shown nor sent anywhere for classification.
 */
const ORDINARY_PYTHON = new Set([
  'flask',
  'fastapi',
  'django',
  'starlette',
  'werkzeug',
  'jinja2',
  'markupsafe',
  'itsdangerous',
  'click',
  'typer',
  'uvicorn',
  'gunicorn',
  'pydantic',
  'pydantic_settings',
  'sqlalchemy',
  'sqlmodel',
  'flask_sqlalchemy',
  'flask_migrate',
  'alembic',
  'flask_login',
  'flask_wtf',
  'flask_cors',
  'wtforms',
  'rest_framework',
  'corsheaders',
  'environ',
  'decouple',
  'dotenv',
  'dj_database_url',
  'requests',
  'httpx',
  'aiohttp',
  'urllib3',
  'numpy',
  'pandas',
  'scipy',
  'matplotlib',
  'PIL',
  'yaml',
  'toml',
  'tomli',
  'dateutil',
  'pytz',
  'arrow',
  'attrs',
  'attr',
  'marshmallow',
  'jwt',
  'passlib',
  'bcrypt',
  'argon2',
  'cryptography',
  'jose',
  'rich',
  'tqdm',
  'loguru',
  'tenacity',
  'typing_extensions',
  'six',
  'pytest',
]);

export function isOrdinaryPythonPackage(top: string): boolean {
  return ORDINARY_PYTHON.has(top) || PYTHON_STDLIB.has(top);
}

/** The known package an import belongs to, matching the longest dotted name first. */
function knownPackage(module: string): { name: string; known: KnownPackage } | undefined {
  const parts = module.split('.');
  for (let end = parts.length; end >= 1; end--) {
    const name = parts.slice(0, end).join('.');
    const known = KNOWN_PYTHON_PACKAGES.get(name);
    if (known) return { name, known };
  }
  return undefined;
}

/** True if a top-level name is a folder or module in the project, so it's the project's own code. */
function localNames(project: PyProject): Set<string> {
  const names = new Set<string>();
  for (const path of project.files.keys()) {
    for (const part of path.split('/')) names.add(part.replace(/\.py$/, ''));
  }
  return names;
}

function nodeFor(
  module: string,
  identified: IdentifiedPackages,
  findings: Findings,
): GraphNode | undefined {
  const match = knownPackage(module);
  if (match?.known.kind === 'service') {
    return {
      id: `service:${match.name}`,
      kind: 'service',
      label: match.known.label,
      source: match.name,
    };
  }
  if (match?.known.kind === 'database') {
    return {
      id: `database:${match.known.engine}`,
      kind: 'database',
      label: match.known.label,
      via: match.name,
      inferred: true,
    };
  }
  const top = module.split('.')[0] ?? module;
  if (isOrdinaryPythonPackage(top)) return undefined;
  const ai = identified.get(top);
  if (ai?.kind === 'library') return undefined;
  if (ai?.kind === 'service') {
    return {
      id: `service:${top}`,
      kind: 'service',
      label: ai.label,
      source: top,
      identifiedBy: 'ai',
    };
  }
  if (ai?.kind === 'database') {
    return {
      id: `database:${top}`,
      kind: 'database',
      label: ai.label,
      via: top,
      inferred: true,
      identifiedBy: 'ai',
    };
  }
  findings.addUnknownPackage(top);
  return { id: `service:${top}`, kind: 'service', label: top, source: top, unidentified: true };
}

/** The first line that uses a name an import brought in, outside import statements. */
function firstUse(file: PyFile, imp: PyImport): Node | undefined {
  return all(file.root, 'identifier').find((id) => id.text === imp.local && !inImport(id));
}

/**
 * Turns imports of outside packages into service and database connections,
 * like `import stripe` or `from openai import OpenAI`. Packages Grapher
 * doesn't know are recorded by name only, for Claude to identify later.
 */
export function detectPackages(
  project: PyProject,
  findings: Findings,
  identified: IdentifiedPackages = new Map(),
): void {
  const local = localNames(project);
  for (const file of project.files.values()) {
    for (const imp of file.imports) {
      const top = imp.module.split('.')[0] ?? '';
      if (top === '' || local.has(top)) continue; // relative or the project's own code
      if (project.resolveModule(file.path, imp.module) !== undefined) continue;
      // `from google.cloud import storage` names the package google.cloud.storage.
      const full = imp.name === undefined ? imp.module : `${imp.module}.${imp.name}`;
      const node = nodeFor(full, identified, findings);
      if (!node) continue;
      findings.addNode(node);
      const kind = node.kind === 'database' ? 'connects' : 'uses-service';
      findings.connect({
        from: file.nodeId,
        to: node.id,
        kind,
        location: { path: file.path, line: imp.line, role: 'import' },
      });
      const use = firstUse(file, imp);
      if (use) {
        findings.connect({
          from: file.nodeId,
          to: node.id,
          kind,
          location: { path: file.path, line: lineOf(use), role: 'use' },
        });
      }
    }
  }
}
