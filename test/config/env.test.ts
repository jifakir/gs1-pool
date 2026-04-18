import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ITEMS_XML_PREVIEW_CHARS,
  effectiveItemsXmlPreviewChars,
} from '../../src/config/env.js';

describe('effectiveItemsXmlPreviewChars', () => {
  it('uses explicit char cap when > 0', () => {
    expect(
      effectiveItemsXmlPreviewChars({
        LOG_DATALINK_ITEM_DETAILS: false,
        LOG_DATALINK_ITEMS_BODY_PREVIEW_CHARS: 4096,
      }),
    ).toBe(4096);
  });

  it('ignores detail flag when explicit cap is set', () => {
    expect(
      effectiveItemsXmlPreviewChars({
        LOG_DATALINK_ITEM_DETAILS: true,
        LOG_DATALINK_ITEMS_BODY_PREVIEW_CHARS: 500,
      }),
    ).toBe(500);
  });

  it('uses default preview size when detail flag is on and cap is 0', () => {
    expect(
      effectiveItemsXmlPreviewChars({
        LOG_DATALINK_ITEM_DETAILS: true,
        LOG_DATALINK_ITEMS_BODY_PREVIEW_CHARS: 0,
      }),
    ).toBe(DEFAULT_ITEMS_XML_PREVIEW_CHARS);
  });

  it('is off when both detail is off and cap is 0', () => {
    expect(
      effectiveItemsXmlPreviewChars({
        LOG_DATALINK_ITEM_DETAILS: false,
        LOG_DATALINK_ITEMS_BODY_PREVIEW_CHARS: 0,
      }),
    ).toBe(0);
  });
});
