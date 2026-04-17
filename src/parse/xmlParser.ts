import { XMLParser } from 'fast-xml-parser';

export function createXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    trimValues: true,
    // Important: keep codes like `E14` as strings (otherwise they may be mis-parsed as numbers).
    parseTagValue: false,
    isArray: (tagName) => {
      const name = tagName.includes(':') ? tagName.slice(tagName.indexOf(':') + 1) : tagName;
      return (
        name === 'row' ||
        name === 'tradeItem' ||
        name === 'nutrientDetail' ||
        name === 'netContent' ||
        name === 'allergenRelatedInformation' ||
        name === 'allergen'
      );
    },
  });
}
