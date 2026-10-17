// MD 文档救援 — 严格 UTF-8 文本读写
//
// Why：plugin-fs 的 readTextFile 内部用非 fatal 的 TextDecoder，GBK 等非 UTF-8 字节会被
// 静默替换成 U+FFFD（`�`）。修复流程读进来是乱码、写回去就把乱码固化进用户原文件，
// 界面还报"修复成功"——这是会永久损坏用户数据的静默失败。
// 这里改为读原始字节 + fatal 解码：解不出来就抛错，让调用方跳过该文件而不是写回。

import { readFile, writeTextFile } from '@tauri-apps/plugin-fs';

/** 非 UTF-8 文件的统一提示文案（failedFiles 列表与 toast 共用） */
export const NON_UTF8_ERROR_MESSAGE = '编码不受支持（非 UTF-8），已跳过以免写回乱码';

/** 文件不是合法 UTF-8，禁止读写。调用方据此把文件计入失败而非继续处理 */
export class NonUtf8FileError extends Error {
  constructor() {
    super(NON_UTF8_ERROR_MESSAGE);
    this.name = 'NonUtf8FileError';
  }
}

/** U+FEFF，用转义写法避免源码里出现不可见字符 */
const UTF8_BOM = '\uFEFF';

export interface MdTextFile {
  /** 已剥离 BOM 的文本内容 */
  content: string;
  /** 原文件是否带 UTF-8 BOM，写回时需要补回，避免静默改变文件字节 */
  hasBom: boolean;
}

/** 读取文本文件，非 UTF-8 时抛 NonUtf8FileError */
export async function readUtf8TextFile(path: string): Promise<MdTextFile> {
  const bytes = await readFile(path);
  const hasBom =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new NonUtf8FileError();
  }

  // 按 WHATWG 规范 ignoreBOM 默认 false，BOM 已被解码器吃掉；
  // 这里再判一次是防御——万一残留就剥掉，否则写回时会变成两个 BOM
  return {
    content: decoded.startsWith(UTF8_BOM) ? decoded.slice(1) : decoded,
    hasBom,
  };
}

/** 写回文本文件，原文件有 BOM 就补回 */
export async function writeUtf8TextFile(
  path: string,
  content: string,
  hasBom: boolean,
): Promise<void> {
  await writeTextFile(path, hasBom ? UTF8_BOM + content : content);
}

/** 把读取异常转成给用户看的一句话（NonUtf8FileError 直接用它自己的文案，不带 `Error:` 前缀） */
export function describeReadError(err: unknown): string {
  return err instanceof NonUtf8FileError ? err.message : String(err);
}
