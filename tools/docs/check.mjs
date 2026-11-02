#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import GithubSlugger from 'github-slugger';
import { parseFragment } from 'parse5';

const markdown = new MarkdownIt({ html: true });

export function repositoryFiles(root, includeUntracked = false) {
  const args = ['ls-files', '-z', '--cached'];
  if (includeUntracked) args.push('--others', '--exclude-standard');
  return [...new Set(execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 })
    .toString('utf8').split('\0').filter(Boolean))]
    .filter((file) => fs.existsSync(path.join(root, file)));
}

function descendants(tokens, visit) {
  for (const token of tokens) {
    visit(token);
    if (token.children) descendants(token.children, visit);
  }
}

export function documentInfo(text) {
  const tokens = markdown.parse(text, {});
  const slugger = new GithubSlugger();
  const anchors = new Set();
  const links = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'heading_open') {
      const inline = tokens[i + 1];
      const title = (inline?.children ?? [])
        .filter((token) => ['text', 'code_inline', 'image'].includes(token.type))
        .map((token) => token.content).join('');
      anchors.add(slugger.slug(title));
    }
  }
  descendants(tokens, (token) => {
    const target = token.type === 'link_open' ? token.attrGet('href')
      : token.type === 'image' ? token.attrGet('src') : null;
    if (target !== null) links.push(target);
    if (token.type === 'html_inline' || token.type === 'html_block') {
      const visit = (node) => {
        if (['script', 'style', 'template'].includes(node.tagName)) return;
        for (const attr of node.attrs ?? []) {
          if (attr.name === 'id' || attr.name === 'name') anchors.add(attr.value);
          if (attr.name === 'href' || attr.name === 'src') links.push(attr.value);
        }
        for (const child of node.childNodes ?? []) visit(child);
      };
      visit(parseFragment(token.content));
    }
  });
  return { anchors, links };
}

export function checkFiles(root, files) {
  const tracked = new Set(files.map((file) => file.replaceAll('\\', '/')));
  const directories = new Set(['']);
  for (const file of tracked) {
    let parent = path.posix.dirname(file);
    while (parent !== '.' && !directories.has(parent)) {
      directories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  const docs = files.filter((file) => /\.md$/i.test(file));
  const cache = new Map();
  const read = (file) => {
    if (!cache.has(file)) cache.set(file, documentInfo(fs.readFileSync(path.join(root, file), 'utf8')));
    return cache.get(file);
  };
  const errors = [];
  let checked = 0;
  for (const file of docs) {
    for (const link of read(file).links) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link)) continue;
      checked++;
      const fail = (reason) => errors.push({ file, link, reason });
      let pathname, anchor;
      try {
        const hash = link.indexOf('#');
        const address = hash < 0 ? link : link.slice(0, hash);
        pathname = decodeURIComponent(address.split('?')[0]);
        anchor = hash < 0 ? '' : decodeURIComponent(link.slice(hash + 1));
      } catch {
        fail('invalid percent encoding');
        continue;
      }
      const resolved = pathname ? path.posix.normalize(path.posix.join(path.posix.dirname(file), pathname)) : file;
      const target = resolved.replace(/\/$/, '');
      if (pathname.startsWith('/') || target === '..' || target.startsWith('../')) {
        fail('target is outside the published repository');
      } else if (!tracked.has(target) && !directories.has(target)) {
        fail('target is absent from Git or has different letter case');
      } else if (anchor && /\.md$/i.test(target) && !read(target).anchors.has(anchor)) {
        fail('heading or explicit anchor does not exist');
      }
    }
  }
  return { documents: docs.length, checked, errors };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = checkFiles(root, repositoryFiles(root, process.argv.includes('--include-untracked')));
  console.log(`Documents: ${result.documents}; local links: ${result.checked}; broken: ${result.errors.length}`);
  for (const error of result.errors) console.error(`${error.file}: ${error.link} (${error.reason})`);
  process.exitCode = result.errors.length ? 1 : 0;
}
