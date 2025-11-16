// src/history.ts
import { Store } from './store';
import { writeText } from '@tauri-apps/api/clipboard';
import { HistoryItem } from './config';

// 使用一个单独的 .dat 文件来存储历史记录
const historyStore = new Store('.history.dat');

// DOM 元素
const historyBody = document.getElementById('history-body')!;
const clearHistoryBtn = document.getElementById('clear-history-btn')!;
const statusMessageEl = document.getElementById('status-message')!;

/**
 * 删除单条历史记录
 */
async function deleteHistoryItem(itemId: string) {
  if (!confirm('您确定要从本地历史记录中删除此条目吗？此操作不会删除已上传到微博的图片。')) {
    return;
  }

  try {
    statusMessageEl.textContent = '删除中...';
    const items = await historyStore.get<HistoryItem[]>('uploads') || [];
    
    // 移除指定 ID 的记录
    const filteredItems = items.filter(item => item.id !== itemId);
    
    await historyStore.set('uploads', filteredItems);
    await historyStore.save();
    
    statusMessageEl.textContent = '已删除。';
    loadHistory(); // 重新加载列表
  } catch (err) {
    statusMessageEl.textContent = `删除失败: ${err}`;
    console.error('删除历史记录失败:', err);
  }
}

/**
 * 迁移旧格式的历史记录到新格式（向后兼容）
 */
function migrateHistoryItem(item: any): HistoryItem {
  // 如果是新格式，直接返回
  if (item.id && item.localFileName && item.generatedLink) {
    return item as HistoryItem;
  }
  
  // 旧格式迁移：fileName -> localFileName, link -> generatedLink
  return {
    id: item.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
    timestamp: item.timestamp || Date.now(),
    localFileName: item.localFileName || item.fileName || '未知文件',
    weiboPid: item.weiboPid || '',
    generatedLink: item.generatedLink || item.link || '',
    r2Key: item.r2Key || null,
  };
}

/**
 * 加载并渲染历史记录
 */
async function loadHistory() {
  let items = await historyStore.get<any[]>('uploads');
  
  if (!items || items.length === 0) {
    historyBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #888;">暂无历史记录</td></tr>';
    return;
  }

  // 迁移旧格式数据
  const migratedItems = items.map(migrateHistoryItem);
  
  // 如果有迁移，保存回存储
  const needsSave = items.some(item => !item.id || !item.localFileName || !item.generatedLink);
  if (needsSave) {
    await historyStore.set('uploads', migratedItems);
    await historyStore.save();
  }

  // 清空现有内容
  historyBody.innerHTML = '';

  // 填充表格 (PRD 1.1 - 增强型本地管理)
  for (const item of migratedItems) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', item.id); // 用于删除时定位

    // 1. 本地文件名
    const tdName = document.createElement('td');
    tdName.textContent = item.localFileName;
    tdName.title = item.localFileName;
    tr.appendChild(tdName);

    // 2. 生成的链接
    const tdLink = document.createElement('td');
    const link = document.createElement('a');
    link.href = item.generatedLink;
    link.target = '_blank';
    link.textContent = item.generatedLink;
    link.title = item.generatedLink;
    tdLink.appendChild(link);
    tr.appendChild(tdLink);

    // 3. 操作 (一键复制按钮)
    const tdAction = document.createElement('td');
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', async () => {
      try {
        await writeText(item.generatedLink);
        copyBtn.textContent = '已复制!';
        setTimeout(() => (copyBtn.textContent = '复制'), 1500);
      } catch (err) {
        copyBtn.textContent = '失败!';
      }
    });
    tdAction.appendChild(copyBtn);
    tr.appendChild(tdAction);

    // 4. 删除按钮 (PRD 1.1)
    const tdDelete = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = '删除此记录';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.border = 'none';
    deleteBtn.style.background = 'transparent';
    deleteBtn.style.fontSize = '16px';
    deleteBtn.addEventListener('click', () => {
      deleteHistoryItem(item.id);
    });
    tdDelete.appendChild(deleteBtn);
    tr.appendChild(tdDelete);

    historyBody.appendChild(tr);
  }
}

/**
 * 清空历史记录
 */
async function clearHistory() {
  if (!confirm('确定要清空所有上传历史记录吗？此操作不可撤销。')) {
    return;
  }
  try {
    statusMessageEl.textContent = '清空中...';
    await historyStore.clear();
    await historyStore.save();
    statusMessageEl.textContent = '已清空。';
    loadHistory(); // 重新加载以显示空状态
  } catch (err) {
    statusMessageEl.textContent = `清空失败: ${err}`;
  }
}

// 绑定事件
clearHistoryBtn.addEventListener('click', clearHistory);

// 初始加载
document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
});

