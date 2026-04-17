/**
 * Maps Datalink trade item JSON (XML-derived) into the Mongo product shape used by your app.
 *
 * Macro fields (`calories`, `carbs`, `fat`, `fiber`, `protien`, `quantity`) are derived from
 * `ingredientDetail.nutrientDetail` when present; they reflect the basis described in the GS1
 * payload (see `gs1_info.ingredientDetail.nutrientBasisQuantity`).
 */
import type { TradeItemDto } from '../parse/tradeItemXml.js';
import {
  collectNodesByLocalName,
  findFirstStringByLocalName,
  pickFirstValueByLocalName,
} from '../parse/jsonWalk.js';

export type MappedProductDocument = {
  name: string;
  provider: 'gs1';
  protien: number;
  carbs: number;
  fat: number;
  fiber: number;
  quantity: number;
  calories: number;
  added_by: string;
  gs1_info: Record<string, unknown>;
  isDeleted: boolean;
  ingredients: unknown[];
  kenmerken: unknown[];
  allergie_info: unknown[];
  __v: number;
};

function asRecord(node: unknown): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
  return node as Record<string, unknown>;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function findFirstHttpUrl(root: unknown): string | undefined {
  let best: string | undefined;
  const visit = (node: unknown): void => {
    if (best) return;
    if (typeof node === 'string') {
      if (/^https?:\/\//i.test(node)) best = node;
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const it of node) visit(it);
      return;
    }
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const key = k.includes(':') ? k.slice(k.indexOf(':') + 1) : k;
      if (key.toLowerCase() === 'url' && typeof v === 'string' && /^https?:\/\//i.test(v)) {
        best = v;
        return;
      }
      visit(v);
    }
  };
  visit(root);
  return best;
}

function normalizeQuantityContained(
  raw: unknown,
): Record<string, unknown> | Record<string, unknown>[] | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return undefined;
}

function buildIngredientDetail(tradeItemJson: unknown): Record<string, unknown> | undefined {
  const preparationStateCode = findFirstStringByLocalName(tradeItemJson, 'preparationStateCode');

  const basisObj = asRecord(pickFirstValueByLocalName(tradeItemJson, 'nutrientBasisQuantity'));
  const basisValue =
    (basisObj ? findFirstStringByLocalName(basisObj, 'value') : undefined) ??
    findFirstStringByLocalName(tradeItemJson, 'nutrientBasisQuantity');
  const basisUnit =
    (basisObj ? findFirstStringByLocalName(basisObj, 'measurementUnitCode') : undefined) ??
    findFirstStringByLocalName(tradeItemJson, 'nutrientBasisQuantityMeasurementUnitCode') ??
    findFirstStringByLocalName(tradeItemJson, 'measurementUnitCode');

  const nutrientDetailNodes = collectNodesByLocalName(tradeItemJson, 'nutrientDetail');
  const nutrientDetail = nutrientDetailNodes
    .map((node) => {
      const obj = asRecord(node);
      if (!obj) return undefined;
      const nutrientTypeCode =
        findFirstStringByLocalName(obj, 'nutrientTypeCode') ??
        (typeof obj.nutrientTypeCode === 'string' ? obj.nutrientTypeCode : undefined);
      const measurementPrecisionCode = findFirstStringByLocalName(obj, 'measurementPrecisionCode');
      const quantityContainedRaw =
        pickFirstValueByLocalName(obj, 'quantityContained') ?? obj.quantityContained;
      const quantityContained = normalizeQuantityContained(quantityContainedRaw);
      if (!nutrientTypeCode) return undefined;
      const out: Record<string, unknown> = { nutrientTypeCode };
      if (measurementPrecisionCode) out.measurementPrecisionCode = measurementPrecisionCode;
      if (quantityContained) out.quantityContained = quantityContained;
      return out;
    })
    .filter((x): x is Record<string, unknown> => Boolean(x));

  if (!preparationStateCode && !basisValue && nutrientDetail.length === 0) return undefined;

  const ingredientDetail: Record<string, unknown> = {};
  if (preparationStateCode) ingredientDetail.preparationStateCode = preparationStateCode;
  if (basisValue || basisUnit) {
    ingredientDetail.nutrientBasisQuantity = {
      ...(basisValue ? { value: basisValue } : {}),
      ...(basisUnit ? { measurementUnitCode: basisUnit } : {}),
    };
  }
  if (nutrientDetail.length) ingredientDetail.nutrientDetail = nutrientDetail;
  return Object.keys(ingredientDetail).length ? ingredientDetail : undefined;
}

function extractMacros(tradeItemJson: unknown): {
  calories: number;
  protien: number;
  carbs: number;
  fat: number;
  fiber: number;
} {
  const nutrients = collectNodesByLocalName(tradeItemJson, 'nutrientDetail');
  let calories = 0;
  let protien = 0;
  let carbs = 0;
  let fat = 0;
  let fiber = 0;

  const readKcal = (node: unknown): number | undefined => {
    const qc = pickFirstValueByLocalName(node, 'quantityContained');
    const list = Array.isArray(qc) ? qc : qc ? [qc] : [];
    for (const item of list) {
      const o = asRecord(item);
      if (!o) continue;
      const unit = findFirstStringByLocalName(o, 'measurementUnitCode') ?? o.measurementUnitCode;
      const val = toFiniteNumber(o.value ?? o['#text']);
      if (unit === 'E14' && val !== undefined) return val; // kcal
    }
    return undefined;
  };

  const readGramMacro = (node: unknown): number | undefined => {
    const qc = pickFirstValueByLocalName(node, 'quantityContained');
    const list = Array.isArray(qc) ? qc : qc ? [qc] : [];
    for (const item of list) {
      const o = asRecord(item);
      if (!o) continue;
      const unit =
        findFirstStringByLocalName(o, 'measurementUnitCode') ?? o.measurementUnitCode;
      const val = toFiniteNumber(o.value ?? o['#text']);
      if (unit === 'GRM' && val !== undefined) return val;
    }

    const single = asRecord(qc);
    if (single && !Array.isArray(qc)) {
      const unit =
        findFirstStringByLocalName(single, 'measurementUnitCode') ?? single.measurementUnitCode;
      const val = toFiniteNumber(single.value ?? single['#text']);
      if (unit === 'GRM' && val !== undefined) return val;
    }
    return undefined;
  };

  for (const n of nutrients) {
    const code = findFirstStringByLocalName(n, 'nutrientTypeCode');
    if (!code) continue;
    if (code === 'ENER-') {
      calories = readKcal(n) ?? calories;
    } else if (code === 'PRO-') {
      protien = readGramMacro(n) ?? protien;
    } else if (code === 'CHOAVL') {
      carbs = readGramMacro(n) ?? carbs;
    } else if (code === 'FAT') {
      fat = readGramMacro(n) ?? fat;
    } else if (code === 'FIBTG' || code === 'FIBTS' || code === 'FIBINS' || code === 'FIB-') {
      fiber = readGramMacro(n) ?? fiber;
    }
  }

  return { calories, protien, carbs, fat, fiber };
}

function extractNetQuantity(tradeItemJson: unknown): number {
  const netContents = collectNodesByLocalName(tradeItemJson, 'netContent');
  const first = netContents[0];
  const obj = asRecord(first);
  if (!obj) return 0;
  const val = toFiniteNumber(obj.value ?? obj['#text'] ?? findFirstStringByLocalName(obj, 'value'));
  return val ?? 0;
}

function extractAllergenInfo(tradeItemJson: unknown): unknown[] {
  const candidates = collectNodesByLocalName(tradeItemJson, 'allergenRelatedInformation');
  const out: unknown[] = [];
  for (const c of candidates) {
    const o = asRecord(c);
    if (!o) continue;
    const allergenTypeCode = findFirstStringByLocalName(o, 'allergenTypeCode');
    const levelOfContainmentCode = findFirstStringByLocalName(o, 'levelOfContainmentCode');
    if (!allergenTypeCode || !levelOfContainmentCode) continue;
    out.push({ allergenTypeCode, levelOfContainmentCode });
  }
  return out;
}

function pickName(tradeItemJson: unknown): string {
  const regulatedName = findFirstStringByLocalName(tradeItemJson, 'regulatedProductName');
  const descriptionShort = findFirstStringByLocalName(tradeItemJson, 'descriptionShort');
  const functionalName = findFirstStringByLocalName(tradeItemJson, 'functionalName');
  const tradeDesc = findFirstStringByLocalName(tradeItemJson, 'tradeItemDescription');
  return (
    (regulatedName && regulatedName.trim()) ||
    (descriptionShort && descriptionShort.trim()) ||
    (functionalName && functionalName.trim()) ||
    (tradeDesc && tradeDesc.trim()) ||
    'Unknown'
  );
}

export function mapTradeItemDtoToProductDocument(
  dto: TradeItemDto,
  addedByObjectIdHex: string,
): MappedProductDocument {
  const tradeItemJson = dto.tradeItemJson;

  const ingredientStatement =
    findFirstStringByLocalName(tradeItemJson, 'ingredientStatement') ??
    findFirstStringByLocalName(tradeItemJson, 'ingredientsDescription') ??
    '';

  const ingredientDetail = buildIngredientDetail(tradeItemJson);
  const macros = extractMacros(tradeItemJson);

  const consumerInstructions = pickFirstValueByLocalName(tradeItemJson, 'consumerInstructions');

  const gs1_info: Record<string, unknown> = {
    gln: dto.gln,
    gtin: dto.gtin,
    targetMarketCountryCode: dto.targetMarketCountryCode,
  };

  const lastChangeDateTime = findFirstStringByLocalName(tradeItemJson, 'lastChangeDateTime');
  if (lastChangeDateTime) gs1_info.lastChangeDateTime = lastChangeDateTime;

  if (consumerInstructions !== undefined) gs1_info.consumerInstructions = consumerInstructions;
  if (ingredientStatement) gs1_info.ingredientStatement = ingredientStatement;
  if (ingredientDetail) gs1_info.ingredientDetail = ingredientDetail;

  const productImage = findFirstHttpUrl(tradeItemJson);
  if (productImage) gs1_info.productImage = productImage;

  const descriptionShort = findFirstStringByLocalName(tradeItemJson, 'descriptionShort');
  const functionalName = findFirstStringByLocalName(tradeItemJson, 'functionalName');
  const brandName = findFirstStringByLocalName(tradeItemJson, 'brandName');

  if (descriptionShort) gs1_info.descriptionShort = descriptionShort;
  if (functionalName) gs1_info.functionalName = functionalName;
  if (brandName) gs1_info.brandName = brandName;

  const netContents = collectNodesByLocalName(tradeItemJson, 'netContent');
  if (netContents.length) {
    gs1_info.netContent = netContents
      .map((n) => {
        const o = asRecord(n);
        if (!o) return undefined;
        const value = findFirstStringByLocalName(o, 'value') ?? (typeof o.value === 'string' ? o.value : undefined);
        const measurementUnitCode =
          findFirstStringByLocalName(o, 'measurementUnitCode') ??
          (typeof o.measurementUnitCode === 'string' ? o.measurementUnitCode : undefined);
        if (!value || !measurementUnitCode) return undefined;
        return { value, measurementUnitCode };
      })
      .filter((x): x is { value: string; measurementUnitCode: string } => Boolean(x));
  }

  const allergenInfo = extractAllergenInfo(tradeItemJson);
  if (allergenInfo.length) gs1_info.allergenInfo = allergenInfo;

  const name = pickName(tradeItemJson);
  const quantity = extractNetQuantity(tradeItemJson);

  return {
    name,
    provider: 'gs1',
    protien: macros.protien,
    carbs: macros.carbs,
    fat: macros.fat,
    fiber: macros.fiber,
    quantity,
    calories: macros.calories,
    added_by: addedByObjectIdHex,
    gs1_info,
    isDeleted: false,
    ingredients: [],
    kenmerken: [],
    allergie_info: [],
    __v: 0,
  };
}

export function maxLastChangeIso(docs: MappedProductDocument[]): string | undefined {
  let best: string | undefined;
  for (const d of docs) {
    const v = d.gs1_info.lastChangeDateTime;
    if (typeof v === 'string' && v.trim()) {
      if (!best || Date.parse(v) > Date.parse(best)) best = v;
    }
  }
  return best;
}
