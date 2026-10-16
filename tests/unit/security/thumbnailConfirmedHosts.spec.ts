import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';

// getConfirmedHttpHosts 的调用方清单（src/security/networkPolicy.ts）：每个渲染 ThumbnailImage 的地方
// 都要传 confirmedHttpHosts。漏一处，那里用户已确认过的明文 HTTP 图床缩略图就显示不出来。

const SRC = join(__dirname, '../../../src');
const ELEMENT = 1;
const DIRECTIVE = 7;

interface TemplateNode {
  type: number;
  tag?: string;
  loc: { start: { line: number } };
  props?: Array<{ type: number; name: string; arg?: { content?: string } }>;
  children?: TemplateNode[];
}

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return vueFiles(path);
    return entry.name.endsWith('.vue') ? [path] : [];
  });
}

function passesHosts(node: TemplateNode): boolean {
  return (node.props ?? []).some((prop) => prop.type === DIRECTIVE && prop.name === 'bind'
    && (prop.arg?.content === 'confirmed-http-hosts' || prop.arg?.content === 'confirmedHttpHosts'));
}

function walk(node: TemplateNode, visit: (node: TemplateNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

describe('ThumbnailImage callers', () => {
  it('always pass the confirmed plain-HTTP hosts', () => {
    const missing: string[] = [];
    let seen = 0;
    for (const file of vueFiles(SRC)) {
      const ast = parse(readFileSync(file, 'utf8'), { filename: file }).descriptor.template?.ast as TemplateNode | undefined;
      if (!ast) continue;
      walk(ast, (node) => {
        if (node.type !== ELEMENT || node.tag !== 'ThumbnailImage') return;
        seen++;
        if (!passesHosts(node)) missing.push(`${relative(SRC, file).replace(/\\/g, '/')}:${node.loc.start.line}`);
      });
    }
    expect(seen).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
