#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { checkFiles, repositoryFiles } from '../docs/check.mjs';

// Keep the existing entry point while sharing the canonical documentation checker.
const root = fileURLToPath(new URL('../../', import.meta.url));
const result = checkFiles(root, repositoryFiles(root));
console.log(`Documents: ${result.documents}; local links: ${result.checked}; broken: ${result.errors.length}`);
for (const error of result.errors) console.error(`${error.file}: ${error.link} (${error.reason})`);
process.exitCode = result.errors.length ? 1 : 0;
