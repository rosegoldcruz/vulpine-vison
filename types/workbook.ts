export interface WorkbookColumnMap {
  sku: string;
  cabinetCode: string;
  description?: string;
  finish?: string;
  constructionFamily?: string;
  unitCost?: string;
}

export interface WorkbookRecord {
  sku: string;
  cabinetCode: string;
  description?: string;
  finish?: string;
  constructionFamily?: string;
  unitCostCents?: number;
  sourceWorkbook: string;
  sourceSheet: string;
  sourceRow: number;
}
