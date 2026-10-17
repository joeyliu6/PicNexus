// 文档文件夹索引（交接说明 8.3 / 13.4）：扫描结果 → 文档里的图片链接各对应哪张图的哪一份；
// 每张图「用于 N 个文档」；修复时每个文档要换哪几条。纯函数，无 Vue / 文件读写。
//
// 只认 PicNexus 记录里的链接：文档里别处来的图片不检测、不计入、不替换。
// 文档里可能写的是原始链接、加了前缀的链接（微博代理等），也可能是用户换过前缀的旧链接：三种都要对得上。

import type { HealthImage } from './healthModel';
import { isDead } from './healthModel';

/** Rust scan_md_folder 返回的一个文档（只取用得到的字段） */
export interface ScannedDoc {
  filePath: string;
  fileName: string;
  links: ReadonlyArray<{ url: string; lineNumber: number }>;
}

export interface ScannedFolder {
  folder: string;
  docs: readonly ScannedDoc[];
}

/** 文档里的一处引用 */
export interface DocRef {
  folder: string;
  path: string;
  name: string;
  line: number;
  /** 文档里写的原样链接（替换时按它找） */
  url: string;
  imageId: string;
  host: string;
}

export interface DocIndex {
  refs: DocRef[];
  /** imageId → 引用它的文档路径（去重） */
  docsByImage: Map<string, Set<string>>;
  /** 全部扫到的文档数 */
  docCount: number;
}

type StripPrefix = (url: string) => string;

/** 记录里每一份链接的几种写法 → 哪张图的哪一份 */
function urlLookup(images: readonly HealthImage[], strip: StripPrefix): Map<string, { imageId: string; host: string }> {
  const map = new Map<string, { imageId: string; host: string }>();
  for (const image of images) {
    for (const copy of image.copies) {
      const target = { imageId: image.id, host: copy.host };
      for (const url of [copy.row.url, copy.row.rawUrl, strip(copy.row.url)]) {
        if (url && !map.has(url)) map.set(url, target);
      }
    }
  }
  return map;
}

export function buildDocIndex(folders: readonly ScannedFolder[], images: readonly HealthImage[], strip: StripPrefix): DocIndex {
  const lookup = urlLookup(images, strip);
  const refs: DocRef[] = [];
  const docsByImage = new Map<string, Set<string>>();
  let docCount = 0;
  for (const { folder, docs } of folders) {
    for (const doc of docs) {
      docCount++;
      for (const link of doc.links) {
        const url = link.url.trim();
        const hit = lookup.get(url) ?? lookup.get(strip(url));
        if (!hit) continue;
        refs.push({ folder, path: doc.filePath, name: doc.fileName, line: link.lineNumber, url, ...hit });
        const set = docsByImage.get(hit.imageId);
        if (set) set.add(doc.filePath);
        else docsByImage.set(hit.imageId, new Set([doc.filePath]));
      }
    }
  }
  return { refs, docsByImage, docCount };
}

/**
 * 这张图在文档里该换成哪一份：复制时使用的那份可访问就用它；它失效、能修就用改用的那份；都不行返回 undefined。
 * 修复会把「复制时使用」切过去，所以两种情况最后都是「修复后复制时使用的那份」。
 */
export function replacementHost(image: HealthImage): string | undefined {
  if (image.copies[0]?.status === 'ok') return image.copyHost;
  return image.state === 'fixable' ? image.fixTo : undefined;
}

/** 一处引用是不是失效链接（它指向的那份被查出失效） */
function isDeadRef(ref: DocRef, imageById: ReadonlyMap<string, HealthImage>): boolean {
  const copy = imageById.get(ref.imageId)?.copies.find((c) => c.host === ref.host);
  return copy !== undefined && isDead(copy.status);
}

/** 一个文档要做的替换 */
export interface DocWrite {
  folder: string;
  path: string;
  name: string;
  /** 文档里的原样链接 → 新链接 */
  replacements: Map<string, string>;
  /** 换掉几处（按出现次数） */
  places: number;
}

/** 文档弹窗里的一行：几处失效、几处可替换 */
export interface DocProblem {
  folder: string;
  path: string;
  name: string;
  dead: number;
  fixable: number;
}

/**
 * 修复要改哪些文档：只看 imageIds 这些图（不给 = 全部），引用了失效那份、且这张图有可换的那份的才换。
 * urlOf(imageId, host) 给出新链接（复制出去的那种写法）。
 */
export function planDocWrites(
  index: DocIndex,
  images: readonly HealthImage[],
  urlOf: (imageId: string, host: string) => string | undefined,
  imageIds?: ReadonlySet<string>,
): DocWrite[] {
  const imageById = new Map(images.map((image) => [image.id, image]));
  const byPath = new Map<string, DocWrite>();
  for (const ref of index.refs) {
    if (imageIds && !imageIds.has(ref.imageId)) continue;
    if (!isDeadRef(ref, imageById)) continue;
    const image = imageById.get(ref.imageId);
    const host = image && replacementHost(image);
    const next = host && urlOf(ref.imageId, host);
    if (!next || next === ref.url) continue;
    let write = byPath.get(ref.path);
    if (!write) {
      write = { folder: ref.folder, path: ref.path, name: ref.name, replacements: new Map(), places: 0 };
      byPath.set(ref.path, write);
    }
    write.replacements.set(ref.url, next);
    write.places++;
  }
  return [...byPath.values()];
}

/** 文档弹窗「需要修复的文档」：有失效引用的文档，按失效处数从多到少 */
export function docProblems(index: DocIndex, images: readonly HealthImage[]): DocProblem[] {
  const imageById = new Map(images.map((image) => [image.id, image]));
  const byPath = new Map<string, DocProblem>();
  for (const ref of index.refs) {
    if (!isDeadRef(ref, imageById)) continue;
    let problem = byPath.get(ref.path);
    if (!problem) {
      problem = { folder: ref.folder, path: ref.path, name: ref.name, dead: 0, fixable: 0 };
      byPath.set(ref.path, problem);
    }
    problem.dead++;
    const image = imageById.get(ref.imageId);
    if (image && replacementHost(image)) problem.fixable++;
  }
  return [...byPath.values()].sort((a, b) => b.dead - a.dead || a.name.localeCompare(b.name));
}

/** 「2 处失效，均可替换」「2 处失效，1 处可替换」「1 处失效，可替换」「1 处失效，无可用备份」 */
export function problemDetail(problem: DocProblem): string {
  const lead = `${problem.dead} 处失效`;
  if (problem.fixable === 0) return `${lead}，无可用备份`;
  if (problem.fixable === problem.dead) return problem.dead === 1 ? `${lead}，可替换` : `${lead}，均可替换`;
  return `${lead}，${problem.fixable} 处可替换`;
}

/** 文件所在目录（弹窗里文件名下面那行） */
export function parentDir(path: string): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return cut > 0 ? path.slice(0, cut) : path;
}
