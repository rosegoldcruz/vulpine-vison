import 'server-only';

import type { ExecutionStatus } from '@/types/canonical';

export type ExecutionControlAction = 'pause' | 'resume' | 'cancel' | 'retry';

export interface ExecutionControlTransition {
  action: ExecutionControlAction;
  from: ExecutionStatus;
  to: ExecutionStatus;
  changed: boolean;
}

export class InvalidExecutionControlTransition extends Error {
  constructor(status: ExecutionStatus, action: ExecutionControlAction) {
    super(`Cannot ${action} an execution in status ${status}.`);
    this.name = 'InvalidExecutionControlTransition';
  }
}

export const ACTIVE_EXECUTION_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  'validating',
  'uploading',
  'rasterizing',
  'classifying',
  'extracting',
  'mapping',
  'qa_checking',
]);

function result(
  action: ExecutionControlAction,
  from: ExecutionStatus,
  to: ExecutionStatus,
): ExecutionControlTransition {
  return { action, from, to, changed: from !== to };
}

export function requestExecutionControl(
  status: ExecutionStatus,
  action: ExecutionControlAction,
): ExecutionControlTransition {
  if (action === 'pause') {
    if (status === 'pause_requested' || status === 'paused') return result(action, status, status);
    if (ACTIVE_EXECUTION_STATUSES.has(status)) return result(action, status, 'pause_requested');
    if (status === 'waiting' || status === 'retry_wait') return result(action, status, 'paused');
  }

  if (action === 'resume' && status === 'paused') {
    return result(action, status, 'waiting');
  }

  if (action === 'cancel') {
    if (status === 'cancel_requested' || status === 'canceled') return result(action, status, status);
    if (ACTIVE_EXECUTION_STATUSES.has(status) || status === 'pause_requested') {
      return result(action, status, 'cancel_requested');
    }
    if (status === 'waiting' || status === 'retry_wait' || status === 'paused' || status === 'stalled') {
      return result(action, status, 'canceled');
    }
  }

  if (action === 'retry' && (status === 'failed' || status === 'stalled' || status === 'retry_wait')) {
    return result(action, status, 'waiting');
  }

  throw new InvalidExecutionControlTransition(status, action);
}

export function acknowledgeExecutionControl(status: ExecutionStatus): ExecutionStatus {
  if (status === 'pause_requested') return 'paused';
  if (status === 'cancel_requested') return 'canceled';
  throw new Error(`Execution status ${status} has no control request to acknowledge.`);
}

