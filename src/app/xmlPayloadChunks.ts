import { collectNodesByLocalName } from '../parse/jsonWalk.js';

/**
 * Split parsed items export JSON into chunks to persist: one subtree per `<row>` or `<tradeItem>` when
 * present; otherwise store the entire parsed tree once so nothing is dropped.
 */
export function chunksForXmlToJsonStorage(parsed: unknown): unknown[] {
  const rows = collectNodesByLocalName(parsed, 'row');
  if (rows.length > 0) return rows;
  const tradeItems = collectNodesByLocalName(parsed, 'tradeItem');
  if (tradeItems.length > 0) return tradeItems;
  return [parsed];
}
