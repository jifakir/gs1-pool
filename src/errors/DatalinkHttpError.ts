export class DatalinkHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DatalinkHttpError';
  }
}

export class DatalinkAuthError extends DatalinkHttpError {
  constructor(url: string, options?: { cause?: unknown }) {
    super('Unauthorized (401)', 401, url, options);
    this.name = 'DatalinkAuthError';
  }
}

export class DatalinkNotFoundError extends DatalinkHttpError {
  constructor(url: string, options?: { cause?: unknown }) {
    super('Not found (404)', 404, url, options);
    this.name = 'DatalinkNotFoundError';
  }
}

/**
 * APIM returns 403 when the subscription key or caller context is not allowed.
 * GS1 NL Datalink also typically requires IP allowlisting in addition to the API key.
 */
export class DatalinkForbiddenError extends DatalinkHttpError {
  readonly bodyPreview: string;

  constructor(url: string, bodyText: string, options?: { cause?: unknown }) {
    const preview = bodyText.trim().slice(0, 500);
    super(
      [
        'Forbidden (403). Common causes:',
        '(1) Subscription key is for a different environment or API product than ',
        'the base URL (ACC developer portal key vs ACC endpoint);',
        '(2) Your subscription does not include the Datalink API;',
        '(3) Your outbound IP is not on GS1’s allowlist (spec requires API key + IP whitelist).',
        preview ? `Server response preview: ${preview}` : 'Server returned an empty body.',
      ].join(' '),
      403,
      url,
      options,
    );
    this.name = 'DatalinkForbiddenError';
    this.bodyPreview = preview;
  }
}
