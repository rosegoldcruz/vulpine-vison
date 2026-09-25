import 'server-only';

import type { ClassifiedPage } from '@/types';
import type { CabinetCategory, NormalizedRegion, UnitType } from '@/types/canonical';

const CLASSIFICATIONS = new Set<ClassifiedPage['classification']>([
  'COVER', 'INDEX', 'GENERAL', 'UNIT_MATRIX', 'FLOOR_PLAN', 'UNIT_PLAN', 'INTERIOR_ELEVATION',
  'KITCHEN_ELEVATION', 'BATH_ELEVATION', 'FINISH_SCHEDULE', 'CASEWORK_SCHEDULE',
  'APPLIANCE_SCHEDULE', 'ACCESSIBILITY', 'DETAIL', 'IRRELEVANT', 'UNKNOWN',
]);
const CATEGORIES = new Set<CabinetCategory>([
  'base', 'sink_base', 'drawer_base', 'wall', 'refrigerator_wall', 'microwave_wall', 'tall_pantry',
  'vanity', 'ada', 'filler', 'finished_panel', 'toe_kick', 'molding', 'accessory',
]);
const ACCESSIBILITY = new Set<UnitType['accessibility']>(['standard', 'ada', 'type_a', 'unknown']);

export interface VisionUnitCandidate {
  code: string;
  name: string;
  accessibility: UnitType['accessibility'];
  aliases: string[];
  projectCount?: number;
  discrepancy?: string;
  region: NormalizedRegion;
  confidence: number;
  evidence: string;
}

export interface VisionCabinetCandidate {
  unitCode: string;
  view?: string;
  room: string;
  category: CabinetCategory;
  interpretedCode?: string;
  widthInches?: number;
  heightInches?: number;
  depthInches?: number;
  configuration?: string;
  adjacentAppliances: string[];
  fillers: string[];
  panels: string[];
  exposedEnds: string[];
  quantityPerUnit: number;
  ada: boolean;
  region: NormalizedRegion;
  confidence: number;
  planNote?: string;
  unresolvedAmbiguity?: string;
  evidence: string;
}

export interface CabinetVisionAnalysis {
  classification: ClassifiedPage['classification'];
  classificationConfidence: number;
  classificationEvidence: string;
  unitTypes: VisionUnitCandidate[];
  cabinets: VisionCabinetCandidate[];
  provider: string;
  model: string;
  mode: 'image_provider' | 'deterministic_text_fallback';
}

function finiteNumber(value: unknown, minimum: number, maximum: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw Object.assign(new Error(`${field} must be between ${minimum} and ${maximum}.`), { code: 'VISION_SCHEMA_INVALID', status: 502 });
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error(`${field} is required.`), { code: 'VISION_SCHEMA_INVALID', status: 502 });
  return value.trim();
}

function region(value: unknown, field: string): NormalizedRegion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error(`${field} is required.`), { code: 'VISION_SCHEMA_INVALID', status: 502 });
  const item = value as Record<string, unknown>;
  const parsed = {
    x: finiteNumber(item.x, 0, 1, `${field}.x`), y: finiteNumber(item.y, 0, 1, `${field}.y`),
    width: finiteNumber(item.width, 0, 1, `${field}.width`), height: finiteNumber(item.height, 0, 1, `${field}.height`),
  };
  if (parsed.x + parsed.width > 1.000001 || parsed.y + parsed.height > 1.000001) {
    throw Object.assign(new Error(`${field} must remain inside the page.`), { code: 'VISION_SCHEMA_INVALID', status: 502 });
  }
  return parsed;
}

function optionalPositive(value: unknown, field: string): number | undefined {
  if (value == null) return undefined;
  return finiteNumber(value, 0, 10_000, field);
}

function stringArray(value: unknown, field: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw Object.assign(new Error(`${field} must be an array of strings.`), { code: 'VISION_SCHEMA_INVALID', status: 502 });
  return value.map((item) => item.trim()).filter(Boolean);
}

export function validateVisionAnalysis(payload: unknown, provider: string, model: string): CabinetVisionAnalysis {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Object.assign(new Error('Vision provider returned a non-object response.'), { code: 'VISION_SCHEMA_INVALID', status: 502 });
  const source = payload as Record<string, unknown>;
  const classification = requiredString(source.classification, 'classification').toUpperCase() as ClassifiedPage['classification'];
  if (!CLASSIFICATIONS.has(classification)) throw Object.assign(new Error('Vision classification is unsupported.'), { code: 'VISION_SCHEMA_INVALID', status: 502 });
  const rawUnits = source.unitTypes == null ? [] : source.unitTypes;
  const rawCabinets = source.cabinets == null ? [] : source.cabinets;
  if (!Array.isArray(rawUnits) || !Array.isArray(rawCabinets)) throw Object.assign(new Error('unitTypes and cabinets must be arrays.'), { code: 'VISION_SCHEMA_INVALID', status: 502 });
  const unitTypes = rawUnits.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Object.assign(new Error(`unitTypes[${index}] is invalid.`), { code: 'VISION_SCHEMA_INVALID', status: 502 });
    const item = raw as Record<string, unknown>;
    const accessibility = (typeof item.accessibility === 'string' ? item.accessibility.toLowerCase() : 'unknown') as UnitType['accessibility'];
    if (!ACCESSIBILITY.has(accessibility)) throw Object.assign(new Error(`unitTypes[${index}].accessibility is invalid.`), { code: 'VISION_SCHEMA_INVALID', status: 502 });
    const projectCount = item.projectCount == null ? undefined : finiteNumber(item.projectCount, 0, Number.MAX_SAFE_INTEGER, `unitTypes[${index}].projectCount`);
    if (projectCount !== undefined && !Number.isSafeInteger(projectCount)) throw Object.assign(new Error(`unitTypes[${index}].projectCount must be an integer.`), { code: 'VISION_SCHEMA_INVALID', status: 502 });
    return {
      code: requiredString(item.code, `unitTypes[${index}].code`), name: requiredString(item.name, `unitTypes[${index}].name`), accessibility,
      aliases: Array.isArray(item.aliases) ? item.aliases.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim()) : [],
      projectCount, discrepancy: typeof item.discrepancy === 'string' && item.discrepancy.trim() ? item.discrepancy.trim() : undefined,
      region: region(item.region, `unitTypes[${index}].region`), confidence: finiteNumber(item.confidence, 0, 1, `unitTypes[${index}].confidence`),
      evidence: requiredString(item.evidence, `unitTypes[${index}].evidence`),
    };
  });
  const cabinets = rawCabinets.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Object.assign(new Error(`cabinets[${index}] is invalid.`), { code: 'VISION_SCHEMA_INVALID', status: 502 });
    const item = raw as Record<string, unknown>;
    const category = requiredString(item.category, `cabinets[${index}].category`).toLowerCase() as CabinetCategory;
    if (!CATEGORIES.has(category)) throw Object.assign(new Error(`cabinets[${index}].category is invalid.`), { code: 'VISION_SCHEMA_INVALID', status: 502 });
    const quantity = finiteNumber(item.quantityPerUnit, 1, Number.MAX_SAFE_INTEGER, `cabinets[${index}].quantityPerUnit`);
    if (!Number.isSafeInteger(quantity)) throw Object.assign(new Error(`cabinets[${index}].quantityPerUnit must be an integer.`), { code: 'VISION_SCHEMA_INVALID', status: 502 });
    return {
      unitCode: requiredString(item.unitCode, `cabinets[${index}].unitCode`), room: requiredString(item.room, `cabinets[${index}].room`), category,
      view: typeof item.view === 'string' && item.view.trim() ? item.view.trim() : undefined,
      interpretedCode: typeof item.interpretedCode === 'string' && item.interpretedCode.trim() ? item.interpretedCode.trim() : undefined,
      widthInches: optionalPositive(item.widthInches, `cabinets[${index}].widthInches`), heightInches: optionalPositive(item.heightInches, `cabinets[${index}].heightInches`), depthInches: optionalPositive(item.depthInches, `cabinets[${index}].depthInches`),
      configuration: typeof item.configuration === 'string' && item.configuration.trim() ? item.configuration.trim() : undefined,
      adjacentAppliances: stringArray(item.adjacentAppliances, `cabinets[${index}].adjacentAppliances`),
      fillers: stringArray(item.fillers, `cabinets[${index}].fillers`), panels: stringArray(item.panels, `cabinets[${index}].panels`),
      exposedEnds: stringArray(item.exposedEnds, `cabinets[${index}].exposedEnds`),
      quantityPerUnit: quantity, ada: item.ada === true,
      region: region(item.region, `cabinets[${index}].region`), confidence: finiteNumber(item.confidence, 0, 1, `cabinets[${index}].confidence`),
      planNote: typeof item.planNote === 'string' && item.planNote.trim() ? item.planNote.trim() : undefined,
      unresolvedAmbiguity: typeof item.unresolvedAmbiguity === 'string' && item.unresolvedAmbiguity.trim() ? item.unresolvedAmbiguity.trim() : undefined,
      evidence: requiredString(item.evidence, `cabinets[${index}].evidence`),
    };
  });
  return {
    classification, classificationConfidence: finiteNumber(source.classificationConfidence, 0, 1, 'classificationConfidence'),
    classificationEvidence: requiredString(source.classificationEvidence, 'classificationEvidence'), unitTypes, cabinets,
    provider, model, mode: 'image_provider',
  };
}

export function visionProviderState() {
  const provider = process.env.CABINET_VISION_PROVIDER?.trim() || null;
  const endpoint = process.env.CABINET_VISION_ENDPOINT?.trim() || null;
  const apiKey = process.env.CABINET_VISION_API_KEY?.trim() || null;
  const model = process.env.CABINET_VISION_MODEL?.trim() || null;
  const configured = Boolean(provider && endpoint && apiKey && model);
  return { provider, model, status: configured ? 'configured' as const : 'not_configured' as const,
    message: configured ? 'Image analysis provider is configured; runtime observations determine connectivity.' : 'No image-analysis provider is configured. Image-only pages remain review-required.' };
}

export async function analyzeCabinetPlanImage(input: {
  image: Buffer;
  mimeType: string;
  fallback: { classification: ClassifiedPage['classification']; confidence: number; reason: string };
  sourceFile: string;
  pageNumber: number;
}): Promise<CabinetVisionAnalysis> {
  const state = visionProviderState();
  if (state.status !== 'configured') return {
    classification: input.fallback.classification, classificationConfidence: input.fallback.confidence,
    classificationEvidence: input.fallback.reason, unitTypes: [], cabinets: [], provider: 'deterministic-pdf-text', model: 'v1', mode: 'deterministic_text_fallback',
  };
  let endpoint: URL;
  try { endpoint = new URL(process.env.CABINET_VISION_ENDPOINT!); } catch { throw Object.assign(new Error('Cabinet Vision endpoint is invalid.'), { code: 'VISION_CONFIG_INVALID', status: 500 }); }
  if (endpoint.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && endpoint.protocol === 'http:')) {
    throw Object.assign(new Error('Cabinet Vision endpoint must use HTTPS.'), { code: 'VISION_CONFIG_INVALID', status: 500 });
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST', signal: AbortSignal.timeout(45_000),
      headers: { authorization: `Bearer ${process.env.CABINET_VISION_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.CABINET_VISION_MODEL, task: 'cabinet_plan_analysis', sourceFile: input.sourceFile, pageNumber: input.pageNumber,
        image: { mimeType: input.mimeType, base64: input.image.toString('base64') },
        constraints: { normalizedRegions: true, doNotInferUnsupportedDimensions: true, uncertainMustBeFlagged: true },
        outputSchema: {
          classification: 'supported classification enum', classificationConfidence: '0..1', classificationEvidence: 'source-grounded explanation',
          unitTypes: [{ code: 'string', name: 'string', accessibility: 'standard|ada|type_a|unknown', aliases: ['string'], projectCount: 'optional integer', discrepancy: 'optional string', region: 'normalized rectangle', confidence: '0..1', evidence: 'visible source evidence' }],
          cabinets: [{ unitCode: 'string', view: 'optional elevation/view', room: 'string', category: 'cabinet category enum', interpretedCode: 'optional visible mark', widthInches: 'optional visible number', heightInches: 'optional visible number', depthInches: 'optional visible number', configuration: 'optional string', adjacentAppliances: ['string'], fillers: ['string'], panels: ['string'], exposedEnds: ['string'], quantityPerUnit: 'positive integer', ada: 'boolean', region: 'normalized rectangle', confidence: '0..1', planNote: 'optional visible note', unresolvedAmbiguity: 'optional string', evidence: 'visible source evidence' }],
        },
      }),
    });
  } catch (error) {
    throw Object.assign(new Error(error instanceof Error ? `Cabinet Vision provider unavailable: ${error.message}` : 'Cabinet Vision provider unavailable.'), { code: 'PROVIDER_TEMPORARILY_UNAVAILABLE', status: 503 });
  }
  if (!response.ok) throw Object.assign(new Error(`Cabinet Vision provider returned HTTP ${response.status}.`), { code: response.status >= 500 ? 'PROVIDER_TEMPORARILY_UNAVAILABLE' : 'VISION_PROVIDER_REJECTED', status: response.status >= 500 ? 503 : 502 });
  return validateVisionAnalysis(await response.json(), state.provider!, state.model!);
}
