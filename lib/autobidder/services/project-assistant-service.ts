import 'server-only';

import {
  buildProjectAssistantContext,
  executeProjectAssistantQuery,
  optimizeProjectPrompt,
  type ProjectAssistantToolRequest,
  type PromptOptimizationContext,
} from '@/lib/autobidder/assistant';
import { ApiServiceError } from '@/lib/autobidder/api/errors';
import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { getCanonicalBidSnapshot, type CanonicalBidSnapshot } from '@/lib/autobidder/services/canonical-bid-service';
import type { BidJob, CabinetObservation, ProjectManifest, SkuMapping, WorkbookRecord } from '@/types';
import type { Principal } from '@/types/canonical';

function canonicalLegacyAdapter(project: ProjectManifest, legacy: BidJob, canonical: CanonicalBidSnapshot): BidJob {
  const unitById = new Map(canonical.unitTypes.map((item) => [item.id, item]));
  const cabinetById = new Map(canonical.cabinetInstances.map((item) => [item.id, item]));
  const skuById = new Map(canonical.catalogSkus.map((item) => [item.id, item]));
  const mappingByTakeoff = new Map(canonical.mappings.map((item) => [item.takeoffLineId, item]));
  const takeoffRows: CabinetObservation[] = canonical.takeoffLines.map((line, index) => {
    const cabinet = cabinetById.get(line.cabinetInstanceId)!;
    const unit = unitById.get(line.unitTypeId);
    const evidenceId = line.evidenceIds[0] || 'missing-evidence';
    return {
      projectId: project.projectId, unitType: unit?.code || line.unitTypeId, room: cabinet?.room || 'Unknown', sequence: index + 1,
      cabinetFamily: cabinet?.interpretedCode || cabinet?.category || 'Unresolved', observedWidth: cabinet?.widthInches,
      observedHeight: cabinet?.heightInches, observedDepth: cabinet?.depthInches, ada: Boolean(cabinet?.ada),
      description: cabinet?.planNote || cabinet?.configuration || cabinet?.category || 'Cabinet takeoff line',
      source: { sourceDocument: evidenceId, sourcePage: 0, sourceView: cabinet?.room, confidence: cabinet?.confidence },
      reviewRequired: line.status !== 'approved',
    };
  });
  const skuMappings: SkuMapping[] = canonical.takeoffLines.map((line) => {
    const cabinet = cabinetById.get(line.cabinetInstanceId);
    const mapping = mappingByTakeoff.get(line.id);
    const sku = mapping?.catalogSkuId ? skuById.get(mapping.catalogSkuId) : undefined;
    const status: SkuMapping['mappingStatus'] = mapping?.outcome === 'exact_match' ? 'EXACT'
      : mapping?.outcome === 'normalized_match' ? 'NORMALIZED'
        : mapping?.outcome === 'approved_substitution' ? 'MANUAL_OVERRIDE' : 'UNRESOLVED';
    return { cabinetFamily: cabinet?.interpretedCode || cabinet?.category || line.id, matchedSku: sku?.sku, mappingStatus: status,
      unitCostCents: sku?.unitCostCents, sourceWorkbook: sku?.sourceWorkbook, sourceSheet: sku?.sourceWorksheet,
      sourceRow: sku?.sourceRow, matchReason: mapping?.resolutionNote || mapping?.matchMethod };
  });
  const workbookRecords: WorkbookRecord[] = canonical.catalogSkus.map((sku) => ({
    sku: sku.sku, cabinetCode: sku.cabinetCode, description: sku.description, sourceWorkbook: sku.sourceWorkbook,
    sourceSheet: sku.sourceWorksheet, sourceRow: sku.sourceRow, unitCostCents: sku.unitCostCents,
  }));
  const latestQa = canonical.qaResults[0];
  return {
    ...legacy, state: canonical.job.state as BidJob['state'], updatedAt: canonical.job.updatedAt, workbookRecords, takeoffRows, skuMappings,
    unitMix: canonical.unitMixEntries.map((entry) => ({ unitType: unitById.get(entry.unitTypeId)?.code || entry.unitTypeId,
      count: entry.verifiedCount ?? entry.extractedCount, evidence: entry.evidenceIds.join(', '), confidence: entry.status === 'verified' ? 1 : 0,
      source: { sourceDocument: entry.evidenceIds[0] || 'missing-evidence', sourcePage: 0 } })),
    pricingLines: canonical.estimateLines.map((line) => ({ key: line.id, description: line.description, quantity: line.projectQuantity,
      unitCostCents: line.unitCostCents, totalCostCents: line.extendedCostCents })),
    qaResult: { safeToSend: Boolean(latestQa?.safeToSend), criticalIssues: (latestQa?.issues || []).map((issue) => ({ code: issue.code, message: issue.message, details: { entityType: issue.entityType, entityId: issue.entityId } })), warnings: [], assumptions: latestQa?.reviewerRequirements || [] },
    logs: canonical.auditEvents.map((event) => ({ event: event.action, actor: event.actorId, timestamp: event.occurredAt, resourceType: event.resourceType, resourceId: event.resourceId })),
  };
}

async function loadContext(jobId: string, principal?: Principal) {
  const job = await new BidJobRepository().get(jobId);
  if (!job) throw new ApiServiceError('JOB_NOT_FOUND', 'Job not found.', 404, { jobId });
  const project = await new ProjectRepository().get(job.projectId, principal?.organizationId);
  if (!project) throw new ApiServiceError('PROJECT_NOT_FOUND', 'Project not found.', 404, { projectId: job.projectId });
  try {
    const canonical = getCanonicalBidSnapshot(jobId, principal);
    const useCanonical = canonical.job.state !== 'project_created' || job.state === 'created';
    return buildProjectAssistantContext(project, useCanonical ? canonicalLegacyAdapter(project, job, canonical) : job);
  } catch (error) {
    throw new ApiServiceError('ASSISTANT_CONTEXT_INVALID', error instanceof Error ? error.message : 'Assistant context is invalid.', 409, { jobId });
  }
}

export async function queryProjectAssistant(jobId: string, request: ProjectAssistantToolRequest, principal?: Principal) {
  return executeProjectAssistantQuery(await loadContext(jobId, principal), request);
}

function routeQuestion(message: string): ProjectAssistantToolRequest {
  const value = message.toLowerCase();
  if (/\b(qa|blocker|safe to send|critical issue)\b/.test(value)) return { tool: 'qa_blockers' };
  if (/\b(unresolved|missing cabinet|needs review)\b/.test(value)) return { tool: 'unresolved_cabinets' };
  if (/\b(map|mapping|mapped|sku)\b/.test(value)) return { tool: 'mapping_explanation', args: {} };
  if (/\b(workbook|catalog|price source|source row)\b/.test(value)) return { tool: 'workbook_rows', args: { usedOnly: true } };
  if (/\b(audit|history|who changed)\b/.test(value)) return { tool: 'audit_summary', args: { limit: 20 } };
  if (/\b(status|state|where are we|workflow)\b/.test(value)) return { tool: 'workflow_status' };
  return { tool: 'remaining_actions' };
}

export async function groundProjectChat(jobId: string, message: string, principal?: Principal) {
  const result = await queryProjectAssistant(jobId, routeQuestion(message), principal);
  const citations = result.facts.flatMap((fact) => fact.citations);
  const uniqueCitations = citations.filter((citation, index, all) => all.findIndex((item) => item.id === citation.id) === index);
  const statements = result.facts.map((fact) => fact.text);
  const text = [
    ...(statements.length ? statements : ['The persisted project records do not contain a supported answer for that question.']),
    ...(result.limitations.length ? ['', `Limitations: ${result.limitations.join(' ')}`] : []),
    ...(uniqueCitations.length ? ['', 'Sources:', ...uniqueCitations.map((citation) => `• ${citation.label} [${citation.kind}:${citation.entityId}]`)] : []),
  ].join('\n');
  return { text, result, citations: uniqueCitations };
}

export async function optimizePromptForProject(input: {
  jobId: string;
  prompt: string;
  context?: Omit<PromptOptimizationContext, 'projectId' | 'projectName' | 'workbookName' | 'qaCriteria'>;
}, principal?: Principal) {
  const active = await loadContext(input.jobId, principal);
  const workbookNames = [...new Set(active.job.workbookRecords.map((row) => row.sourceWorkbook))];
  const qaCriteria = active.job.qaResult.criticalIssues.map((issue) => `${issue.code}: ${issue.message}`);
  return optimizeProjectPrompt({
    prompt: input.prompt,
    context: {
      ...input.context,
      projectId: active.project.projectId,
      projectName: active.project.projectName,
      workbookName: workbookNames.length ? workbookNames.join(', ') : undefined,
      qaCriteria,
    },
  });
}
