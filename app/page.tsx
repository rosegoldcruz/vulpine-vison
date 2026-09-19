import { WorkspaceClient } from '@/components/autobidder/workspace-client';

export default function Page() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h1 className="text-xl font-semibold">Vulpine Cabinet AutoBidder</h1>
          <p className="mt-1 text-sm text-slate-400">
            Next.js App Router migration baseline: ingestion, persisted workflow state, and route-handler pipeline.
          </p>
        </header>
        <WorkspaceClient />
      </div>
    </main>
  );
}
