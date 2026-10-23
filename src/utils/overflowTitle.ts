// 被省略号截断的文字（文件名）：鼠标移上去时用系统提示补上全文；没被截断的不挂提示，免得每个名字都冒一个。
// 用法：<span v-overflow-title class="…">{{ name }}</span>，元素自己负责截断（overflow: hidden + text-overflow: ellipsis）。

import type { Directive } from 'vue';

function syncTitle(this: HTMLElement): void {
  if (this.scrollWidth > this.clientWidth) this.title = this.textContent?.trim() ?? '';
  else this.removeAttribute('title');
}

export const vOverflowTitle: Directive<HTMLElement> = {
  mounted(el) {
    el.addEventListener('mouseenter', syncTitle);
  },
  beforeUnmount(el) {
    el.removeEventListener('mouseenter', syncTitle);
  },
};
