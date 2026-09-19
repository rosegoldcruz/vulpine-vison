import 'server-only';
import type { BidJob, ClassifiedPage, CriticalIssue, WorkflowState, WorkbookRecord } from '@/types';
import { nextState } from '@/lib/autobidder/domain/workflow';
import { ApiServiceError } from '@/lib/autobidder/api/errors';
import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import { readBinary } from '@/lib/autobidder/storage/file-store';
import { parsePdf } from '@/lib/autobidder/services/pdf-service';
import { parseWorkbook } from '@/lib/autobidder/services/workbook-parser';

function nowIso() {
  return new Date().toISOString();
}

function beginStage(job: BidJob, stage: string) {
  job.logs.push({ jobId: job.id, stage, event: 'start', time: nowIso() });
  return { stage, startTime: Date.now() };
}

function endStage(job: BidJob, ticket: { stage: string; startTime: number }) {
  const endTime = Date.now();
  job.timings.push({
    stage: ticket.stage,
    startTime: new Date(ticket.startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
    durationMs: endTime - ticket.startTime,
  });
  job.logs.push({ jobId: job.id, stage: ticket.stage, event: 'end', time: nowIso(), durationMs: endTime - ticket.startTime });
}

function updateState(job: BidJob, target: WorkflowState) {
  job.state = nextState(job.state, target);
}

function qaIssues(job: BidJob): CriticalIssue[] {
  const issues: CriticalIssue[] = [];
  if (!job.manifest.workbookFiles.length) {
    issues.push({ code: 'WORKBOOK_REQUIRED', message: 'A cabinet pricing workbook must be uploaded before processing.' });
  }
  if (!job.manifest.pdfFiles.length) {
    issues.push({ code: 'PDF_REQUIRED', message: 'At least one plan PDF must be uploaded before processing.' });
  }
  if (!job.classifiedPages.length) {
    issues.push({ code: 'CLASSIFICATION_REQUIRED', message: 'No PDF pages were classified.' });
  }
  if (!job.unitMix.length) {
    issues.push({ code: 'UNIT_MIX_REQUIRED', message: 'Unit mix extraction is required and must be approved.' });
  }
  if (!job.takeoffRows.length) {
    issues.push({ code: 'TAKEOFF_REQUIRED', message: 'Cabinet takeoff rows are required before pricing.' });
  }
  if (job.skuMappings.some((m) => m.mappingStatus === 'UNRESOLVED')) {
    issues.push({ code: 'UNRESOLVED_SKU', message: 'Unresolved SKU mappings block bid completion.' });
  }
  return issues;
}

function findWorkbookByCode(records: WorkbookRecord[], code: string) {
  return records.find((r) => r.cabinetCode === code || r.sku === code);
}

function cents(value: number) {
  return Math.round(value);
}

function enforceSafeToSendQuarantine(job: BidJob) {
  job.qaResult.safeToSend = false;
  const hasMarker = job.qaResult.criticalIssues.some((issue) => issue.code === 'SAFE_TO_SEND_QUARANTINED');
  if (!hasMarker) {
    job.qaResult.criticalIssues.push({
      code: 'SAFE_TO_SEND_QUARANTINED',
      message: 'SAFE_TO_SEND is disabled until Golden Bid validation is complete.',
    });
  }
}

export async function processJob(jobId: string): Promise<BidJob> {
  const repo = new BidJobRepository();
  const existing = await repo.get(jobId);
  if (!existing) {
    throw new ApiServiceError('JOB_NOT_FOUND', 'Job not found.', 404, { jobId });
  }

  const job = existing;

  const workbookStage = beginStage(job, 'workbook_ingestion');
  if (job.manifest.workbookFiles.length === 0) {
    updateState(job, 'failed');
    job.errorMessage = 'A cabinet pricing workbook must be uploaded before processing.';
    endStage(job, workbookStage);
    await repo.save(job);
    return job;
  }

  const workbookFile = job.manifest.workbookFiles[0];
  const workbookBuffer = await readBinary(workbookFile.path);
  job.workbookRecords = parseWorkbook(workbookBuffer, workbookFile.name);
  updateState(job, 'workbook_ingested');
  endStage(job, workbookStage);

  const parseStage = beginStage(job, 'pdf_metadata_and_text');
  const pages: ClassifiedPage[] = [];
  let totalPages = 0;
  for (const pdfFile of job.manifest.pdfFiles) {
    const pdfBuffer = await readBinary(pdfFile.path);
    const parsed = await parsePdf(pdfBuffer, pdfFile.name);
    job.logs.push({
      jobId: job.id,
      stage: 'pdf_parse',
      document: parsed.documentName,
      fileSizeBytes: parsed.fileSizeBytes,
      pageCount: parsed.pageCount,
      metadataDurationMs: parsed.metadataDurationMs,
      textExtractionDurationMs: parsed.textExtractionDurationMs,
      textExtractionAttempts: parsed.textExtractionAttempts,
      time: nowIso(),
    });
    totalPages += parsed.pageCount;
    parsed.pages.forEach((page) => {
      pages.push({
        document: parsed.documentName,
        pageNumber: page.pageNumber,
        classification: page.classification,
        confidence: page.confidence,
        reason: page.reason,
      });
    });
  }
  job.classifiedPages = pages;
  job.manifest.pageCount = totalPages;
  updateState(job, 'pages_classified');
  endStage(job, parseStage);

  const unitMixStage = beginStage(job, 'unit_mix_extraction');
  // Deterministic and evidence-only behavior: this migration does not fabricate unit mix.
  job.unitMix = [];
  updateState(job, 'unit_mix_drafted');
  updateState(job, 'unit_mix_review_required');
  endStage(job, unitMixStage);

  // Pipeline intentionally stops here until human review + explicit takeoff exists.
  job.takeoffRows = [];
  job.skuMappings = [];
  job.pricingLines = [];

  const issues = qaIssues(job);
  job.qaResult = {
    safeToSend: false,
    criticalIssues: issues,
    warnings: [],
    assumptions: [
      'Phase zero migration baseline: no mocked takeoff or generated pricing is allowed.',
      'Cabinet intelligence is quarantined during Phase Zero validation.',
    ],
  };
  enforceSafeToSendQuarantine(job);

  await repo.save(job);
  return job;
}

export async function approveUnitMix(jobId: string, approvedBy: string): Promise<BidJob> {
  const repo = new BidJobRepository();
  const job = await repo.get(jobId);
  if (!job) {
    throw new ApiServiceError('JOB_NOT_FOUND', 'Job not found.', 404, { jobId });
  }
  if (job.state !== 'unit_mix_review_required') {
    throw new ApiServiceError('INVALID_STATE_TRANSITION', `Job state ${job.state} cannot transition via unit mix approval.`, 409, {
      jobId,
      state: job.state,
      expectedState: 'unit_mix_review_required',
    });
  }

  throw new ApiServiceError(
    'ESTIMATOR_INTELLIGENCE_DISABLED',
    `Unit mix approval is disabled during Phase Zero quarantine. Request by: ${approvedBy}`,
    409,
    { jobId },
  );
}

export async function applyManualSkuResolution(
  jobId: string,
  payload: {
    cabinetFamily: string;
    mappedSku: string;
    unitCostCents: number;
    overrideReason: string;
    overrideUser: string;
  },
): Promise<BidJob> {
  const repo = new BidJobRepository();
  const job = await repo.get(jobId);
  if (!job) {
    throw new ApiServiceError('JOB_NOT_FOUND', 'Job not found.', 404, { jobId });
  }

  throw new ApiServiceError(
    'ESTIMATOR_INTELLIGENCE_DISABLED',
    `Manual SKU resolution is disabled during Phase Zero quarantine. Request by: ${payload.overrideUser}`,
    409,
    { jobId, cabinetFamily: payload.cabinetFamily },
  );
}
