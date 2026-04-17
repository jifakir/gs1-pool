import pino from 'pino';
import type { AppLogger } from '../types/logger.js';

function wrap(base: pino.Logger): AppLogger {
  return {
    child(bindings) {
      return wrap(base.child(bindings));
    },
    debug(fields, msg) {
      base.debug(fields, msg);
    },
    info(fields, msg) {
      base.info(fields, msg);
    },
    warn(fields, msg) {
      base.warn(fields, msg);
    },
    error(fields, msg) {
      base.error(fields, msg);
    },
  };
}

export function createLogger(options: {
  level: string;
  correlationId: string;
}): AppLogger {
  const base = pino({
    level: options.level,
    base: { correlationId: options.correlationId },
    redact: {
      paths: [
        'subscriptionKey',
        'DATALINK_SUBSCRIPTION_KEY',
        'req.headers.ocp-apim-subscription-key',
        'headers.ocp-apim-subscription-key',
        'MONGODB_URI',
        'mongoUri',
      ],
      remove: true,
    },
  });
  return wrap(base);
}
