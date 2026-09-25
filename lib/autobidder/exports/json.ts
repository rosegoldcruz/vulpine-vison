import 'server-only';

import type { CabinetExportSnapshotV1 } from './contracts';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function stableJsonStringify(value: unknown, space = 2): string {
  return JSON.stringify(canonicalize(value), null, space);
}

export function serializeExportJson(snapshot: CabinetExportSnapshotV1): Buffer {
  return Buffer.from(`${stableJsonStringify(snapshot)}\n`, 'utf8');
}
