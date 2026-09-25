import { connectionState, type ProviderConnectionState, type ProviderObservation } from './connection';

export interface EmailProviderConfig {
  provider?: string | null;
  apiKey?: string | null;
  fromAddress?: string | null;
  apiEndpoint?: string | null;
}

export function emailProviderState(
  config: EmailProviderConfig,
  observation?: ProviderObservation,
): ProviderConnectionState {
  const missing = [
    ...(!config.provider?.trim() ? ['provider'] : []),
    ...(!config.apiKey?.trim() ? ['apiKey'] : []),
    ...(!config.fromAddress?.trim() ? ['fromAddress'] : []),
    ...(!config.apiEndpoint?.trim() ? ['apiEndpoint'] : []),
  ];
  return connectionState({
    capability: 'email',
    provider: config.provider,
    configured: missing.length === 0,
    missingSettings: missing,
    observation,
  });
}
