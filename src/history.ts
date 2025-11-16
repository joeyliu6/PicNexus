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
 * 加载并渲染历史记录
 */
async function loadHistory() {
  const items = await historyStore.get<HistoryItem[]>('uploads');
  
  if (!items || items.length === 0) {
    historyBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #888;">暂无历史记录</td></tr>';
    return;
  }

  // 清空现有内容
  historyBody.innerHTML = '';

  // 填充表格 (PRD 3.3)
  for (const item of items) {
    const tr = document.createElement('tr');

    // 1. 本地文件名
    const tdName = document.createElement('td');
    tdName.textContent = item.fileName;
    tdName.title = item.fileName;
    tr.appendChild(tdName);

    // 2. 生成的链接
    const tdLink = document.createElement('td');
    const link = document.createElement('a');
    link.href = item.link;
    link.target = '_blank';
    link.textContent = item.link;
    link.title = item.link;
    tdLink.appendChild(link);
    tr.appendChild(tdLink);

    // 3. 操作 (一键复制按钮) (PRD 3.3)
    const tdAction = document.createElement('td');
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', async () => {
      try {
        await writeText(item.link);
        copyBtn.textContent = '已复制!';
        setTimeout(() => (copyBtn.textContent = '复制'), 1500);
      } catch (err) {
        copyBtn.textContent = '失败!';
      }
    });
    tdAction.appendChild(copyBtn);
    tr.appendChild(tdAction);

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

