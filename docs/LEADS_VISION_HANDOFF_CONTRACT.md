# LEADS_VISION_HANDOFF_CONTRACT

## Purpose
Versioned contract for creating bid projects in Vision from the Leads product.

## Endpoint
- Method: `POST`
- Path: `/api/integrations/leads/handoff`
- Auth header: `x-integration-key: <LEADS_INTEGRATION_KEY>`

## Request Body (v1)
```json
{
  "projectName": "Oak Ridge Apartments - Bid Package",
  "sourceSystem": "vulpine-leads",
  "leadId": "lead_01J6ABCDEF",
  "accountName": "Oak Ridge Development",
  "contactName": "Pat Buyer",
  "contactEmail": "pat@example.com",
  "contactPhone": "+1-303-555-0101",
  "opportunityName": "Oak Ridge Phase 2",
  "notes": "Urgent project, plans expected by Friday.",
  "attachmentRefs": [
    "drive://opportunities/oak-ridge/plan-set-v3.zip",
    "drive://opportunities/oak-ridge/pricing-workbook.xlsx"
  ],
  "correlationId": "corr_01J6XYZ"
}
```

## Success Response
```json
{
  "ok": true,
  "data": {
    "project": {
      "projectId": "...",
      "projectName": "...",
      "leadHandoff": {
        "correlationId": "...",
        "sourceSystem": "vulpine-leads",
        "leadId": "...",
        "createdAt": "..."
      }
    },
    "handoff": {
      "projectId": "...",
      "correlationId": "...",
      "nextAction": "Upload bid files via POST /api/uploads with x-project-id header."
    }
  }
}
```

## Error Codes
- `INTEGRATION_NOT_CONFIGURED` (503)
- `UNAUTHORIZED` (401)
- `VALIDATION_ERROR` (400)
- `INTERNAL_ERROR` (500)

## Notes
- This endpoint only creates a project shell with lead context.
- It does not process files or advance estimator states.
- Existing Phase Zero quarantine constraints remain unchanged.
