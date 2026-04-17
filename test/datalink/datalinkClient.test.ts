import { describe, expect, it, vi } from 'vitest';
import { DatalinkClient } from '../../src/datalink/datalinkClient.js';
import { createLogger } from '../../src/observability/createLogger.js';

describe('DatalinkClient', () => {
  it('sends subscription key header', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('<xml/>', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const logger = createLogger({ level: 'silent', correlationId: 'test' });
    const client = new DatalinkClient(
      {
        DATALINK_BASE_URL: 'https://example.test/datalink',
        DATALINK_SUBSCRIPTION_KEY: 'secret',
        HTTP_TIMEOUT_MS: 5000,
        USER_AGENT: 'gs1-pool/test',
      },
      logger,
    );

    await client.getSuppliers();

    expect(fetchMock).toHaveBeenCalled();
    const firstCall = fetchMock.mock.calls[0] as [string, RequestInit] | undefined;
    expect(firstCall).toBeDefined();
    const init = firstCall![1];
    const headers = new Headers(init.headers);
    expect(headers.get('Ocp-Apim-Subscription-Key')).toBe('secret');
    expect(headers.get('User-Agent')).toBe('gs1-pool/test');

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
