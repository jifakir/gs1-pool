export type FailureReason = 'http' | 'parse' | 'map' | 'mongo';

export class SyncMetrics {
  itemsFetched = 0;
  itemsMapped = 0;
  itemsUpserted = 0;
  /** Rows written to the xml-to-json staging collection. */
  itemsXmlToJsonSaved = 0;
  /** Fallback files written under `XMLTOJSON_LOCAL_DIR`. */
  itemsXmlToJsonLocalJson = 0;
  itemsXmlToJsonLocalXml = 0;
  itemsXmlToJsonDuplicatesSkipped = 0;
  itemsFailed = 0;
  readonly failuresByReason: Record<FailureReason, number> = {
    http: 0,
    parse: 0,
    map: 0,
    mongo: 0,
  };

  snapshot(): Record<string, number> {
    return {
      itemsFetched: this.itemsFetched,
      itemsMapped: this.itemsMapped,
      itemsUpserted: this.itemsUpserted,
      itemsXmlToJsonSaved: this.itemsXmlToJsonSaved,
      itemsXmlToJsonLocalJson: this.itemsXmlToJsonLocalJson,
      itemsXmlToJsonLocalXml: this.itemsXmlToJsonLocalXml,
      itemsXmlToJsonDuplicatesSkipped: this.itemsXmlToJsonDuplicatesSkipped,
      itemsFailed: this.itemsFailed,
      failures_http: this.failuresByReason.http,
      failures_parse: this.failuresByReason.parse,
      failures_map: this.failuresByReason.map,
      failures_mongo: this.failuresByReason.mongo,
    };
  }

  recordFailure(reason: FailureReason): void {
    this.itemsFailed += 1;
    this.failuresByReason[reason] += 1;
  }
}
