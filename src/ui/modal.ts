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

