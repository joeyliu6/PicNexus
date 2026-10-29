<script setup lang="ts">
// 从 URL 下载（HomeScreen.dc.html H10）：与其他对话框同一规格。实时显示识别到几个地址；
// 下载中按钮变「正在下载…」，下载完照常上传。Ctrl+Enter 提交、Esc 关闭。
import { computed, ref, watch } from 'vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnDialog from '@/components/pn/PnDialog.vue';
import { useUrlDownload } from '@/composables/upload/useUrlDownload';
import { uiPlatform } from '@/utils/platform';
import { formatShortcut } from '@/utils/shortcutText';

const open = defineModel<boolean>('open', { default: false });

const props = defineProps<{
  /** 「下载后上传到 京东、Cloudflare R2」 */
  hostNames: readonly string[];
  downloading: boolean;
}>();

const emit = defineEmits<{ submit: [input: string] }>();

const { parseUrls } = useUrlDownload();
const input = ref('');
watch(open, (value) => { if (value) input.value = ''; });

const count = computed(() => parseUrls(input.value).length);
/** 写法同全应用的快捷键（交接说明 3.3：Ctrl+Enter，macOS ⌘Enter；H10 画的「Ctrl Enter」不照做，同命令面板） */
const submitKeys = formatShortcut('CommandOrControl+Enter', uiPlatform());
const target = computed(() => (props.hostNames.length ? `下载后上传到${props.hostNames.join('、')}` : '下载后上传'));

function submit() {
  if (count.value === 0 || props.downloading) return;
  emit('submit', input.value);
}

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <PnDialog v-model:open="open" title="从 URL 下载" :eyebrow="target" icon="link">
    <label class="url-dialog__field">
      <span class="url-dialog__label">图片地址（每行一个）</span>
      <span class="url-dialog__box">
        <textarea
          v-model="input"
          class="url-dialog__input"
          spellcheck="false"
          placeholder="https://example.com/image.jpg"
          @keydown="onKeydown"
        />
      </span>
    </label>
    <span class="url-dialog__note">支持 JPG、PNG、GIF、WEBP、BMP<template v-if="count"> · 已识别 {{ count }} 个地址</template></span>
    <template #footer-left>
      <span class="url-dialog__note"><span class="url-dialog__mono">{{ submitKeys }}</span> 提交 · <span class="url-dialog__mono">Esc</span> 关闭</span>
    </template>
    <template #footer>
      <PnButton variant="secondary" size="dialog" @click="open = false">取消</PnButton>
      <PnButton variant="primary" size="dialog" :loading="downloading" :disabled="count === 0" @click="submit">
        {{ downloading ? '正在下载…' : '下载并上传' }}
      </PnButton>
    </template>
  </PnDialog>
</template>

<style>
.url-dialog__field { display: flex; flex-direction: column; gap: var(--pn-space-6); }

.url-dialog__label {
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
  color: var(--pn-text2);
}

/* 边框和焦点框画在外层：旧主题对 textarea:focus 的重置（box-shadow: none）够不着这里，和 PnInput 同一做法 */
.url-dialog__box {
  display: flex;
  height: var(--pn-size-url-input);
  border-radius: var(--pn-radius-md);
  background: var(--pn-field);
  box-shadow: inset 0 0 0 1px var(--pn-border-strong);
  transition: box-shadow var(--pn-dur-instant) var(--pn-ease-in);
}

.url-dialog__box:focus-within {
  box-shadow: inset 0 0 0 1px var(--pn-brand), 0 0 0 var(--pn-ring-soft-width) var(--pn-ring-soft);
}

.url-dialog__input {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  padding: var(--pn-space-8) var(--pn-space-sidebar-x);
  resize: none;
  border: 0;
  border-radius: inherit;
  outline: none;
  background: transparent;
  color: var(--pn-text1);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-mono);
  line-height: 1.7;
}

.url-dialog__note { font-size: var(--pn-text-footnote); color: var(--pn-text3); }
.url-dialog__mono { font-family: var(--pn-font-mono); }
</style>
