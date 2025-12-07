// src/r2-manager.ts
// R2 存储管理视图逻辑

import { invoke } from '@tauri-apps/api/tauri';
import { writeText } from '@tauri-apps/api/clipboard';
import { UserConfig } from './config/types';
import { appState } from './appState';
import { showConfirmModal } from './ui/modal';

/**
 * R2 对象接口（与 Rust 结构体匹配）
 */
interface R2Object {
  key: string;
  size: number;
  lastModified: string;
}

/**
 * R2 管理器类
 */
export class R2Manager {
  private config: UserConfig;
  private objects: R2Object[] = [];
  private currentModalObject: R2Object | null = null;
  private selectedKeys: Set<string> = new Set(); // 新增：存储选中项

  // DOM 元素
  private gridContainer: HTMLElement;
  private loadingEl: HTMLElement;
  private errorMessageEl: HTMLElement;
  private bucketInfoEl: HTMLElement;
  private statsInfoEl: HTMLElement;
  private refreshBtn: HTMLButtonElement;
  private modal: HTMLElement;
  private modalImage: HTMLImageElement;
  private modalFilename: HTMLElement;
  private modalFilesize: HTMLElement;
  private modalCopyBtn: HTMLButtonElement;
  private modalDeleteBtn: HTMLButtonElement;
  private modalCloseBtn: HTMLButtonElement;

  // 新增 DOM 引用
  private batchDeleteBtn: HTMLButtonElement;
  private selectAllCheckbox: HTMLInputElement;
  private batchCountSpan: HTMLElement;
  
  // [v2.7 优化] 存储事件监听器引用，用于清理
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(config: UserConfig) {
    this.config = config;

    // 获取 DOM 元素
    this.gridContainer = this.getElement('r2-grid-container');
    this.loadingEl = this.getElement('r2-loading');
    this.errorMessageEl = this.getElement('r2-error-message');
    this.bucketInfoEl = this.getElement('r2-bucket-info');
    this.statsInfoEl = this.getElement('r2-stats-info');
    this.refreshBtn = this.getElement('r2-refresh-btn') as HTMLButtonElement;
    this.modal = this.getElement('r2-modal');
    this.modalImage = this.getElement('r2-modal-image') as HTMLImageElement;
    this.modalFilename = this.getElement('r2-modal-filename');
    this.modalFilesize = this.getElement('r2-modal-filesize');
    this.modalCopyBtn = this.getElement('r2-modal-copy-btn') as HTMLButtonElement;
    this.modalDeleteBtn = this.getElement('r2-modal-delete-btn') as HTMLButtonElement;
    this.modalCloseBtn = this.getElement('r2-modal-close-btn') as HTMLButtonElement;
    
    // 获取新增的批量操作元素
    // 注意：这些元素可能在某些版本中不存在，需要容错
    this.batchDeleteBtn = document.getElementById('r2-batch-delete-btn') as HTMLButtonElement;
    this.selectAllCheckbox = document.getElementById('r2-select-all') as HTMLInputElement;
    this.batchCountSpan = document.getElementById('r2-batch-count') as HTMLElement;

    this.initEventListeners();
  }

  /**
   * 获取 DOM 元素，带错误检查
   */
  private getElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`[R2管理] 找不到元素: ${id}`);
    }
    return element as T;
  }

  /**
   * 初始化事件监听器
   */
  private initEventListeners(): void {
    // 刷新按钮
    this.refreshBtn.addEventListener('click', () => {
      // [v2.6 优化] 用户手动刷新，标记为脏数据
      appState.isR2Dirty = true;
      this.selectedKeys.clear(); // 刷新时清空选中
      this.updateBatchUI();
      this.loadObjects();
    });

    // 模态框关闭按钮
    this.modalCloseBtn.addEventListener('click', () => {
      this.closeModal();
    });

    // 点击模态框背景关闭
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal || (e.target as HTMLElement).classList.contains('r2-modal-overlay')) {
        this.closeModal();
      }
    });

    // 复制链接按钮
    this.modalCopyBtn.addEventListener('click', () => {
      this.copyCurrentObjectLink();
    });

    // 删除按钮
    this.modalDeleteBtn.addEventListener('click', () => {
      this.deleteCurrentObject();
    });

    // ESC 键关闭模态框
    // [v2.7 优化] 保存事件处理器引用，以便后续清理
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.modal.style.display === 'flex') {
        this.closeModal();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);

    // 批量删除按钮
    if (this.batchDeleteBtn) {
      this.batchDeleteBtn.addEventListener('click', () => {
        this.deleteSelectedObjects();
      });
    }

    // 全选复选框
    if (this.selectAllCheckbox) {
      this.selectAllCheckbox.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        this.toggleSelectAll(checked);
      });
    }
  }

  /**
   * 更新配置
   */
  public updateConfig(config: UserConfig): void {
    this.config = config;
  }

  /**
   * [v2.7 优化] 清理事件监听器，防止内存泄漏
   * 在组件销毁或重新初始化时调用
   */
  public cleanup(): void {
    // 清理全局键盘事件监听器
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    
    // 清理 IntersectionObserver（如果存在）
    // 注意：IntersectionObserver 在 observe 时已经 unobserve，这里主要是预防性清理
    
    console.log('[R2管理] 已清理事件监听器');
  }

  /**
   * 加载 R2 对象列表
   */
  public async loadObjects(): Promise<void> {
    try {
      console.log('[R2管理] 开始加载对象列表');

      // 检查配置
      if (!this.isR2Configured()) {
        this.showError('请先在"设置"中完整配置 R2 并提供"公开访问域名"。');
        return;
      }

      // 显示加载状态
      this.showLoading(true);
      this.hideError();
      this.clearGrid();
      
      // 禁用批量操作按钮
      if (this.selectAllCheckbox) this.selectAllCheckbox.disabled = true;

      // 更新存储桶信息
      this.bucketInfoEl.textContent = `存储桶: ${this.config.services.r2?.bucketName}`;

      // 调用 Rust 命令获取对象列表
      this.objects = await invoke<R2Object[]>('list_r2_objects', {
        config: this.config.services.r2,
      });

      console.log(`[R2管理] 成功获取 ${this.objects.length} 个对象`);

      // 显示统计信息
      const totalSize = this.objects.reduce((sum, obj) => sum + obj.size, 0);
      this.statsInfoEl.textContent = `共 ${this.objects.length} 个项目，${this.formatFileSize(totalSize)}`;

      // 渲染网格
      this.renderGrid();

      this.showLoading(false);
      
      // 启用批量操作按钮
      if (this.selectAllCheckbox) this.selectAllCheckbox.disabled = false;
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[R2管理] 加载对象失败:', error);
      this.showError(`加载失败: ${errorMsg}`);
      this.showLoading(false);
    }
  }

  /**
   * 检查 R2 是否已配置
   */
  private isR2Configured(): boolean {
    const r2 = this.config.services?.r2;
    return !!(
      r2?.accountId &&
      r2?.accessKeyId &&
      r2?.secretAccessKey &&
      r2?.bucketName &&
      r2?.publicDomain
    );
  }

  /**
   * 渲染网格
   * [v2.7 优化] 使用 DocumentFragment 批量插入，减少 DOM 重排
   */
  private renderGrid(): void {
    this.clearGrid();

    if (this.objects.length === 0) {
      this.gridContainer.innerHTML = '<div class="r2-empty-message">暂无图片</div>';
      return;
    }

    // 使用 DocumentFragment 进行批量插入，避免频繁触发重排
    const fragment = document.createDocumentFragment();
    this.objects.forEach((obj) => {
      const item = this.createGridItem(obj);
      fragment.appendChild(item);
    });
    
    // 一次性插入所有元素，只触发一次重排
    this.gridContainer.appendChild(fragment);
    
    // 更新 UI 状态（全选框等）
    this.updateBatchUI();
  }

  /**
   * 创建网格项
   * [v2.7 优化] 增强图片懒加载，使用 IntersectionObserver 显示占位符
   */
  private createGridItem(obj: R2Object): HTMLElement {
    const item = document.createElement('div');
    item.className = 'r2-item';
    item.setAttribute('data-key', obj.key);

    // 根据是否被选中添加样式类
    if (this.selectedKeys.has(obj.key)) {
      item.classList.add('selected');
    }

    // 1. Image Container (用于占位符)
    const imgContainer = document.createElement('div');
    imgContainer.className = 'r2-item-img-container';
    imgContainer.style.position = 'relative';
    imgContainer.style.width = '100%';
    imgContainer.style.height = '100%';
    imgContainer.style.backgroundColor = 'var(--bg-secondary, #f0f0f0)';
    imgContainer.style.overflow = 'hidden';
    
    // 占位符（在图片加载前显示）
    const placeholder = document.createElement('div');
    placeholder.className = 'r2-item-placeholder';
    placeholder.style.position = 'absolute';
    placeholder.style.top = '0';
    placeholder.style.left = '0';
    placeholder.style.width = '100%';
    placeholder.style.height = '100%';
    placeholder.style.background = 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)';
    placeholder.style.backgroundSize = '200% 100%';
    placeholder.style.animation = 'shimmer 1.5s infinite';
    placeholder.style.zIndex = '1';
    imgContainer.appendChild(placeholder);
    
    // 2. Image
    const img = document.createElement('img');
    img.className = 'r2-item-img';
    img.loading = 'lazy';
    img.alt = obj.key;
    img.style.position = 'absolute';
    img.style.top = '0';
    img.style.left = '0';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.opacity = '0'; // 初始透明，等待加载完成
    img.style.transition = 'opacity 0.3s ease';
    img.style.zIndex = '2';
    
    // 显示图片的函数
    const showImage = () => {
      img.style.opacity = '1';
      placeholder.style.opacity = '0';
      placeholder.style.pointerEvents = 'none';
    };
    
    // 隐藏占位符的函数
    const hidePlaceholder = () => {
      setTimeout(() => {
        placeholder.style.display = 'none';
      }, 300); // 等待淡出动画完成
    };
    
    // [v2.7 优化] 使用 IntersectionObserver 实现更精确的懒加载
    const imageUrl = this.buildImageUrl(obj.key);
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // 图片进入视口，开始加载
          img.src = imageUrl;
          
          // 检查图片是否已经加载完成（可能来自缓存）
          if (img.complete && img.naturalHeight !== 0) {
            // 图片已经加载完成（可能是缓存），直接显示
            showImage();
            hidePlaceholder();
          } else {
            // 图片需要加载，设置加载回调
            img.onload = () => {
              // 图片加载完成后显示，隐藏占位符
              showImage();
              hidePlaceholder();
            };
          }
          
          img.onerror = () => {
            // 加载失败，显示错误占位符
            placeholder.style.background = 'var(--error, #ff4444)';
            placeholder.style.animation = 'none';
            placeholder.textContent = '加载失败';
            placeholder.style.color = 'var(--text-on-error, #ffffff)';
            placeholder.style.display = 'flex';
            placeholder.style.alignItems = 'center';
            placeholder.style.justifyContent = 'center';
            placeholder.style.zIndex = '3';
          };
          
          observer.unobserve(item); // 不再需要观察
        }
      });
    }, {
      rootMargin: '50px' // 提前 50px 开始加载
    });
    
    observer.observe(item);
    imgContainer.appendChild(img);

    // 2. Checkbox Container (新增)
    const checkboxContainer = document.createElement('div');
    checkboxContainer.className = 'r2-item-checkbox';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = this.selectedKeys.has(obj.key);
    
    // 阻止点击冒泡，防止触发图片预览
    checkbox.onclick = (e) => {
      e.stopPropagation();
      this.toggleSelection(obj.key, checkbox.checked);
    };
    
    checkboxContainer.appendChild(checkbox);

    // 3. Overlay
    const overlay = document.createElement('div');
    overlay.className = 'r2-item-overlay';

    // 3.1 Filename
    const nameSpan = document.createElement('span');
    nameSpan.className = 'r2-item-name';
    nameSpan.textContent = obj.key;
    nameSpan.title = obj.key;

    // 3.2 Delete Button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'r2-item-delete';
    deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    deleteBtn.title = '删除';

    // Events
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      this.deleteObject(obj);
    };

    // Assemble
    overlay.appendChild(nameSpan);
    overlay.appendChild(deleteBtn);
    item.appendChild(imgContainer); // 使用 imgContainer 而不是直接使用 img
    item.appendChild(checkboxContainer); // Add Checkbox
    item.appendChild(overlay);
    
    // 修改 item 点击事件：支持 Ctrl/Cmd 切换选中
    item.onclick = (e) => {
        if (e.ctrlKey || e.metaKey) {
          // Ctrl/Cmd + 点击 -> 切换选中
          const isSelected = !this.selectedKeys.has(obj.key);
          checkbox.checked = isSelected;
          this.toggleSelection(obj.key, isSelected);
        } else {
          // 普通点击 -> 预览
          this.openModal(obj);
        }
    };

    return item;
  }
  
  /**
   * 切换单个选中状态
   */
  private toggleSelection(key: string, selected: boolean): void {
    if (selected) {
      this.selectedKeys.add(key);
    } else {
      this.selectedKeys.delete(key);
    }
    this.updateBatchUI(); // 更新 UI 状态
    this.refreshGridItemStyle(key, selected); // 仅更新该项样式
  }
  
  /**
   * 刷新单个网格项的样式（无需重绘整个网格）
   */
  private refreshGridItemStyle(key: string, selected: boolean): void {
      const item = this.gridContainer.querySelector(`.r2-item[data-key="${CSS.escape(key)}"]`);
      if (item) {
          if (selected) {
              item.classList.add('selected');
          } else {
              item.classList.remove('selected');
          }
          
          // 同时更新内部复选框状态 (如果是通过 Ctrl 点击触发的)
          const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
          if (checkbox) {
              checkbox.checked = selected;
          }
      }
  }

  /**
   * 更新批量操作 UI（按钮显隐、全选框状态）
   */
  private updateBatchUI(): void {
    const count = this.selectedKeys.size;

    if (this.batchDeleteBtn && this.batchCountSpan) {
      this.batchDeleteBtn.style.display = count > 0 ? 'inline-flex' : 'none';
      this.batchCountSpan.textContent = `(${count})`;
    }
    
    // 更新全选框状态
    if (this.selectAllCheckbox) {
      this.selectAllCheckbox.checked = count > 0 && count === this.objects.length;
      this.selectAllCheckbox.indeterminate = count > 0 && count < this.objects.length;
    }
  }

  /**
   * 全选/反选逻辑
   */
  private toggleSelectAll(selected: boolean): void {
    if (selected) {
      this.objects.forEach(obj => this.selectedKeys.add(obj.key));
    } else {
      this.selectedKeys.clear();
    }
    this.renderGrid(); // 全选建议重绘网格，因为所有项都要变
    this.updateBatchUI();
  }

  /**
   * 批量删除选中项
   */
  private async deleteSelectedObjects(): Promise<void> {
    const count = this.selectedKeys.size;
    if (count === 0) return;

    // 使用自定义模态框
    const confirmed = await showConfirmModal(
      `您确定要永久删除选中的 ${count} 个文件吗？\n\n此操作不可撤销。`,
      '确认批量删除'
    );

    if (!confirmed) return;

    console.log(`[R2管理] 开始批量删除 ${count} 个对象`);
    
    // 显示加载中
    this.showLoading(true); 

    const keysToDelete = Array.from(this.selectedKeys);
    let successCount = 0;
    let failCount = 0;
    
    // 更新状态文本显示进度
    if (this.errorMessageEl) {
        this.errorMessageEl.style.display = 'block';
        this.errorMessageEl.style.backgroundColor = 'var(--bg-card)'; // 临时用作进度条背景
        this.errorMessageEl.style.color = 'var(--text-primary)';
        this.errorMessageEl.textContent = `正在删除... (0/${count})`;
    }

    // 简单的并发控制（例如每次 5 个）
    const batchSize = 5;
    for (let i = 0; i < keysToDelete.length; i += batchSize) {
      const batch = keysToDelete.slice(i, i + batchSize);
      await Promise.all(batch.map(async (key) => {
        try {
          await invoke('delete_r2_object', {
            config: this.config.services.r2,
            key: key,
          });
          successCount++;
        } catch (error) {
          console.error(`删除失败 ${key}:`, error);
          failCount++;
        }
      }));
      
      // 更新进度
      if (this.errorMessageEl) {
          this.errorMessageEl.textContent = `正在删除... (${Math.min(i + batchSize, count)}/${count})`;
      }
    }

    // 完成后处理
    this.selectedKeys.clear();
    this.updateBatchUI();
    
    // 重新加载列表
    await this.loadObjects();
    
    // 恢复错误消息框样式
    if (this.errorMessageEl) {
        this.errorMessageEl.style.backgroundColor = '';
        this.errorMessageEl.style.color = '';
        this.errorMessageEl.style.display = 'none';
    }
    
    if (failCount > 0) {
      this.showTemporaryMessage(`删除完成: ${successCount} 成功, ${failCount} 失败`, 'error');
    } else {
      this.showTemporaryMessage(`成功删除 ${successCount} 个文件`);
    }
  }

  /**
   * 构建图片 URL
   */
  private buildImageUrl(key: string): string {
    const domain = this.config.services.r2?.publicDomain?.replace(/\/$/, '') || ''; // 移除末尾的斜杠
    return `${domain}/${key}`;
  }

  /**
   * 打开模态框
   */
  private openModal(obj: R2Object): void {
    this.currentModalObject = obj;
    const imageUrl = this.buildImageUrl(obj.key);

    this.modalImage.src = imageUrl;
    this.modalFilename.textContent = `文件名: ${obj.key}`;
    this.modalFilesize.textContent = `大小: ${this.formatFileSize(obj.size)}`;

    this.modal.style.display = 'flex';
  }

  /**
   * 关闭模态框
   */
  private closeModal(): void {
    this.modal.style.display = 'none';
    this.currentModalObject = null;
  }

  /**
   * 复制当前对象的链接
   */
  private async copyCurrentObjectLink(): Promise<void> {
    if (!this.currentModalObject) return;

    try {
      const url = this.buildImageUrl(this.currentModalObject.key);
      await writeText(url);
      this.showTemporaryMessage('✓ 链接已复制到剪贴板');
    } catch (error) {
      console.error('[R2管理] 复制链接失败:', error);
      this.showTemporaryMessage('✗ 复制失败', 'error');
    }
  }

  /**
   * 删除当前模态框中的对象
   */
  private async deleteCurrentObject(): Promise<void> {
    if (!this.currentModalObject) return;
    await this.deleteObject(this.currentModalObject);
    this.closeModal();
  }

  /**
   * 删除对象
   */
  private async deleteObject(obj: R2Object): Promise<void> {
    try {
      // 确认对话框 (使用新的模态框)
      const confirmed = await showConfirmModal(
        `您确定要从 R2 永久删除 "${obj.key}" 吗？\n\n此操作不可撤销。`,
        '确认删除'
      );

      if (!confirmed) {
        return;
      }

      console.log(`[R2管理] 开始删除对象: ${obj.key}`);

      // 调用 Rust 命令删除对象
      const result = await invoke<string>('delete_r2_object', {
        config: this.config.services.r2,
        key: obj.key,
      });

      console.log(`[R2管理] ${result}`);

      // 从列表中移除
      this.objects = this.objects.filter((o) => o.key !== obj.key);
      
      // 如果该对象被选中，也移除选中状态
      if (this.selectedKeys.has(obj.key)) {
          this.selectedKeys.delete(obj.key);
          this.updateBatchUI();
      }

      // 重新渲染网格
      this.renderGrid();

      // 更新统计信息
      const totalSize = this.objects.reduce((sum, o) => sum + o.size, 0);
      this.statsInfoEl.textContent = `共 ${this.objects.length} 个项目，${this.formatFileSize(totalSize)}`;

      this.showTemporaryMessage('✓ 删除成功');
      
      // [v2.6 优化] 删除后 DOM 已同步，不需要标记脏数据
      // appState.isR2Dirty = false; // 保持缓存有效
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[R2管理] 删除对象失败:', error);
      this.showTemporaryMessage(`✗ 删除失败: ${errorMsg}`, 'error');
    }
  }

  /**
   * 显示/隐藏加载状态
   */
  private showLoading(show: boolean): void {
    this.loadingEl.style.display = show ? 'flex' : 'none';
  }

  /**
   * 显示错误消息
   */
  private showError(message: string): void {
    this.errorMessageEl.textContent = message;
    this.errorMessageEl.style.display = 'block';
  }

  /**
   * 隐藏错误消息
   */
  private hideError(): void {
    this.errorMessageEl.style.display = 'none';
  }

  /**
   * 清空网格
   */
  private clearGrid(): void {
    this.gridContainer.innerHTML = '';
  }

  /**
   * 显示临时消息（toast）
   */
  private showTemporaryMessage(message: string, type: 'success' | 'error' = 'success'): void {
    const toast = document.createElement('div');
    toast.className = `r2-toast r2-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // 淡入动画
    setTimeout(() => {
      toast.classList.add('r2-toast-show');
    }, 10);

    // 3秒后移除
    setTimeout(() => {
      toast.classList.remove('r2-toast-show');
      setTimeout(() => {
        document.body.removeChild(toast);
      }, 300);
    }, 3000);
  }

  /**
   * 格式化文件大小
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }
}
