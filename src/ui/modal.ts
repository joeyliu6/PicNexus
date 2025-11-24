import { dialog } from '@tauri-apps/api';

/**
 * 显示自定义确认模态框
 * @param message 确认消息
 * @param title 标题 (可选)
 * @returns Promise<boolean> 用户点击确定返回 true，取消返回 false
 */
export function showConfirmModal(message: string, title: string = '确认'): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const messageEl = document.getElementById('confirm-modal-message');
    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');
    const closeBtn = document.getElementById('confirm-modal-close');

    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn || !closeBtn) {
      console.error('[模态框] 找不到模态框元素，回退到原生对话框');
      dialog.ask(message, { title, type: 'warning' }).then(resolve);
      return;
    }

    // 设置内容
    titleEl.textContent = title;
    messageEl.textContent = message;
    modal.style.display = 'flex';
    
    // 聚焦确认按钮方便键盘操作
    okBtn.focus();

    // 清理函数
    const cleanup = () => {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlayClick);
      window.removeEventListener('keydown', onEscKey);
    };

    const onOk = () => {
      cleanup();
      modal.style.display = 'none';
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      modal.style.display = 'none';
      resolve(false);
    };

    const onOverlayClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('modal-overlay') || target.id === 'confirm-modal') {
            onCancel();
        }
    };
    
    const onEscKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onCancel();
    };

    // 绑定事件
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlayClick);
    window.addEventListener('keydown', onEscKey);
  });
}

/**
 * 显示自定义提示/警示模态框 (Alert 模式)
 * 复用 confirm-modal 的结构，但隐藏取消按钮
 * @param message 提示消息内容
 * @param title 标题 (默认: '提示')
 * @param type 预留参数，目前主要用于区分标题样式 (可选)
 */
export function showAlertModal(message: string, title: string = '提示', type: 'normal' | 'error' = 'normal'): Promise<void> {
  return new Promise((resolve) => {
    // 1. 获取 DOM 元素 (与 showConfirmModal 相同)
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const messageEl = document.getElementById('confirm-modal-message');
    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');
    const closeBtn = document.getElementById('confirm-modal-close');

    // 2. 安全检查
    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn || !closeBtn) {
      console.error('[模态框] 找不到模态框元素，回退到原生弹窗');
      // 降级处理：如果找不到 DOM，回退到原生
      dialog.message(message, { title, type: type === 'error' ? 'error' : 'warning' });
      resolve();
      return;
    }

    // 3. 设置内容
    titleEl.textContent = title;
    messageEl.textContent = message;
    
    // 4. 【关键】隐藏取消按钮，将模态框变为 Alert 风格
    cancelBtn.style.display = 'none';
    
    // 5. 根据 type 设置标题颜色
    if (type === 'error') {
      titleEl.style.color = 'var(--error)';
    } else {
      titleEl.style.color = 'var(--text-primary)'; // 恢复默认
    }
    
    // 6. 显示模态框
    modal.style.display = 'flex';
    okBtn.focus(); // 聚焦确定按钮，方便回车关闭

    // 7. 定义清理与关闭逻辑
    const cleanup = () => {
      okBtn.removeEventListener('click', onClose);
      closeBtn.removeEventListener('click', onClose);
      modal.removeEventListener('click', onOverlayClick);
      window.removeEventListener('keydown', onEscKey);
      
      // 【关键】恢复取消按钮显示，以免影响 confirm-modal 的正常使用
      cancelBtn.style.display = '';
      // 恢复标题颜色
      titleEl.style.color = '';
    };

    const onClose = () => {
      cleanup();
      modal.style.display = 'none';
      resolve();
    };

    const onOverlayClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('modal-overlay') || target.id === 'confirm-modal') {
            onClose();
        }
    };
    
    const onEscKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' || e.key === 'Enter') {
            onClose();
        }
    };

    // 8. 绑定事件
    okBtn.addEventListener('click', onClose);
    closeBtn.addEventListener('click', onClose); // 关闭按钮也视为"知道了"
    modal.addEventListener('click', onOverlayClick);
    window.addEventListener('keydown', onEscKey);
  });
}

