import 'server-only';

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { CabinetExportSnapshotV1 } from './contracts';

export const REVIEW_DOCUMENT_TEMPLATE_VERSION = 'cabinet-review-document/v1' as const;

export interface ReviewPdfCapability {
  available: true;
  provider: 'pdf-lib';
  reason: string;
  fallback: 'deterministic_html';
}

export function getReviewPdfCapability(): ReviewPdfCapability {
  return {
    available: true,
    provider: 'pdf-lib',
    reason: 'Server-side PDF generation is available through the pinned pdf-lib writer.',
    fallback: 'deterministic_html',
  };
}

function wrapPdfText(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) current = candidate;
    else { if (current) lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ['—'];
}

function drawPdfSection(page: PDFPage, font: PDFFont, bold: PDFFont, title: string, lines: string[], pageNumber: number) {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: height - 74, width, height: 74, color: rgb(0.035, 0.08, 0.11) });
  page.drawText('VULPINE CABINET BRAIN', { x: 42, y: height - 33, size: 9, font: bold, color: rgb(0.25, 0.72, 0.88) });
  page.drawText(title, { x: 42, y: height - 57, size: 18, font: bold, color: rgb(0.94, 0.97, 0.98) });
  let y = height - 102;
  for (const raw of lines) {
    for (const line of wrapPdfText(raw, font, 10, width - 84)) {
      if (y < 48) break;
      page.drawText(line, { x: 42, y, size: 10, font, color: rgb(0.12, 0.18, 0.22) });
      y -= 15;
    }
    y -= 5;
  }
  page.drawText(`Internal review package  •  Page ${pageNumber}`, { x: 42, y: 24, size: 8, font, color: rgb(0.4, 0.48, 0.52) });
}

export interface ReviewSnippetArtifact { title: string; bytes: Buffer; mimeType: 'image/png' | 'image/jpeg' }

export async function generateReviewPdf(snapshot: CabinetExportSnapshotV1, snippetArtifacts: ReviewSnippetArtifact[] = []): Promise<Buffer> {
  if (snapshot.audience !== 'internal_review') throw new Error('Review PDF requires an internal_review snapshot.');
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${snapshot.project.name} — Cabinet Brain Review`);
  pdf.setCreator('Vulpine Cabinet Brain');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const unitTypeById = new Map(snapshot.entities.unitTypes.map((item) => [item.id, item]));
  const skuById = new Map(snapshot.entities.catalogSkus.map((item) => [item.id, item]));
  const mappingById = new Map(snapshot.entities.skuMappings.map((item) => [item.id, item]));
  const sections: Array<[string, string[]]> = [
    ['1. Project Summary', [snapshot.project.name, `Project ID: ${snapshot.project.id}`, `Generated: ${snapshot.createdAt}`, `Total: ${money(snapshot.totals.grandTotalCents, snapshot.totals.currency)}`]],
    ['2. Workflow / QA Status', [`Workflow: ${snapshot.bidJob.state}`, `QA: ${snapshot.qaResult.safeToSend ? 'SAFE TO SEND' : 'UNSAFE TO SEND — INTERNAL REVIEW ONLY'}`, ...snapshot.qaResult.issues.map((issue) => `${issue.code}: ${issue.message}`), ...(snapshot.qaResult.warnings || []).map((warning) => `Warning: ${warning}`), ...(snapshot.qaResult.informationalNotes || []).map((note) => `Note: ${note}`)]],
    ['3. Verified Unit Mix', snapshot.entities.unitMixEntries.map((entry) => `${unitTypeById.get(entry.unitTypeId)?.code || entry.unitTypeId}: extracted ${entry.extractedCount}, verified ${entry.verifiedCount ?? '—'}, ${entry.status}`)],
    ['4. Per-Unit Cabinet Takeoffs', snapshot.entities.takeoffLines.map((line) => `${unitTypeById.get(line.unitTypeId)?.code || line.unitTypeId}: ${line.quantityPerUnit} per unit — ${line.status}`)],
    ['5. Project Quantity Summary', snapshot.entities.estimateLines.map((line) => `${line.description}: ${line.projectQuantity} × ${money(line.unitCostCents, line.currency)} = ${money(line.extendedCostCents, line.currency)}`)],
    ['6. SKU & Pricing Schedule', snapshot.entities.estimateLines.map((line) => { const mapping = line.mappingId ? mappingById.get(line.mappingId) : undefined; const sku = mapping?.catalogSkuId ? skuById.get(mapping.catalogSkuId) : undefined; return `${sku?.sku || 'UNMAPPED'} — ${line.description} — ${money(line.unitCostCents, line.currency)} — ${sku ? `${sku.sourceWorkbook} / ${sku.sourceWorksheet} / row ${sku.sourceRow}` : 'no workbook source'}`; })],
    ['7. Assumptions and Exceptions', [...snapshot.assumptions, ...snapshot.warnings]],
    ['8. Measurement Log', ['Measurements are supporting evidence only and never override printed architectural dimensions.', 'Measurement evidence is listed when attached to estimate provenance.']],
    ['9. Annotated Plan Evidence', snapshot.provenance.flatMap((trace) => trace.evidence.map((evidence) => `${trace.estimateLineId}: document ${evidence.sourceDocumentId || '—'}, page ${evidence.pageNumber || '—'}, sheet ${evidence.sheetNumber || '—'}`))],
    ['10. Unresolved or Overridden Items', [...snapshot.qaResult.issues.filter((issue) => !issue.resolved).map((issue) => `${issue.code}: ${issue.message}`), ...snapshot.entities.skuMappings.filter((mapping) => ['normalized_match', 'approved_substitution'].includes(mapping.outcome)).map((mapping) => `${mapping.outcome}: ${mapping.id} — ${mapping.resolutionNote || 'approved override'}`)]],
    ['11. Reviewer / Approval Information', snapshot.approvals.map((approval) => `${approval.type}: ${approval.decision} by ${approval.actorId} at ${approval.occurredAt}${approval.note ? ` — ${approval.note}` : ''}`)],
  ];
  let pageNumber = 0;
  for (const [index, [title, lines]] of sections.entries()) {
    pageNumber += 1;
    drawPdfSection(pdf.addPage([612, 792]), font, bold, title, lines.length ? lines : ['No records.'], pageNumber);
    if (index === 8) {
      for (const artifact of snippetArtifacts) {
        pageNumber += 1;
        const page = pdf.addPage([612, 792]);
        drawPdfSection(page, font, bold, `9A. Evidence Snippet — ${artifact.title}`, [], pageNumber);
        const embedded = artifact.mimeType === 'image/png' ? await pdf.embedPng(artifact.bytes) : await pdf.embedJpg(artifact.bytes);
        const scale = Math.min(528 / embedded.width, 620 / embedded.height, 1);
        const width = embedded.width * scale;
        const height = embedded.height * scale;
        page.drawImage(embedded, { x: (612 - width) / 2, y: Math.max(55, 690 - height), width, height });
      }
    }
  }
  return Buffer.from(await pdf.save());
}

function html(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

function section(title: string, body: string, breakBefore = true): string {
  return `<section class="review-section${breakBefore ? ' page-break' : ''}"><h2>${html(title)}</h2>${body}</section>`;
}

function table(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  if (rows.length === 0) return '<p class="empty">No records.</p>';
  return `<table><thead><tr>${headers.map((header) => `<th>${html(header)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${html(cell)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

function list(items: readonly string[]): string {
  if (items.length === 0) return '<p class="empty">None recorded.</p>';
  return `<ul>${items.map((item) => `<li>${html(item)}</li>`).join('')}</ul>`;
}

export function renderInternalReviewHtml(snapshot: CabinetExportSnapshotV1): string {
  if (snapshot.audience !== 'internal_review') {
    throw new Error('The internal review template only accepts internal_review snapshots.');
  }

  const unitTypeById = new Map(snapshot.entities.unitTypes.map((unitType) => [unitType.id, unitType]));
  const cabinetById = new Map(snapshot.entities.cabinetInstances.map((cabinet) => [cabinet.id, cabinet]));
  const mappingById = new Map(snapshot.entities.skuMappings.map((mapping) => [mapping.id, mapping]));
  const skuById = new Map(snapshot.entities.catalogSkus.map((sku) => [sku.id, sku]));
  const sheetById = new Map(snapshot.entities.planSheets.map((sheet) => [sheet.id, sheet]));
  const documentById = new Map(snapshot.entities.sourceDocuments.map((document) => [document.id, document]));

  const qaStatus = snapshot.qaResult.safeToSend ? 'SAFE TO SEND' : 'UNSAFE TO SEND — INTERNAL REVIEW ONLY';
  const unresolved = snapshot.qaResult.issues.filter((issue) => !issue.resolved);
  const overrides = snapshot.entities.skuMappings.filter(
    (mapping) => mapping.outcome === 'approved_substitution' || mapping.outcome === 'normalized_match',
  );
  const measurements = snapshot.entities.evidence.filter((evidence) => evidence.kind === 'measurement');
  const annotatedEvidence = snapshot.entities.evidence.filter(
    (evidence) => evidence.kind === 'snippet' || evidence.region !== undefined,
  );

  const sections = [
    section(
      '1. Project Summary',
      table(
        ['Field', 'Value'],
        [
          ['Project', snapshot.project.name],
          ['Customer', snapshot.project.customerName ?? ''],
          ['Address', snapshot.project.projectAddress ?? ''],
          ['Project ID', snapshot.project.id],
          ['Bid Job ID', snapshot.bidJob.id],
          ['Snapshot ID', snapshot.snapshotId],
          ['Snapshot schema', snapshot.schemaVersion],
          ['Generated at', snapshot.createdAt],
          ['Generated by', snapshot.createdBy],
        ],
      ),
      false,
    ),
    section(
      '2. Workflow / QA Status',
      `<p class="status ${snapshot.qaResult.safeToSend ? 'safe' : 'unsafe'}">${html(qaStatus)}</p>${table(
        ['Workflow state', 'QA result', 'Executed at', 'Calculation version'],
        [[snapshot.bidJob.state, snapshot.qaResult.id, snapshot.qaResult.executedAt, snapshot.qaResult.calculationVersion]],
      )}${list(snapshot.warnings)}`,
    ),
    section(
      '3. Verified Unit Mix',
      table(
        ['Unit type', 'Extracted', 'Verified', 'Status', 'Approved by', 'Evidence'],
        snapshot.entities.unitMixEntries.map((entry) => [
          unitTypeById.get(entry.unitTypeId)?.code ?? entry.unitTypeId,
          entry.extractedCount,
          entry.verifiedCount ?? '',
          entry.status,
          entry.approvedBy ?? '',
          entry.evidenceIds.join(', '),
        ]),
      ),
    ),
    section(
      '4. Per-Unit Cabinet Takeoffs',
      table(
        ['Unit type', 'Room', 'Category', 'Code', 'Qty / unit', 'Status', 'Evidence'],
        snapshot.entities.takeoffLines.map((line) => {
          const cabinet = cabinetById.get(line.cabinetInstanceId);
          return [
            unitTypeById.get(line.unitTypeId)?.code ?? line.unitTypeId,
            cabinet?.room ?? '',
            cabinet?.category ?? '',
            cabinet?.interpretedCode ?? '',
            line.quantityPerUnit,
            line.status,
            line.evidenceIds.join(', '),
          ];
        }),
      ),
    ),
    section(
      '5. Project Quantity Summary',
      `${table(
        ['Line', 'Category', 'Description', 'Project quantity', 'Extended cost'],
        snapshot.entities.estimateLines.map((line) => [
          line.id,
          line.category,
          line.description,
          line.projectQuantity,
          money(line.extendedCostCents, line.currency),
        ]),
      )}<p class="total">Grand total: ${html(money(snapshot.totals.grandTotalCents, snapshot.totals.currency))}</p>`,
    ),
    section(
      '6. SKU & Pricing Schedule',
      table(
        ['Estimate line', 'SKU', 'Description', 'Qty', 'Unit cost', 'Extended', 'Workbook source'],
        snapshot.entities.estimateLines.map((line) => {
          const mapping = line.mappingId ? mappingById.get(line.mappingId) : undefined;
          const sku = mapping?.catalogSkuId ? skuById.get(mapping.catalogSkuId) : undefined;
          return [
            line.id,
            sku?.sku ?? 'UNRESOLVED',
            line.description,
            line.projectQuantity,
            money(line.unitCostCents, line.currency),
            money(line.extendedCostCents, line.currency),
            sku ? `${sku.sourceWorkbook} / ${sku.sourceWorksheet} / row ${sku.sourceRow}` : '',
          ];
        }),
      ),
    ),
    section('7. Assumptions and Exceptions', `<h3>Assumptions</h3>${list(snapshot.assumptions)}<h3>Warnings</h3>${list(snapshot.warnings)}`),
    section(
      '8. Measurement Log',
      table(
        ['Evidence', 'Sheet', 'Page', 'Text', 'Region'],
        measurements.map((evidence) => {
          const sheet = sheetById.get(evidence.planSheetId);
          return [
            evidence.id,
            sheet?.sheetNumber ?? sheet?.id ?? '',
            sheet?.pageNumber ?? '',
            evidence.text ?? '',
            evidence.region ? JSON.stringify(evidence.region) : '',
          ];
        }),
      ),
    ),
    section(
      '9. Annotated Plan Evidence',
      table(
        ['Evidence', 'Kind', 'Document', 'Sheet', 'Page', 'Coordinates', 'Text'],
        annotatedEvidence.map((evidence) => {
          const sheet = sheetById.get(evidence.planSheetId);
          const document = sheet ? documentById.get(sheet.sourceDocumentId) : undefined;
          return [
            evidence.id,
            evidence.kind,
            document?.originalPath ?? document?.fileName ?? '',
            sheet?.sheetNumber ?? '',
            sheet?.pageNumber ?? '',
            evidence.region ? JSON.stringify(evidence.region) : '',
            evidence.text ?? '',
          ];
        }),
      ),
    ),
    section(
      '10. Unresolved or Overridden Items',
      `<h3>Open QA items</h3>${table(
        ['Code', 'Severity', 'Entity', 'Message', 'Evidence'],
        unresolved.map((issue) => [
          issue.code,
          issue.severity,
          `${issue.entityType ?? ''}:${issue.entityId ?? ''}`,
          issue.message,
          issue.evidenceIds.join(', '),
        ]),
      )}<h3>Normalized mappings and substitutions</h3>${table(
        ['Mapping', 'Outcome', 'Takeoff', 'Approved by', 'Resolution'],
        overrides.map((mapping) => [
          mapping.id,
          mapping.outcome,
          mapping.takeoffLineId,
          mapping.approvedBy ?? '',
          mapping.resolutionNote ?? '',
        ]),
      )}`,
    ),
    section(
      '11. Reviewer / Approval Information',
      table(
        ['Approval', 'Type', 'Target', 'Decision', 'Actor', 'Time', 'Note'],
        snapshot.approvals.map((approval) => [
          approval.id,
          approval.type,
          `${approval.targetType}:${approval.targetId}`,
          approval.decision,
          approval.actorId,
          approval.occurredAt,
          approval.note ?? '',
        ]),
      ),
    ),
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="generator" content="${REVIEW_DOCUMENT_TEMPLATE_VERSION}">
<title>${html(snapshot.project.name)} — Internal Cabinet Review</title>
<style>
@page { size: Letter; margin: 0.55in; }
* { box-sizing: border-box; }
body { color: #172033; font: 10pt/1.35 Arial, sans-serif; margin: 0; }
body::before { content: "INTERNAL REVIEW — NOT CUSTOMER BID"; display: block; color: #9f1239; font-size: 15pt; font-weight: 700; margin-bottom: 16px; text-align: center; }
h1 { font-size: 20pt; margin: 0 0 6px; }
h2 { border-bottom: 2px solid #334155; font-size: 14pt; margin: 0 0 12px; padding-bottom: 4px; }
h3 { font-size: 11pt; margin: 14px 0 6px; }
p.meta { color: #475569; margin: 0 0 16px; }
.page-break { break-before: page; page-break-before: always; }
table { border-collapse: collapse; font-size: 8.5pt; table-layout: fixed; width: 100%; }
th, td { border: 1px solid #cbd5e1; overflow-wrap: anywhere; padding: 5px; text-align: left; vertical-align: top; }
th { background: #e2e8f0; }
tr { break-inside: avoid; page-break-inside: avoid; }
.status { border: 2px solid; font-size: 12pt; font-weight: 700; padding: 8px; }
.safe { border-color: #15803d; color: #166534; }
.unsafe { border-color: #be123c; color: #9f1239; }
.total { font-size: 12pt; font-weight: 700; text-align: right; }
.empty { color: #64748b; font-style: italic; }
</style>
</head>
<body>
<h1>${html(snapshot.project.name)}</h1>
<p class="meta">Internal cabinet review package · ${html(snapshot.snapshotId)} · ${html(snapshot.createdAt)}</p>
${sections.join('\n')}
</body>
</html>\n`;
}
