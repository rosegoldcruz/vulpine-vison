import { describe, expect, it } from 'vitest';
import {
  ProviderNotConfiguredError,
  companyIntelligenceProviderState,
  emailProviderState,
  mapsProviderState,
  requireConfigured,
  selectFreightGrounding,
} from '@/lib/backoffice';

describe('backoffice provider honesty and logistics precedence', () => {
  it('reports unconfigured providers without implying a live connection', () => {
    const email = emailProviderState({ provider: 'resend', apiKey: '', fromAddress: '' });
    const intelligence = companyIntelligenceProviderState({ provider: 'zoominfo', apiKey: null });
    const maps = mapsProviderState({});
    expect(email).toMatchObject({ capability: 'email', status: 'not_configured', configured: false });
    expect(intelligence).toMatchObject({ capability: 'company_intelligence', status: 'not_configured', configured: false });
    expect(maps).toMatchObject({ capability: 'maps', status: 'not_configured', configured: false, provider: null });
    expect(() => requireConfigured(intelligence)).toThrowError(ProviderNotConfiguredError);
  });

  it('does not call configured credentials connected until a live observation exists', () => {
    const unverified = mapsProviderState({ provider: 'mapbox', apiKey: 'secret' });
    expect(unverified).toMatchObject({ status: 'configured_unverified', configured: true, checkedAt: null });

    const connected = mapsProviderState(
      { provider: 'mapbox', apiKey: 'secret' },
      { outcome: 'connected', checkedAt: '2026-09-25T12:00:00.000Z' },
    );
    expect(connected).toMatchObject({ status: 'connected', configured: true, checkedAt: '2026-09-25T12:00:00.000Z' });
  });

  it('always gives an approved freight quote precedence over a map estimate', () => {
    const result = selectFreightGrounding({
      approvedQuote: {
        id: 'quote-1', status: 'approved', amount: { amountCents: 5_000_00, currency: 'USD' },
        approvedAt: '2026-09-25T10:00:00.000Z', provider: 'Carrier',
      },
      mapEstimate: {
        provider: 'mapbox', retrievedAt: '2026-09-25T11:00:00.000Z', originLabel: 'Plant', destinationLabel: 'Site',
        distanceMeters: 100_000, estimatedFreight: { amountCents: 2_000_00, currency: 'USD' },
      },
    });
    expect(result).toMatchObject({
      source: 'approved_quote', authoritative: true, amount: { amountCents: 5_000_00, currency: 'USD' },
    });
  });

  it('marks map-only freight as non-authoritative and supports unavailable state', () => {
    const mapOnly = selectFreightGrounding({
      mapEstimate: {
        provider: 'maps', retrievedAt: '2026-09-25T11:00:00.000Z', originLabel: 'A', destinationLabel: 'B',
        distanceMeters: 42_000,
      },
    });
    expect(mapOnly).toMatchObject({ source: 'map_estimate', authoritative: false });
    expect(selectFreightGrounding({})).toMatchObject({ source: 'unavailable', authoritative: false });
  });
});
