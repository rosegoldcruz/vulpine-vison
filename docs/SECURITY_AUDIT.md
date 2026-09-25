# Dependency security audit

Audit date: 2026-09-25

## Remediation completed

- Upgraded `adm-zip` to 0.6.1, removing crafted-size allocation and symlink-overwrite advisories from the upload path.
- Upgraded `pdfjs-dist` to 6.3.289, removing the reported malicious-PDF JavaScript-execution advisory.
- Ran non-breaking `npm audit fix`, which removed three additional transitive advisories.
- Revalidated ZIP traversal/limits, PDF rasterization, route-level negative cases, all 159 tests, and the production build.

## Residual report

`npm audit --json` reports 8 advisories: 4 moderate, 3 high, and 1 critical.

- The Vitest/Vite/esbuild group is development-only in this repository. npm's available remediation upgrades Vitest from 2.x to 5.x, a breaking major. Do not expose the Vitest UI/server on an untrusted network.
- The Next/PostCSS group requires Next 16 according to npm, a framework-major migration outside a safe patch-level hardening change. The application does not accept or compile user-supplied CSS.
- `xlsx` has two high-severity advisories and npm reports no fixed release. Workbook ingestion is server-side, schema-constrained, size-limited, and rejects corrupt/unsupported files, but replacing the parser should remain a tracked production-security task.

No `--force` upgrade was applied because it would silently cross framework and test-runner major versions without a dedicated migration and compatibility campaign.
