import 'server-only';

import type {
  ProviderConnectivityInput,
  ProviderConnectivityState,
} from './contracts';

/**
 * Produces an honest provider state without exposing configuration values.
 * "Configured" is never treated as proof that a provider is reachable.
 */
export function evaluateProviderConnectivity(input: ProviderConnectivityInput): ProviderConnectivityState {
  const configured = new Set(input.configuredConfiguration);
  const missingConfiguration = input.requiredConfiguration.filter((name) => !configured.has(name));
  const base = {
    providerId: input.providerId,
    displayName: input.displayName,
    capabilities: [...input.capabilities],
    missingConfiguration,
    fallbackProviderId: input.fallbackProviderId,
  };

  if (missingConfiguration.length) {
    return {
      ...base,
      status: 'DISCONNECTED',
      connected: false,
      detail: `Missing required configuration: ${missingConfiguration.join(', ')}.`,
    };
  }

  if (!input.probe) {
    return {
      ...base,
      status: 'CONFIGURED_UNVERIFIED',
      connected: false,
      detail: 'Required configuration is present, but no successful runtime connectivity probe has been recorded.',
    };
  }

  if (input.probe.ok) {
    return {
      ...base,
      status: 'AVAILABLE',
      connected: true,
      checkedAt: input.probe.checkedAt,
      latencyMs: input.probe.latencyMs,
      detail: input.probe.detail || 'Provider connectivity was verified successfully.',
    };
  }

  const degraded = Boolean(input.fallbackProviderId);
  return {
    ...base,
    status: degraded ? 'DEGRADED' : 'UNAVAILABLE',
    connected: false,
    checkedAt: input.probe.checkedAt,
    latencyMs: input.probe.latencyMs,
    errorCode: input.probe.errorCode,
    detail:
      input.probe.detail ||
      (degraded
        ? `Primary provider probe failed; configured fallback is ${input.fallbackProviderId}.`
        : 'Provider connectivity probe failed and no fallback is configured.'),
  };
}

export function configuredNames(configuration: Record<string, string | undefined>): string[] {
  return Object.entries(configuration)
    .filter(([, value]) => Boolean(value?.trim()))
    .map(([name]) => name);
}
