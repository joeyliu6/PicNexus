// S3 兼容存储的对象名（key）生成
//
// Why 单独成文件：key 的格式决定了每一条新上传记录的最终 URL，属于对外契约，
// 抽出来才能被单测直接覆盖（BaseS3Uploader.upload 走 invoke，测起来要连带 mock 整条链路）。

import { formatDateCompact } from '../../utils/formatters';

/**
 * 随机段长度（base36）。36^4 ≈ 168 万种组合——碰撞只在
 * 「同一天 + 同一个原文件名 + 同一个随机段」三者同时命中时才发生。
 */
const RANDOM_SEGMENT_LENGTH = 4;

/** 定长 base36 随机段；不足位左侧补 0，保证 key 段宽固定、便于肉眼扫读 */
function randomSegment(): string {
  const space = 36 ** RANDOM_SEGMENT_LENGTH;
  return Math.floor(Math.random() * space)
    .toString(36)
    .padStart(RANDOM_SEGMENT_LENGTH, '0');
}

/**
 * 生成 S3 对象名：`{path}/{yyyyMMdd}_{4位随机}_{原文件名}`
 *
 * Why 要加前缀：原实现是「配置路径 + 原始文件名」，同名文件第二次上传会直接顶掉第一次的对象，
 * 于是第一条历史记录的链接从此指向第二张图——内容被静默替换且不可恢复。
 * 前缀保证唯一，原文件名留在末尾，既保住可读性也保住扩展名（Rust 侧按扩展名推断 Content-Type）。
 *
 * @param path 配置里的存储路径前缀，可为空；结尾有无 `/` 都能处理
 * @param fileName 原始文件名（含扩展名）
 */
export function buildObjectKey(path: string, fileName: string): string {
  const normalizedPath = path ? (path.endsWith('/') ? path : `${path}/`) : '';
  return `${normalizedPath}${formatDateCompact()}_${randomSegment()}_${fileName}`;
}
