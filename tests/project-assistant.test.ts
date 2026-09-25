import { describe, expect, it } from 'vitest';
import type { BidJob, ProjectManifest } from '@/types';
import {
  buildProjectAssistantContext,
  evaluateAssistantToolPolicy,
  executeProjectAssistantQuery,
  queryAuditSummary,
  queryMappingExplanation,
  queryQaBlockers,
  queryRemainingActions,
  queryUnresolvedCabinets,
  queryWorkbookRows,
  queryWorkflowStatus,
} from '@/lib/autobidder/assistant';

function fixture(): { project: ProjectManifest; job: BidJob } {
  const project: ProjectManifest = {
    projectId: 'project-1',
    projectName: 'Riverwalk',
    files: [],
    pdfFiles: [],
    workbookFiles: [],
    pageCount: 12,
    createdAt: '2026-01-01T00:00:00.000Z',
    processingStatus: 'ready',
  };
  const job: BidJob = {
    id: 'job-1',
    projectId: project.projectId,
    state: 'bid_review_required',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    manifest: project,
    workbookRecords: [
      {
        sku: 'W3636',
        cabinetCode: 'W3636',
        description: '36 inch wall cabinet',
        unitCostCents: 12345,
        sourceWorkbook: 'approved.xlsx',
        sourceSheet: 'Catalog',
        sourceRow: 14,
      },
      {
        sku: 'B24',
        cabinetCode: 'B24',
        sourceWorkbook: 'approved.xlsx',
        sourceSheet: 'Catalog',
        sourceRow: 15,
      },
    ],
    classifiedPages: [],
    unitMix: [],
    takeoffRows: [
      {
        projectId: project.projectId,
        unitType: 'A1',
        room: 'Kitchen',
        sequence: 1,
        cabinetFamily: 'WALL_36',
        observedWidth: 36,
        ada: false,
        description: 'Wall cabinet requiring review',
        source: {
          sourceDocument: 'plans.pdf',
          sourcePage: 8,
          sourceSheet: 'A5.1',
          sourceView: 'Kitchen Elevation 1',
          confidence: 0.7,
        },
        reviewRequired: true,
      },
    ],
    skuMappings: [
      {
        cabinetFamily: 'WALL_36',
        matchedSku: 'W3636',
        mappingStatus: 'EXACT',
        unitCostCents: 12345,
        sourceWorkbook: 'approved.xlsx',
        sourceSheet: 'Catalog',
        sourceRow: 14,
        matchReason: 'Exact cabinet code and width match',
      },
      {
        cabinetFamily: 'VANITY_30',
        mappingStatus: 'UNRESOLVED',
        matchReason: 'No authoritative workbook row matched',
      },
    ],
    pricingLines: [],
    qaResult: {
      safeToSend: false,
      criticalIssues: [
        {
          code: 'UNRESOLVED_SKU',
          message: 'One cabinet family has no approved SKU.',
          details: { cabinetFamily: 'VANITY_30' },
        },
      ],
      warnings: [],
      assumptions: [],
    },
    manualOverrides: [],
    timings: [],
    logs: [
      { event: 'job_created', actor: 'estimator@example.com', timestamp: '2026-01-01T00:00:00.000Z' },
      { action: 'workbook_ingested', user: 'estimator@example.com', at: '2026-01-01T00:02:00.000Z' },
    ],
  };
  return { project, job };
}

describe('project assistant deterministic read-only queries', () => {
  it('rejects mismatched project and job identifiers', () => {
    const { project, job } = fixture();
    expect(() => buildProjectAssistantContext({ ...project, projectId: 'other' }, job)).toThrow(/matching project/i);
  });

  it('returns workflow truth with citations', () => {
    const { project, job } = fixture();
    const answer = queryWorkflowStatus(buildProjectAssistantContext(project, job));
    expect(answer.readOnly).toBe(true);
    expect(answer.data).toMatchObject({ workflowState: 'bid_review_required', safeToSend: false });
    expect(answer.facts[0].citations.map((citation) => citation.kind)).toEqual(['project', 'workflow']);
  });

  it('reports unresolved mappings and evidence-linked takeoff review items without mutating the job', () => {
    const { project, job } = fixture();
    const before = JSON.stringify(job);
    const answer = queryUnresolvedCabinets(buildProjectAssistantContext(project, job));
    expect(answer.data.map((item) => item.reason)).toEqual(['UNRESOLVED_MAPPING', 'TAKEOFF_REVIEW_REQUIRED']);
    expect(answer.data[1].citations.map((citation) => citation.kind)).toEqual(['takeoff', 'plan_evidence']);
    expect(JSON.stringify(job)).toBe(before);
  });

  it('explains persisted mappings and cites the exact authoritative workbook row', () => {
    const { project, job } = fixture();
    const answer = queryMappingExplanation(buildProjectAssistantContext(project, job), { sku: 'w3636' });
    expect(answer.data).toHaveLength(1);
    expect(answer.data[0]).toMatchObject({ status: 'EXACT', matchedSku: 'W3636' });
    expect(answer.data[0].citations.map((citation) => citation.kind)).toEqual(['sku_mapping', 'workbook_row']);
    expect(answer.data[0].workbookReference).toEqual({ workbook: 'approved.xlsx', sheet: 'Catalog', row: 14 });
  });

  it('defaults workbook queries to rows actually referenced by persisted mappings', () => {
    const { project, job } = fixture();
    const context = buildProjectAssistantContext(project, job);
    expect(queryWorkbookRows(context).data.map((row) => row.sku)).toEqual(['W3636']);
    expect(queryWorkbookRows(context, { usedOnly: false }).data.map((row) => row.sku)).toEqual(['W3636', 'B24']);
  });

  it('returns QA blockers, remaining work, and bounded audit summaries with citations', () => {
    const { project, job } = fixture();
    const context = buildProjectAssistantContext(project, job);
    const blockers = queryQaBlockers(context);
    const remaining = queryRemainingActions(context);
    const audit = queryAuditSummary(context, { limit: 1 });

    expect(blockers.data[0].code).toBe('UNRESOLVED_SKU');
    expect(blockers.data[0].citations[0].kind).toBe('qa_issue');
    expect(remaining.data.map((action) => action.code)).toEqual(
      expect.arrayContaining(['COMPLETE_QA', 'RESOLVE_SKU_MAPPING', 'REVIEW_TAKEOFF_ITEM', 'QA_UNRESOLVED_SKU']),
    );
    expect(audit.data.total).toBe(2);
    expect(audit.data.events).toHaveLength(1);
    expect(audit.data.events[0]).toMatchObject({ event: 'workbook_ingested', actor: 'estimator@example.com' });
    expect(audit.data.events[0].citations[0].kind).toBe('audit_event');
  });

  it('dispatches only allowlisted query tools', () => {
    const { project, job } = fixture();
    const answer = executeProjectAssistantQuery(buildProjectAssistantContext(project, job), {
      tool: 'mapping_explanation',
      args: { cabinetFamily: 'WALL_36' },
    });
    expect(answer.tool).toBe('mapping_explanation');
  });
});

describe('assistant tool policy', () => {
  it.each([
    ['calculate_authoritative_bid', 'AUTHORITATIVE_ARITHMETIC_FORBIDDEN'],
    ['approve_unit_mix', 'APPROVAL_FORBIDDEN'],
    ['transition_workflow', 'STATE_CHANGE_FORBIDDEN'],
    ['override_mapping', 'MUTATION_FORBIDDEN'],
    ['surprise_tool', 'UNKNOWN_TOOL_FORBIDDEN'],
  ])('denies %s', (tool, code) => {
    expect(evaluateAssistantToolPolicy(tool)).toMatchObject({ allowed: false, code });
  });

  it('allows only deterministic read-only queries', () => {
    expect(evaluateAssistantToolPolicy('qa_blockers')).toEqual({
      allowed: true,
      readOnly: true,
      code: 'READ_ONLY_ALLOWED',
      reason: 'Tool is an allowlisted, deterministic read-only project query.',
    });
  });
});
