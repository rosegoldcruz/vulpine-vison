import { connectionState, type ProviderConnectionState, type ProviderObservation } from './connection';

export interface MapsProviderConfig {
  provider?: string | null;
  apiKey?: string | null;
}

export function mapsProviderState(
  config: MapsProviderConfig,
  observation?: ProviderObservation,
): ProviderConnectionState {
  const missing = [
    ...(!config.provider?.trim() ? ['provider'] : []),
    ...(!config.apiKey?.trim() ? ['apiKey'] : []),
  ];
  return connectionState({
    capability: 'maps',
    provider: config.provider,
    configured: missing.length === 0,
    missingSettings: missing,
    observation,
  });
}
