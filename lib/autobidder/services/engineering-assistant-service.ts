import 'server-only';

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDatabase } from '@/lib/autobidder/db/database';
import { emailProviderState } from '@/lib/backoffice/providers/email';
import { companyIntelligenceProviderState } from '@/lib/backoffice/providers/company-intelligence';
import { mapsProviderState } from '@/lib/backoffice/providers/maps';

const root = process.cwd();
const surfaces = [
  'types/canonical.ts', 'lib/autobidder/services/canonical-bid-service.ts', 'lib/autobidder/services/workflow-service.ts',
  'lib/autobidder/services/job-control-service.ts', 'lib/autobidder/services/export-artifact-service.ts',
  'components/autobidder/workspace-client.tsx', 'lib/backoffice/service.ts',
];

async function exists(relative: string) {
  try { await access(path.join(root, relative)); return true; } catch { return false; }
}

export async function inspectEngineeringRuntime(question: string) {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const files = await Promise.all(surfaces.map(async (relative) => ({ path: relative, present: await exists(relative) })));
  const migrations = getDatabase().prepare('SELECT version, name, applied_at AS appliedAt FROM schema_migrations ORDER BY version').all();
  const tables = (getDatabase().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>).map((row) => row.name);
  const failedRuns = Number((getDatabase().prepare(`SELECT COUNT(*) AS count FROM job_runs WHERE status IN ('failed','stalled')`).get() as { count: number }).count);
  const unresolvedMappings = Number((getDatabase().prepare(`SELECT COUNT(*) AS count FROM sku_mappings WHERE outcome='unresolved'`).get() as { count: number }).count);
  const providers = {
    email: emailProviderState({ provider: process.env.EMAIL_PROVIDER, apiKey: process.env.EMAIL_API_KEY, fromAddress: process.env.EMAIL_FROM }),
    companyIntelligence: companyIntelligenceProviderState({ provider: process.env.COMPANY_INTELLIGENCE_PROVIDER, apiKey: process.env.COMPANY_INTELLIGENCE_API_KEY }),
    maps: mapsProviderState({ provider: process.env.MAPS_PROVIDER, apiKey: process.env.MAPS_API_KEY }),
  };
  return {
    question: question.trim(), inspectedAt: new Date().toISOString(), repositoryRoot: root,
    runtime: { node: process.version, environment: process.env.NODE_ENV || 'development', database: 'SQLite WAL with ordered migrations' },
    packages: { next: packageJson.dependencies?.next, react: packageJson.dependencies?.react, pdfjs: packageJson.dependencies?.['pdfjs-dist'], xlsx: packageJson.dependencies?.xlsx, vitest: packageJson.devDependencies?.vitest },
    architecture: { canonicalSurfaces: files, schemaMigrationCount: migrations.length, migrations, tableCount: tables.length, tables },
    runtimeEvidence: { failedOrStalledRuns: failedRuns, unresolvedMappings },
    providers,
    nextActions: [
      ...(failedRuns ? [`Inspect ${failedRuns} failed or stalled run(s) through persisted diagnostics before changing code.`] : []),
      ...(unresolvedMappings ? [`Resolve ${unresolvedMappings} persisted SKU mapping exception(s) through attributed approvals.`] : []),
      ...Object.entries(providers).filter(([, state]) => state.status !== 'connected').map(([name]) => `${name} remains disconnected; configure and verify its provider before claiming live integration.`),
    ],
    limitations: ['This read-only inspection reports repository, database, dependency, and provider runtime evidence. It does not mutate code, approve bids, or claim an external provider is live without a verified connection.'],
  };
}
