// src/components/views/CloudStorageView/composables/useFileOperations.ts
// 文件操作逻辑

import { ref, type Ref } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { useConfigManager } from '@/composables/useConfig';
import { useToast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import { StorageManagerFactory } from '@/services/storage';
import {
  LINK_FORMATS,
  type CloudServiceType,
  type StorageObject,
  type LinkFormat,
  type OperationProgress,
} from '../types';

export interface FileOperationsOptions {
  /** 当前服务 */
  activeService: Ref<CloudServiceType>;
  /** 当前路径 */
  currentPath: Ref<string>;
  /** 刷新回调 */
  refresh: () => Promise<void>;
  /** 清空选择回调 */
  clearSelection: () => void;
}

export interface FileOperationsReturn {
  /** 是否正在执行操作 */
  isOperating: Ref<boolean>;
  /** 操作进度 */
  operationProgress: Ref<OperationProgress | null>;
  /** 上传文件 */
  uploadFiles: () => Promise<void>;
  /** 删除文件 */
  deleteFiles: (items: StorageObject[]) => Promise<void>;
  /** 重命名文件 */
  renameFile: (item: StorageObject, newName: string) => Promise<void>;
  /** 移动文件 */
  moveFiles: (items: StorageObject[], destPath: string) => Promise<void>;
  /** 复制链接 */
  copyLinks: (items: StorageObject[], format: LinkFormat) => Promise<void>;
  /** 创建文件夹 */
  createFolder: (folderName: string) => Promise<void>;
  /** 下载文件 */
  downloadFile: (item: StorageObject) => Promise<void>;
}

export function useFileOperations(options: FileOperationsOptions): FileOperationsReturn {
  const { activeService, currentPath, refresh, clearSelection } = options;

  const configManager = useConfigManager();
  const toast = useToast();
  const { confirmDelete } = useConfirm();

  // 操作进行中状态
  const isOperating = ref(false);
  const operationProgress = ref<OperationProgress | null>(null);

  // 获取当前管理器
  function getManager() {
    const config = configManager.config.value.services?.[activeService.value];
    if (!config) throw new Error('存储服务未配置');
    return StorageManagerFactory.create(activeService.value, config);
  }

  // 上传文件
  async function uploadFiles() {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: '图片',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'],
        },
      ],
    });

    if (!selected || selected.length === 0) return;

    const files = Array.isArray(selected) ? selected : [selected];
    const manager = getManager();

    isOperating.value = true;
    operationProgress.value = {
      operation: 'upload',
      current: 0,
      total: files.length,
    };

    let successCount = 0;
    let failCount = 0;

    for (const filePath of files) {
      try {
        const fileName = filePath.split(/[\\/]/).pop() || 'file';
        const remotePath = currentPath.value + fileName;

        operationProgress.value = {
          operation: 'upload',
          current: operationProgress.value.current,
          total: files.length,
          currentFile: fileName,
        };

        await manager.uploadFile(filePath, remotePath);
        successCount++;
      } catch (e) {
        console.error('上传失败:', e);
        failCount++;
      }

      operationProgress.value.current++;
    }

    isOperating.value = false;
    operationProgress.value = null;

    if (failCount === 0) {
      toast.success('上传完成', `成功上传 ${successCount} 个文件`);
    } else {
      toast.warn('部分上传失败', `成功 ${successCount} 个，失败 ${failCount} 个`);
    }

    await refresh();
  }

  // 删除文件
  async function deleteFiles(items: StorageObject[]) {
    const folderCount = items.filter((i) => i.type === 'folder').length;

    let message = `确定要删除选中的 ${items.length} 项吗？`;
    if (folderCount > 0) {
      message += `\n注意：删除文件夹将同时删除其中的所有文件。`;
    }
    message += '\n此操作不可撤销。';

    confirmDelete(message, async () => {
      const manager = getManager();

      isOperating.value = true;
      operationProgress.value = {
        operation: 'delete',
        current: 0,
        total: items.length,
      };

      try {
        const paths = items.map((i) => i.key);
        const result = await manager.deleteFiles(paths);

        if (result.failed.length === 0) {
          toast.success('已删除', `${result.success.length} 项`);
        } else {
          toast.warn(
            '部分删除失败',
            `成功 ${result.success.length} 项，失败 ${result.failed.length} 项`
          );
        }
      } catch (e) {
        toast.error('删除失败', e instanceof Error ? e.message : '未知错误');
      } finally {
        isOperating.value = false;
        operationProgress.value = null;
        clearSelection();
        await refresh();
      }
    });
  }

  // 重命名文件（通过复制+删除实现）
  async function renameFile(item: StorageObject, newName: string) {
    if (!newName || newName === item.name) return;

    isOperating.value = true;

    try {
      // 对于文件夹，需要特殊处理（对象存储通常没有真正的文件夹）
      if (item.type === 'folder') {
        toast.warn('暂不支持', '文件夹重命名功能暂不支持');
        return;
      }

      // 对于文件，使用复制+删除
      // 注意：这需要后端支持 copyObject 操作
      // 目前简化处理：提示用户
      toast.info('提示', '重命名功能需要先下载再上传，建议在 Web 控制台操作');
    } catch (e) {
      toast.error('重命名失败', e instanceof Error ? e.message : '未知错误');
    } finally {
      isOperating.value = false;
    }
  }

  // 移动文件
  async function moveFiles(_items: StorageObject[], _destPath: string) {
    // 移动功能需要复制+删除，暂时简化处理
    toast.info('提示', '移动功能开发中，建议在 Web 控制台操作');
  }

  // 复制链接
  async function copyLinks(items: StorageObject[], format: LinkFormat) {
    const files = items.filter((i) => i.type === 'file' && i.url);
    if (files.length === 0) {
      toast.warn('无法复制', '请选择有效的文件');
      return;
    }

    const formatConfig = LINK_FORMATS.find((f) => f.format === format);
    if (!formatConfig) return;

    const links = files
      .map((file) => formatConfig.template(file.url!, file.name))
      .join('\n');

    try {
      await navigator.clipboard.writeText(links);
      toast.success('已复制', `${files.length} 个链接已复制到剪贴板`);
    } catch (e) {
      toast.error('复制失败', '无法访问剪贴板');
    }
  }

  // 创建文件夹
  async function createFolder(folderName: string) {
    if (!folderName) return;

    isOperating.value = true;
    try {
      const manager = getManager();
      const folderPath = currentPath.value + folderName;
      await manager.createFolder(folderPath);
      toast.success('创建成功', `文件夹 "${folderName}" 已创建`);
      await refresh();
    } catch (e) {
      toast.error('创建失败', e instanceof Error ? e.message : '未知错误');
    } finally {
      isOperating.value = false;
    }
  }

  // 下载文件
  async function downloadFile(item: StorageObject) {
    if (item.type === 'folder') {
      toast.warn('无法下载', '不支持下载文件夹');
      return;
    }

    // 直接打开 URL 下载
    if (item.url) {
      window.open(item.url, '_blank');
      toast.success('开始下载', `正在下载 "${item.name}"`);
    } else {
      toast.error('下载失败', '无法获取下载链接');
    }
  }

  return {
    isOperating,
    operationProgress,
    uploadFiles,
    deleteFiles,
    renameFile,
    moveFiles,
    copyLinks,
    createFolder,
    downloadFile,
  };
}
