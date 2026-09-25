import { describe, expect, it } from 'vitest';
import { classifyPageText } from '@/lib/autobidder/services/pdf-service';

describe('cabinet plan classification taxonomy', () => {
  it.each([
    ['ENLARGED UNIT FLOOR PLAN A1', 'UNIT_PLAN'],
    ['KITCHEN ELEVATION', 'KITCHEN_ELEVATION'],
    ['BATHROOM VANITY ELEVATION', 'BATH_ELEVATION'],
    ['INTERIOR ELEVATIONS', 'INTERIOR_ELEVATION'],
    ['MILLWORK SCHEDULE', 'CASEWORK_SCHEDULE'],
    ['FINISH SCHEDULE', 'FINISH_SCHEDULE'],
    ['UNIT MATRIX', 'UNIT_MATRIX'],
    ['TYPE A ACCESSIBLE ADA PLAN', 'ACCESSIBILITY'],
    ['APPLIANCE SCHEDULE', 'APPLIANCE_SCHEDULE'],
    ['CIVIL GRADING AND DRAINAGE', 'IRRELEVANT'],
  ])('classifies %s as %s with evidence', (text, expected) => {
    const result = classifyPageText(text);
    expect(result.classification).toBe(expected);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.reason).not.toHaveLength(0);
  });

  it('fails uncertain input into explicit review rather than discarding it', () => {
    expect(classifyPageText('unlabeled scanned symbols')).toMatchObject({ classification: 'UNKNOWN', confidence: 0.3 });
  });
});
