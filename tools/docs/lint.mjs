import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { repositoryFiles } from './check.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const files = repositoryFiles(root, process.argv.includes('--include-untracked')).filter((file) => /\.md$/i.test(file));
const cli = fileURLToPath(new URL('./node_modules/markdownlint-cli2/markdownlint-cli2-bin.mjs', import.meta.url));
const result = spawnSync(process.execPath, [cli, '--config', '.markdownlint-cli2.jsonc', ...files], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
