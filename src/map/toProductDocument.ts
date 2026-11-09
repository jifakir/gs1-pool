/**
 * Maps Datalink trade item JSON (XML-derived) into the Mijneetschema `Ingredient` shape
 * (see api/src/models/Ingredient.js).
 *
 * GS1 sends units and languages as XML attributes, which fast-xml-parser stores as
 * `{ "#text": "1.5", "@_measurementUnitCode": "GRM" }` and `{ "#text": "...", "@_languageCode": "nl" }`.
 * Every reader below handles that shape as well as plain child elements.
 *
 * Macros (`calories`, `protien`, `carbs`, `fat`, `fiber`) are per `quantity` + `unit`, which is the
 * nutrient basis (usually 100 g / 100 ml). The app computes `calories / quantity * amount`.
 */
import type { TradeItemDto } from '../parse/tradeItemXml.js';
import {
  collectNodesByLocalName,
  findFirstStringByLocalName,
  pickFirstValueByLocalName,
  scalarTextFromUnknown,
} from '../parse/jsonWalk.js';
import {
  ALLERGEN_NAMES_NL,
  CLAIM_KENMERKEN,
  CONTAINMENT_NL,
  CONTAINMENT_RANK,
  DIET_KENMERKEN,
  LABEL_KENMERKEN,
  UNIT_TO_APP,
  type Kenmerk,
} from './gs1Labels.js';

export type AppIngredientLine = { name: string; amount: string };
export type AppAllergen = { name: string; value: string };

export type MappedProductDocument = {
  name: string;
  provider: 'gs1';
  protien: number;
  carbs: number;
  fat: number;
  fiber: number;
  unit: string;
  quantity: number;
  calories: number;
  added_by: string;
  gs1_info: Record<string, unknown>;
  isDeleted: boolean;
  ingredients: AppIngredientLine[];
  kenmerken: Kenmerk[];
  allergie_info: AppAllergen[];
  __v: number;
};

const PREFERRED_LANGS = ['nl', 'en'];
const KJ_PER_KCAL = 4.184;

function asRecord(node: unknown): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
  return node as Record<string, unknown>;
}

function toList(node: unknown): unknown[] {
  if (node === undefined || node === null) return [];
  return Array.isArray(node) ? node : [node];
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Parses GS1 numeric text such as `"1.5"`, `"0,3"`, `"<0.5"`, `"100.000000"`. */
export function parseGs1Number(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const s = scalarTextFromUnknown(value);
  if (!s) return undefined;
  const cleaned = s.replace(/[<>~≈≤≥]/g, '').replace(/\s+/g, '').replace(',', '.');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/** Attribute (`@_name`) first, then a child element of the same name. */
function attrOrField(o: Record<string, unknown>, name: string): string | undefined {
  return scalarTextFromUnknown(o[`@_${name}`]) ?? scalarTextFromUnknown(o[name]);
}

type Qty = { value: number; unit?: string };

/** Reads a GS1 measurement (`{ "#text", "@_measurementUnitCode" }` or `{ value, measurementUnitCode }`). */
export function readQuantity(node: unknown): Qty | undefined {
  if (typeof node === 'string' || typeof node === 'number') {
    const value = parseGs1Number(node);
    return value === undefined ? undefined : { value };
  }
  const o = asRecord(node);
  if (!o) return undefined;
  const value = parseGs1Number(o['#text'] ?? o.value);
  if (value === undefined) return undefined;
  const unit = attrOrField(o, 'measurementUnitCode');
  return unit ? { value, unit } : { value };
}

/**
 * Text from a possibly multi-language GS1 field: a string, `{ "#text", "@_languageCode" }`,
 * or an array of those. Prefers Dutch, then English, then the first entry.
 */
export function pickLanguageText(node: unknown, langs: string[] = PREFERRED_LANGS): string | undefined {
  const entries = toList(node)
    .map((it) => {
      if (typeof it === 'string' || typeof it === 'number') {
        return { text: String(it).trim(), lang: undefined as string | undefined };
      }
      const o = asRecord(it);
      if (!o) return undefined;
      const text = scalarTextFromUnknown(o['#text']);
      return text ? { text: text.trim(), lang: attrOrField(o, 'languageCode')?.toLowerCase() } : undefined;
    })
    .filter((e): e is { text: string; lang: string | undefined } => Boolean(e && e.text));
  if (entries.length === 0) return undefined;
  for (const lang of langs) {
    const hit = entries.find((e) => e.lang === lang);
    if (hit) return hit.text;
  }
  return entries[0]!.text;
}

function textField(root: unknown, localName: string): string | undefined {
  return pickLanguageText(pickFirstValueByLocalName(root, localName));
}

// ---------------------------------------------------------------- nutrition

type NutrientOut = {
  nutrientTypeCode: string;
  measurementPrecisionCode?: string;
  /** Energy: `[kJ, kcal]` (the admin panel reads index 1 as kcal). Others: one measurement. */
  quantityContained:
    | { value: string; measurementUnitCode?: string }
    | { value: string; measurementUnitCode: string }[];
};

type NutritionResult = {
  basis?: Qty;
  preparationStateCode?: string;
  nutrients: NutrientOut[];
  macros: { calories: number; protien: number; carbs: number; fat: number; fiber: number };
};

/**
 * Picks one nutrient table. Products can list several (per 100 g and per portion, prepared and
 * unprepared); mixing them gives wrong numbers. Prefers unprepared, per 100, in g/ml.
 */
function pickNutrientHeader(tradeItemJson: unknown): unknown {
  const headers = collectNodesByLocalName(tradeItemJson, 'nutrientHeader').filter((h) => asRecord(h));
  if (headers.length === 0) return tradeItemJson;
  let best = headers[0];
  let bestScore = -1;
  for (const h of headers) {
    const prep = findFirstStringByLocalName(h, 'preparationStateCode');
    const basis = readQuantity(pickFirstValueByLocalName(h, 'nutrientBasisQuantity'));
    let score = 0;
    if (!prep || prep === 'UNPREPARED') score += 2;
    if (basis?.value === 100) score += 2;
    if (basis?.unit === 'GRM' || basis?.unit === 'MLT') score += 1;
    if (score > bestScore) {
      best = h;
      bestScore = score;
    }
  }
  return best;
}

const FIBRE_CODES = new Set(['FIBTG', 'FIB-', 'FIBTS', 'FIBINS']);

function extractNutrition(tradeItemJson: unknown): NutritionResult {
  const header = pickNutrientHeader(tradeItemJson);
  const basis = readQuantity(pickFirstValueByLocalName(header, 'nutrientBasisQuantity'));
  const preparationStateCode = findFirstStringByLocalName(header, 'preparationStateCode');

  const macros = { calories: 0, protien: 0, carbs: 0, fat: 0, fiber: 0 };
  const nutrients: NutrientOut[] = [];

  for (const node of collectNodesByLocalName(header, 'nutrientDetail')) {
    const o = asRecord(node);
    if (!o) continue;
    const code = scalarTextFromUnknown(pickFirstValueByLocalName(o, 'nutrientTypeCode'));
    if (!code) continue;
    const precision = scalarTextFromUnknown(pickFirstValueByLocalName(o, 'measurementPrecisionCode'));
    const qtys = toList(pickFirstValueByLocalName(o, 'quantityContained'))
      .map(readQuantity)
      .filter((q): q is Qty => Boolean(q));
    if (qtys.length === 0) continue;

    const base: Omit<NutrientOut, 'quantityContained'> = { nutrientTypeCode: code };
    if (precision) base.measurementPrecisionCode = precision;

    if (code === 'ENER-') {
      const kcalQ = qtys.find((q) => q.unit === 'E14')?.value;
      const kjQ = qtys.find((q) => q.unit === 'KJO')?.value;
      const kcal = kcalQ ?? (kjQ !== undefined ? kjQ / KJ_PER_KCAL : undefined);
      const kj = kjQ ?? (kcalQ !== undefined ? kcalQ * KJ_PER_KCAL : undefined);
      if (kcal === undefined || kj === undefined) continue;
      macros.calories = round(kcal);
      nutrients.push({
        ...base,
        quantityContained: [
          { value: String(round(kj, 1)), measurementUnitCode: 'KJO' },
          { value: String(round(kcal, 1)), measurementUnitCode: 'E14' },
        ],
      });
      continue;
    }

    const q = qtys.find((x) => x.unit === 'GRM') ?? qtys[0]!;
    nutrients.push({
      ...base,
      quantityContained: q.unit
        ? { value: String(q.value), measurementUnitCode: q.unit }
        : { value: String(q.value) },
    });

    if (q.unit !== 'GRM') continue;
    const grams = round(q.value);
    if (code === 'PRO-') macros.protien = grams;
    else if (code === 'CHOAVL' || (code === 'CHO-' && macros.carbs === 0)) macros.carbs = grams;
    else if (code === 'FAT') macros.fat = grams;
    else if (FIBRE_CODES.has(code) && macros.fiber === 0) macros.fiber = grams;
  }

  return { basis, preparationStateCode, nutrients, macros };
}

// ---------------------------------------------------------------- ingredients

/** Splits on `,`/`;` outside brackets, keeping decimal commas such as `12,5%`. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if ((ch === ')' || ch === ']' || ch === '}') && depth > 0) depth--;
    const decimalComma = ch === ',' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '');
    if (depth === 0 && (ch === ',' || ch === ';') && !decimalComma) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

/** Index of the first `". "` + letter outside brackets: the end of the ingredient list. */
function endOfFirstSentence(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
    else if (depth === 0 && ch === '.' && /\s/.test(text[i + 1] ?? '') && /\p{L}/u.test(text.slice(i + 1).trimStart()[0] ?? '')) {
      return i;
    }
  }
  return -1;
}

const INGREDIENT_PREFIX = /^\s*(ingredi[eë]nt(?:en)?|ingredients?|zutaten|ingr[ée]dients?)\s*:?\s*/iu;
/** Trace/allergen notes that follow the list, e.g. "Kan SELDERIJ bevatten", "- kan SOJA bevatten". */
const TRAILING_NOTES =
  /(?:^|[\s.;\-–])(kan\s+(?:sporen\s+)?[^.]*?bevatten|bevat\s+mogelijk|allergie[- ]?(?:info|informatie)?\s*:|allergenen\s*:|voor allergenen|geproduceerd in een|in een bedrijf|in een omgeving)/iu;
const PCT_IN_PARENS = /\(\s*(\d+(?:[.,]\d+)?)\s*%\s*\)/u;
const PCT_BARE = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*%(?=\s|$)/u;

/**
 * Turns a GS1 `ingredientStatement` into the app's `[{ name, amount }]`.
 * `amount` is the percentage when the label states one (e.g. `"45%"`), else `""`.
 */
export function parseIngredientStatement(statement: string | undefined): AppIngredientLine[] {
  if (!statement) return [];
  let text = statement.replace(/\s+/g, ' ').trim().replace(INGREDIENT_PREFIX, '');

  const notes = TRAILING_NOTES.exec(text);
  if (notes && notes.index > 0) text = text.slice(0, notes.index);
  const end = endOfFirstSentence(text);
  if (end > 0) text = text.slice(0, end);

  const out: AppIngredientLine[] = [];
  for (const rawPart of splitTopLevel(text)) {
    let part = rawPart.trim().replace(/[.\s]+$/u, '');
    if (!part) continue;

    let amount = '';
    const inParens = PCT_IN_PARENS.exec(part);
    if (inParens) {
      amount = `${inParens[1]}%`;
      part = part.replace(inParens[0], ' ');
    } else {
      const topLevel = part.replace(/\([^()]*\)|\[[^[\]]*\]/g, (m) => ' '.repeat(m.length));
      const bare = PCT_BARE.exec(topLevel);
      if (bare) {
        amount = `${bare[1]}%`;
        part = part.slice(0, bare.index) + ' ' + part.slice(bare.index + bare[0].length);
      }
    }

    const name = part
      .replace(/\(\s*\)/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s:\-–*]+|[\s:\-–*]+$/gu, '')
      .trim();
    if (name) out.push({ name, amount });
  }
  return out;
}

// ---------------------------------------------------------------- allergens & kenmerken

type AllergenCode = { allergenTypeCode: string; levelOfContainmentCode: string };

/** One entry per allergen code (strongest containment wins). */
function extractAllergenCodes(tradeItemJson: unknown): AllergenCode[] {
  const byCode = new Map<string, string>();
  // Real exports wrap each code in <allergen>; some feeds put the codes directly under
  // <allergenRelatedInformation>. Only take the latter when the code is a direct child.
  const flat = collectNodesByLocalName(tradeItemJson, 'allergenRelatedInformation').filter((n) => {
    const o = asRecord(n);
    return Boolean(o && Object.keys(o).some((key) => key.replace(/^.*:/, '') === 'allergenTypeCode'));
  });
  for (const node of [...collectNodesByLocalName(tradeItemJson, 'allergen'), ...flat]) {
    const o = asRecord(node);
    if (!o) continue;
    const code = scalarTextFromUnknown(pickFirstValueByLocalName(o, 'allergenTypeCode'));
    const level = scalarTextFromUnknown(pickFirstValueByLocalName(o, 'levelOfContainmentCode'));
    if (!code || !level) continue;
    const prev = byCode.get(code);
    if (!prev || (CONTAINMENT_RANK[level] ?? 0) > (CONTAINMENT_RANK[prev] ?? 0)) byCode.set(code, level);
  }
  return [...byCode].map(([allergenTypeCode, levelOfContainmentCode]) => ({
    allergenTypeCode,
    levelOfContainmentCode,
  }));
}

/** Rare codes without a Dutch name stay in `gs1_info.allergenInfo` but are not shown in the app. */
function toAppAllergens(codes: AllergenCode[]): AppAllergen[] {
  return codes
    .filter((c) => ALLERGEN_NAMES_NL[c.allergenTypeCode] && CONTAINMENT_NL[c.levelOfContainmentCode])
    .map((c) => ({
      name: ALLERGEN_NAMES_NL[c.allergenTypeCode]!,
      value: CONTAINMENT_NL[c.levelOfContainmentCode]!,
    }));
}

function codesByLocalName(root: unknown, localName: string): string[] {
  return collectNodesByLocalName(root, localName)
    .flatMap(toList)
    .map((v) => scalarTextFromUnknown(v))
    .filter((v): v is string => Boolean(v));
}

/** Diet, quality and "free from" marks for the app's `kenmerken` (deduplicated by icon). */
export function extractKenmerken(tradeItemJson: unknown): Kenmerk[] {
  const found: Kenmerk[] = [];
  const add = (km: Kenmerk | undefined): void => {
    if (km && !found.some((f) => f.icon === km.icon)) found.push(km);
  };

  for (const code of codesByLocalName(tradeItemJson, 'dietTypeCode')) add(DIET_KENMERKEN[code]);
  for (const code of codesByLocalName(tradeItemJson, 'packagingMarkedLabelAccreditationCode')) {
    add(LABEL_KENMERKEN[code]);
  }
  for (const node of collectNodesByLocalName(tradeItemJson, 'claimDetail')) {
    const o = asRecord(node);
    if (!o) continue;
    const type = scalarTextFromUnknown(pickFirstValueByLocalName(o, 'claimTypeCode'));
    if (!type) continue;
    const element = scalarTextFromUnknown(pickFirstValueByLocalName(o, 'claimElementCode'));
    add((element && CLAIM_KENMERKEN[`${type}:${element}`]) || CLAIM_KENMERKEN[type]);
  }
  return found;
}

// ---------------------------------------------------------------- misc fields

function findProductImage(tradeItemJson: unknown): string | undefined {
  for (const node of collectNodesByLocalName(tradeItemJson, 'referencedFileHeader')) {
    for (const h of toList(node)) {
      const o = asRecord(h);
      if (!o) continue;
      const type = scalarTextFromUnknown(pickFirstValueByLocalName(o, 'referencedFileTypeCode'));
      const uri = scalarTextFromUnknown(pickFirstValueByLocalName(o, 'uniformResourceIdentifier'));
      if (type === 'PRODUCT_IMAGE' && uri && /^https?:\/\//i.test(uri)) return uri;
    }
  }
  return findFirstHttpUrl(tradeItemJson);
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
    for (const [key, v] of Object.entries(node as Record<string, unknown>)) {
      // Skip XML namespace / schema attributes, which also hold http URLs.
      if (key.startsWith('@_')) continue;
      visit(v);
    }
  };
  visit(root);
  return best;
}

function extractNetContents(tradeItemJson: unknown): { value: string; measurementUnitCode: string }[] {
  return collectNodesByLocalName(tradeItemJson, 'netContent')
    .map(readQuantity)
    .filter((q): q is Required<Qty> => Boolean(q?.unit))
    .map((q) => ({ value: String(q.value), measurementUnitCode: q.unit }));
}

function pickName(tradeItemJson: unknown): string {
  return (
    textField(tradeItemJson, 'descriptionShort') ||
    textField(tradeItemJson, 'functionalName') ||
    textField(tradeItemJson, 'regulatedProductName') ||
    textField(tradeItemJson, 'tradeItemDescription') ||
    'Unknown'
  );
}

export function mapTradeItemDtoToProductDocument(
  dto: TradeItemDto,
  addedByObjectIdHex: string,
): MappedProductDocument {
  const tradeItemJson = dto.tradeItemJson;

  const ingredientStatement =
    textField(tradeItemJson, 'ingredientStatement') ?? textField(tradeItemJson, 'ingredientsDescription');
  const nutrition = extractNutrition(tradeItemJson);
  const allergenCodes = extractAllergenCodes(tradeItemJson);

  const gs1_info: Record<string, unknown> = {
    gln: dto.gln,
    gtin: dto.gtin,
    targetMarketCountryCode: dto.targetMarketCountryCode,
  };

  const lastChangeDateTime = findFirstStringByLocalName(tradeItemJson, 'lastChangeDateTime');
  if (lastChangeDateTime) gs1_info.lastChangeDateTime = lastChangeDateTime;

  const consumerInstructions = pickFirstValueByLocalName(tradeItemJson, 'consumerInstructions');
  if (consumerInstructions !== undefined) gs1_info.consumerInstructions = consumerInstructions;
  if (ingredientStatement) gs1_info.ingredientStatement = ingredientStatement;

  if (nutrition.nutrients.length || nutrition.basis) {
    const ingredientDetail: Record<string, unknown> = {};
    if (nutrition.preparationStateCode) ingredientDetail.preparationStateCode = nutrition.preparationStateCode;
    if (nutrition.basis) {
      ingredientDetail.nutrientBasisQuantity = {
        value: String(nutrition.basis.value),
        ...(nutrition.basis.unit ? { measurementUnitCode: nutrition.basis.unit } : {}),
      };
    }
    if (nutrition.nutrients.length) ingredientDetail.nutrientDetail = nutrition.nutrients;
    gs1_info.ingredientDetail = ingredientDetail;
  }

  const productImage = findProductImage(tradeItemJson);
  if (productImage) gs1_info.productImage = productImage;

  const descriptionShort = textField(tradeItemJson, 'descriptionShort');
  const functionalName = textField(tradeItemJson, 'functionalName');
  const variantDescription = textField(tradeItemJson, 'variantDescription');
  const brandName = textField(tradeItemJson, 'brandName');
  if (descriptionShort) gs1_info.descriptionShort = descriptionShort;
  if (functionalName) gs1_info.functionalName = functionalName;
  if (variantDescription) gs1_info.variantDescription = variantDescription;
  if (brandName) gs1_info.brandName = brandName;

  const netContent = extractNetContents(tradeItemJson);
  if (netContent.length) gs1_info.netContent = netContent;
  if (allergenCodes.length) gs1_info.allergenInfo = allergenCodes;

  const basisUnit = nutrition.basis?.unit;

  return {
    name: pickName(tradeItemJson),
    provider: 'gs1',
    ...nutrition.macros,
    unit: (basisUnit && UNIT_TO_APP[basisUnit]) || 'g',
    quantity: nutrition.basis?.value && nutrition.basis.value > 0 ? nutrition.basis.value : 100,
    added_by: addedByObjectIdHex,
    gs1_info,
    isDeleted: false,
    ingredients: parseIngredientStatement(ingredientStatement),
    kenmerken: extractKenmerken(tradeItemJson),
    allergie_info: toAppAllergens(allergenCodes),
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
