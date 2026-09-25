import 'server-only';
import { createHash } from 'node:crypto';
import type { BidJob, ClassifiedPage, CriticalIssue, WorkflowState, WorkbookRecord } from '@/types';
import { nextState } from '@/lib/autobidder/domain/workflow';
import { ApiServiceError } from '@/lib/autobidder/api/errors';
import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { readBinary, writeBinary } from '@/lib/autobidder/storage/file-store';
import { parsePdf } from '@/lib/autobidder/services/pdf-service';
import { parseWorkbook } from '@/lib/autobidder/services/workbook-parser';
import { renderPdfToBuffers } from '@/lib/autobidder/ingestion/pdf-raster-service';
import { getDatabase } from '@/lib/autobidder/db/database';
import { checkpointJobRun, completeJobRun, controlJobRun, failJobRun, getProcessingSettings, latestJobRun, recordProgress, scheduleAutomaticRetry } from '@/lib/autobidder/services/job-control-service';
import { advanceCanonicalSystemState, ingestCanonicalCatalog, materializeCabinetVisionDraft } from '@/lib/autobidder/services/canonical-bid-service';
import type { Principal } from '@/types/canonical';
import { listFileQueue, updateFileQueueItem } from '@/lib/autobidder/services/file-queue-service';
import { createNotificationOnce } from '@/lib/autobidder/services/notification-service';
import { analyzeCabinetPlanImage } from '@/lib/autobidder/services/cabinet-vision-provider';
import { persistCabinetVisionAnalysis } from '@/lib/autobidder/services/cabinet-vision-agent-service';

const processingPrincipal: Principal = {
  id: 'cabinet-processing-service', kind: 'service', displayName: 'Cabinet processing service',
  role: 'service', organizationId: 'local', scopes: ['project:upload'],
};

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

export async function processJob(jobId: string, actor: Principal = processingPrincipal): Promise<BidJob> {
  const repo = new BidJobRepository();
  const existing = await repo.get(jobId);
  if (!existing) {
    throw new ApiServiceError('JOB_NOT_FOUND', 'Job not found.', 404, { jobId });
  }

  const job = existing;
  const systemActor: Principal = { ...processingPrincipal, organizationId: actor.organizationId };
  if (job.state !== 'files_ingested' && job.state !== 'workbook_ingested') {
    throw new ApiServiceError('JOB_NOT_PROCESSABLE', `Job in state ${job.state} cannot be started again.`, 409, {
      jobId,
      state: job.state,
    });
  }

  const projectRepo = new ProjectRepository();
  const project = await projectRepo.get(job.projectId);
  if (!project) throw new ApiServiceError('PROJECT_NOT_FOUND', 'Project not found.', 404, { projectId: job.projectId });
  project.processingStatus = 'processing';
  await projectRepo.save(project);

  const activeRun = latestJobRun(job.id);
  const checkpoint = () => { if (activeRun) checkpointJobRun(activeRun.id); };

  try {
  checkpoint();

  const queuedAtStart = listFileQueue(job.id);
  if (job.state === 'files_ingested') {
  const workbookStage = beginStage(job, 'workbook_ingestion');
  if (job.manifest.workbookFiles.length === 0) {
    throw new ApiServiceError('WORKBOOK_REQUIRED', 'A cabinet pricing workbook must be uploaded before processing.', 409);
  }

  const workbookFile = job.manifest.workbookFiles[0];
  const workbookQueue = queuedAtStart.find((item) => item.sourceDocumentId === workbookFile.id);
  if (workbookQueue?.status === 'canceled') throw new ApiServiceError('WORKBOOK_REQUIRED', 'The authoritative workbook was removed from the processing queue.', 409);
  if (workbookQueue) updateFileQueueItem(job.id, workbookFile.id, { status: 'validating', stage: 'workbook_ingestion', completedUnits: 0, totalUnits: 1 });
  const workbookBuffer = await readBinary(workbookFile.path);
  try {
    job.workbookRecords = parseWorkbook(workbookBuffer, workbookFile.name);
  } catch (error) {
    if (workbookQueue) updateFileQueueItem(job.id, workbookFile.id, { status: 'failed', stage: 'workbook_ingestion', completedUnits: 0, totalUnits: 1, failureCode: error instanceof ApiServiceError ? error.code : 'WORKBOOK_PROCESSING_FAILED', failureReason: error instanceof Error ? error.message : 'Workbook processing failed.' });
    throw error;
  }
  ingestCanonicalCatalog(job.id, {
    fileName: workbookFile.name,
    sha256: createHash('sha256').update(workbookBuffer).digest('hex'),
    sourceDocumentId: workbookFile.id,
    rows: job.workbookRecords.map((record) => ({
      sku: record.sku || record.cabinetCode,
      cabinetCode: record.cabinetCode || record.sku,
      sourceWorksheet: record.sourceSheet,
      sourceRow: record.sourceRow,
      rawValues: {
        sku: record.sku,
        cabinetCode: record.cabinetCode,
        description: record.description,
        finish: record.finish,
        constructionFamily: record.constructionFamily,
        unitCostCents: record.unitCostCents,
      },
      description: record.description,
      finish: record.finish,
      constructionFamily: record.constructionFamily,
      unitCostCents: record.unitCostCents,
    })),
  }, systemActor);
  updateState(job, 'workbook_ingested');
  endStage(job, workbookStage);
  await repo.save(job);
  if (workbookQueue) updateFileQueueItem(job.id, workbookFile.id, { status: 'completed', stage: 'workbook_ingestion', completedUnits: 1, totalUnits: 1 });
  checkpoint();
  }

  const parseStage = beginStage(job, 'pdf_metadata_and_text');
  let pages: ClassifiedPage[] = [...job.classifiedPages];
  let totalPages = pages.length;
  const queue = listFileQueue(job.id);
  const queueBySource = new Map(queue.map((item) => [item.sourceDocumentId, item]));
  const pdfFiles = job.manifest.pdfFiles.filter((file) => {
    const item = queueBySource.get(file.id);
    return item && item.status !== 'canceled' && item.status !== 'completed';
  });
  const fileFailures: Array<{ file: string; code: string; message: string; status: number; details?: Record<string, unknown> }> = [];
  const workerCount = Math.min(pdfFiles.length, getProcessingSettings(actor.id).workerConcurrency);
  let nextFileIndex = 0;
  let completedDocuments = 0;
  await Promise.all(Array.from({ length: workerCount }, async () => {
  while (nextFileIndex < pdfFiles.length) {
    const pdfFile = pdfFiles[nextFileIndex++];
    checkpoint();
    const queueItem = queueBySource.get(pdfFile.id)!;
    try {
      updateFileQueueItem(job.id, pdfFile.id, { status: queueItem.status === 'failed' ? 'retrying' : 'validating', stage: 'pdf_validation', completedUnits: 0 });
      const pdfBuffer = await readBinary(pdfFile.path);
      const parsed = await parsePdf(pdfBuffer, pdfFile.name);
      updateFileQueueItem(job.id, pdfFile.id, { status: 'rasterizing', stage: 'pdf_rasterization', completedUnits: 0, totalUnits: parsed.pageCount });
      const sourceSha = createHash('sha256').update(pdfBuffer).digest('hex');
      getDatabase().prepare(`INSERT OR IGNORE INTO source_documents
        (id, project_id, original_path, storage_key, file_name, mime_type, byte_size, sha256, outcome, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?)`)
        .run(pdfFile.id, job.projectId, pdfFile.name, pdfFile.path, pdfFile.name, pdfFile.mimeType, pdfFile.size, sourceSha, nowIso());
      const rasterPages = await renderPdfToBuffers({
        sourceDocumentId: pdfFile.id,
        documentName: pdfFile.name,
        pdf: pdfBuffer,
        limits: { requestedDpi: 144, maxPixelsPerPage: 16_000_000, maxDimensionPixels: 10_000 },
      });
      pages = pages.filter((page) => page.document !== parsed.documentName);
      for (const raster of rasterPages) {
        const extension = raster.mimeType === 'image/png' ? 'png' : 'jpg';
        const storageKey = `renders/${job.projectId}/${pdfFile.id}/page-${raster.pageNumber}.${extension}`;
        await writeBinary(storageKey, raster.artifact);
        updateFileQueueItem(job.id, pdfFile.id, { status: 'rasterizing', stage: 'pdf_rasterization', completedUnits: raster.pageNumber, totalUnits: raster.pageCount });
        if (activeRun) recordProgress({ runId: activeRun.id, stage: 'rasterizing', unit: `pages:${pdfFile.id}`, completed: raster.pageNumber, total: raster.pageCount, message: `Rendered ${pdfFile.name} page ${raster.pageNumber}` });
        const classified = parsed.pages[raster.pageNumber - 1];
        updateFileQueueItem(job.id, pdfFile.id, { status: 'classifying', stage: 'page_classification', completedUnits: raster.pageNumber - 1, totalUnits: raster.pageCount });
        const analysis = await analyzeCabinetPlanImage({
          image: raster.artifact, mimeType: raster.mimeType, sourceFile: pdfFile.name, pageNumber: raster.pageNumber,
          fallback: { classification: classified?.classification || 'UNKNOWN', confidence: classified?.confidence ?? 0, reason: classified?.reason || 'No reliable text classification was available.' },
        });
        const reviewRequired = analysis.classification === 'UNKNOWN' || analysis.classificationConfidence < 0.65
          || analysis.cabinets.some((item) => Boolean(item.unresolvedAmbiguity));
        getDatabase().prepare(`INSERT INTO plan_sheets
          (id, source_document_id, page_number, sheet_number, title, classification, classification_confidence, review_required, render_storage_key, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_document_id, page_number) DO UPDATE SET sheet_number=excluded.sheet_number, title=excluded.title, classification=excluded.classification,
          classification_confidence=excluded.classification_confidence, review_required=excluded.review_required,
          render_storage_key=excluded.render_storage_key, payload_json=excluded.payload_json`)
          .run(raster.pageIdentity, pdfFile.id, raster.pageNumber, classified?.sheetNumber ?? null, classified?.sheetTitle ?? null, analysis.classification, analysis.classificationConfidence, reviewRequired ? 1 : 0, storageKey, JSON.stringify({
            widthPoints: raster.widthPoints, heightPoints: raster.heightPoints, rotation: raster.rotationDegrees,
            renderDpi: raster.effectiveDpi, renderWidthPx: raster.widthPixels, renderHeightPx: raster.heightPixels,
            artifactSha256: raster.artifactSha256, classificationEvidence: analysis.classificationEvidence,
            classificationProvider: analysis.provider, classificationModel: analysis.model, classificationMode: analysis.mode,
            cabinetRelevant: !['COVER', 'INDEX', 'IRRELEVANT', 'UNKNOWN'].includes(analysis.classification),
          }));
        persistCabinetVisionAnalysis({ projectId: job.projectId, planSheetId: raster.pageIdentity, analysis });
        updateFileQueueItem(job.id, pdfFile.id, { status: 'extracting', stage: 'cabinet_vision_extraction', completedUnits: raster.pageNumber, totalUnits: raster.pageCount });
        if (activeRun) {
          recordProgress({ runId: activeRun.id, stage: 'classifying', unit: `pages:${pdfFile.id}`, completed: raster.pageNumber, total: raster.pageCount, message: `Classified ${pdfFile.name} page ${raster.pageNumber}` });
          recordProgress({ runId: activeRun.id, stage: 'extracting', unit: `pages:${pdfFile.id}`, completed: raster.pageNumber, total: raster.pageCount, message: `Persisted Vision evidence for ${pdfFile.name} page ${raster.pageNumber}` });
        }
      }
      job.logs.push({ jobId: job.id, stage: 'pdf_parse', document: parsed.documentName, fileSizeBytes: parsed.fileSizeBytes,
        pageCount: parsed.pageCount, metadataDurationMs: parsed.metadataDurationMs, textExtractionDurationMs: parsed.textExtractionDurationMs,
        textExtractionAttempts: parsed.textExtractionAttempts, time: nowIso() });
      const persistedSheets = getDatabase().prepare(`SELECT page_number, sheet_number, title, classification, classification_confidence, payload_json
        FROM plan_sheets WHERE source_document_id=? ORDER BY page_number`).all(pdfFile.id) as Array<Record<string, unknown>>;
      persistedSheets.forEach((page) => {
        const payload = JSON.parse(String(page.payload_json || '{}')) as Record<string, unknown>;
        pages.push({ document: parsed.documentName, pageNumber: Number(page.page_number), sheetNumber: page.sheet_number ? String(page.sheet_number) : undefined,
          sheetTitle: page.title ? String(page.title) : undefined, classification: page.classification as ClassifiedPage['classification'],
          confidence: Number(page.classification_confidence), reason: String(payload.classificationEvidence || 'Persisted classification evidence.') });
      });
      totalPages = pages.length;
      job.classifiedPages = pages;
      job.manifest.pageCount = totalPages;
      await repo.save(job);
      updateFileQueueItem(job.id, pdfFile.id, { status: 'completed', stage: 'page_classification', completedUnits: parsed.pageCount, totalUnits: parsed.pageCount });
      completedDocuments += 1;
      if (activeRun) recordProgress({ runId: activeRun.id, stage: 'extracting', unit: 'documents', completed: completedDocuments, total: pdfFiles.length, message: `Classified and extracted ${pdfFile.name}` });
      checkpoint();
    } catch (error) {
      if (error instanceof ApiServiceError && (error.code === 'RUN_PAUSED' || error.code === 'RUN_CANCELED')) throw error;
      const code = error instanceof ApiServiceError ? error.code : 'DOCUMENT_PROCESSING_FAILED';
      const message = error instanceof Error ? error.message : 'Document processing failed.';
      updateFileQueueItem(job.id, pdfFile.id, { status: 'failed', stage: 'document_processing', failureCode: code, failureReason: message });
      fileFailures.push({
        file: pdfFile.name,
        code,
        message,
        status: error instanceof ApiServiceError ? error.status : 500,
        details: error instanceof ApiServiceError ? error.details : undefined,
      });
    }
  }
  }));
  if (fileFailures.length) {
    if (completedDocuments === 0 && fileFailures.length === 1) {
      const failure = fileFailures[0];
      throw new ApiServiceError(failure.code, failure.message, failure.status, { file: failure.file, ...failure.details });
    }
    throw new ApiServiceError('PARTIAL_DOCUMENT_FAILURE', `${fileFailures.length} document(s) failed; completed documents and page artifacts were preserved.`, 503, { failures: fileFailures });
  }
  if (pages.length === 0) throw new ApiServiceError('PDF_REQUIRED', 'At least one non-canceled plan PDF must complete processing.', 409);
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
  project.pageCount = totalPages;
  project.processingStatus = 'ready';
  await projectRepo.save(project);
  advanceCanonicalSystemState(job.id, 'cabinet_pages_classified', systemActor, 'All rendered plan pages received persisted classification results.');
  materializeCabinetVisionDraft(job.id, systemActor);
  if (activeRun) completeJobRun(activeRun.id, 'Workbook ingestion, page rendering, and classification completed.');
  createNotificationOnce({ principalId: actor.id, projectId: job.projectId, bidJobId: job.id, type: 'classification_complete', severity: 'success',
    title: 'Plan classification complete', body: `${totalPages} rendered page(s) were classified and persisted.`, targetPath: `/?job=${encodeURIComponent(job.id)}` });
  if (pages.some((page) => page.classification === 'UNKNOWN')) createNotificationOnce({ principalId: actor.id, projectId: job.projectId, bidJobId: job.id,
    type: 'review_required', severity: 'warning', title: 'Visual review required', body: 'One or more uncertain plan sheets require a human classification or evidence review.', targetPath: `/?job=${encodeURIComponent(job.id)}#blueprint-title` });
  return job;
  } catch (error) {
    const controlInterruption = error instanceof ApiServiceError && (error.code === 'RUN_PAUSED' || error.code === 'RUN_CANCELED');
    if (controlInterruption) {
      // Execution control lives on the persisted run; keep the project eligible for a paused-run resume.
      project.processingStatus = 'uploaded';
      await projectRepo.save(project);
      throw error;
    }
    const partialDocumentFailure = error instanceof ApiServiceError && error.code === 'PARTIAL_DOCUMENT_FAILURE';
    if (partialDocumentFailure) {
      job.errorMessage = error.message;
      job.logs.push({ jobId: job.id, stage: 'processing', event: 'partial_failure', code: error.code, message: error.message, time: nowIso() });
      project.processingStatus = 'uploaded';
      if (activeRun) failJobRun(activeRun.id, error.message);
      await Promise.allSettled([repo.save(job), projectRepo.save(project)]);
      throw error;
    }
    job.state = 'failed';
    job.errorMessage = error instanceof Error ? error.message : 'Unknown processing failure.';
    job.logs.push({
      jobId: job.id,
      stage: 'processing',
      event: 'failed',
      code: error instanceof ApiServiceError ? error.code : 'PROCESSING_FAILED',
      message: job.errorMessage,
      time: nowIso(),
    });
    project.processingStatus = 'failed';
    if (activeRun) failJobRun(activeRun.id, job.errorMessage);
    createNotificationOnce({ principalId: actor.id, projectId: job.projectId, bidJobId: job.id, type: 'processing_failed', severity: 'critical',
      title: 'Processing failed', body: job.errorMessage, targetPath: `/?job=${encodeURIComponent(job.id)}${activeRun ? `&run=${encodeURIComponent(activeRun.id)}` : ''}` });
    await Promise.allSettled([repo.save(job), projectRepo.save(project)]);
    throw error;
  }
}

export async function processJobWithAutomaticRetries(jobId: string, actor: Principal = processingPrincipal): Promise<BidJob> {
  for (;;) {
    try {
      return await processJob(jobId, actor);
    } catch (error) {
      const run = latestJobRun(jobId);
      const typed = error instanceof ApiServiceError ? error : new ApiServiceError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown processing error.', 500);
      if (!run || ['RUN_PAUSED', 'RUN_CANCELED'].includes(typed.code)) throw error;
      const retry = scheduleAutomaticRetry(run.id, { code: typed.code, message: typed.message, status: typed.status }, actor.id);
      if (!retry.scheduled) {
        createNotificationOnce({ principalId: actor.id, bidJobId: jobId, type: 'processing_failed', severity: 'critical',
          title: 'Processing failed', body: `${typed.message} Automatic retry was not scheduled: ${retry.decision.reason}`,
          targetPath: `/?job=${encodeURIComponent(jobId)}&run=${encodeURIComponent(run.id)}` });
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, retry.delayMs));
      controlJobRun(run.id, 'retry', `Automatic retry after ${retry.decision.category} failure.`);
    }
  }
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
