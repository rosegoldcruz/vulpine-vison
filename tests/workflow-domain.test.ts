import { describe, expect, it } from 'vitest';
import { assertTransition } from '@/lib/autobidder/domain/workflow';

describe('workflow transitions', () => {
  it('allows created -> files_ingested', () => {
    expect(() => assertTransition('created', 'files_ingested')).not.toThrow();
  });

  it('blocks invalid transition', () => {
    expect(() => assertTransition('created', 'safe_to_send')).toThrow(/Invalid workflow transition/);
  });
});
