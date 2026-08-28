import type { Page, TestInfo } from '@playwright/test';
import { env } from './env';

type NetworkEntry = {
  timestamp: string;
  method: string;
  url: string;
  status?: number;
  requestBody?: unknown;
  responseBody?: unknown;
};

const secretKeys = /authorization|cookie|token|password|secret/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        secretKeys.test(key) ? '[REDACTED]' : sanitize(item),
      ]),
    );
  }

  return value;
}

function parseBody(body: string | null): unknown {
  if (!body) return undefined;
  try {
    return sanitize(JSON.parse(body));
  } catch {
    const redacted = body.replace(
      /(authorization|cookie|token|password|secret)=([^&\s]+)/gi,
      '$1=[REDACTED]',
    );
    return redacted.length > 2_000 ? redacted.slice(0, 2_000) + '…' : redacted;
  }
}

function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (secretKeys.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function startNetworkRecorder(page: Page, testInfo: TestInfo): () => Promise<void> {
  const filter = new RegExp(env.networkUrlFilter, 'i');
  const entries = new Map<string, NetworkEntry>();

  page.on('request', (request) => {
    if (!filter.test(request.url())) return;

    const safeUrl = sanitizeUrl(request.url());
    const key = [request.method(), safeUrl, request.timing().startTime].join(' ');
    entries.set(key, {
      timestamp: new Date().toISOString(),
      method: request.method(),
      url: safeUrl,
      requestBody: parseBody(request.postData()),
    });
  });

  page.on('response', async (response) => {
    const request = response.request();
    if (!filter.test(request.url())) return;
    const safeUrl = sanitizeUrl(request.url());

    const existing = [...entries.entries()]
      .reverse()
      .find(([, entry]) => entry.method === request.method() && entry.url === safeUrl);
    const key = existing?.[0] ?? [request.method(), safeUrl, 'response'].join(' ');
    const entry =
      existing?.[1] ??
      ({
        timestamp: new Date().toISOString(),
        method: request.method(),
        url: safeUrl,
      } satisfies NetworkEntry);

    entry.status = response.status();

    const contentType = response.headers()['content-type'] ?? '';
    if (contentType.includes('application/json')) {
      try {
        entry.responseBody = sanitize(await response.json());
      } catch {
        entry.responseBody = '[JSON BODY UNAVAILABLE]';
      }
    }
    entries.set(key, entry);
  });

  return async () => {
    const body = Buffer.from(JSON.stringify([...entries.values()], null, 2), 'utf-8');
    await testInfo.attach('network.json', {
      body,
      contentType: 'application/json',
    });
  };
}
