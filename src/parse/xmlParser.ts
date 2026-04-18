import { XMLParser } from 'fast-xml-parser';

/** Local tag name after any namespace prefix (`foo:bar` → `bar`). */
export function stripXmlPrefix(tagName: string): string {
  const idx = tagName.indexOf(':');
  return idx === -1 ? tagName : tagName.slice(idx + 1);
}

/** Elements that appear repeated in Datalink/GDSN exports and must become JSON arrays. */
export function datalinkItemsIsArrayTag(tagName: string): boolean {
  const name = stripXmlPrefix(tagName);
  return (
    name === 'row' ||
    name === 'tradeItem' ||
    name === 'nutrientDetail' ||
    name === 'netContent' ||
    name === 'allergenRelatedInformation' ||
    name === 'allergen'
  );
}

/**
 * Parser for extraction / mapping (trade items, suppliers). Namespace prefixes stripped from tag
 * names for simpler `collectNodesByLocalName` lookups; values trimmed.
 */
export function createXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    trimValues: true,
    parseTagValue: false,
    isArray: (tagName) => datalinkItemsIsArrayTag(tagName),
  });
}

/**
 * Parser for **audit / xmltojson only**: preserves element text verbatim (`trimValues: false`) and
 * keeps namespace prefixes on tag keys (`removeNSPrefix: false`) so stored JSON matches source XML
 * naming and whitespace for review.
 */
export function createAuditXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: false,
    trimValues: false,
    parseTagValue: false,
    /** No custom `isArray`: use the library default so we do not coerce single elements into `[x]`. */
  });
}
