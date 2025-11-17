// src/login-webview.ts
import { appWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/tauri';

/**
 * 获取 DOM 元素，带空值检查
 * @param id 元素 ID
 * @param elementType 元素类型描述（用于错误消息）
 * @returns DOM 元素或 null
 */
function getElement<T extends HTMLElement>(id: string, elementType: string = '元素'): T | null {
  const element = document.getElementById(id);
  if (!element) {
    console.error(`[登录窗口] ${elementType} 不存在: ${id}`);
    return null;
  }
  return element as T;
}

// DOM元素（带空值检查）
const getCookieBtn = getElement<HTMLButtonElement>('get-cookie-btn', '获取Cookie按钮');
const closeBtn = getElement<HTMLButtonElement>('close-btn', '关闭按钮');
const statusMessage = getElement<HTMLDivElement>('status-message', '状态消息');
const startLoginBtn = getElement<HTMLButtonElement>('start-login-btn', '开始登录按钮');
const instructionsDiv = getElement<HTMLDivElement>('instructions', '说明区域');
const tipsSection = getElement<HTMLDivElement>('tips-section', '提示区域');

/**
 * 显示状态消息
 * @param message 消息文本
 * @param type 消息类型 ('normal' | 'success' | 'error')
 */
function showStatus(message: string, type: 'normal' | 'success' | 'error' = 'normal'): void {
  if (!statusMessage) {
    console.warn('[登录窗口] statusMessage 不存在，无法显示状态:', message);
    return;
  }
  
  try {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
  } catch (error) {
    console.error('[登录窗口] 显示状态失败:', error);
  }
}

/**
 * 从后端获取请求头 Cookie
 * @returns Cookie 字符串，如果失败返回 null
 */
async function fetchRequestHeaderCookie(): Promise<string | null> {
  try {
    console.log('[手动获取] 开始调用后端请求头Cookie提取');
    
    const cookie = await invoke<string>('get_request_header_cookie');
    
    console.log('[手动获取] 后端返回的Cookie长度:', cookie?.length || 0);
    
    if (!cookie || typeof cookie !== 'string') {
      console.warn('[手动获取] Cookie 无效或为空:', typeof cookie);
      return null;
    }
    
    const trimmedCookie = cookie.trim();
    if (trimmedCookie.length === 0) {
      console.warn('[手动获取] Cookie 为空字符串');
      return null;
    }
    
    console.log('[手动获取] ✓ 成功获取请求头Cookie');
    return trimmedCookie;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[手动获取] 请求头Cookie提取失败:', errorMsg);
    return null;
  }
}

/**
 * 开始登录按钮事件处理
 * 加载微博登录页面并启动Cookie监控
 */
if (startLoginBtn) {
  startLoginBtn.addEventListener('click', async () => {
    try {
      console.log('[自动登录] 开始加载微博登录页面');
      
      // 隐藏说明，显示提示
      if (instructionsDiv) {
        try {
          instructionsDiv.style.display = 'none';
        } catch (error) {
          console.warn('[自动登录] 隐藏说明区域失败:', error);
        }
      }
      
      if (tipsSection) {
        try {
          tipsSection.innerHTML = `
            <strong>💡 登录中：</strong>
            页面正在加载微博登录页面，登录成功后会自动检测并获取Cookie...
          `;
        } catch (error) {
          console.warn('[自动登录] 更新提示区域失败:', error);
        }
      }
      
      showStatus('正在加载微博登录页面...', 'normal');
      
      // 启动后端Cookie监控
      try {
        await invoke('start_cookie_monitoring');
        console.log('[自动登录] ✓ 已启动后端Cookie监控');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[自动登录] 启动监控失败:', errorMsg);
        showStatus(`⚠️ 启动监控失败: ${errorMsg}`, 'error');
        // 继续跳转，即使监控启动失败
      }
      
      // 跳转到微博登录页面
      try {
        window.location.href = 'https://m.weibo.cn/';
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[自动登录] 页面跳转失败:', errorMsg);
        showStatus(`❌ 页面跳转失败: ${errorMsg}`, 'error');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[自动登录] 开始登录失败:', errorMsg);
      showStatus(`❌ 开始登录失败: ${errorMsg}`, 'error');
    }
  });
} else {
  console.error('[登录窗口] 开始登录按钮不存在');
}


/**
 * 手动获取Cookie按钮事件处理（备用方案）
 * 尝试从请求头或页面Cookie中获取
 */
if (getCookieBtn) {
  getCookieBtn.addEventListener('click', async () => {
    try {
      console.log('[手动获取] 开始手动获取Cookie');
      
      // 禁用按钮防止重复点击
      getCookieBtn.disabled = true;
      showStatus('🔎 正在尝试读取请求头Cookie...', 'normal');

      // 尝试从请求头获取Cookie
      let cookie: string | null = null;
      let cookieSource: 'header' | 'document' = 'header';
      
      try {
        cookie = await fetchRequestHeaderCookie();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn('[手动获取] 获取请求头Cookie失败:', errorMsg);
      }

      // 如果请求头没有Cookie，尝试从页面获取
      if (!cookie || cookie.length === 0) {
        showStatus('⚠️ 未检测到请求头Cookie，尝试页面Cookie...', 'normal');
        
        try {
          const docCookie = document.cookie;
          if (docCookie && typeof docCookie === 'string' && docCookie.trim().length > 0) {
            cookie = docCookie.trim();
            cookieSource = 'document';
            console.log('[手动获取] 成功获取页面Cookie');
          } else {
            console.warn('[手动获取] 页面Cookie为空');
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error('[手动获取] 读取页面Cookie失败:', errorMsg);
        }
      }

      // 验证Cookie
      if (!cookie || cookie.trim().length === 0) {
        console.warn('[手动获取] 未检测到任何Cookie');
        showStatus('❌ 未检测到Cookie，请确保已登录', 'error');
        getCookieBtn.disabled = false;
        return;
      }

      const trimmedCookie = cookie.trim();
      console.log(`[手动获取] 使用${cookieSource === 'header' ? '请求头' : '页面'}Cookie，长度: ${trimmedCookie.length}`);
      showStatus('✅ 正在保存Cookie...', 'success');
      
      // 调用后端保存Cookie
      try {
        await invoke('save_cookie_from_login', { cookie: trimmedCookie });
        console.log('[手动获取] ✓ Cookie已保存');
        showStatus('✅ Cookie保存成功！窗口将在2秒后关闭...', 'success');
        
        // 2秒后关闭窗口
        setTimeout(async () => {
          try {
            await appWindow.close();
            console.log('[手动获取] ✓ 窗口已关闭');
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error('[手动获取] 关闭窗口失败:', errorMsg);
          }
        }, 2000);
      } catch (invokeError) {
        const errorMsg = invokeError instanceof Error ? invokeError.message : String(invokeError);
        console.error('[手动获取] 保存Cookie失败:', errorMsg);
        showStatus(`❌ 保存失败: ${errorMsg}`, 'error');
        getCookieBtn.disabled = false;
      }
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[手动获取] 获取Cookie失败:', errorMsg);
      showStatus(`❌ 获取失败: ${errorMsg}`, 'error');
      if (getCookieBtn) {
        getCookieBtn.disabled = false;
      }
    }
  });
} else {
  console.error('[登录窗口] 获取Cookie按钮不存在');
}

/**
 * 关闭按钮事件处理
 */
if (closeBtn) {
  closeBtn.addEventListener('click', async () => {
    try {
      console.log('[登录窗口] 关闭窗口');
      await appWindow.close();
      console.log('[登录窗口] ✓ 窗口已关闭');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[登录窗口] 关闭窗口失败:', errorMsg);
      showStatus(`❌ 关闭窗口失败: ${errorMsg}`, 'error');
    }
  });
} else {
  console.error('[登录窗口] 关闭按钮不存在');
}

/**
 * 键盘快捷键：ESC 键关闭窗口
 */
document.addEventListener('keydown', (e) => {
  try {
    if (e.key === 'Escape') {
      console.log('[登录窗口] 检测到 ESC 键，关闭窗口');
      if (closeBtn) {
        closeBtn.click();
      } else {
        console.warn('[登录窗口] 关闭按钮不存在，无法通过 ESC 键关闭');
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[登录窗口] 键盘事件处理失败:', errorMsg);
  }
});

console.log('[登录窗口] ✓ 页面已初始化');

