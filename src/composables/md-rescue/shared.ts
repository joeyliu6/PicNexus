// MD 文档救援 — 共享类型 + 单例状态
// 所有子模块通过导入此文件共享状态

import { ref, shallowRef, type Ref } from 'vue';
import type { MdImageLink } from '../../types/linkCheck';

// ============================================
// 导出类型
// ============================================

/** 带文件路径信息的图片链接 */
export interface MdImageLinkWithFile extends MdImageLink {
  /** 所属文件路径 */
  sourceFile: string;
  /** 所属文件显示名 */
  sourceFileName: string;
}

/** 流程阶段（scanning 涵盖原 report） */
export type RescuePhase = 'idle' | 'scanning' | 'fixing' | 'done';

/** 单个文件的健康状态 */
export interface FileHealth {
  path: string;
  name: string;
  totalCount: number;
  brokenCount: number;
  timeoutCount: number;
  /** suspicious 或 browser_might_work 的链接数 */
  suspiciousCount: number;
  rescuableCount: number;
  unrescuableCount: number;
  /** broken = 有失效链接, warning = 仅超时/可疑, healthy = 全部正常或未检测 */
  status: 'broken' | 'warning' | 'healthy';
  /** 该文件的完整管道（URL检测+备用链接查找）是否完成 */
  ready: boolean;
  /** fixing 阶段实时更新：该文件是否已完成修复 */
  healed: boolean;
}

/** 修复策略 */
export type RepairStrategy =
  | { type: 'priority'; order: string[] }
  | { type: 'fastest' }
  | { type: 'manual'; selections: Map<string, string> };

/** 修复完成后的收据 */
export interface RepairReceipt {
  filesFixed: number;
  linksFixed: number;
  unrescuableCount: number;
  backupPath: string;
  /** 用于撤销：original → backup 的映射 */
  fileBackupMap: Array<{ original: string; backup: string }>;
  /** 本轮替换失败的文件，供 UI 准确提示“部分完成” */
  failedFiles: Array<{ file: string; links: number; error: string }>;
}

// ============================================
// 内部类型（供子模块使用）
// ============================================

/** Rust scan_md_folder 返回的类型 */
export interface RustMdImageLink {
  originalText: string;
  url: string;
  altText: string;
  lineNumber: number;
  syntax: 'markdown' | 'html';
  context: 'normal' | 'blockquote' | 'table';
}
export interface RustMdFileResult {
  filePath: string;
  fileName: string;
  links: RustMdImageLink[];
}
export interface RustScanResult {
  files: RustMdFileResult[];
  totalFiles: number;
  totalLinks: number;
  elapsedMs: number;
  cancelled: boolean;
  /** 因权限不足等原因跳过的目录列表 */
  skippedDirs: string[];
  /** 已发现但读取失败的 Markdown 文件 */
  readFailedFiles?: string[];
}
export interface RustScanProgress {
  phase: 'scanning' | 'reading';
  scannedFiles: number;
  processedFiles: number;
  totalFiles: number;
  foundLinks: number;
  currentFile: string;
}

// ============================================
// 单例共享状态
// ============================================

/** 当前阶段 */
export const phase: Ref<RescuePhase> = ref('idle');

/** 选择模式：单文件 or 文件夹 */
export const mode: Ref<'file' | 'folder' | null> = ref(null);
export const filePath: Ref<string | null> = ref(null);
export const folderPath: Ref<string | null> = ref(null);
/** 文件夹模式下扫描到的 MD 文件列表 */
export const mdFiles: Ref<string[]> = shallowRef([]);
export const fileContent: Ref<string | null> = ref(null);
export const imageLinks: Ref<MdImageLinkWithFile[]> = shallowRef([]);
export const isAnalyzing = ref(false);
/** 正在读取 MD 文件、收集图片链接（selectFolder/loadFolderPath 读文件时为 true） */
export const isCollecting = ref(false);
/** 收集阶段进度（Rust 侧实时推送） */
export const collectProgress = ref<{
  scannedFiles: number;
  processedFiles: number;
  foundLinks: number;
  /** reading 阶段当前正在处理的文件名 */
  currentFile?: string;
} | null>(null);
export const isReplacing = ref(false);
/** 用户排除的 URL 集合（不参与检测） */
export const excludedUrls: Ref<Set<string>> = ref(new Set());
/** 文件夹模式下是否递归扫描子文件夹 */
export const includeSubfolders = ref(true);
/** 是否提取代码块（围栏 + 行内 backtick）内的图片链接 */
export const includeCodeBlocks = ref(false);

/** fixing 阶段进度 */
export const fixingProgress: Ref<{ current: number; total: number }> = ref({ current: 0, total: 0 });
/** 修复完成后的收据 */
export const repairReceipt: Ref<RepairReceipt | null> = ref(null);
/** fixing 阶段已完成修复的文件路径集合（用于动画） */
export const healedFiles: Ref<Set<string>> = ref(new Set());
/** 图床偏好（serviceId 列表，顺序即优先级；空数组 = 不限） */
export const hostPreference: Ref<string[]> = ref([]);
/** 扫描子阶段：checking=URL检测中, backups=备用链接查找中, complete=全部完成, cancelling=取消中, cancelled=已取消 */
export const scanStage = ref<'checking' | 'backups' | 'complete' | 'cancelling' | 'cancelled'>('checking');
/** 已完成完整管道（URL检测+备用链接）的文件路径集合 */
export const readyFiles: Ref<Set<string>> = shallowRef(new Set());
/** 映射后的扫描进度（以图片数为单位，而非去重 URL 数） */
export const scanProgress = ref<{ checked: number; total: number } | null>(null);
/** 全局取消标志：scanning / fixing 阶段共用 */
export const isCancelled = ref(false);
/** 因权限不足等原因跳过的目录列表 */
export const skippedDirs: Ref<string[]> = ref([]);

// ============================================
// let 变量（通过 getter/setter 导出）
// ============================================

/** 收集阶段取消标志（跨 await 检查） */
let _collectCancelled = false;
export function getCollectCancelled() { return _collectCancelled; }
export function setCollectCancelled(v: boolean) { _collectCancelled = v; }

/** 链接检测开始时间戳（用于估算剩余时间） */
let _checkStartTime = 0;
export function getCheckStartTime() { return _checkStartTime; }
export function setCheckStartTime(v: number) { _checkStartTime = v; }

// URL → historyId 内存索引（延迟建立）
let _urlIndex: Map<string, { historyId: string; serviceId: string }[]> | null = null;
export function getUrlIndex() { return _urlIndex; }
export function setUrlIndex(v: Map<string, { historyId: string; serviceId: string }[]> | null) { _urlIndex = v; }

// ============================================
// 常量
// ============================================

export const MD_EXTENSIONS = ['.md', '.markdown'];
/** 拖放多文件时 JS 侧的读取并发数 */
export const COLLECT_CONCURRENCY = 8;
