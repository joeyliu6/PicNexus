/**
 * Markdown 链接修复服务
 *
 * 提供扫描 Markdown 文件、检测图片链接有效性、替换失效链接和重新上传功能
 * 重构为两阶段执行：detect（检测）+ execute（执行）
 */

import { invoke } from '@tauri-apps/api/core';
import { readDir, readTextFile, writeTextFile, exists, remove, rename, mkdir, copyFile } from '@tauri-apps/plugin-fs';
import pLimit from 'p-limit';
import type {
  ServiceType,
  UserConfig,
  HistoryItem,
  MarkdownRepairOptions,
  MarkdownRepairResult,
  MarkdownRepairSummary,
  FileRepairResult,
  LinkRepairResult,
  MarkdownDetectOptions,
  MarkdownExecuteOptions,
  LinkCategory,
  ReplacementCandidate
} from '../config/types';
import { MultiServiceUploader } from '../core/MultiServiceUploader';
import { historyDB } from './HistoryDatabase';
import { getErrorMessage } from '../types/errors';

/** 链接检测结果（来自 Rust 后端） */
interface CheckLinkResult {
  link: string;
  is_valid: boolean;
  status_code: number | null;
  error: string | null;
  error_type: string;
  suggestion: string | null;
  response_time: number | null;
}

/** 从 Markdown 文件中提取的图片链接 */
interface ExtractedLink {
  url: string;
  /** 原始匹配文本（如 ![alt](url) 或 <img src="url">） */
  fullMatch: string;
  /** 链接在文件中的位置索引 */
  index: number;
}

/** 进度回调参数 */
export interface RepairProgress {
  /** 当前阶段 */
  stage: 'scanning' | 'checking' | 'repairing' | 'reuploading' | 'backup' | 'done';
  /** 阶段描述 */
  stageText: string;
  /** 当前处理的文件或链接 */
  current?: string;
  /** 已完成数量 */
  completed: number;
  /** 总数量 */
  total: number;
  /** 百分比（0-100） */
  percent: number;
}

/** 检测结果（用于 UI 展示） */
export interface DetectionResult {
  /** 扫描的目录 */
  directoryPath: string;
  /** 汇总统计 */
  summary: MarkdownRepairSummary;
  /** 每个文件的详细结果 */
  files: FileRepairResult[];
  /** 按分类聚合的链接 */
  linksByCategory: {
    /** A类：可替换（失效但有备用） */
    replaceable: Array<{
      originalUrl: string;
      filePaths: string[];
      replacements: ReplacementCandidate[];
    }>;
    /** B类：需重新上传（失效且无备用） */
    needReupload: Array<{
      originalUrl: string;
      filePaths: string[];
    }>;
    /** C类：可增加冗余（有效但单一来源，或不在历史记录中的外部链接） */
    canBackup: Array<{
      originalUrl: string;
      filePaths: string[];
      serviceId: ServiceType | 'external';
    }>;
  };
}

/**
 * Markdown 修复服务类
 */
export class MarkdownRepairService {
  /** 并发检测限制 */
  private readonly CONCURRENT_CHECKS = 10;

  /** 并发重新上传限制 */
  private readonly CONCURRENT_UPLOADS = 3;

  /** 重试延迟（毫秒） */
  private readonly RETRY_DELAY = 2000;

  /** URL 索引最大条目数（防止内存溢出） */
  private readonly MAX_INDEX_ENTRIES = 100000;

  /** URL 索引（用于快速查找历史记录中的替换链接） */
  private urlIndex: Map<string, HistoryItem[]> = new Map();

  /** 当前检测使用的链接前缀列表 */
  private prefixList: string[] = [];

  /**
   * 去除链接的所有已配置前缀
   * 按长度降序匹配，确保优先匹配最长前缀
   *
   * @param url 原始链接
   * @returns 去除前缀后的链接
   */
  private stripPrefixes(url: string): string {
    // 按长度降序排列，确保匹配最长前缀
    const sortedPrefixes = [...this.prefixList].sort((a, b) => b.length - a.length);

    for (const prefix of sortedPrefixes) {
      if (url.startsWith(prefix)) {
        const stripped = url.slice(prefix.length);
        // 验证去除后的 URL 仍然是有效格式（以 http 开头或相对路径）
        if (stripped.startsWith('http') || stripped.startsWith('/') || stripped.length > 0) {
          return stripped;
        }
      }
    }
    return url;
  }

  /**
   * 阶段 1：检测
   * 扫描 Markdown 文件，检测链接有效性，返回详细结果供 UI 展示
   *
   * @param options 检测选项
   * @param prefixList 链接前缀列表（用于去除前缀后检测和匹配）
   * @param onProgress 进度回调
   * @returns 检测结果
   */
  async detect(
    options: MarkdownDetectOptions,
    prefixList: string[] = [],
    onProgress?: (progress: RepairProgress) => void
  ): Promise<DetectionResult> {
    console.log(`[MarkdownRepair] 开始检测流程 | 目录: ${options.directoryPath} | 包含子目录: ${options.includeSubdirs} | 前缀数量: ${prefixList.length}`);

    // 保存前缀列表供后续方法使用
    this.prefixList = prefixList;

    const summary: MarkdownRepairSummary = {
      totalFiles: 0,
      totalLinks: 0,
      validLinks: 0,
      invalidLinks: 0,
      replaceableLinks: 0,
      needReuploadLinks: 0,
      canBackupLinks: 0,
      replacedLinks: 0,
      reuploadedLinks: 0,
      reuploadFailedLinks: 0,
      unmatchedLinks: 0,
      modifiedFiles: 0,
      errors: 0
    };

    const files: FileRepairResult[] = [];
    const linksByCategory: DetectionResult['linksByCategory'] = {
      replaceable: [],
      needReupload: [],
      canBackup: []
    };

    // 用于聚合同一链接在多个文件中的出现
    const linkToFiles = new Map<string, Set<string>>();
    const linkToCategory = new Map<string, LinkCategory>();
    const linkToReplacements = new Map<string, ReplacementCandidate[]>();
    const linkToServiceId = new Map<string, ServiceType | 'external'>();

    // 阶段 1: 扫描 Markdown 文件
    onProgress?.({
      stage: 'scanning',
      stageText: '正在扫描目录...',
      completed: 0,
      total: 0,
      percent: 0
    });

    const mdFiles = await this.scanMarkdownFiles(options.directoryPath, options.includeSubdirs);
    summary.totalFiles = mdFiles.length;
    console.log(`[MarkdownRepair] 找到 ${mdFiles.length} 个 Markdown 文件`);

    if (mdFiles.length === 0) {
      return {
        directoryPath: options.directoryPath,
        summary,
        files,
        linksByCategory
      };
    }

    // 阶段 2: 构建 URL 索引（从历史记录）
    onProgress?.({
      stage: 'scanning',
      stageText: '正在构建 URL 索引...',
      completed: 0,
      total: mdFiles.length,
      percent: 5
    });

    await this.buildUrlIndex();

    // 阶段 3: 处理每个文件
    const limit = pLimit(this.CONCURRENT_CHECKS);
    let processedFiles = 0;

    for (const filePath of mdFiles) {
      try {
        const relativePath = this.getRelativePath(filePath, options.directoryPath);

        onProgress?.({
          stage: 'checking',
          stageText: '正在检测链接...',
          current: relativePath,
          completed: processedFiles,
          total: mdFiles.length,
          percent: Math.round((processedFiles / mdFiles.length) * 90) + 5
        });

        const fileResult = await this.detectFile(
          filePath,
          relativePath,
          limit,
          linkToFiles,
          linkToCategory,
          linkToReplacements,
          linkToServiceId
        );

        files.push(fileResult);

        // 更新统计（确保 totalLinks = validLinks + invalidLinks）
        for (const link of fileResult.links) {
          summary.totalLinks++;

          // 按链接状态统计（互斥）
          if (link.status === 'valid') {
            summary.validLinks++;
          } else {
            summary.invalidLinks++;
          }

          // 按链接分类统计（独立于状态）
          // 分类统计用于 UI 展示，与状态统计是不同维度
          switch (link.category) {
            case 'can_backup':
              summary.canBackupLinks++;
              break;
            case 'replaceable':
              summary.replaceableLinks++;
              break;
            case 'need_reupload':
              summary.needReuploadLinks++;
              break;
          }
        }

        if (fileResult.error) {
          summary.errors++;
        }
      } catch (error) {
        console.error(`[MarkdownRepair] 处理文件失败: ${filePath}`, error);
        files.push({
          filePath,
          relativePath: this.getRelativePath(filePath, options.directoryPath),
          links: [],
          modified: false,
          error: String(error)
        });
        summary.errors++;
      }

      processedFiles++;
    }

    // 构建分类聚合结果
    for (const [url, filePaths] of linkToFiles) {
      const category = linkToCategory.get(url);
      const filePathArray = Array.from(filePaths);

      if (category === 'replaceable') {
        linksByCategory.replaceable.push({
          originalUrl: url,
          filePaths: filePathArray,
          replacements: linkToReplacements.get(url) || []
        });
      } else if (category === 'need_reupload') {
        linksByCategory.needReupload.push({
          originalUrl: url,
          filePaths: filePathArray
        });
      } else if (category === 'can_backup') {
        linksByCategory.canBackup.push({
          originalUrl: url,
          filePaths: filePathArray,
          serviceId: linkToServiceId.get(url) || 'weibo'
        });
      }
    }

    onProgress?.({
      stage: 'done',
      stageText: '检测完成',
      completed: mdFiles.length,
      total: mdFiles.length,
      percent: 100
    });

    console.log(`[MarkdownRepair] 检测完成 | 目录: ${options.directoryPath} | 文件: ${summary.totalFiles} | 链接: ${summary.totalLinks} (有效: ${summary.validLinks}, 失效: ${summary.invalidLinks}) | A类: ${summary.replaceableLinks}, B类: ${summary.needReuploadLinks}, C类: ${summary.canBackupLinks}`);
    return {
      directoryPath: options.directoryPath,
      summary,
      files,
      linksByCategory
    };
  }

  /**
   * 检测单个文件
   */
  private async detectFile(
    filePath: string,
    relativePath: string,
    limit: ReturnType<typeof pLimit>,
    linkToFiles: Map<string, Set<string>>,
    linkToCategory: Map<string, LinkCategory>,
    linkToReplacements: Map<string, ReplacementCandidate[]>,
    linkToServiceId: Map<string, ServiceType | 'external'>
  ): Promise<FileRepairResult> {
    const result: FileRepairResult = {
      filePath,
      relativePath,
      links: [],
      modified: false
    };

    try {
      // 读取文件内容
      const content = await readTextFile(filePath);

      // 提取图片链接
      const links = this.extractImageLinks(content);

      if (links.length === 0) {
        return result;
      }

      // 并发检测所有链接（带重试）
      // 注意：检测时使用去除前缀后的 URL，以便正确检测原始链接
      const checkResults = await Promise.all(
        links.map(link => {
          const strippedUrl = this.stripPrefixes(link.url);
          return limit(() => this.checkLinkWithRetry(strippedUrl));
        })
      );

      // 处理每个链接
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const checkResult = checkResults[i];
        // 去除前缀后的 URL（用于匹配历史记录）
        const strippedUrl = this.stripPrefixes(link.url);

        // 记录链接出现的文件（使用原始 URL，因为后续替换需要匹配原始内容）
        if (!linkToFiles.has(link.url)) {
          linkToFiles.set(link.url, new Set());
        }
        linkToFiles.get(link.url)!.add(relativePath);

        const linkResult: LinkRepairResult = {
          originalUrl: link.url,
          status: 'valid'
        };

        if (checkResult.is_valid) {
          // 链接有效，检查是否需要增加冗余
          linkResult.status = 'valid';

          // 检查历史记录（使用去除前缀后的 URL 匹配）
          const historyItems = this.urlIndex.get(strippedUrl);
          if (historyItems && historyItems.length > 0) {
            // 在历史记录中找到，检查是否只有单一来源
            const allUrls = this.getAllUrlsFromHistory(historyItems);
            if (allUrls.length === 1) {
              // 只有单一来源，标记为可增加冗余
              linkResult.category = 'can_backup';
              linkToCategory.set(link.url, 'can_backup');

              // 获取来源图床
              const sourceService = this.getSourceService(historyItems[0], strippedUrl);
              if (sourceService) {
                linkToServiceId.set(link.url, sourceService);
              }
            }
          } else {
            // 不在历史记录中的有效链接，标记为外部链接（可增加冗余）
            linkResult.category = 'can_backup';
            linkToCategory.set(link.url, 'can_backup');
            linkToServiceId.set(link.url, 'external');
          }
        } else {
          // 链接无效，查找替换（使用去除前缀后的 URL 匹配）
          const replacements = await this.findAllReplacements(strippedUrl);

          if (replacements.length > 0) {
            // 有可用替换，标记为 A 类
            linkResult.status = 'unmatched'; // 状态为无效，但有替换选项
            linkResult.category = 'replaceable';
            linkResult.availableReplacements = replacements;
            linkToCategory.set(link.url, 'replaceable');
            linkToReplacements.set(link.url, replacements);
          } else {
            // 无可用替换，标记为 B 类
            linkResult.status = 'unmatched';
            linkResult.category = 'need_reupload';
            linkResult.error = checkResult.error || '链接无效且无可用替换';
            linkToCategory.set(link.url, 'need_reupload');
          }
        }

        result.links.push(linkResult);
      }
    } catch (error) {
      result.error = String(error);
      console.error(`[MarkdownRepair] 处理文件失败: ${filePath}`, error);
    }

    return result;
  }

  /**
   * 阶段 2：执行
   * 根据用户选择执行替换/重新上传
   *
   * @param detectionResult 检测结果
   * @param executeOptions 执行选项
   * @param config 用户配置
   * @param onProgress 进度回调
   * @returns 执行结果
   */
  async execute(
    detectionResult: DetectionResult,
    executeOptions: MarkdownExecuteOptions,
    config: UserConfig,
    onProgress?: (progress: RepairProgress) => void
  ): Promise<MarkdownRepairResult> {
    const replaceCount = executeOptions.linksToReplace.size;
    const reuploadCount = executeOptions.linksToReupload.length;
    const targetServicesStr = executeOptions.targetServices.join(', ') || '无';
    console.log(`[MarkdownRepair] 开始执行流程 | 目录: ${detectionResult.directoryPath} | 替换: ${replaceCount} 个链接 | 重新上传: ${reuploadCount} 个链接 | 目标图床: ${targetServicesStr} | 备份: ${executeOptions.backup ? '是' : '否'}`);

    const summary: MarkdownRepairSummary = { ...detectionResult.summary };
    const files: FileRepairResult[] = [];

    // 收集需要修改的文件
    const fileModifications = new Map<string, Map<string, string>>();

    // 1. 处理替换链接
    for (const [originalUrl, replacementUrl] of executeOptions.linksToReplace) {
      // 找出这个链接出现在哪些文件中
      for (const file of detectionResult.files) {
        for (const link of file.links) {
          if (link.originalUrl === originalUrl) {
            if (!fileModifications.has(file.filePath)) {
              fileModifications.set(file.filePath, new Map());
            }
            fileModifications.get(file.filePath)!.set(originalUrl, replacementUrl);
          }
        }
      }
    }

    // 计算进度分配：根据实际任务动态分配进度范围
    const hasReupload = executeOptions.linksToReupload.length > 0 && executeOptions.targetServices.length > 0;
    const hasModifications = fileModifications.size > 0 || hasReupload;
    const hasBackup = executeOptions.backup && hasModifications;

    // 进度范围分配（确保连续性）
    // - 有重新上传 + 有修改: 重新上传 0-40%, 备份 40-50%, 写入 50-95%, 完成 100%
    // - 仅重新上传: 重新上传 0-90%, 完成 100%
    // - 仅修改: 备份 0-10%, 写入 10-95%, 完成 100%
    // - 无任务: 直接完成 100%
    let reuploadStart = 0, reuploadEnd = 0;
    let backupPercent = 0;
    let repairStart = 0, repairEnd = 95;

    if (hasReupload && fileModifications.size > 0) {
      // 两种任务都有
      reuploadStart = 0;
      reuploadEnd = 40;
      backupPercent = hasBackup ? 45 : 40;
      repairStart = hasBackup ? 50 : 40;
      repairEnd = 95;
    } else if (hasReupload) {
      // 仅重新上传
      reuploadStart = 0;
      reuploadEnd = 90;
    } else if (fileModifications.size > 0) {
      // 仅修改
      backupPercent = hasBackup ? 10 : 0;
      repairStart = hasBackup ? 15 : 0;
      repairEnd = 95;
    }

    // 2. 处理重新上传（并发执行）
    if (hasReupload) {
      const uploadLimit = pLimit(this.CONCURRENT_UPLOADS);
      let completedCount = 0;
      const totalCount = executeOptions.linksToReupload.length;

      // 使用并发限制执行上传任务
      const uploadTasks = executeOptions.linksToReupload.map(url =>
        uploadLimit(async () => {
          const currentPercent = reuploadStart + Math.round((completedCount / totalCount) * (reuploadEnd - reuploadStart));
          onProgress?.({
            stage: 'reuploading',
            stageText: '正在重新上传...',
            current: url,
            completed: completedCount,
            total: totalCount,
            percent: currentPercent
          });

          const reuploadResult = await this.reuploadImage(
            url,
            executeOptions.targetServices,
            config
          );

          completedCount++;
          return { url, result: reuploadResult };
        })
      );

      // 等待所有上传任务完成
      const uploadResults = await Promise.all(uploadTasks);

      // 处理上传结果
      for (const { url, result: reuploadResult } of uploadResults) {
        if (reuploadResult.success && reuploadResult.newUrl) {
          // 找出这个链接出现在哪些文件中
          for (const file of detectionResult.files) {
            for (const link of file.links) {
              if (link.originalUrl === url) {
                if (!fileModifications.has(file.filePath)) {
                  fileModifications.set(file.filePath, new Map());
                }
                fileModifications.get(file.filePath)!.set(url, reuploadResult.newUrl);
              }
            }
          }

          // 插入新的历史记录
          if (reuploadResult.newHistoryItem) {
            await historyDB.insert(reuploadResult.newHistoryItem);
          }

          summary.reuploadedLinks++;
        } else {
          summary.reuploadFailedLinks++;
        }
      }
    }

    // 3. 备份并写入文件
    if (fileModifications.size > 0) {
      // 备份
      if (executeOptions.backup) {
        onProgress?.({
          stage: 'backup',
          stageText: '正在备份文件...',
          completed: 0,
          total: fileModifications.size,
          percent: backupPercent
        });

        await this.backupFiles(
          detectionResult.directoryPath,
          Array.from(fileModifications.keys()),
          executeOptions.cleanOldBackups
        );
      }

      // 写入修改
      let modifiedCount = 0;
      const totalModifications = fileModifications.size;

      for (const [filePath, replacements] of fileModifications) {
        const currentPercent = repairStart + Math.round((modifiedCount / totalModifications) * (repairEnd - repairStart));
        onProgress?.({
          stage: 'repairing',
          stageText: '正在写入修改...',
          current: filePath,
          completed: modifiedCount,
          total: totalModifications,
          percent: currentPercent
        });

        try {
          let content = await readTextFile(filePath);

          for (const [oldUrl, newUrl] of replacements) {
            content = content.split(oldUrl).join(newUrl);
          }

          await this.atomicWrite(filePath, content);
          summary.modifiedFiles++;
          summary.replacedLinks += replacements.size;

          // 更新文件结果（深复制避免污染原始数据）
          const originalFile = detectionResult.files.find(f => f.filePath === filePath);
          if (originalFile) {
            const updatedFile: FileRepairResult = {
              ...originalFile,
              modified: true,
              // 深复制 links 数组，避免污染原始 detectionResult
              links: originalFile.links.map(link => {
                if (replacements.has(link.originalUrl)) {
                  return {
                    ...link,
                    status: 'replaced' as const,
                    replacementUrl: replacements.get(link.originalUrl)
                  };
                }
                return { ...link };
              })
            };
            files.push(updatedFile);
          }
        } catch (error) {
          console.error(`[MarkdownRepair] 写入文件失败: ${filePath}`, error);
          summary.errors++;
        }

        modifiedCount++;
      }
    }

    // 添加未修改的文件
    for (const file of detectionResult.files) {
      if (!fileModifications.has(file.filePath)) {
        files.push(file);
      }
    }

    onProgress?.({
      stage: 'done',
      stageText: '执行完成',
      completed: fileModifications.size,
      total: fileModifications.size,
      percent: 100
    });

    console.log(`[MarkdownRepair] 执行完成 | 目录: ${detectionResult.directoryPath} | 已替换: ${summary.replacedLinks} 个链接 | 已重新上传: ${summary.reuploadedLinks} 个 (失败: ${summary.reuploadFailedLinks}) | 已修改文件: ${summary.modifiedFiles} | 错误: ${summary.errors}`);
    return { summary, files };
  }

  /**
   * 备份文件到 .md_repair_backup_[时间戳] 目录
   */
  private async backupFiles(
    baseDir: string,
    filePaths: string[],
    cleanOldBackups?: boolean
  ): Promise<string> {
    // 生成备份目录名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    const backupDirName = `.md_repair_backup_${timestamp}`;
    const backupDir = this.joinPath(baseDir, backupDirName);

    // 清理旧备份
    if (cleanOldBackups) {
      await this.cleanOldBackups(baseDir);
    }

    // 创建备份目录
    await mkdir(backupDir, { recursive: true });

    // 复制文件，保持目录结构
    for (const filePath of filePaths) {
      const relativePath = this.getRelativePath(filePath, baseDir);
      const backupPath = this.joinPath(backupDir, relativePath);

      // 确保父目录存在
      const parentDir = this.getParentDir(backupPath);
      if (parentDir !== backupDir) {
        await mkdir(parentDir, { recursive: true });
      }

      // 复制文件
      await copyFile(filePath, backupPath);
    }

    console.log(`[MarkdownRepair] 已备份 ${filePaths.length} 个文件到 ${backupDir}`);
    return backupDir;
  }

  /**
   * 清理旧的备份目录
   */
  private async cleanOldBackups(baseDir: string): Promise<void> {
    try {
      const entries = await readDir(baseDir);

      for (const entry of entries) {
        if (entry.isDirectory && entry.name.startsWith('.md_repair_backup_')) {
          const fullPath = this.joinPath(baseDir, entry.name);
          await this.removeDirectory(fullPath);
          console.log(`[MarkdownRepair] 已清理旧备份: ${entry.name}`);
        }
      }
    } catch (error) {
      console.error('[MarkdownRepair] 清理旧备份失败:', error);
    }
  }

  /**
   * 递归删除目录
   */
  private async removeDirectory(dirPath: string): Promise<void> {
    const entries = await readDir(dirPath);

    for (const entry of entries) {
      const fullPath = this.joinPath(dirPath, entry.name);
      if (entry.isDirectory) {
        await this.removeDirectory(fullPath);
      } else {
        await remove(fullPath);
      }
    }

    await remove(dirPath);
  }

  /**
   * 兼容旧的 repair 方法（保留向后兼容）
   */
  async repair(
    options: MarkdownRepairOptions,
    config: UserConfig,
    onProgress?: (progress: RepairProgress) => void
  ): Promise<MarkdownRepairResult> {
    // 先执行检测
    const detectResult = await this.detect(
      {
        directoryPath: options.directoryPath,
        includeSubdirs: options.includeSubdirs
      },
      [],
      onProgress
    );

    // 如果是仅检测模式，直接返回
    if (options.repairMode === 'detect') {
      return {
        summary: detectResult.summary,
        files: detectResult.files
      };
    }

    // 构建执行选项
    const linksToReplace = new Map<string, string>();
    const linksToReupload: string[] = [];

    // 收集需要替换的链接
    for (const item of detectResult.linksByCategory.replaceable) {
      if (item.replacements.length > 0) {
        // 使用第一个有效替换
        const validReplacement = item.replacements.find(r => r.isValid);
        if (validReplacement) {
          linksToReplace.set(item.originalUrl, validReplacement.url);
        }
      }
    }

    // 收集需要重新上传的链接
    if (options.repairMode === 'reupload' && options.targetServices?.length) {
      for (const item of detectResult.linksByCategory.needReupload) {
        linksToReupload.push(item.originalUrl);
      }
    }

    // 执行
    return this.execute(
      detectResult,
      {
        linksToReplace,
        linksToReupload,
        targetServices: options.targetServices || [],
        backup: false
      },
      config,
      onProgress
    );
  }

  /**
   * 扫描目录中的 Markdown 文件
   */
  private async scanMarkdownFiles(
    directoryPath: string,
    includeSubdirs: boolean
  ): Promise<string[]> {
    const mdFiles: string[] = [];

    const scanDir = async (dir: string) => {
      try {
        const entries = await readDir(dir);

        for (const entry of entries) {
          const fullPath = this.joinPath(dir, entry.name);

          if (entry.isDirectory && includeSubdirs) {
            // 跳过备份目录
            if (!entry.name.startsWith('.md_repair_backup_')) {
              await scanDir(fullPath);
            }
          } else if (entry.isFile && entry.name.toLowerCase().endsWith('.md')) {
            mdFiles.push(fullPath);
          }
        }
      } catch (error) {
        console.error(`[MarkdownRepair] 扫描目录失败: ${dir}`, error);
      }
    };

    await scanDir(directoryPath);
    return mdFiles;
  }

  /**
   * 构建 URL 索引
   * 从历史记录中提取所有 URL，建立快速查找索引
   * 如果数据库未初始化或查询失败，urlIndex 将保持为空
   */
  private async buildUrlIndex(): Promise<void> {
    this.urlIndex.clear();

    try {
      // 使用流式读取所有历史记录
      // historyDB.getAllStream 内部会自动初始化数据库
      let itemCount = 0;
      let indexLimitReached = false;

      for await (const batch of historyDB.getAllStream(1000)) {
        for (const item of batch) {
          // 检查是否达到索引上限（防止内存溢出）
          if (this.urlIndex.size >= this.MAX_INDEX_ENTRIES) {
            indexLimitReached = true;
            break;
          }

          itemCount++;

          // 索引所有成功上传的 URL
          for (const result of item.results) {
            if (result.status === 'success' && result.result?.url) {
              const url = result.result.url;
              if (!this.urlIndex.has(url)) {
                this.urlIndex.set(url, []);
              }
              this.urlIndex.get(url)!.push(item);
            }
          }

          // 索引生成的链接
          if (item.generatedLink) {
            if (!this.urlIndex.has(item.generatedLink)) {
              this.urlIndex.set(item.generatedLink, []);
            }
            this.urlIndex.get(item.generatedLink)!.push(item);
          }
        }

        if (indexLimitReached) break;
      }

      console.log(`[MarkdownRepair] URL 索引构建完成，共 ${this.urlIndex.size} 个唯一 URL（来自 ${itemCount} 条历史记录）`);

      if (indexLimitReached) {
        console.warn(`[MarkdownRepair] 历史记录过多，索引已达到上限 ${this.MAX_INDEX_ENTRIES}，部分链接可能无法匹配`);
      }

      if (this.urlIndex.size === 0) {
        console.warn('[MarkdownRepair] 历史记录为空，A 类替换功能将不可用');
      }
    } catch (error) {
      console.error('[MarkdownRepair] 构建 URL 索引失败:', error);
    }
  }

  /**
   * 从 Markdown 内容中提取图片链接
   * 使用局部正则表达式避免并发竞态问题
   */
  private extractImageLinks(content: string): ExtractedLink[] {
    // 在方法内创建正则表达式，避免类属性的并发状态问题
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["'][^>]*>/gi;

    const links: ExtractedLink[] = [];
    const seenUrls = new Set<string>();

    // 使用 matchAll 替代 exec 循环，更安全且无状态
    for (const match of content.matchAll(imageRegex)) {
      // match[2] 是 Markdown 格式的 URL，match[3] 是 HTML img 标签的 URL
      const url = match[2] || match[3];

      // 跳过重复和非 HTTP(S) 链接
      if (!url || seenUrls.has(url) || !url.startsWith('http')) {
        continue;
      }

      seenUrls.add(url);
      links.push({
        url,
        fullMatch: match[0],
        index: match.index!
      });
    }

    return links;
  }

  /**
   * 检测单个链接有效性（带重试）
   */
  private async checkLinkWithRetry(url: string): Promise<CheckLinkResult> {
    // 第一次检测
    let result = await this.checkLink(url);

    // 如果失败，等待后重试一次
    if (!result.is_valid) {
      console.log(`[MarkdownRepair] 链接检测失败，${this.RETRY_DELAY}ms 后重试: ${url}`);
      await this.delay(this.RETRY_DELAY);
      result = await this.checkLink(url);

      if (!result.is_valid) {
        console.log(`[MarkdownRepair] 重试后仍然失败: ${url}`);
      }
    }

    return result;
  }

  /**
   * 检测单个链接有效性
   */
  private async checkLink(url: string): Promise<CheckLinkResult> {
    try {
      return await invoke<CheckLinkResult>('check_image_link', { link: url });
    } catch (error) {
      return {
        link: url,
        is_valid: false,
        status_code: null,
        error: getErrorMessage(error),
        error_type: 'network',
        suggestion: null,
        response_time: null
      };
    }
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 从历史记录中查找所有可用的替换 URL
   */
  private async findAllReplacements(brokenUrl: string): Promise<ReplacementCandidate[]> {
    const replacements: ReplacementCandidate[] = [];
    const historyItems = this.urlIndex.get(brokenUrl);

    if (!historyItems || historyItems.length === 0) {
      return replacements;
    }

    // 收集所有不同的 URL
    const checkedUrls = new Set<string>();
    checkedUrls.add(brokenUrl);

    for (const item of historyItems) {
      for (const result of item.results) {
        if (result.status === 'success' && result.result?.url) {
          const url = result.result.url;

          if (!checkedUrls.has(url)) {
            checkedUrls.add(url);

            // 检测链接是否有效
            const checkResult = await this.checkLinkWithRetry(url);

            replacements.push({
              url,
              serviceId: result.serviceId,
              isValid: checkResult.is_valid
            });
          }
        }
      }
    }

    // 按有效性排序（有效的在前）
    replacements.sort((a, b) => (b.isValid ? 1 : 0) - (a.isValid ? 1 : 0));

    return replacements;
  }

  /**
   * 获取历史记录中的所有 URL
   */
  private getAllUrlsFromHistory(historyItems: HistoryItem[]): string[] {
    const urls = new Set<string>();

    for (const item of historyItems) {
      for (const result of item.results) {
        if (result.status === 'success' && result.result?.url) {
          urls.add(result.result.url);
        }
      }
      if (item.generatedLink) {
        urls.add(item.generatedLink);
      }
    }

    return Array.from(urls);
  }

  /**
   * 获取链接的来源图床
   */
  private getSourceService(historyItem: HistoryItem, url: string): ServiceType | null {
    for (const result of historyItem.results) {
      if (result.status === 'success' && result.result?.url === url) {
        return result.serviceId;
      }
    }
    return null;
  }

  /**
   * 重新上传图片到指定图床
   */
  private async reuploadImage(
    sourceUrl: string,
    targetServices: ServiceType[],
    config: UserConfig
  ): Promise<{
    success: boolean;
    newUrl?: string;
    serviceId?: ServiceType;
    newHistoryItem?: HistoryItem;
    error?: string;
  }> {
    try {
      console.log(`[MarkdownRepair] 开始重新上传: ${sourceUrl}`);

      // 1. 下载图片到临时文件
      const tempFilePath = await invoke<string>('download_image_from_url', { url: sourceUrl });
      console.log(`[MarkdownRepair] 图片已下载到: ${tempFilePath}`);

      // 2. 上传到目标图床
      const uploader = new MultiServiceUploader();
      const uploadResult = await uploader.uploadToMultipleServices(
        tempFilePath,
        targetServices,
        config
      );

      if (uploadResult.primaryUrl) {
        // 构建新的历史记录项
        const newHistoryItem: HistoryItem = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: Date.now(),
          localFileName: this.extractFilenameFromUrl(sourceUrl),
          filePath: tempFilePath,
          primaryService: uploadResult.primaryService,
          results: uploadResult.results.map(r => ({
            serviceId: r.serviceId,
            result: r.result,
            status: r.status,
            error: r.error
          })),
          generatedLink: uploadResult.primaryUrl
        };

        return {
          success: true,
          newUrl: uploadResult.primaryUrl,
          serviceId: uploadResult.primaryService,
          newHistoryItem
        };
      }

      return {
        success: false,
        error: '所有图床上传失败'
      };
    } catch (error) {
      console.error('[MarkdownRepair] 重新上传失败:', error);
      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * 从 URL 中提取文件名
   */
  private extractFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || 'unknown';
      return filename;
    } catch {
      return 'unknown';
    }
  }

  /**
   * 原子写入文件（先写临时文件再重命名）
   * 使用备份-恢复策略确保数据安全
   */
  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    const backupPath = `${filePath}.bak`;
    let originalExists = false;
    let backupCreated = false;

    try {
      // 1. 写入临时文件
      await writeTextFile(tempPath, content);

      // 2. 如果原文件存在，重命名为备份（而非直接删除）
      originalExists = await exists(filePath);
      if (originalExists) {
        // 先清理可能存在的旧备份
        if (await exists(backupPath)) {
          await remove(backupPath);
        }
        await rename(filePath, backupPath);
        backupCreated = true;
      }

      // 3. 重命名临时文件为目标文件
      await rename(tempPath, filePath);

      // 4. 成功后删除备份文件
      if (backupCreated) {
        try {
          await remove(backupPath);
        } catch {
          // 备份清理失败不影响主流程，仅记录警告
          console.warn(`[MarkdownRepair] 清理备份文件失败: ${backupPath}`);
        }
      }
    } catch (error) {
      console.error(`[MarkdownRepair] 原子写入失败: ${filePath}`, error);

      // 恢复原文件（如果已创建备份）
      if (backupCreated) {
        try {
          // 尝试恢复：将备份重命名回原文件
          if (await exists(backupPath)) {
            // 如果目标文件已存在（rename 部分成功），先删除
            if (await exists(filePath)) {
              await remove(filePath);
            }
            await rename(backupPath, filePath);
            console.log(`[MarkdownRepair] 已从备份恢复原文件: ${filePath}`);
          }
        } catch (restoreError) {
          console.error(`[MarkdownRepair] 恢复原文件失败: ${filePath}，备份位于: ${backupPath}`, restoreError);
        }
      }

      // 清理临时文件
      try {
        if (await exists(tempPath)) {
          await remove(tempPath);
        }
      } catch {
        console.warn(`[MarkdownRepair] 清理临时文件失败: ${tempPath}`);
      }

      throw error;
    }
  }

  /**
   * 获取相对路径
   */
  private getRelativePath(filePath: string, basePath: string): string {
    // 规范化路径分隔符
    const normalizedFile = filePath.replace(/\\/g, '/');
    const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/$/, '');

    if (normalizedFile.startsWith(normalizedBase)) {
      return normalizedFile.slice(normalizedBase.length + 1);
    }

    return filePath;
  }

  /**
   * 拼接路径（跨平台兼容）
   * 统一使用正斜杠作为分隔符，因为 Tauri 的文件系统 API 支持正斜杠
   */
  private joinPath(...parts: string[]): string {
    return parts
      .map(p => p.replace(/\\/g, '/').replace(/\/+$/, ''))
      .filter(p => p.length > 0)
      .join('/');
  }

  /**
   * 获取路径的父目录
   */
  private getParentDir(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;
  }

  /**
   * 获取已存在的备份目录列表
   */
  async getExistingBackups(directoryPath: string): Promise<string[]> {
    const backups: string[] = [];

    try {
      const entries = await readDir(directoryPath);

      for (const entry of entries) {
        if (entry.isDirectory && entry.name.startsWith('.md_repair_backup_')) {
          backups.push(entry.name);
        }
      }
    } catch (error) {
      console.error('[MarkdownRepair] 获取备份列表失败:', error);
    }

    return backups.sort().reverse(); // 按时间倒序
  }
}

/** 导出单例实例 */
export const markdownRepairService = new MarkdownRepairService();
