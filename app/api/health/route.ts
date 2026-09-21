export const runtime = 'nodejs';

export async function GET() {
  return Response.json({
    status: 'ok',
    service: 'vision',
    quarantine: {
      safeToSend: false,
      estimatorCompletion: false,
      unitMixApproval: false,
      takeoff: false,
      skuMapping: false,
      pricing: false,
      export: false,
    },
  });
}
