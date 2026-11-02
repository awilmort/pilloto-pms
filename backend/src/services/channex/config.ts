/**
 * Channex configuration — env vars of CHANNEX_ARCHITECTURE.md §5.3.
 *
 * Read lazily on every call (dotenv loads after module imports, and tests change
 * process.env). The app must boot without Channex configured: validation only warns.
 * Secrets (`CHANNEX_API_KEY`, `CHANNEX_WEBHOOK_SECRET`) are never logged or returned.
 */

export type ChannexEnvironment = 'staging' | 'production';

export const CHANNEX_DEFAULT_BASE_URLS: Record<ChannexEnvironment, string> = {
  staging: 'https://staging.channex.io',
  production: 'https://app.channex.io',
};

export interface ChannexConfig {
  environment: ChannexEnvironment;
  baseUrl: string;
  apiKey?: string;
  webhookSecret?: string;
  webhookUrl?: string;
  workersDisabled: boolean;
}

function readEnvironment(raw: string | undefined): ChannexEnvironment {
  return raw?.trim().toLowerCase() === 'production' ? 'production' : 'staging';
}

export function getChannexConfig(env: NodeJS.ProcessEnv = process.env): ChannexConfig {
  const environment = readEnvironment(env.CHANNEX_ENV);
  const baseUrl = (env.CHANNEX_BASE_URL?.trim() || CHANNEX_DEFAULT_BASE_URLS[environment]).replace(/\/+$/, '');
  return {
    environment,
    baseUrl,
    apiKey: env.CHANNEX_API_KEY?.trim() || undefined,
    webhookSecret: env.CHANNEX_WEBHOOK_SECRET?.trim() || undefined,
    webhookUrl: env.CHANNEX_WEBHOOK_URL?.trim() || undefined,
    workersDisabled: env.CHANNEX_WORKERS_DISABLED === 'true',
  };
}

/** True when Pilloto can call the Channex API at all. */
export function isChannexConfigured(config: ChannexConfig = getChannexConfig()): boolean {
  return Boolean(config.apiKey && config.baseUrl);
}

/** Problems with the Channex env vars, as human-readable warnings (never contains secrets). */
export function validateChannexConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  const warnings: string[] = [];
  const config = getChannexConfig(env);
  const rawEnv = env.CHANNEX_ENV?.trim().toLowerCase();

  if (rawEnv && rawEnv !== 'staging' && rawEnv !== 'production') {
    warnings.push(`CHANNEX_ENV="${env.CHANNEX_ENV}" is not 'staging' or 'production'; using 'staging'.`);
  }
  if (!config.apiKey) {
    warnings.push('CHANNEX_API_KEY is not set — the channel manager is unavailable.');
    return warnings;
  }
  if (!/^https:\/\//.test(config.baseUrl)) {
    warnings.push(`CHANNEX_BASE_URL (${config.baseUrl}) is not an https URL.`);
  }
  const otherEnv: ChannexEnvironment = config.environment === 'production' ? 'staging' : 'production';
  if (config.baseUrl === CHANNEX_DEFAULT_BASE_URLS[otherEnv]) {
    warnings.push(`CHANNEX_ENV is '${config.environment}' but CHANNEX_BASE_URL points at Channex ${otherEnv}.`);
  }
  if (!config.webhookSecret) {
    warnings.push('CHANNEX_WEBHOOK_SECRET is not set — signed Channex webhooks will be rejected; bookings arrive through the feed poller only.');
  }
  if (!config.webhookUrl) {
    warnings.push('CHANNEX_WEBHOOK_URL is not set — the global Channex webhook cannot be created.');
  }
  return warnings;
}

/** Startup check: logs warnings, never throws. */
export function logChannexConfigWarnings(): void {
  const config = getChannexConfig();
  const warnings = validateChannexConfig();
  if (isChannexConfigured(config)) {
    console.log(`🔌 Channex configured (${config.environment}, ${config.baseUrl})`);
  }
  for (const w of warnings) console.warn(`⚠️  Channex: ${w}`);
}

// ── Environment guard ────────────────────────────────────────────────────────

export class ChannexEnvironmentMismatchError extends Error {
  constructor(public readonly recordEnvironment: string | undefined, public readonly currentEnvironment: ChannexEnvironment) {
    super(`Channex record belongs to environment '${recordEnvironment ?? 'unknown'}' but CHANNEX_ENV is '${currentEnvironment}'.`);
    this.name = 'ChannexEnvironmentMismatchError';
  }
}

/**
 * Channex ids are environment-specific (architecture §5.3): refuse to use a stored
 * ChannexProperty/ChannexEntityMap stamped for another environment.
 */
export function assertCurrentEnvironment<T extends { environment?: string | null }>(
  doc: T,
  config: ChannexConfig = getChannexConfig(),
): T {
  if (doc.environment !== config.environment) {
    throw new ChannexEnvironmentMismatchError(doc.environment ?? undefined, config.environment);
  }
  return doc;
}
