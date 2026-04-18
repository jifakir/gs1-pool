import { createXmlParser } from './xmlParser.js';

/** Same parser options as trade-item extraction — exact XML → JS tree fast-xml-parser output. */
export function parseDatalinkItemsXmlToJson(xml: string): unknown {
  return createXmlParser().parse(xml);
}
