import { describe, expect, it } from 'vitest';
import { reconcileUnitMix, validateUnitMix, verifiedUnitCounts } from '@/lib/autobidder/compiler/unit-mix';
import { unitMix, unitType } from './support/compiler-fixtures';

describe('unit mix compiler helpers', () => {
  it('validates and reconciles a fully evidenced, approved unit matrix', () => {
    const entries = [unitMix(), unitMix({ id: 'mix-b', unitTypeId: 'unit-b', extractedCount: 4, verifiedCount: 4 })];
    const unitTypes = [unitType(), unitType({ id: 'unit-b', code: 'B1', name: 'Unit B1' })];

    expect(validateUnitMix(entries, unitTypes)).toEqual({ valid: true, issues: [] });
    expect(reconcileUnitMix(entries, { unitTypes, expectedTotal: 14 })).toMatchObject({
      extractedTotal: 14,
      verifiedTotal: 14,
      expectedTotalMatched: true,
      entriesVerified: 2,
      canCompile: true,
    });
    expect(verifiedUnitCounts(entries).get('unit-b')).toBe(4);
  });

  it('requires explicit resolution when verification changes an extracted count', () => {
    const unresolved = unitMix({ extractedCount: 9, verifiedCount: 10 });
    const result = validateUnitMix([unresolved], [unitType()]);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('DISCREPANCY_UNRESOLVED');
    expect(() => verifiedUnitCounts([unresolved])).toThrow(/not eligible/i);

    expect(
      validateUnitMix([{ ...unresolved, discrepancy: 'Schedule says 9; floor reconciliation says 10', resolutionNote: 'Estimator verified 10.' }], [unitType()]).valid,
    ).toBe(true);
  });

  it('rejects duplicate unit types, missing evidence, invalid counts, and incomplete approval', () => {
    const entries = [
      unitMix({ evidenceIds: [], verifiedCount: undefined, approvedBy: undefined, approvedAt: undefined }),
      unitMix({ id: 'mix-duplicate', extractedCount: -1 }),
    ];
    const codes = validateUnitMix(entries, [unitType()]).issues.map((issue) => issue.code);

    expect(codes).toEqual(expect.arrayContaining([
      'DUPLICATE_UNIT_TYPE',
      'MISSING_EVIDENCE',
      'INVALID_EXTRACTED_COUNT',
      'VERIFICATION_INCOMPLETE',
    ]));
  });
});
