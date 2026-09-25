import 'server-only';

import {
  connectionState,
  requireConfigured,
  type ProviderConnectionState,
} from './providers/connection';
import { companyIntelligenceProviderState } from './providers/company-intelligence';
import { emailProviderState } from './providers/email';
import { mapsProviderState } from './providers/maps';
import { getDatabase } from '@/lib/autobidder/db/database';
import {
  listProviderSnapshots,
  saveProviderSnapshot,
  type EmailTransport,
} from './service';

function configuredUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.protocol === 'http:') ? url.toString() : null;
  } catch {
    return null;
  }
}

export function emailConnectionState(projectId?: string): ProviderConnectionState {
  const config = {
    provider: process.env.EMAIL_PROVIDER,
    apiKey: process.env.EMAIL_API_KEY,
    fromAddress: process.env.EMAIL_FROM,
    apiEndpoint: configuredUrl(process.env.EMAIL_API_ENDPOINT),
  };
  const sent = projectId ? getDatabase().prepare(`
    SELECT provider, sent_at FROM outreach_activities
    WHERE project_id = ? AND status = 'sent' AND provider = ?
    ORDER BY sent_at DESC LIMIT 1
  `).get(projectId, config.provider || null) as { provider: string; sent_at: string } | undefined : undefined;
  return emailProviderState(config, sent ? { outcome: 'connected', checkedAt: sent.sent_at, message: 'Provider accepted the latest outreach delivery.' } : undefined);
}

export function companyIntelligenceConnectionState(projectId?: string): ProviderConnectionState {
  const latest = projectId ? listProviderSnapshots(projectId, 'company_intelligence')[0] : undefined;
  const observation = latest?.retrievedAt
    ? { outcome: latest.status as 'connected' | 'degraded' | 'error', checkedAt: latest.retrievedAt, message: latest.errorCode || undefined }
    : undefined;
  const base = companyIntelligenceProviderState({
    provider: process.env.COMPANY_INTELLIGENCE_PROVIDER,
    apiKey: process.env.COMPANY_INTELLIGENCE_API_KEY,
  }, observation);
  if (!configuredUrl(process.env.COMPANY_INTELLIGENCE_ENDPOINT)) {
    return connectionState({
      capability: 'company_intelligence', provider: base.provider, configured: false,
      missingSettings: ['endpoint'],
    });
  }
  return base;
}

export function mapsConnectionState(projectId?: string): ProviderConnectionState {
  const latest = projectId ? listProviderSnapshots(projectId, 'maps')[0] : undefined;
  const observation = latest?.retrievedAt
    ? { outcome: latest.status as 'connected' | 'degraded' | 'error', checkedAt: latest.retrievedAt, message: latest.errorCode || undefined }
    : undefined;
  const base = mapsProviderState({ provider: process.env.MAPS_PROVIDER, apiKey: process.env.MAPS_API_KEY }, observation);
  if (!configuredUrl(process.env.MAPS_ROUTE_ENDPOINT)) {
    return connectionState({ capability: 'maps', provider: base.provider, configured: false, missingSettings: ['endpoint'] });
  }
  return base;
}

async function providerJson(endpoint: string, apiKey: string, body: Record<string, unknown>) {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw Object.assign(new Error('The configured provider could not be reached.'), { code: 'PROVIDER_UNAVAILABLE', status: 502 });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`The configured provider returned HTTP ${response.status}.`), { code: 'PROVIDER_REJECTED', status: 502 });
  }
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw Object.assign(new Error('The configured provider returned an invalid response.'), { code: 'PROVIDER_INVALID_RESPONSE', status: 502 });
  }
  return payload as Record<string, unknown>;
}

export function configuredEmailTransport(): EmailTransport {
  const state = emailConnectionState();
  requireConfigured(state);
  const endpoint = configuredUrl(process.env.EMAIL_API_ENDPOINT)!;
  const apiKey = process.env.EMAIL_API_KEY!;
  const from = process.env.EMAIL_FROM!;
  return {
    provider: state.provider!,
    async send(message) {
      const payload = await providerJson(endpoint, apiKey, { from, to: message.recipient, subject: message.subject, text: message.body, attachmentIds: message.attachmentIds });
      const externalId = typeof payload.id === 'string' ? payload.id : typeof payload.messageId === 'string' ? payload.messageId : null;
      if (!externalId) throw Object.assign(new Error('Email provider did not return a delivery identifier.'), { code: 'PROVIDER_INVALID_RESPONSE', status: 502 });
      return { externalId, acceptedAt: new Date().toISOString() };
    },
  };
}

export async function enrichCompany(input: { projectId: string; companyName?: string; domain?: string }, actorId: string) {
  const state = companyIntelligenceConnectionState(input.projectId);
  requireConfigured(state);
  if (!input.companyName?.trim() && !input.domain?.trim()) {
    throw Object.assign(new Error('companyName or domain is required.'), { code: 'VALIDATION_FAILED', status: 400 });
  }
  let payload: Record<string, unknown>;
  try {
    payload = await providerJson(configuredUrl(process.env.COMPANY_INTELLIGENCE_ENDPOINT)!, process.env.COMPANY_INTELLIGENCE_API_KEY!, {
      companyName: input.companyName?.trim() || undefined,
      domain: input.domain?.trim() || undefined,
    });
  } catch (error: any) {
    saveProviderSnapshot({
      projectId: input.projectId, providerType: 'company_intelligence', providerName: state.provider!, status: 'error',
      payload: {}, retrievedAt: new Date().toISOString(), errorCode: error.code || 'PROVIDER_UNAVAILABLE',
    }, actorId);
    throw error;
  }
  return saveProviderSnapshot({
    projectId: input.projectId,
    providerType: 'company_intelligence',
    providerName: state.provider!,
    status: 'connected',
    externalRecordId: typeof payload.id === 'string' ? payload.id : null,
    payload,
    retrievedAt: new Date().toISOString(),
  }, actorId);
}

export async function refreshMapRoute(input: {
  projectId: string;
  originLabel: string;
  destinationLabel: string;
}, actorId: string) {
  const state = mapsConnectionState(input.projectId);
  requireConfigured(state);
  if (!input.originLabel?.trim() || !input.destinationLabel?.trim()) {
    throw Object.assign(new Error('originLabel and destinationLabel are required.'), { code: 'VALIDATION_FAILED', status: 400 });
  }
  let response: Record<string, unknown>;
  try {
    response = await providerJson(configuredUrl(process.env.MAPS_ROUTE_ENDPOINT)!, process.env.MAPS_API_KEY!, {
      origin: input.originLabel.trim(), destination: input.destinationLabel.trim(),
    });
  } catch (error: any) {
    saveProviderSnapshot({
      projectId: input.projectId, providerType: 'maps', providerName: state.provider!, status: 'error', payload: {},
      retrievedAt: new Date().toISOString(), errorCode: error.code || 'PROVIDER_UNAVAILABLE',
    }, actorId);
    throw error;
  }
  const distanceMeters = response.distanceMeters;
  if (typeof distanceMeters !== 'number' || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw Object.assign(new Error('Map provider did not return a valid distanceMeters value.'), { code: 'PROVIDER_INVALID_RESPONSE', status: 502 });
  }
  let estimatedFreight: { amountCents: number; currency: string } | undefined;
  if (response.estimatedFreight != null) {
    const candidate = response.estimatedFreight as Record<string, unknown>;
    if (!Number.isSafeInteger(candidate.amountCents) || Number(candidate.amountCents) < 0
      || typeof candidate.currency !== 'string' || !/^[A-Za-z]{3}$/.test(candidate.currency)) {
      throw Object.assign(new Error('Map provider returned an invalid freight estimate.'), { code: 'PROVIDER_INVALID_RESPONSE', status: 502 });
    }
    estimatedFreight = { amountCents: Number(candidate.amountCents), currency: candidate.currency.toUpperCase() };
  }
  const estimate = {
    provider: state.provider!,
    retrievedAt: new Date().toISOString(),
    originLabel: input.originLabel.trim(),
    destinationLabel: input.destinationLabel.trim(),
    distanceMeters,
    ...(typeof response.durationSeconds === 'number' ? { durationSeconds: response.durationSeconds } : {}),
    ...(estimatedFreight ? { estimatedFreight } : {}),
  };
  return saveProviderSnapshot({
    projectId: input.projectId, providerType: 'maps', providerName: state.provider!, status: 'connected', payload: estimate,
    retrievedAt: estimate.retrievedAt,
  }, actorId);
}
