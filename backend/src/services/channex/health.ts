/**
 * Channex connectivity check for the platform console (plan Phase 2.1).
 * Reports environment, base URL and success/failure — never the API key.
 */

import { getChannexConfig, isChannexConfigured, ChannexEnvironment } from './config';
import {
  createChannexClient, ChannexClientOptions, ChannexAuthError, ChannexRateLimitError,
  ChannexRetryableError, ChannexValidationError, classifyChannexError,
} from './channexClient';

export type ChannexHealthErrorKind = 'not_configured' | 'auth' | 'rate_limit' | 'unavailable' | 'validation' | 'unknown';

export interface ChannexHealth {
  environment: ChannexEnvironment;
  baseUrl: string;
  configured: boolean;
  ok: boolean;
  latencyMs?: number;
  checkedAt: string;
  error?: { kind: ChannexHealthErrorKind; message: string; status?: number };
}

export async function checkChannexHealth(options: ChannexClientOptions = {}): Promise<ChannexHealth> {
  const config = getChannexConfig();
  const base = { environment: config.environment, baseUrl: config.baseUrl, checkedAt: new Date().toISOString() };

  if (!isChannexConfigured(config)) {
    return {
      ...base, configured: false, ok: false,
      error: { kind: 'not_configured', message: 'CHANNEX_API_KEY is not set on this server.' },
    };
  }

  const started = Date.now();
  try {
    await createChannexClient(config, options).get('/properties', { 'pagination[limit]': 1 });
    return { ...base, configured: true, ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    const e = classifyChannexError(err, config.apiKey);
    const kind: ChannexHealthErrorKind =
      e instanceof ChannexAuthError ? 'auth'
        : e instanceof ChannexRateLimitError ? 'rate_limit'
          : e instanceof ChannexRetryableError ? 'unavailable'
            : e instanceof ChannexValidationError ? 'validation'
              : 'unknown';
    return {
      ...base, configured: true, ok: false, latencyMs: Date.now() - started,
      error: { kind, message: e.message, status: e.status },
    };
  }
}
