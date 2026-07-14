import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const pluginRequire = createRequire(resolve('plugins/picnexus/package.json'));
const esbuild = pluginRequire('esbuild');
const outputDir = mkdtempSync(join(tmpdir(), 'picnexus-plugin-behavior-'));
const outputPath = join(outputDir, 'markdown.mjs');

await esbuild.build({
  entryPoints: [resolve('plugins/picnexus/src/markdown.ts')],
  bundle: true,
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
  logLevel: 'silent',
});

const markdown = await import(pathToFileURL(outputPath).href);

test.after(() => {
  rmSync(outputDir, { recursive: true, force: true });
});

test('formats external images as escaped Markdown', () => {
  assert.equal(
    markdown.formatMarkdownImage('photo [draft]\\final.png', 'https://cdn.example.com/photo(1).png'),
    '![photo \\[draft\\]\\\\final.png](https://cdn.example.com/photo\\(1\\).png)',
  );
});

test('creates unique placeholders for concurrent uploads', () => {
  const first = markdown.createUploadPlaceholder('image.png', '100-1');
  const second = markdown.createUploadPlaceholder('image.png', '100-2');

  assert.notEqual(first, second);
  assert.match(first, /#picnexus-upload-100-1/);
  assert.match(second, /#picnexus-upload-100-2/);
});

test('finds each batch placeholder at its own range', () => {
  const first = markdown.createUploadPlaceholder('one.png', '200-1');
  const second = markdown.createUploadPlaceholder('two.png', '200-2');
  const content = `before ${first} middle ${second} after`;

  assert.deepEqual(markdown.findPlaceholderRange(content, first), {
    start: 7,
    end: 7 + first.length,
  });
  assert.deepEqual(markdown.findPlaceholderRange(content, second), {
    start: 8 + first.length + 7,
    end: 8 + first.length + 7 + second.length,
  });
  assert.equal(markdown.findPlaceholderRange(content, 'missing'), null);
});

test('keeps batch placeholders isolated while upload results arrive', () => {
  const first = markdown.createUploadPlaceholder('one.png', '300-1');
  const second = markdown.createUploadPlaceholder('two.png', '300-2');
  let content = `before ${first} middle ${second} after`;

  const secondRange = markdown.findPlaceholderRange(content, second);
  assert.ok(secondRange);
  content = `${content.slice(0, secondRange.start)}![two.png](https://cdn.example.com/two.png)${content.slice(secondRange.end)}`;

  const firstRange = markdown.findPlaceholderRange(content, first);
  assert.ok(firstRange);
  content = `${content.slice(0, firstRange.start)}![one.png](https://cdn.example.com/one.png)${content.slice(firstRange.end)}`;

  assert.equal(
    content,
    'before ![one.png](https://cdn.example.com/one.png) middle ![two.png](https://cdn.example.com/two.png) after',
  );
});
