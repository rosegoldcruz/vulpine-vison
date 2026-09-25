import { describe, expect, it } from 'vitest';
import { buildExportSnapshot, ExportSnapshotError } from '@/lib/autobidder/exports';
import { makeExportInput } from './export-test-fixture';

describe('versioned export snapshots', () => {
  it('builds a deterministic internal snapshot with complete provenance and warnings', () => {
    const input = makeExportInput();
    input.approvals = [...input.approvals].reverse();
    const snapshot = buildExportSnapshot(input);

    expect(snapshot.schemaVersion).toBe('cabinet-export-snapshot/v1');
    expect(snapshot.totals).toEqual({
      currency: 'USD',
      lineCount: 1,
      projectQuantity: 20,
      grandTotalCents: 250000,
      totalsByCategory: { cabinet: 250000 },
    });
    expect(snapshot.provenance[0]).toMatchObject({
      estimateLineId: 'estimate-1',
      mappingId: 'mapping-1',
      takeoffLineId: 'takeoff-1',
      cabinetInstanceId: 'cabinet-1',
      unitMixEntryId: 'unit-mix-1',
      catalogSkuId: 'sku-1',
      complete: true,
      workbookSource: { workbook: 'pricing.xlsx', worksheet: 'Catalog', row: 42 },
    });
    expect(snapshot.provenance[0].evidence[0]).toMatchObject({
      evidenceId: 'evidence-1',
      sourceDocumentId: 'document-1',
      sourceDocumentSha256: 'abc123',
      pageNumber: 2,
    });
    expect(snapshot.warnings.join(' ')).toContain('INTERNAL REVIEW ONLY');

    input.project.name = 'mutated after snapshot';
    expect(snapshot.project.name).toBe('Oak Ridge');
  });

  it('requires an explicit export approval', () => {
    const input = makeExportInput();
    input.approvals = [];
    expect(() => buildExportSnapshot(input)).toThrowError(
      expect.objectContaining<Partial<ExportSnapshotError>>({ code: 'EXPORT_APPROVAL_REQUIRED' }),
    );
  });

  it('blocks unsafe customer exports', () => {
    const input = makeExportInput({ audience: 'customer', safeToSend: false });
    expect(() => buildExportSnapshot(input)).toThrowError(expect.objectContaining({ code: 'QA_BLOCK' }));
  });

  it('blocks customer exports with incomplete provenance', () => {
    const input = makeExportInput({ audience: 'customer', safeToSend: true });
    input.evidence = [];
    expect(() => buildExportSnapshot(input)).toThrowError(expect.objectContaining({ code: 'PROVENANCE_INCOMPLETE' }));
  });
});
