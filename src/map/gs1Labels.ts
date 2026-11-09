/**
 * Dutch display labels for GS1 code lists used by the Mijneetschema app
 * (`allergie_info`, `kenmerken`). Unknown codes fall back to the raw code.
 */

/** GS1 AllergenTypeCode → Dutch name. */
export const ALLERGEN_NAMES_NL: Record<string, string> = {
  AC: 'Schaaldieren',
  AE: 'Ei',
  AF: 'Vis',
  AM: 'Melk',
  AN: 'Noten',
  AP: "Pinda's",
  AS: 'Sesamzaad',
  AU: 'Sulfiet',
  AW: 'Gluten',
  AY: 'Soja',
  BC: 'Selderij',
  BM: 'Mosterd',
  GB: 'Gerst',
  GK: 'Kamut',
  GO: 'Haver',
  GS: 'Spelt',
  ML: 'Lactose',
  NL: 'Lupine',
  NR: 'Rogge',
  SA: 'Amandelen',
  SC: 'Cashewnoten',
  SH: 'Hazelnoten',
  SM: 'Macadamianoten',
  SP: 'Pecannoten',
  SR: 'Paranoten',
  ST: 'Pistachenoten',
  SW: 'Walnoten',
  UM: 'Weekdieren',
  UW: 'Tarwe',
};

/** GS1 LevelOfContainmentCode → Dutch value. */
export const CONTAINMENT_NL: Record<string, string> = {
  CONTAINS: 'Bevat',
  MAY_CONTAIN: 'Kan bevatten',
  FREE_FROM: 'Bevat niet',
};

/** Strongest first, used when the same allergen appears more than once. */
export const CONTAINMENT_RANK: Record<string, number> = {
  CONTAINS: 3,
  MAY_CONTAIN: 2,
  FREE_FROM: 1,
};

export type Kenmerk = { icon: string; kmName: string };

const k = (icon: string, kmName: string): Kenmerk => ({ icon, kmName });

/** packagingMarkedLabelAccreditationCode → kenmerk. Packaging/recycling marks are left out on purpose. */
export const LABEL_KENMERKEN: Record<string, Kenmerk> = {
  EU_ORGANIC_FARMING: k('biologisch', 'Biologisch'),
  AGRICULTURE_BIOLOGIQUE: k('biologisch', 'Biologisch'),
  EKO: k('biologisch', 'Biologisch'),
  DEMETER_LABEL: k('biologisch', 'Biologisch'),
  EUROPEAN_V_LABEL_VEGAN: k('vegan', 'Vegan'),
  VEGAN_SOCIETY_VEGAN_LOGO: k('vegan', 'Vegan'),
  EUROPEAN_V_LABEL_VEGETARIAN: k('vegetarisch', 'Vegetarisch'),
  HALAL_CORRECT: k('halal', 'Halal'),
  HALAL_HFA: k('halal', 'Halal'),
  HALAL_FEEDING_AUTHORITY: k('halal', 'Halal'),
  OU_KOSHER: k('koosjer', 'Koosjer'),
  KOSHER_CERTIFICATION: k('koosjer', 'Koosjer'),
  CROSSED_GRAIN_SYMBOL: k('glutenvrij', 'Glutenvrij'),
  FAIR_TRADE_MARK: k('fairtrade', 'Fairtrade'),
  MARINE_STEWARDSHIP_COUNCIL_LABEL: k('msc', 'MSC duurzame vis'),
  AQUACULTURE_STEWARDSHIP_COUNCIL: k('asc', 'ASC verantwoorde kweek'),
  RAINFOREST_ALLIANCE_PEOPLE_NATURE: k('rainforest-alliance', 'Rainforest Alliance'),
  RAINFOREST_ALLIANCE: k('rainforest-alliance', 'Rainforest Alliance'),
  BETER_LEVEN_1_STER: k('beter-leven', 'Beter Leven 1 ster'),
  BETER_LEVEN_2_STER: k('beter-leven', 'Beter Leven 2 sterren'),
  BETER_LEVEN_3_STER: k('beter-leven', 'Beter Leven 3 sterren'),
  WEIDEMELK: k('weidemelk', 'Weidemelk'),
};

/** dietTypeCode → kenmerk. */
export const DIET_KENMERKEN: Record<string, Kenmerk> = {
  VEGAN: k('vegan', 'Vegan'),
  VEGETARIAN: k('vegetarisch', 'Vegetarisch'),
  HALAL: k('halal', 'Halal'),
  KOSHER: k('koosjer', 'Koosjer'),
  ORGANIC: k('biologisch', 'Biologisch'),
};

/** `claimTypeCode` or `claimTypeCode:claimElementCode` → kenmerk. */
export const CLAIM_KENMERKEN: Record<string, Kenmerk> = {
  VEGAN: k('vegan', 'Vegan'),
  VEGETARIAN: k('vegetarisch', 'Vegetarisch'),
  'FREE_FROM:GLUTEN': k('glutenvrij', 'Glutenvrij'),
  'NATURALLY_FREE_FROM:GLUTEN': k('glutenvrij', 'Glutenvrij'),
  'FREE_FROM:LACTOSE': k('lactosevrij', 'Lactosevrij'),
  'NATURALLY_FREE_FROM:LACTOSE': k('lactosevrij', 'Lactosevrij'),
  'FREE_FROM:MILK': k('zuivelvrij', 'Zuivelvrij'),
  'FREE_FROM:SUGAR': k('suikervrij', 'Suikervrij'),
  'FREE_FROM:SUGARS': k('suikervrij', 'Suikervrij'),
  'NO_ADDED:SUGAR': k('zonder-toegevoegde-suikers', 'Zonder toegevoegde suikers'),
  'NO_ADDED:SUGARS': k('zonder-toegevoegde-suikers', 'Zonder toegevoegde suikers'),
  'WITHOUT:SUGAR': k('zonder-toegevoegde-suikers', 'Zonder toegevoegde suikers'),
  'FREE_FROM:PALM_OIL': k('zonder-palmolie', 'Zonder palmolie'),
  'WITHOUT:PALM_OIL': k('zonder-palmolie', 'Zonder palmolie'),
  'FREE_FROM:PRESERVATIVES': k('zonder-conserveermiddelen', 'Zonder conserveermiddelen'),
  'WITHOUT:PRESERVATIVES': k('zonder-conserveermiddelen', 'Zonder conserveermiddelen'),
  'FREE_FROM:ARTIFICIAL_COLOUR': k('zonder-kleurstoffen', 'Zonder kunstmatige kleurstoffen'),
  'WITHOUT:ARTIFICIAL_COLOUR': k('zonder-kleurstoffen', 'Zonder kunstmatige kleurstoffen'),
  'FREE_FROM:COLOURING_AGENTS': k('zonder-kleurstoffen', 'Zonder kunstmatige kleurstoffen'),
  'WITHOUT:COLOURING_AGENTS': k('zonder-kleurstoffen', 'Zonder kunstmatige kleurstoffen'),
  'FREE_FROM:ARTIFICIAL_FLAVOUR': k('zonder-smaakstoffen', 'Zonder kunstmatige smaakstoffen'),
  'WITHOUT:ARTIFICIAL_FLAVOUR': k('zonder-smaakstoffen', 'Zonder kunstmatige smaakstoffen'),
  'FREE_FROM:FLAVOUR_ENHANCERS': k('zonder-smaakversterkers', 'Zonder smaakversterkers'),
  'WITHOUT:FLAVOUR_ENHANCERS': k('zonder-smaakversterkers', 'Zonder smaakversterkers'),
  'FREE_FROM:ALCOHOL': k('alcoholvrij', 'Alcoholvrij'),
  'WITHOUT:GMO': k('zonder-ggo', 'Zonder GGO'),
  'FREE_FROM:GMO': k('zonder-ggo', 'Zonder GGO'),
  'HIGH:PROTEIN': k('eiwitrijk', 'Rijk aan eiwitten'),
  'SOURCE_OF:PROTEIN': k('eiwitbron', 'Bron van eiwitten'),
  'HIGH:FIBRE': k('vezelrijk', 'Rijk aan vezels'),
  'HIGH:FIBER': k('vezelrijk', 'Rijk aan vezels'),
  'SOURCE_OF:FIBRE': k('vezelbron', 'Bron van vezels'),
  'SOURCE_OF:FIBER': k('vezelbron', 'Bron van vezels'),
  'LOW:FAT': k('vetarm', 'Vetarm'),
  'LOW:SUGAR': k('suikerarm', 'Suikerarm'),
  'LOW:SUGARS': k('suikerarm', 'Suikerarm'),
  'LOW:SALT': k('zoutarm', 'Zoutarm'),
  'LOW:CALORIE': k('caloriearm', 'Caloriearm'),
  'LOW:ENERGY': k('caloriearm', 'Caloriearm'),
};

/** GS1 measurement unit → app `unit`. */
export const UNIT_TO_APP: Record<string, string> = {
  GRM: 'g',
  KGM: 'kg',
  MLT: 'ml',
  LTR: 'l',
  CLT: 'cl',
};
