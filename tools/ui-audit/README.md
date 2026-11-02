# Interface Checks

Run from the repository root using the frontend's installed dependencies.

| Tool | Purpose | Prerequisite |
|---|---|---|
| `static-scan.mjs` | Visual-system inventory | Source files |
| `contrast-scan.mjs` | Palette contrast | Design tokens |
| `a11y-static.mjs` | Accessible-name and keyboard checks | Source files |
| `class-audit.mjs` | Classes without emitted CSS | Production build |
| `live-scan.mjs` | Routes, viewports and fixture datasets | Running frontend, Playwright browser |
| `focus-scan.mjs` | Reached focus indicators | Running frontend, Playwright browser |
| `lcp-probe.mjs` | Repeated page-load measurements | Running frontend, Playwright browser |
| `mock-api.mjs` | Deterministic browser fixtures | Imported by browser tools |

```powershell
node tools/ui-audit/contrast-scan.mjs
node tools/ui-audit/a11y-static.mjs
$env:NEXT_DIST_DIR = '.next-verify' # match the inspected build
node tools/ui-audit/class-audit.mjs
```

Target an owned test server. Inspect each browser tool's options before running. Keep output
in ignored `test-results/` or outside the checkout. Record revision, environment, command and
reached scenarios. Static and fixture-based checks do not establish complete accessibility
conformance or real-service correctness.

For an isolated preview with the system Edge browser:

```powershell
node tools/ui-audit/focus-scan.mjs --base http://127.0.0.1:23000 --channel msedge
```

Focus contrast is a project check. [WCAG 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
concerns obscured controls; [2.4.13](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)
separately assesses indicator area and change of contrast. The script does not establish
either criterion completely.

Use [documentation checks](../docs/README.md) for links. See the
[design system](../../docs/design-system.md) and [test guide](../../docs/testing.md).
