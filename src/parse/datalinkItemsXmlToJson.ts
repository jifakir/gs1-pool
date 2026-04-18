import { createAuditXmlParser } from './xmlParser.js';

/**
 * Parse items XML for **xmltojson audit storage only**: verbatim text, namespaced keys, default
 * array rules (no custom `isArray`). Persist the returned object as-is — full API response body.
 */
export function parseDatalinkItemsXmlToJson(xml: string): unknown {
  return createAuditXmlParser().parse(xml);
}
