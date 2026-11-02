# Documentation Checks

Run from this directory with Node.js 22 or newer:

```powershell
npm ci --ignore-scripts
npm test
npm run check
```

Checks read the Git file list, so ignored files cannot satisfy published links. Stage new
documents before the final run. During editing, both commands accept `--include-untracked`:

```powershell
node check.mjs --include-untracked
node lint.mjs --include-untracked
```

The Markdown parser checks inline/reference links, images, HTML links, same-page anchors,
duplicate GitHub heading slugs and exact path case. Code examples are excluded from link
extraction. External URLs are not fetched; verify essential references separately.
Markdownlint uses the repository configuration.

The pinned overrides keep the lint regex/math parsers on patched, supported releases.
Run `npm audit --audit-level=high` when changing this toolchain.

Update the relevant [guide](../../docs/index.md) with behaviour/configuration changes. Keep
generated reports and personal working notes outside published documentation.
