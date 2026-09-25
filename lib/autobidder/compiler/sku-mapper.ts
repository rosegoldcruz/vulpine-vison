import 'server-only';

import type {
  CabinetInstance,
  CatalogSku,
  EntityId,
  IsoTimestamp,
  SkuMapping,
  TakeoffLine,
} from '@/types/canonical';

export interface ApprovedNormalizationRule {
  id: EntityId;
  sourceCode: string;
  targetCatalogSkuId: EntityId;
  approvedBy: EntityId;
  approvedAt: IsoTimestamp;
  widthInches?: number;
  heightInches?: number;
  depthInches?: number;
  cabinetCategory?: CabinetInstance['category'];
}

export interface ApprovedSubstitution {
  takeoffLineId: EntityId;
  targetCatalogSkuId: EntityId;
  approvedBy: EntityId;
  approvedAt: IsoTimestamp;
  note: string;
}

export interface MapSkuInput {
  mappingId: EntityId;
  takeoffLine: TakeoffLine;
  cabinet: CabinetInstance;
  catalog: readonly CatalogSku[];
  authoritativeWorkbookId: EntityId;
  normalizationRules?: readonly ApprovedNormalizationRule[];
  substitutions?: readonly ApprovedSubstitution[];
}

export interface MapSkuResult {
  mapping: SkuMapping;
  catalogSku?: CatalogSku;
}

function unresolved(input: MapSkuInput, method: string, note: string): MapSkuResult {
  return {
    mapping: {
      id: input.mappingId,
      takeoffLineId: input.takeoffLine.id,
      outcome: 'unresolved',
      matchMethod: method,
      resolutionNote: note,
    },
  };
}

function dimensionsMatch(cabinet: CabinetInstance, sku: CatalogSku): boolean {
  const dimensions: Array<[number | undefined, number | undefined]> = [
    [cabinet.widthInches, sku.widthInches],
    [cabinet.heightInches, sku.heightInches],
    [cabinet.depthInches, sku.depthInches],
  ];
  return dimensions.every(([required, actual]) => required === undefined || actual === required);
}

function ruleMatches(rule: ApprovedNormalizationRule, cabinet: CabinetInstance): boolean {
  return (
    cabinet.interpretedCode === rule.sourceCode &&
    (rule.widthInches === undefined || cabinet.widthInches === rule.widthInches) &&
    (rule.heightInches === undefined || cabinet.heightInches === rule.heightInches) &&
    (rule.depthInches === undefined || cabinet.depthInches === rule.depthInches) &&
    (rule.cabinetCategory === undefined || cabinet.category === rule.cabinetCategory)
  );
}

export function mapCatalogSku(input: MapSkuInput): MapSkuResult {
  if (input.takeoffLine.cabinetInstanceId !== input.cabinet.id) {
    return unresolved(input, 'invalid_input', 'Takeoff line does not reference the supplied cabinet instance.');
  }
  if (input.takeoffLine.unitTypeId !== input.cabinet.unitTypeId) {
    return unresolved(input, 'invalid_input', 'Takeoff line and cabinet instance reference different unit types.');
  }
  if (input.takeoffLine.status !== 'approved' || input.cabinet.status !== 'approved') {
    return unresolved(input, 'takeoff_not_approved', 'Only approved takeoff items are eligible for SKU mapping.');
  }
  if (!input.cabinet.interpretedCode?.trim()) {
    return unresolved(input, 'no_supported_code', 'No interpreted cabinet code is available for deterministic matching.');
  }

  const validCatalog = input.catalog.filter(
    (sku) => sku.active && sku.workbookId === input.authoritativeWorkbookId,
  );
  const exactMatches = validCatalog.filter(
    (sku) =>
      (sku.cabinetCode === input.cabinet.interpretedCode || sku.sku === input.cabinet.interpretedCode) &&
      dimensionsMatch(input.cabinet, sku),
  );

  if (exactMatches.length === 1) {
    const sku = exactMatches[0];
    return {
      mapping: {
        id: input.mappingId,
        takeoffLineId: input.takeoffLine.id,
        catalogSkuId: sku.id,
        outcome: 'exact_match',
        matchMethod: 'authoritative_code_and_dimensions',
        confidence: 1,
      },
      catalogSku: sku,
    };
  }
  if (exactMatches.length > 1) {
    return unresolved(input, 'ambiguous_exact_match', 'More than one authoritative catalog row satisfies the exact match.');
  }

  const matchingRules = (input.normalizationRules ?? []).filter((rule) => ruleMatches(rule, input.cabinet));
  if (matchingRules.length > 1) {
    return unresolved(input, 'ambiguous_normalization', 'More than one approved normalization rule applies.');
  }
  if (matchingRules.length === 1) {
    const rule = matchingRules[0];
    if (!rule.approvedBy || !rule.approvedAt) {
      return unresolved(input, 'normalization_not_approved', 'Normalization rule is missing approval provenance.');
    }
    const sku = validCatalog.find((candidate) => candidate.id === rule.targetCatalogSkuId);
    if (!sku) {
      return unresolved(input, 'invalid_normalization_target', 'Approved normalization target is not active in the authoritative workbook.');
    }
    return {
      mapping: {
        id: input.mappingId,
        takeoffLineId: input.takeoffLine.id,
        catalogSkuId: sku.id,
        outcome: 'normalized_match',
        matchMethod: 'approved_normalization_rule',
        confidence: 1,
        normalizationRuleId: rule.id,
        approvedBy: rule.approvedBy,
        approvedAt: rule.approvedAt,
      },
      catalogSku: sku,
    };
  }

  const substitutions = (input.substitutions ?? []).filter(
    (substitution) => substitution.takeoffLineId === input.takeoffLine.id,
  );
  if (substitutions.length > 1) {
    return unresolved(input, 'ambiguous_substitution', 'More than one approved substitution exists for the takeoff line.');
  }
  if (substitutions.length === 1) {
    const substitution = substitutions[0];
    if (!substitution.approvedBy || !substitution.approvedAt || !substitution.note.trim()) {
      return unresolved(input, 'substitution_not_approved', 'Substitution is missing approval provenance or rationale.');
    }
    const sku = validCatalog.find((candidate) => candidate.id === substitution.targetCatalogSkuId);
    if (!sku) {
      return unresolved(input, 'invalid_substitution_target', 'Approved substitution target is not active in the authoritative workbook.');
    }
    return {
      mapping: {
        id: input.mappingId,
        takeoffLineId: input.takeoffLine.id,
        catalogSkuId: sku.id,
        outcome: 'approved_substitution',
        matchMethod: 'explicit_approved_substitution',
        confidence: 1,
        approvedBy: substitution.approvedBy,
        approvedAt: substitution.approvedAt,
        resolutionNote: substitution.note,
      },
      catalogSku: sku,
    };
  }

  return unresolved(input, 'no_permitted_match', 'No exact match, approved normalization, or approved substitution exists.');
}
