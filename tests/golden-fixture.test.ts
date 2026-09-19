import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('golden fixture schema', () => {
  it('contains expected deterministic totals payload', () => {
    const filePath = path.resolve(process.cwd(), 'fixtures/golden-project/expected-results.json');
    const json = JSON.parse(readFileSync(filePath, 'utf-8')) as any;

    expect(Array.isArray(json.expected_mappings)).toBe(true);
    expect(typeof json.expected_totals_cents.cabinets).toBe('number');
    expect(json.expected_totals_cents.cabinets).toBeGreaterThan(0);
  });
});
