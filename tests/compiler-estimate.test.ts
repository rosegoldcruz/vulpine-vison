import { describe, expect, it } from 'vitest';
import { compileEstimate, compileEstimateLine } from '@/lib/autobidder/compiler/estimate';
import { cabinet, catalogSku, mapping, takeoff, unitMix } from './support/compiler-fixtures';

function validInput() {
  return {
    estimateLineId: 'estimate-1',
    bidJobId: 'job-1',
    takeoffLine: takeoff(),
    cabinet: cabinet(),
    mapping: mapping(),
    catalogSku: catalogSku(),
    unitMixEntry: unitMix(),
    currency: 'USD',
    calculationVersion: 'compiler-v1',
  };
}

describe('integer quantity and cost compiler', () => {
  it('calculates project quantity and extended material cost deterministically', () => {
    const line = compileEstimateLine(validInput());

    expect(line).toMatchObject({
      quantityPerUnit: 2,
      verifiedUnitCount: 10,
      projectQuantity: 20,
      unitCostCents: 9500,
      extendedCostCents: 190000,
      category: 'cabinet',
    });
    expect(line.evidenceIds).toEqual(['evidence-cabinet', 'evidence-unit']);
  });

  it('aggregates category and grand totals without model-generated arithmetic', () => {
    const first = validInput();
    const second = {
      ...validInput(),
      estimateLineId: 'estimate-2',
      takeoffLine: takeoff({ id: 'takeoff-2', cabinetInstanceId: 'cabinet-2', quantityPerUnit: 1 }),
      cabinet: cabinet({ id: 'cabinet-2', category: 'filler', quantityPerUnit: 1 }),
      mapping: mapping({ id: 'mapping-2', takeoffLineId: 'takeoff-2', catalogSkuId: 'sku-row-2' }),
      catalogSku: catalogSku({ id: 'sku-row-2', cabinetCode: 'F3', sku: 'SKU-F3', unitCostCents: 1000 }),
    };
    const result = compileEstimate([first, second]);

    expect(result.totalsByCategory).toEqual({ cabinet: 190000, filler: 10000 });
    expect(result.grandTotalCents).toBe(200000);
  });

  it('blocks unverified inputs, missing prices, and unsafe integer overflow', () => {
    expect(() => compileEstimateLine({ ...validInput(), unitMixEntry: unitMix({ status: 'unverified' }) })).toThrow(/verified unit count/i);
    expect(() => compileEstimateLine({ ...validInput(), catalogSku: catalogSku({ unitCostCents: undefined }) })).toThrow(/unit cost/i);
    expect(() => compileEstimateLine({
      ...validInput(),
      takeoffLine: takeoff({ quantityPerUnit: Number.MAX_SAFE_INTEGER }),
      cabinet: cabinet({ quantityPerUnit: Number.MAX_SAFE_INTEGER }),
    })).toThrow(/safe integer precision/i);
  });
});
