export type ProviderConnectionStatus =
  | 'not_configured'
  | 'configured_unverified'
  | 'connected'
  | 'degraded'
  | 'error';

export interface ProviderConnectionState {
  capability: 'email' | 'company_intelligence' | 'maps';
  provider: string | null;
  status: ProviderConnectionStatus;
  configured: boolean;
  checkedAt: string | null;
  message: string;
}

export class ProviderNotConfiguredError extends Error {
  readonly code = 'PROVIDER_NOT_CONFIGURED';
  readonly status = 503;

  constructor(
    readonly capability: ProviderConnectionState['capability'],
    readonly provider: string | null,
  ) {
    super(`${capability} provider is not configured.`);
    this.name = 'ProviderNotConfiguredError';
  }
}

export type ProviderObservation =
  | { outcome: 'connected'; checkedAt: string; message?: string }
  | { outcome: 'degraded'; checkedAt: string; message: string }
  | { outcome: 'error'; checkedAt: string; message: string };

export function connectionState(input: {
  capability: ProviderConnectionState['capability'];
  provider?: string | null;
  configured: boolean;
  missingSettings?: string[];
  observation?: ProviderObservation;
}): ProviderConnectionState {
  const provider = input.provider?.trim() || null;
  if (!input.configured || !provider) {
    const missing = input.missingSettings?.length ? ` Missing: ${input.missingSettings.join(', ')}.` : '';
    return {
      capability: input.capability,
      provider,
      status: 'not_configured',
      configured: false,
      checkedAt: null,
      message: `No usable ${input.capability} provider configuration is available.${missing}`,
    };
  }
  if (!input.observation) {
    return {
      capability: input.capability,
      provider,
      status: 'configured_unverified',
      configured: true,
      checkedAt: null,
      message: 'Provider settings are present, but no live connection has been verified.',
    };
  }
  return {
    capability: input.capability,
    provider,
    status: input.observation.outcome,
    configured: true,
    checkedAt: input.observation.checkedAt,
    message: input.observation.message || 'Provider connection verified.',
  };
}

export function requireConfigured(state: ProviderConnectionState): void {
  if (!state.configured || state.status === 'not_configured') {
    throw new ProviderNotConfiguredError(state.capability, state.provider);
  }
}
