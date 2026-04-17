export type SupplierRow = {
  gln: string;
  itemCount?: number;
};

export interface DatalinkApi {
  getSuppliers(params?: { updatedSince?: string }): Promise<{ status: number; bodyText: string }>;
  startItems(params: {
    gln: string;
    targetMarketCountryCode: string;
    updatedSince?: string;
  }): Promise<{ status: number; bodyText: string }>;
  getItemsByInvocationId(invocationId: string): Promise<{ status: number; bodyText: string }>;
  getItem(params: { gln: string; gtin: string; targetMarketCountryCode: string }): Promise<{
    status: number;
    bodyText: string;
  }>;
}
