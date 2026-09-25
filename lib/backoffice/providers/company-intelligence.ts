import { connectionState, type ProviderConnectionState, type ProviderObservation } from './connection';

export interface CompanyIntelligenceProviderConfig {
  provider?: string | null;
  apiKey?: string | null;
}

export function companyIntelligenceProviderState(
  config: CompanyIntelligenceProviderConfig,
  observation?: ProviderObservation,
): ProviderConnectionState {
  const missing = [
    ...(!config.provider?.trim() ? ['provider'] : []),
    ...(!config.apiKey?.trim() ? ['apiKey'] : []),
  ];
  return connectionState({
    capability: 'company_intelligence',
    provider: config.provider,
    configured: missing.length === 0,
    missingSettings: missing,
    observation,
  });
}
