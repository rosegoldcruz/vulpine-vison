import { describe, expect, it } from 'vitest';
import type { RunQaInput } from '@/lib/autobidder/compiler/qa';
import { QA_HARD_STOP_CODES, runCabinetQa } from '@/lib/autobidder/compiler/qa';
import { bidJob, cabinet, catalogSku, estimateLine, mapping, takeoff, timestamp, unitMix } from './support/compiler-fixtures';

function validInput(): RunQaInput {
  return {
    qaResultId: 'qa-1',
    bidJob: bidJob(),
    executedAt: timestamp,
    calculationVersion: 'compiler-v1',
    unitMixEntries: [unitMix()],
    takeoffLines: [takeoff()],
    cabinetInstances: [cabinet()],
    mappings: [mapping()],
    catalogSkus: [catalogSku()],
    estimateLines: [estimateLine()],
    authoritativeWorkbookIds: ['workbook-1'],
    approvedNormalizationRuleIds: [],
    availableEvidenceIds: ['evidence-unit', 'evidence-cabinet'],
    scopeComplete: true,
  };
}

function codes(input: RunQaInput) {
  return runCabinetQa(input).issues.map((issue) => issue.code);
}

describe('Cabinet QA hard-stop matrix', () => {
  it('marks a fully reconciled, evidenced estimate safe to send', () => {
    const result = runCabinetQa(validInput());
    expect(result.safeToSend).toBe(true);
    expect(result.issues).toEqual([]);
    expect(Object.values(result.reconciliation).every((item) => item.passed)).toBe(true);
    expect(result.executedBy).toBe('cabinet_qa_agent');
  });

  it('covers every required hard-stop condition', () => {
    const cases: Array<[string, RunQaInput]> = [
      ['UNIT_MIX_NOT_VERIFIED', { ...validInput(), unitMixEntries: [unitMix({ status: 'unverified' })] }],
      ['UNRESOLVED_CABINET_ITEM', { ...validInput(), takeoffLines: [takeoff({ status: 'unresolved' })] }],
      ['UNMAPPED_SKU', { ...validInput(), mappings: [] }],
      ['INVALID_WORKBOOK_REFERENCE', { ...validInput(), authoritativeWorkbookIds: ['other-workbook'] }],
      ['MISSING_UNIT_COST', { ...validInput(), catalogSkus: [catalogSku({ unitCostCents: undefined })] }],
      ['QUANTITY_INCONSISTENCY', { ...validInput(), estimateLines: [estimateLine({ projectQuantity: 19 })] }],
      ['CONFLICTING_PROJECT_COUNTS', {
        ...validInput(),
        unitMixEntries: [unitMix({ discrepancy: 'Sources disagree', resolutionNote: undefined })],
      }],
      ['UNSUPPORTED_NORMALIZATION', {
        ...validInput(),
        mappings: [mapping({ outcome: 'normalized_match', normalizationRuleId: 'rule-unknown', approvedBy: 'reviewer', approvedAt: timestamp })],
      }],
      ['UNRESOLVED_ADA_CONDITION', {
        ...validInput(),
        cabinetInstances: [cabinet({ ada: true, status: 'review_required' })],
      }],
      ['MISSING_SOURCE_EVIDENCE', { ...validInput(), availableEvidenceIds: [] }],
      ['ARITHMETIC_RECONCILIATION_FAILED', { ...validInput(), estimateLines: [estimateLine({ extendedCostCents: 1 })] }],
      ['INCOMPLETE_PROJECT_SCOPE', { ...validInput(), scopeComplete: false }],
    ];

    expect(cases.map(([code]) => code)).toEqual([...QA_HARD_STOP_CODES]);
    for (const [expectedCode, input] of cases) {
      const result = runCabinetQa(input);
      expect(result.safeToSend, expectedCode).toBe(false);
      expect(codes(input), expectedCode).toContain(expectedCode);
    }
  });

  it('cannot declare an empty or out-of-sequence job safe even when scopeComplete is asserted', () => {
    const input = validInput();
    const result = runCabinetQa({
      ...input,
      bidJob: bidJob({ state: 'project_created' }),
      unitMixEntries: [],
      takeoffLines: [],
      cabinetInstances: [],
      mappings: [],
      catalogSkus: [],
      estimateLines: [],
    });

    expect(result.safeToSend).toBe(false);
    expect(result.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      'UNIT_MIX_NOT_VERIFIED',
      'UNRESOLVED_CABINET_ITEM',
      'INCOMPLETE_PROJECT_SCOPE',
    ]));
  });
});
