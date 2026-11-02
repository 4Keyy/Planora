import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkFiles, documentInfo } from './check.mjs';

test('parses reference links, nested destinations, images and same-page anchors', () => {
  const info = documentInfo('# Start\n[ref][guide]\n![a](<image (1).png>)\n[local](#start)\n\n[guide]: <guide (1).md>\n');
  assert.deepEqual(info.links, ['guide%20(1).md', 'image%20(1).png', '#start']);
  assert.ok(info.anchors.has('start'));
});

test('GitHub slugs include formatting, Unicode and duplicate heading suffixes', () => {
  const info = documentInfo('# A `code` [link](https://example.test)\n# Повтор\n# Повтор\n<a id="explicit"></a>\n');
  assert.deepEqual([...info.anchors], ['a-code-link', 'повтор', 'повтор-1', 'explicit']);
});

test('code examples do not introduce links or anchors', () => {
  const info = documentInfo('```md\n# Fake\n[bad](missing.md)\n```\n`[bad](missing.md)`');
  assert.equal(info.anchors.size, 0);
  assert.deepEqual(info.links, []);
});

test('HTML comments do not create published links or anchors', () => {
  const info = documentInfo('# Home\n<!-- <a id="missing" href="gone.md"></a> -->\n<div>\n<!-- <a id="also-missing" href="gone-again.md"> -->\n</div>');
  assert.deepEqual([...info.anchors], ['home']);
  assert.deepEqual(info.links, []);
});

test('quoted comment-like text does not hide real HTML attributes', () => {
  const info = documentInfo('<a title="<!-- literal -->" id="present" href="real.md">Go</a>');
  assert.ok(info.anchors.has('present'));
  assert.deepEqual(info.links, ['real.md']);
});

test('checks only published paths, case, same-page headings and HTML image sources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planora-docs-'));
  try {
    fs.writeFileSync(path.join(root, 'README.md'), '# Home\n[ok](Guide.md#title)\n[case](guide.md)\n[private](local.md)\n[bad](#gone)\n<img src="image.png">\n');
    fs.writeFileSync(path.join(root, 'Guide.md'), '# Title\n');
    fs.writeFileSync(path.join(root, 'local.md'), '# Private\n');
    fs.writeFileSync(path.join(root, 'image.png'), 'fixture');
    const result = checkFiles(root, ['README.md', 'Guide.md', 'image.png']);
    assert.equal(result.documents, 2);
    assert.deepEqual(result.errors.map((e) => e.link), ['guide.md', 'local.md', '#gone']);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
