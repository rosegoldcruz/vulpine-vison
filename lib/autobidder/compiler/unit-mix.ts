import 'server-only';

import type { EntityId, UnitMixEntry, UnitType } from '@/types/canonical';
import { CompilerInvariantError, requireNonNegativeSafeInteger } from './invariants';

export type UnitMixValidationCode =
  | 'DUPLICATE_ENTRY_ID'
  | 'DUPLICATE_UNIT_TYPE'
  | 'UNKNOWN_UNIT_TYPE'
  | 'PROJECT_MISMATCH'
  | 'INVALID_EXTRACTED_COUNT'
  | 'INVALID_VERIFIED_COUNT'
  | 'MISSING_EVIDENCE'
  | 'DISCREPANCY_UNRESOLVED'
  | 'VERIFICATION_INCOMPLETE';

export interface UnitMixValidationIssue {
  code: UnitMixValidationCode;
  entryId: EntityId;
  message: string;
}

export interface UnitMixValidationResult {
  valid: boolean;
  issues: UnitMixValidationIssue[];
}

export interface UnitMixReconciliation {
  extractedTotal: number;
  verifiedTotal?: number;
  expectedTotal?: number;
  expectedTotalMatched?: boolean;
  entriesVerified: number;
  entriesTotal: number;
  canCompile: boolean;
  issues: UnitMixValidationIssue[];
}

function push(
  issues: UnitMixValidationIssue[],
  entry: UnitMixEntry,
  code: UnitMixValidationCode,
  message: string,
) {
  issues.push({ code, entryId: entry.id, message });
}

export function validateUnitMix(
  entries: readonly UnitMixEntry[],
  unitTypes: readonly UnitType[] = [],
): UnitMixValidationResult {
  const issues: UnitMixValidationIssue[] = [];
  const entryIds = new Set<string>();
  const unitTypeIds = new Set<string>();
  const knownUnitTypes = new Map(unitTypes.map((unitType) => [unitType.id, unitType]));

  for (const entry of entries) {
    if (entryIds.has(entry.id)) {
      push(issues, entry, 'DUPLICATE_ENTRY_ID', `Unit mix entry id ${entry.id} occurs more than once.`);
    }
    entryIds.add(entry.id);

    if (unitTypeIds.has(entry.unitTypeId)) {
      push(issues, entry, 'DUPLICATE_UNIT_TYPE', `Unit type ${entry.unitTypeId} has more than one matrix entry.`);
    }
    unitTypeIds.add(entry.unitTypeId);

    const unitType = knownUnitTypes.get(entry.unitTypeId);
    if (unitTypes.length > 0 && !unitType) {
      push(issues, entry, 'UNKNOWN_UNIT_TYPE', `Unit type ${entry.unitTypeId} is not part of the project catalog.`);
    } else if (unitType && unitType.projectId !== entry.projectId) {
      push(issues, entry, 'PROJECT_MISMATCH', 'Unit mix entry and unit type belong to different projects.');
    }

    if (!Number.isSafeInteger(entry.extractedCount) || entry.extractedCount < 0) {
      push(issues, entry, 'INVALID_EXTRACTED_COUNT', 'Extracted count must be a non-negative safe integer.');
    }
    if (entry.verifiedCount !== undefined && (!Number.isSafeInteger(entry.verifiedCount) || entry.verifiedCount < 0)) {
      push(issues, entry, 'INVALID_VERIFIED_COUNT', 'Verified count must be a non-negative safe integer.');
    }
    if (entry.evidenceIds.length === 0) {
      push(issues, entry, 'MISSING_EVIDENCE', 'Unit counts require at least one source evidence reference.');
    }

    const countChanged = entry.verifiedCount !== undefined && entry.verifiedCount !== entry.extractedCount;
    if ((entry.status === 'disputed' || entry.discrepancy || countChanged) && !entry.resolutionNote?.trim()) {
      push(issues, entry, 'DISCREPANCY_UNRESOLVED', 'Count discrepancies require an explicit resolution note.');
    }

    if (
      entry.status !== 'verified' ||
      entry.verifiedCount === undefined ||
      !entry.approvedBy ||
      !entry.approvedAt
    ) {
      push(issues, entry, 'VERIFICATION_INCOMPLETE', 'Unit count has not been completely verified by an estimator.');
    }
  }

  return { valid: issues.length === 0, issues };
}

export function reconcileUnitMix(
  entries: readonly UnitMixEntry[],
  options: { unitTypes?: readonly UnitType[]; expectedTotal?: number } = {},
): UnitMixReconciliation {
  const validation = validateUnitMix(entries, options.unitTypes);
  const extractedTotal = entries.reduce((sum, entry) => sum + entry.extractedCount, 0);
  const allHaveVerifiedCounts = entries.every((entry) => entry.verifiedCount !== undefined);
  const verifiedTotal = allHaveVerifiedCounts
    ? entries.reduce((sum, entry) => sum + (entry.verifiedCount ?? 0), 0)
    : undefined;

  if (options.expectedTotal !== undefined) {
    requireNonNegativeSafeInteger(options.expectedTotal, 'expectedTotal');
  }

  return {
    extractedTotal,
    verifiedTotal,
    expectedTotal: options.expectedTotal,
    expectedTotalMatched:
      options.expectedTotal === undefined || verifiedTotal === undefined
        ? undefined
        : verifiedTotal === options.expectedTotal,
    entriesVerified: entries.filter((entry) => entry.status === 'verified').length,
    entriesTotal: entries.length,
    canCompile:
      entries.length > 0 &&
      validation.valid &&
      (options.expectedTotal === undefined || verifiedTotal === options.expectedTotal),
    issues: validation.issues,
  };
}

export function verifiedUnitCounts(entries: readonly UnitMixEntry[]): ReadonlyMap<EntityId, number> {
  const reconciliation = reconcileUnitMix(entries);
  if (!reconciliation.canCompile) {
    throw new CompilerInvariantError('UNIT_MIX_NOT_VERIFIED', 'Unit mix is not eligible for compilation.', {
      issues: reconciliation.issues,
    });
  }

  return new Map(entries.map((entry) => [entry.unitTypeId, entry.verifiedCount as number]));
}
