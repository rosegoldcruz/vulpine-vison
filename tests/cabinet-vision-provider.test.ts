import { afterEach, describe, expect, it } from 'vitest';
import { analyzeCabinetPlanImage, validateVisionAnalysis, visionProviderState } from '@/lib/autobidder/services/cabinet-vision-provider';

afterEach(() => {
  delete process.env.CABINET_VISION_PROVIDER;
  delete process.env.CABINET_VISION_ENDPOINT;
  delete process.env.CABINET_VISION_API_KEY;
  delete process.env.CABINET_VISION_MODEL;
});

describe('Cabinet Vision provider contract', () => {
  it('uses an honest deterministic fallback when image analysis is not configured', async () => {
    expect(visionProviderState().status).toBe('not_configured');
    const result = await analyzeCabinetPlanImage({
      image: Buffer.from('image'), mimeType: 'image/png', sourceFile: 'A401.pdf', pageNumber: 1,
      fallback: { classification: 'UNKNOWN', confidence: 0.3, reason: 'No reliable source text.' },
    });
    expect(result).toMatchObject({ mode: 'deterministic_text_fallback', classification: 'UNKNOWN', unitTypes: [], cabinets: [] });
  });

  it('accepts normalized, evidence-backed structured observations', () => {
    const result = validateVisionAnalysis({
      classification: 'KITCHEN_ELEVATION', classificationConfidence: 0.94, classificationEvidence: 'Title and cabinet geometry are visible.',
      unitTypes: [{ code: 'A1', name: 'Unit A1', accessibility: 'standard', aliases: ['A'], projectCount: 12,
        region: { x: .1, y: .1, width: .2, height: .1 }, confidence: .9, evidence: 'Unit A1 schedule row.' }],
      cabinets: [{ unitCode: 'A1', room: 'Kitchen', category: 'base', interpretedCode: 'B24', widthInches: 24,
        quantityPerUnit: 1, ada: false, region: { x: .2, y: .3, width: .15, height: .2 }, confidence: .91, evidence: 'B24 mark at kitchen elevation.' }],
    }, 'vision-provider', 'model-1');
    expect(result.cabinets[0]).toMatchObject({ interpretedCode: 'B24', widthInches: 24 });
  });

  it('rejects provider output that leaves page bounds or invents an unsupported category', () => {
    expect(() => validateVisionAnalysis({
      classification: 'KITCHEN_ELEVATION', classificationConfidence: .9, classificationEvidence: 'evidence', unitTypes: [],
      cabinets: [{ unitCode: 'A1', room: 'Kitchen', category: 'imaginary', quantityPerUnit: 1, ada: false,
        region: { x: .9, y: .1, width: .2, height: .2 }, confidence: .9, evidence: 'mark' }],
    }, 'provider', 'model')).toThrow(/category is invalid/i);
  });
});
