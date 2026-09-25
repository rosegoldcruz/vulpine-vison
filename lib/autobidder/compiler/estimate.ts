import 'server-only';

import type {
  CabinetCategory,
  CabinetInstance,
  CatalogSku,
  EntityId,
  EstimateCategory,
  EstimateLine,
  SkuMapping,
  TakeoffLine,
  UnitMixEntry,
} from '@/types/canonical';
import { CompilerInvariantError, requireNonNegativeSafeInteger, safeMultiply, uniqueStrings } from './invariants';

export interface CompileEstimateLineInput {
  estimateLineId: EntityId;
  bidJobId: EntityId;
  takeoffLine: TakeoffLine;
  cabinet: CabinetInstance;
  mapping: SkuMapping;
  catalogSku: CatalogSku;
  unitMixEntry: UnitMixEntry;
  currency: string;
  calculationVersion: string;
  description?: string;
}

export interface CompiledEstimate {
  lines: EstimateLine[];
  totalsByCategory: Partial<Record<EstimateCategory, number>>;
  grandTotalCents: number;
}

const categoryMap: Record<CabinetCategory, EstimateCategory> = {
  base: 'cabinet',
  sink_base: 'cabinet',
  drawer_base: 'cabinet',
  wall: 'cabinet',
  refrigerator_wall: 'cabinet',
  microwave_wall: 'cabinet',
  tall_pantry: 'cabinet',
  vanity: 'cabinet',
  ada: 'cabinet',
  filler: 'filler',
  finished_panel: 'panel',
  toe_kick: 'accessory',
  molding: 'accessory',
  accessory: 'accessory',
};

export function estimateCategoryForCabinet(category: CabinetCategory): EstimateCategory {
  return categoryMap[category];
}

export function compileEstimateLine(input: CompileEstimateLineInput): EstimateLine {
  const { takeoffLine, cabinet, mapping, catalogSku, unitMixEntry } = input;
  if (takeoffLine.status !== 'approved' || cabinet.status !== 'approved') {
    throw new CompilerInvariantError('TAKEOFF_NOT_APPROVED', 'Only approved cabinet takeoff lines can be compiled.');
  }
  if (takeoffLine.cabinetInstanceId !== cabinet.id || takeoffLine.unitTypeId !== cabinet.unitTypeId) {
    throw new CompilerInvariantError('TAKEOFF_LINK_MISMATCH', 'Takeoff line does not match the supplied cabinet instance.');
  }
  if (takeoffLine.quantityPerUnit !== cabinet.quantityPerUnit) {
    throw new CompilerInvariantError('QUANTITY_INCONSISTENCY', 'Takeoff and cabinet quantities per unit disagree.');
  }
  if (
    unitMixEntry.unitTypeId !== takeoffLine.unitTypeId ||
    unitMixEntry.status !== 'verified' ||
    unitMixEntry.verifiedCount === undefined ||
    !unitMixEntry.approvedBy ||
    !unitMixEntry.approvedAt
  ) {
    throw new CompilerInvariantError('UNIT_MIX_NOT_VERIFIED', 'A verified unit count is required for the takeoff unit type.');
  }
  if (
    mapping.takeoffLineId !== takeoffLine.id ||
    mapping.outcome === 'unresolved' ||
    mapping.catalogSkuId !== catalogSku.id
  ) {
    throw new CompilerInvariantError('SKU_MAPPING_INVALID', 'A resolved mapping to the supplied catalog SKU is required.');
  }
  if (!catalogSku.active) {
    throw new CompilerInvariantError('CATALOG_SKU_INACTIVE', 'Inactive catalog SKUs cannot be priced.');
  }
  if (catalogSku.unitCostCents === undefined) {
    throw new CompilerInvariantError('UNIT_COST_MISSING', 'The mapped catalog SKU does not have an approved unit cost.');
  }

  const quantityPerUnit = requireNonNegativeSafeInteger(takeoffLine.quantityPerUnit, 'quantityPerUnit');
  const verifiedUnitCount = requireNonNegativeSafeInteger(unitMixEntry.verifiedCount, 'verifiedUnitCount');
  const unitCostCents = requireNonNegativeSafeInteger(catalogSku.unitCostCents, 'unitCostCents');
  const projectQuantity = safeMultiply(quantityPerUnit, verifiedUnitCount, 'projectQuantity');
  const extendedCostCents = safeMultiply(projectQuantity, unitCostCents, 'extendedCostCents');

  return {
    id: input.estimateLineId,
    bidJobId: input.bidJobId,
    mappingId: mapping.id,
    unitMixEntryId: unitMixEntry.id,
    category: estimateCategoryForCabinet(cabinet.category),
    description: input.description ?? catalogSku.description ?? catalogSku.sku,
    quantityPerUnit,
    verifiedUnitCount,
    projectQuantity,
    unitCostCents,
    extendedCostCents,
    currency: input.currency,
    calculationVersion: input.calculationVersion,
    evidenceIds: uniqueStrings([
      ...cabinet.evidenceIds,
      ...takeoffLine.evidenceIds,
      ...unitMixEntry.evidenceIds,
    ]),
  };
}

export function compileEstimate(inputs: readonly CompileEstimateLineInput[]): CompiledEstimate {
  const lines = inputs.map(compileEstimateLine);
  const totalsByCategory: Partial<Record<EstimateCategory, number>> = {};
  let grandTotalCents = 0;

  for (const line of lines) {
    const categoryTotal = (totalsByCategory[line.category] ?? 0) + line.extendedCostCents;
    if (!Number.isSafeInteger(categoryTotal)) {
      throw new CompilerInvariantError('INTEGER_OVERFLOW', `Total for ${line.category} exceeds safe integer precision.`);
    }
    totalsByCategory[line.category] = categoryTotal;
    grandTotalCents += line.extendedCostCents;
    if (!Number.isSafeInteger(grandTotalCents)) {
      throw new CompilerInvariantError('INTEGER_OVERFLOW', 'Grand total exceeds safe integer precision.');
    }
  }

  return { lines, totalsByCategory, grandTotalCents };
}
