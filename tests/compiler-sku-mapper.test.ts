import { describe, expect, it } from 'vitest';
import { mapCatalogSku } from '@/lib/autobidder/compiler/sku-mapper';
import { cabinet, catalogSku, takeoff, timestamp } from './support/compiler-fixtures';

describe('deterministic catalog SKU mapping', () => {
  it('maps exactly only within the active authoritative workbook', () => {
    const valid = catalogSku();
    const result = mapCatalogSku({
      mappingId: 'mapping-1',
      takeoffLine: takeoff(),
      cabinet: cabinet(),
      catalog: [
        catalogSku({ id: 'wrong-workbook', workbookId: 'workbook-other' }),
        catalogSku({ id: 'inactive', active: false }),
        valid,
      ],
      authoritativeWorkbookId: 'workbook-1',
    });

    expect(result.mapping).toMatchObject({ outcome: 'exact_match', catalogSkuId: valid.id, confidence: 1 });
    expect(result.catalogSku).toBe(valid);
  });

  it('refuses ambiguous exact matches instead of choosing the first row', () => {
    const result = mapCatalogSku({
      mappingId: 'mapping-1',
      takeoffLine: takeoff(),
      cabinet: cabinet(),
      catalog: [catalogSku(), catalogSku({ id: 'sku-row-2', sku: 'SKU-W30-SECOND' })],
      authoritativeWorkbookId: 'workbook-1',
    });

    expect(result.catalogSku).toBeUndefined();
    expect(result.mapping).toMatchObject({ outcome: 'unresolved', matchMethod: 'ambiguous_exact_match' });
  });

  it('uses only explicit approved normalization rules or substitutions', () => {
    const normalizedTarget = catalogSku({ id: 'normalized-target', sku: 'SKU-W30', cabinetCode: 'W30' });
    const normalized = mapCatalogSku({
      mappingId: 'mapping-normalized',
      takeoffLine: takeoff(),
      cabinet: cabinet({ interpretedCode: 'W-30' }),
      catalog: [normalizedTarget],
      authoritativeWorkbookId: 'workbook-1',
      normalizationRules: [{
        id: 'rule-1',
        sourceCode: 'W-30',
        targetCatalogSkuId: normalizedTarget.id,
        approvedBy: 'approver-1',
        approvedAt: timestamp,
        widthInches: 30,
      }],
    });
    expect(normalized.mapping).toMatchObject({
      outcome: 'normalized_match',
      catalogSkuId: normalizedTarget.id,
      normalizationRuleId: 'rule-1',
      approvedBy: 'approver-1',
    });

    const substituted = mapCatalogSku({
      mappingId: 'mapping-substitution',
      takeoffLine: takeoff(),
      cabinet: cabinet({ interpretedCode: 'W29-UNKNOWN' }),
      catalog: [normalizedTarget],
      authoritativeWorkbookId: 'workbook-1',
      substitutions: [{
        takeoffLineId: 'takeoff-1',
        targetCatalogSkuId: normalizedTarget.id,
        approvedBy: 'approver-2',
        approvedAt: timestamp,
        note: 'Customer-approved W30 substitution.',
      }],
    });
    expect(substituted.mapping).toMatchObject({ outcome: 'approved_substitution', approvedBy: 'approver-2' });
  });

  it('never fabricates or chooses a closest-looking SKU', () => {
    const result = mapCatalogSku({
      mappingId: 'mapping-1',
      takeoffLine: takeoff(),
      cabinet: cabinet({ interpretedCode: 'W29', widthInches: 29 }),
      catalog: [catalogSku()],
      authoritativeWorkbookId: 'workbook-1',
    });

    expect(result.catalogSku).toBeUndefined();
    expect(result.mapping).toMatchObject({ outcome: 'unresolved', matchMethod: 'no_permitted_match' });
    expect(result.mapping.catalogSkuId).toBeUndefined();
  });

  it('does not map an unresolved takeoff item', () => {
    const result = mapCatalogSku({
      mappingId: 'mapping-1',
      takeoffLine: takeoff({ status: 'unresolved' }),
      cabinet: cabinet(),
      catalog: [catalogSku()],
      authoritativeWorkbookId: 'workbook-1',
    });

    expect(result.mapping).toMatchObject({ outcome: 'unresolved', matchMethod: 'takeoff_not_approved' });
  });
});
