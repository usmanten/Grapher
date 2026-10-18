/**
 * Files Grapher must never open, because they usually hold secret values.
 *
 * Matching is by file name (case-insensitive) so it works no matter where the
 * file sits in the project. A denylisted file is skipped even if .gitignore
 * would include it, and the source reader refuses it a second time.
 */

/** Template env files hold placeholder values and are safe to read for setting names. */
const SAFE_ENV_TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template']);

const SECRET_FILE_PATTERNS: readonly RegExp[] = [
  /^\.env$/, // .env
  /^\.env\./, // .env.local, .env.production, ...
  /^\.dev\.vars$/, // Cloudflare Workers local secrets
  /^\.envrc$/, // direnv
  /^\.vault-token$/, // HashiCorp Vault
  /\.(pem|key|p8|p12|pfx|jks|keystore|ppk|asc|gpg)$/, // keys and certificate bundles
  /^id_(rsa|dsa|ecdsa|ed25519)(\.|$)/, // SSH keys
  /^\.(npmrc|pypirc|netrc|git-credentials|htpasswd|pgpass)$/, // tool credential files
  // credentials.json, secrets.yml, secret.txt. Source files like lib/secrets.ts are
  // allowed: they usually only reference env vars, and snippets get scrubbed anyway.
  /^(credentials|secrets?)(\.(?!(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$)[^.]+)*$/,
  /credentials.*\.json$/, // gcp-credentials.json
  /service[-_]?account.*\.json$/, // Google service accounts
  /adminsdk.*\.json$/, // Firebase admin keys
  /\.tfstate(\.backup)?$/, // Terraform state embeds secrets
  /\.tfvars$/,
];

/** Folders that only ever hold credentials. */
const SECRET_DIRECTORIES = new Set(['.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker']);

function baseName(posixPath: string): string {
  const name = posixPath.split('/').pop() ?? posixPath;
  // Windows ignores trailing dots and spaces, so ".env " can open ".env".
  return name.replace(/[. ]+$/, '').toLowerCase();
}

/** True if a file with this path must never be opened. */
export function isSecretFile(posixPath: string): boolean {
  const name = baseName(posixPath);
  if (SAFE_ENV_TEMPLATES.has(name)) return false;
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

/** True if a folder with this path must never be entered. */
export function isSecretDirectory(posixPath: string): boolean {
  return SECRET_DIRECTORIES.has(baseName(posixPath));
}
