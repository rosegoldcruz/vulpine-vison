import { describe, expect, it } from 'vitest';
import {
  configuredNames,
  evaluateProviderConnectivity,
  optimizeProjectPrompt,
  undoPromptRevision,
} from '@/lib/autobidder/assistant';

describe('project assistant prompt optimization', () => {
  it('preserves the original request verbatim and exposes preview plus Undo metadata', () => {
    const original = 'Why did we map this cabinet to W3636?';
    const revision = optimizeProjectPrompt({
      prompt: original,
      context: {
        projectId: 'project-1',
        projectName: 'Riverwalk',
        sheet: 'A5.1',
        unitType: 'A1',
        cabinetTerminology: ['wall cabinet', 'W3636'],
        workbookName: 'approved.xlsx',
        requestedEvidence: ['plan location', 'workbook row'],
        qaCriteria: ['unresolved mappings'],
        desiredOutputStructure: 'Short explanation followed by citations',
      },
      now: new Date('2026-01-03T00:00:00.000Z'),
    });

    expect(revision.originalPrompt).toBe(original);
    expect(revision.optimizedPrompt).toContain(`Original request (verbatim):\n${original}`);
    expect(revision.preview).toBe(revision.optimizedPrompt);
    expect(revision.intentPreserved).toBe(true);
    expect(revision.undo).toEqual({ available: true, restoresPrompt: original });
    expect(undoPromptRevision(revision)).toBe(original);
    expect(revision.appliedContext).toEqual([
      'Project',
      'Project ID',
      'Sheet',
      'Unit type',
      'Cabinet terminology',
      'Authoritative workbook',
      'Requested evidence',
      'QA criteria',
      'Desired output',
    ]);
    expect(revision.revisionId).toMatch(/^prompt-revision-[a-f0-9]{20}$/);
  });

  it('rejects empty prompts rather than inventing intent', () => {
    expect(() => optimizeProjectPrompt({ prompt: '   ' })).toThrow(/non-empty prompt/i);
  });
});

describe('provider connectivity state', () => {
  const base = {
    providerId: 'openai',
    displayName: 'OpenAI',
    capabilities: ['text', 'voice', 'realtime'] as Array<'text' | 'voice' | 'realtime'>,
    requiredConfiguration: ['OPENAI_API_KEY'],
  };

  it('distinguishes missing, configured-unverified, verified, degraded, and unavailable states', () => {
    expect(evaluateProviderConnectivity({ ...base, configuredConfiguration: [] })).toMatchObject({
      status: 'DISCONNECTED',
      connected: false,
      missingConfiguration: ['OPENAI_API_KEY'],
    });
    expect(evaluateProviderConnectivity({ ...base, configuredConfiguration: ['OPENAI_API_KEY'] })).toMatchObject({
      status: 'CONFIGURED_UNVERIFIED',
      connected: false,
    });
    expect(
      evaluateProviderConnectivity({
        ...base,
        configuredConfiguration: ['OPENAI_API_KEY'],
        probe: { ok: true, checkedAt: '2026-01-01T00:00:00.000Z', latencyMs: 42 },
      }),
    ).toMatchObject({ status: 'AVAILABLE', connected: true, latencyMs: 42 });
    expect(
      evaluateProviderConnectivity({
        ...base,
        configuredConfiguration: ['OPENAI_API_KEY'],
        fallbackProviderId: 'xai',
        probe: { ok: false, checkedAt: '2026-01-01T00:00:00.000Z', errorCode: 'TIMEOUT' },
      }),
    ).toMatchObject({ status: 'DEGRADED', connected: false, errorCode: 'TIMEOUT' });
    expect(
      evaluateProviderConnectivity({
        ...base,
        configuredConfiguration: ['OPENAI_API_KEY'],
        probe: { ok: false, checkedAt: '2026-01-01T00:00:00.000Z' },
      }),
    ).toMatchObject({ status: 'UNAVAILABLE', connected: false });
  });

  it('reports configured names without returning secret values', () => {
    expect(configuredNames({ OPENAI_API_KEY: 'secret', XAI_API_KEY: '', OPTIONAL: undefined })).toEqual(['OPENAI_API_KEY']);
  });
});
