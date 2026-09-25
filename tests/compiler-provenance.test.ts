import { describe, expect, it } from 'vitest';
import { buildProvenanceIndex, traceEstimateLine } from '@/lib/autobidder/compiler/provenance';
import {
  cabinet,
  catalogSku,
  estimateLine,
  evidence,
  mapping,
  planSheet,
  sourceDocument,
  takeoff,
  unitMix,
} from './support/compiler-fixtures';

function completeIndex() {
  return buildProvenanceIndex({
    estimateLines: [estimateLine()],
    mappings: [mapping()],
    takeoffLines: [takeoff()],
    cabinetInstances: [cabinet()],
    unitMixEntries: [unitMix()],
    catalogSkus: [catalogSku()],
    evidence: [evidence('evidence-cabinet'), evidence('evidence-unit', 'unit_mix')],
    planSheets: [planSheet()],
    sourceDocuments: [sourceDocument()],
  });
}

describe('evidence provenance traversal', () => {
  it('traverses both plan evidence and authoritative workbook row chains', () => {
    const trace = traceEstimateLine('estimate-1', completeIndex());

    expect(trace.complete).toBe(true);
    expect(trace.missing).toEqual([]);
    expect(trace.mapping?.id).toBe('mapping-1');
    expect(trace.takeoffLine?.id).toBe('takeoff-1');
    expect(trace.cabinetInstance?.id).toBe('cabinet-1');
    expect(trace.evidence).toHaveLength(2);
    expect(trace.evidence.every((item) => item.planSheet?.id === 'sheet-1')).toBe(true);
    expect(trace.evidence.every((item) => item.sourceDocument?.id === 'document-1')).toBe(true);
    expect(trace.workbookSource).toEqual({ workbook: 'pricing.xlsx', worksheet: 'Cabinets', row: 42 });
  });

  it('reports broken provenance links instead of hiding them', () => {
    const index = buildProvenanceIndex({
      estimateLines: [estimateLine()],
      mappings: [mapping()],
      takeoffLines: [takeoff()],
      cabinetInstances: [cabinet()],
      unitMixEntries: [unitMix()],
      catalogSkus: [],
      evidence: [evidence('evidence-cabinet')],
      planSheets: [],
      sourceDocuments: [],
    });
    const trace = traceEstimateLine('estimate-1', index);

    expect(trace.complete).toBe(false);
    expect(trace.missing).toEqual(expect.arrayContaining([
      'CatalogSku',
      'PlanSheet:sheet-1',
      'VisionEvidence:evidence-unit',
    ]));
  });
});
