import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const pluginRequire = createRequire(resolve('plugins/obsidian/package.json'));
const esbuild = pluginRequire('esbuild');
const outputDir = mkdtempSync(join(tmpdir(), 'picnexus-plugin-behavior-'));
const markdownOutputPath = join(outputDir, 'markdown.mjs');
const settingsOutputPath = join(outputDir, 'settings.mjs');

await Promise.all([
  esbuild.build({
    entryPoints: [resolve('plugins/obsidian/src/markdown.ts')],
    bundle: true,
    format: 'esm',
    outfile: markdownOutputPath,
    platform: 'node',
    logLevel: 'silent',
  }),
  esbuild.build({
    entryPoints: [resolve('plugins/obsidian/src/types.ts')],
    bundle: true,
    format: 'esm',
    outfile: settingsOutputPath,
    platform: 'node',
    logLevel: 'silent',
  }),
]);

const markdown = await import(pathToFileURL(markdownOutputPath).href);
const settings = await import(pathToFileURL(settingsOutputPath).href);

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
  const first = markdown.createUploadPlaceholder('image.png', 'ab1');
  const second = markdown.createUploadPlaceholder('image.png', 'ab2');

  assert.notEqual(first, second);
  assert.match(first, /\(ab1\)/);
  assert.match(second, /\(ab2\)/);
});

// 回归：占位符的形态踩了三次才收敛，每一次的坑这里各守一条。
// Live Preview 只在**光标不在的行**隐藏原始标记，而刚粘完图光标恰恰压在占位符上，
// 所以任何「反正会被渲染隐藏」的写法都不成立——只能用纯文本。
test('placeholder is plain text with no markup that Live Preview would expose', () => {
  const placeholder = markdown.createUploadPlaceholder('image.png', 'ab1');

  // 坑 1：`](#...)` 是指向笔记内标题的链接，解析不到会弹「未找到」
  assert.ok(!placeholder.includes('](#'), '不得指向笔记内锚点');
  // 坑 2：HTML 注释会在光标所在行原样露出来
  assert.ok(!placeholder.includes('<!--'), '不得使用 HTML 注释藏 ID');
  // 坑 3：图片语法的 `![` 与 `]()` 同样会在光标所在行露出来
  assert.ok(!placeholder.includes('!['), '不得使用图片语法');
  assert.ok(!placeholder.includes(']('), '不得使用任何 Markdown 链接语法');

  assert.ok(placeholder.includes('image.png'), '要让用户看得出在传哪张图');
  assert.match(placeholder, /\(ab1\)$/, 'ID 结尾，供替换时定位');
});

// 回归：以前按占位符「全文」做 indexOf。Smart Typography 这类插件会改写可见部分（省略号、
// 空白），一改文本就匹配不上，替换静默失败、占位符永久留在笔记里。改为按 ID 定位后不受影响。
test('finds the placeholder even after another plugin rewrites the visible text', () => {
  const placeholder = markdown.createUploadPlaceholder('image.png', 'ab1');
  const mangled = placeholder.replace('…', '...').replace('Uploading', 'Uploading  ');
  const content = `before ${mangled} after`;

  const range = markdown.findPlaceholderRange(content, 'ab1');
  assert.ok(range, '可见文本被改写后仍应定位得到');
  assert.equal(content.slice(range.start, range.end), mangled, '要连被改写的可见部分一起替换掉');
});

// 文件名自带 `(id)` 形状时，尾锚 `(id)]()` 必须让匹配落在真正的 ID 上
test('picks the trailing id even when the file name looks like one', () => {
  const placeholder = markdown.createUploadPlaceholder('photo (ab1).png', 'ab1');
  const range = markdown.findPlaceholderRange(placeholder, 'ab1');

  assert.ok(range);
  assert.equal(range.start, 0);
  assert.equal(range.end, placeholder.length);
});

test('finds each batch placeholder at its own range', () => {
  const first = markdown.createUploadPlaceholder('one.png', 'cd1');
  const second = markdown.createUploadPlaceholder('two.png', 'cd2');
  const content = `before ${first} middle ${second} after`;

  assert.deepEqual(markdown.findPlaceholderRange(content, 'cd1'), {
    start: 7,
    end: 7 + first.length,
  });
  assert.deepEqual(markdown.findPlaceholderRange(content, 'cd2'), {
    start: 8 + first.length + 7,
    end: 8 + first.length + 7 + second.length,
  });
  assert.equal(markdown.findPlaceholderRange(content, 'missing'), null);
});

test('keeps batch placeholders isolated while upload results arrive', () => {
  const first = markdown.createUploadPlaceholder('one.png', 'ef1');
  const second = markdown.createUploadPlaceholder('two.png', 'ef2');
  let content = `before ${first} middle ${second} after`;

  const secondRange = markdown.findPlaceholderRange(content, 'ef2');
  assert.ok(secondRange);
  content = `${content.slice(0, secondRange.start)}![two.png](https://cdn.example.com/two.png)${content.slice(secondRange.end)}`;

  const firstRange = markdown.findPlaceholderRange(content, 'ef1');
  assert.ok(firstRange);
  content = `${content.slice(0, firstRange.start)}![one.png](https://cdn.example.com/one.png)${content.slice(firstRange.end)}`;

  assert.equal(
    content,
    'before ![one.png](https://cdn.example.com/one.png) middle ![two.png](https://cdn.example.com/two.png) after',
  );
});

test('uses defaults when persisted plugin settings are missing or invalid', () => {
  assert.deepEqual(settings.normalizeSettings(null), settings.DEFAULT_SETTINGS);
  assert.deepEqual(settings.normalizeSettings([]), settings.DEFAULT_SETTINGS);
  assert.deepEqual(settings.normalizeSettings({
    port: 80,
    autoUploadOnPaste: 'true',
    autoUploadOnDrop: null,
    showNotifications: 1,
  }), settings.DEFAULT_SETTINGS);
});

test('keeps valid settings and falls back field by field', () => {
  assert.deepEqual(settings.normalizeSettings({
    port: 65535,
    autoUploadOnPaste: false,
    autoUploadOnDrop: true,
    showNotifications: false,
  }), {
    port: 65535,
    autoUploadOnPaste: false,
    autoUploadOnDrop: true,
    showNotifications: false,
  });

  assert.deepEqual(settings.normalizeSettings({
    port: 36799.5,
    autoUploadOnPaste: false,
  }), {
    port: settings.DEFAULT_SETTINGS.port,
    autoUploadOnPaste: false,
    autoUploadOnDrop: settings.DEFAULT_SETTINGS.autoUploadOnDrop,
    showNotifications: settings.DEFAULT_SETTINGS.showNotifications,
  });
});
