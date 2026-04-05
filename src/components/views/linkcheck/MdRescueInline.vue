<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Dialog from 'primevue/dialog';
import RadioButton from 'primevue/radiobutton';
import VirtualScroller from 'primevue/virtualscroller';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useMdRescueManager } from '../../../composables/useMdRescue';
import type { FileHealth, RepairStrategy, MdImageLinkWithFile } from '../../../composables/useMdRescue';
import { useToast } from '../../../composables/useToast';
import { getServiceDisplayName } from '../../../constants/serviceNames';
import { smartTruncateUrl } from '../../../utils/mdParser';
import type { CheckLinkResult } from '../../../types/linkCheck';

const {
  phase,
  imageLinks,
  isAnalyzing,
  isChecking,
  progress,
  fileHealthList,
  availableBackupServices,
  fixingProgress,
  repairReceipt,
  hostPreference,
  includeSubfolders,
  bottomStats,
  selectMdFile,
  selectFolder,
  handleDropPaths,
  analyzeFile,
  applyRepairStrategy,
  loadHostPreference,
  saveHostPreference,
  cancelCheck,
  undoReplace,
  executeReplace,
  reset: resetRescue,
  scanStage,
} = useMdRescueManager();

// Tauri 拖放
const isDragging = ref(false);
let dropUnlisten: (() => void) | null = null;

async function setupDropListener() {
  try {
    const webview = getCurrentWebview();
    dropUnlisten = await webview.onDragDropEvent(async (event) => {
      if (event.payload.type === 'over') {
        isDragging.value = true;
      } else if (event.payload.type === 'drop') {
        isDragging.value = false;
        await handleDropPaths(event.payload.paths);
      } else {
        isDragging.value = false;
      }
    });
  } catch (err) {
    console.error('[MdRescue] 设置拖放监听失败:', err);
  }
}

onMounted(() => { setupDropListener(); });
onBeforeUnmount(() => { dropUnlisten?.(); });

// ============================================================
// 局部 UI 状态
// ============================================================

const showHealthySummary = ref(false);
const showRepairDialog = ref(false);
const repairStrategyType = ref<'priority' | 'fastest' | 'manual'>('priority');
const showManualSection = ref(false);
const tempPreference = ref<string[]>([]);
/** 逐张手选：url → 选中的备用链接 url */
const manualSelections = ref(new Map<string, string>());

const toast = useToast();

/** 表格筛选状态 */
const activeFilter = ref<'all' | 'rescuable' | 'manual'>('all');

/** 虚拟滚动阈值：超过 100 条启用 */
const VIRTUAL_THRESHOLD = 100;
const ROW_HEIGHT = 60;

// ============================================================
// 计算
// ============================================================

const rescuableCount = computed(() =>
  imageLinks.value.filter((l) =>
    l.checkResult && !l.checkResult.is_valid
    && l.backupLinks?.some((b) => b.checkResult?.is_valid),
  ).length,
);

const hasRescuable = computed(() => rescuableCount.value > 0);

/** 已就绪的有问题文件 */
const readyBrokenFiles = computed(() =>
  fileHealthList.value.filter((f) => f.ready && f.status !== 'healthy'),
);

/** 已就绪的健康文件 */
const readyHealthyFiles = computed(() =>
  fileHealthList.value.filter((f) => f.ready && f.status === 'healthy'),
);

const fixingPercent = computed(() => {
  const { current, total } = fixingProgress.value;
  if (total === 0) return 0;
  return Math.round((current / total) * 100);
});

/** 当前扫描 URL 反查到的源文件名 */
const currentScanFileName = computed(() => {
  if (!progress.value?.current_url) return '';
  const url = progress.value.current_url;
  const link = imageLinks.value.find((l) => l.url === url);
  return link ? link.sourceFileName : smartTruncateUrl(url, 40);
});

/** 健康文件每个文件的图片数 */
function getFileImageCount(filePath: string): number {
  return imageLinks.value.filter((l) => l.sourceFile === filePath).length;
}

/** 是否在修复完成状态（done 阶段或有已修复文件） */
const isRepaired = computed(() => phase.value === 'done');

// ============================================================
// Watch
// ============================================================

watch(
  () => scanStage.value,
  async (stage) => {
    if (stage === 'complete') {
      showHealthySummary.value = false;
      await loadHostPreference();
      tempPreference.value = hostPreference.value.length > 0
        ? [...hostPreference.value]
        : [...availableBackupServices.value];
    }
  },
);

// ============================================================
// 方法
// ============================================================

async function handleSelectFile() {
  const ok = await selectMdFile();
  if (ok && imageLinks.value.length > 0) await analyzeFile();
}

async function handleSelectFolder() {
  const ok = await selectFolder();
  if (ok && imageLinks.value.length > 0) await analyzeFile();
}

/** 按文件路径预分组的失效链接（修复中卡片展开时使用） */
const brokenLinksByFile = computed(() => {
  const map = new Map<string, typeof imageLinks.value>();
  for (const l of imageLinks.value) {
    if (l.checkResult && !l.checkResult.is_valid) {
      const arr = map.get(l.sourceFile);
      if (arr) arr.push(l);
      else map.set(l.sourceFile, [l]);
    }
  }
  return map;
});

function getFileBrokenLinks(filePath: string) {
  return brokenLinksByFile.value.get(filePath) ?? [];
}

function errorDesc(cr: CheckLinkResult): string {
  if (cr.error_type === 'timeout') return '连接超时';
  if (cr.error_type === 'network') return '网络错误';
  if (cr.error_type === 'http_4xx') {
    if (cr.status_code === 403) return '防盗链';
    if (cr.status_code === 404) return '图片不存在';
    return `HTTP ${cr.status_code}`;
  }
  if (cr.error_type === 'http_5xx') return '服务器错误';
  if (cr.error_type === 'suspicious') return '可疑响应';
  return '检测失败';
}

function truncatePath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.length <= 2) return path;
  return '.../' + parts.slice(-2).join('/');
}

function getFileDirectory(fullPath: string): string {
  const normalized = fullPath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === -1) return '';
  const dir = normalized.substring(0, lastSlash + 1);
  const parts = dir.split('/').filter(Boolean);
  if (parts.length <= 3) return dir;
  return '.../' + parts.slice(-2).join('/') + '/';
}

// ---------- 修复策略弹窗 ----------

function moveServiceUp(i: number) {
  if (i === 0) return;
  const arr = [...tempPreference.value];
  [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
  tempPreference.value = arr;
}

function openRepairDialog() {
  // 初始化手动选择
  manualSelections.value = new Map();
  for (const link of imageLinks.value) {
    if (!link.checkResult || link.checkResult.is_valid) continue;
    const validBackups = link.backupLinks?.filter((b) => b.checkResult?.is_valid);
    if (validBackups && validBackups.length > 0) {
      manualSelections.value.set(link.url, validBackups[0].url);
    }
  }
  showManualSection.value = false;
  showRepairDialog.value = true;
}

/** 可修复的图片链接（用于弹窗手动选择列表） */
const rescuableLinks = computed(() =>
  imageLinks.value.filter(
    (l) => l.checkResult && !l.checkResult.is_valid
      && l.backupLinks?.some((b) => b.checkResult?.is_valid),
  ),
);

async function confirmRepair() {
  showRepairDialog.value = false;

  let strategy: RepairStrategy;
  switch (repairStrategyType.value) {
    case 'priority':
      strategy = { type: 'priority', order: tempPreference.value };
      // 同时保存为默认偏好
      hostPreference.value = [...tempPreference.value];
      await saveHostPreference();
      break;
    case 'fastest':
      strategy = { type: 'fastest' };
      break;
    case 'manual':
      strategy = { type: 'manual', selections: manualSelections.value };
      break;
  }

  applyRepairStrategy(strategy);
  await executeReplace();
}

// fixing 阶段辅助函数
function fixingCardClass(file: FileHealth): string {
  if (file.healed) return 'fixing-card--done';
  if (fixingFileIsActive(file)) return 'fixing-card--active';
  return 'fixing-card--pending';
}

function fixingCardIconClass(file: FileHealth): string {
  if (file.healed) return 'pi-check-circle';
  if (fixingFileIsActive(file)) return 'pi-spin pi-spinner';
  return 'pi-clock';
}

function fixingFileIsActive(file: FileHealth): boolean {
  if (file.healed) return false;
  const notHealed = fileHealthList.value.filter((f) => !f.healed && f.rescuableCount > 0);
  return notHealed.length > 0 && notHealed[0].path === file.path;
}

// ============================================================
// 新设计：扁平表格 & 筛选 & 行动操作
// ============================================================

/** 扁平化的失效链接列表（含视觉分组标记 firstOfFile） */
interface FlatRow {
  link: MdImageLinkWithFile;
  firstOfFile: boolean;
  status: 'rescuable' | 'manual' | 'replaced';
}

/** 扁平行 + 计数，单次遍历 imageLinks 同时产出 */
const flatBrokenData = computed(() => {
  const rows: FlatRow[] = [];
  let manual = 0, rescuable = 0;
  for (const l of imageLinks.value) {
    if (!l.checkResult || l.checkResult.is_valid) continue;
    const hasValidBackup = l.backupLinks?.some((b) => b.checkResult?.is_valid) ?? false;
    let status: FlatRow['status'];
    if (isRepaired.value && l.selectedBackup) status = 'replaced';
    else if (hasValidBackup) status = 'rescuable';
    else status = 'manual';
    if (status === 'manual') manual++;
    else rescuable++;
    rows.push({ link: l, firstOfFile: false, status });
  }
  return { rows, counts: { all: rows.length, rescuable, manual } };
});

const flatBrokenLinks = computed(() => flatBrokenData.value.rows);
const filterCounts = computed(() => flatBrokenData.value.counts);

/** 按筛选后的行列表（firstOfFile 在此重算以保证视觉分组正确） */
const filteredRows = computed<FlatRow[]>(() => {
  const all = flatBrokenLinks.value;
  const filter = activeFilter.value;

  // 预估容量，减少数组扩容
  const expected = filter === 'all'
    ? all.length
    : filter === 'manual' ? filterCounts.value.manual : filterCounts.value.rescuable;
  const result: FlatRow[] = [];
  if (expected > 0) result.length = 0;

  let prevFile = '';
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    if (filter === 'rescuable' && r.status === 'manual') continue;
    if (filter === 'manual' && r.status !== 'manual') continue;
    result.push({
      link: r.link,
      status: r.status,
      firstOfFile: r.link.sourceFile !== prevFile,
    });
    prevFile = r.link.sourceFile;
  }
  return result;
});

/** 可修复芯片标签（done 阶段显示"已修复"） */
const rescuableChipLabel = computed(() => (isRepaired.value ? '已修复' : '可修复'));

/** 是否启用虚拟滚动 */
const useVirtualScroll = computed(() => filteredRows.value.length > VIRTUAL_THRESHOLD);

/** 从 URL 中提取文件名 */
function extractFilenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return decodeURIComponent(last);
    return u.hostname;
  } catch {
    const tail = url.split('/').pop() || url;
    return tail.split('?')[0] || url;
  }
}

/** 单行状态圆点颜色类 */
function rowStatusClass(r: FlatRow): string {
  if (r.status === 'replaced') return 'row-status--replaced';
  if (r.status === 'rescuable') return 'row-status--rescuable';
  return 'row-status--manual';
}

/** 单行状态文字 */
function rowStatusText(r: FlatRow): string {
  if (r.status === 'replaced') return '已替换';
  if (r.status === 'rescuable') return '可修复';
  return '无备用';
}

const virtualScrollerRef = ref<InstanceType<typeof VirtualScroller> | null>(null);

/** 点击筛选芯片 */
function selectFilter(f: 'all' | 'rescuable' | 'manual') {
  if (activeFilter.value === f) return;
  activeFilter.value = f;
  // 重置虚拟滚动条到顶部
  virtualScrollerRef.value?.scrollToIndex(0);
}

/** 复制单个链接（replaced 状态复制新链接，其他复制原链接） */
async function copyRowLink(row: FlatRow) {
  const target = row.status === 'replaced' && row.link.selectedBackup
    ? row.link.selectedBackup
    : row.link.url;
  const label = row.status === 'replaced' ? '新链接' : '链接';
  try {
    await writeText(target);
    toast.success('已复制', `${label}已复制到剪贴板`);
  } catch (err) {
    toast.error('复制失败', String(err));
  }
}

/** 复制全部无备用链接 */
async function copyAllManualLinks() {
  const urls = flatBrokenLinks.value
    .filter((r) => r.status === 'manual')
    .map((r) => r.link.url)
    .join('\n');
  if (!urls) {
    toast.info('无可复制内容', '没有"无备用链接"的图片');
    return;
  }
  try {
    await writeText(urls);
    toast.success('已复制', `${filterCounts.value.manual} 个链接已复制到剪贴板`);
  } catch (err) {
    toast.error('复制失败', String(err));
  }
}

/** 导出 CSV 报告 */
async function exportCsvReport() {
  if (flatBrokenLinks.value.length === 0) {
    toast.info('无可导出内容', '没有异常链接');
    return;
  }
  const header = '状态,图片链接,所属文件,文件路径,错误类型\r\n';
  const rows = flatBrokenLinks.value.map((r) => {
    const statusText = r.status === 'manual' ? '无备用' : (r.status === 'replaced' ? '已替换' : '可修复');
    const errType = r.link.checkResult ? errorDesc(r.link.checkResult) : '';
    // CSV 转义：双引号包裹，内部双引号加倍
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    return [statusText, r.link.url, r.link.sourceFileName, r.link.sourceFile, errType].map(esc).join(',');
  }).join('\r\n');
  const csv = '\uFEFF' + header + rows; // BOM 防止中文乱码

  try {
    const path = await save({
      defaultPath: `md-rescue-report-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!path) return;
    await writeTextFile(path, csv);
    toast.success('已导出', `报告已保存至 ${path}`);
  } catch (err) {
    toast.error('导出失败', String(err));
  }
}
</script>

<template>
  <div class="md-rescue">

    <!-- ====== idle: 紧凑拖放区 ====== -->
    <div v-if="phase === 'idle'" class="rescue-phase rescue-idle">
      <div class="idle-zone" :class="{ dragging: isDragging }">
        <div class="idle-icon-wrap"><i class="pi pi-upload" /></div>
        <span class="idle-main-text">拖放 Markdown 文件到此处</span>
        <span class="idle-sub-text">支持 .md 和 .markdown 文件</span>
        <div class="idle-buttons">
          <Button label="选择文件" :loading="isAnalyzing || isChecking" class="idle-btn-primary" @click="handleSelectFile" />
          <Button label="选择文件夹" severity="secondary" outlined :loading="isAnalyzing || isChecking" class="idle-btn-secondary" @click="handleSelectFolder" />
        </div>
        <label class="idle-subfolder-option">
          <Checkbox v-model="includeSubfolders" :binary="true" />
          <span>选择文件夹时包含子文件夹</span>
        </label>
      </div>
    </div>

    <!-- ====== working: scanning / fixing / done 统一布局 ====== -->
    <div v-else class="rescue-phase rescue-working">

      <!-- fixing 阶段顶栏 -->
      <div v-if="phase === 'fixing'" class="wk-header">
        <span class="wk-title">正在修复...</span>
        <span class="wk-subtitle">{{ fixingProgress.current }}/{{ fixingProgress.total }} ({{ fixingPercent }}%)</span>
      </div>

      <!-- done 阶段顶栏 -->
      <div v-if="phase === 'done'" class="wk-header">
        <div class="wk-title-group">
          <i class="pi pi-check-circle wk-done-icon" />
          <span class="wk-title">修复完成</span>
          <span v-if="repairReceipt" class="wk-subtitle">共修复 {{ repairReceipt.linksFixed }} 张图片链接</span>
        </div>
        <div class="wk-actions">
          <Button label="撤销" severity="secondary" size="small" icon="pi pi-undo" outlined :disabled="!repairReceipt?.fileBackupMap.length" @click="undoReplace" />
        </div>
      </div>

      <!-- fixing 阶段进度条 -->
      <div v-if="phase === 'fixing'" class="wk-progress">
        <div class="wk-progress-fill" :style="{ width: fixingPercent + '%' }" />
      </div>

      <!-- 内容区 -->
      <div class="wk-body">

        <!-- scanning / done: 扁平表格布局 -->
        <template v-if="phase === 'scanning' || phase === 'done'">
          <template v-if="!(phase === 'scanning' && !progress && scanStage === 'checking')">

            <!-- 顶部操作栏：筛选芯片 + 正常文件折叠链接 -->
            <div v-if="flatBrokenLinks.length > 0" class="mr-action-bar">
              <div class="mr-chips">
                <button class="mr-chip" :class="{ active: activeFilter === 'all' }" @click="selectFilter('all')">
                  <span>全部</span>
                  <span class="mr-chip-count">{{ filterCounts.all }}</span>
                </button>
                <button class="mr-chip" :class="{ active: activeFilter === 'rescuable' }" @click="selectFilter('rescuable')">
                  <span>{{ rescuableChipLabel }}</span>
                  <span class="mr-chip-count">{{ filterCounts.rescuable }}</span>
                </button>
                <button class="mr-chip" :class="{ active: activeFilter === 'manual' }" @click="selectFilter('manual')">
                  <span class="mr-dot mr-dot--amber" />
                  <span>需手动</span>
                  <span class="mr-chip-count">{{ filterCounts.manual }}</span>
                </button>
              </div>
              <button v-if="readyHealthyFiles.length > 0" class="mr-healthy-link" @click="showHealthySummary = !showHealthySummary">
                <i class="pi pi-check-circle" />
                <span>{{ readyHealthyFiles.length }} 个正常文件</span>
                <i class="pi" :class="showHealthySummary ? 'pi-chevron-up' : 'pi-chevron-right'" />
              </button>
            </div>

            <!-- 正常文件展开面板 -->
            <div v-if="readyHealthyFiles.length > 0" class="mr-healthy-wrap" :class="{ expanded: showHealthySummary }">
              <div class="mr-healthy-body">
                <div v-for="file in readyHealthyFiles" :key="file.path" class="mr-healthy-row">
                  <i class="pi pi-check" />
                  <span class="mr-healthy-name">{{ file.name }}</span>
                  <span class="mr-healthy-count">{{ getFileImageCount(file.path) }} 张图片</span>
                </div>
              </div>
            </div>

            <!-- 琥珀警告横幅（简短） -->
            <div v-if="filterCounts.manual > 0 && (scanStage === 'complete' || phase === 'done')" class="mr-warning-banner">
              <i class="pi pi-exclamation-triangle" />
              <span>{{ filterCounts.manual }} 张图片无备用链接，需手动处理</span>
            </div>

            <!-- 问题链接表格 -->
            <div v-if="filteredRows.length > 0" class="mr-table">
              <div class="mr-thead">
                <div class="mr-th mr-col-status">状态</div>
                <div class="mr-th mr-col-image">图片链接</div>
                <div class="mr-th mr-col-file">所在文件</div>
                <div class="mr-th mr-col-action">操作</div>
              </div>

              <VirtualScroller
                v-if="useVirtualScroll"
                ref="virtualScrollerRef"
                :items="filteredRows"
                :item-size="ROW_HEIGHT"
                class="mr-tbody mr-tbody--virtual"
              >
                <template #item="{ item }: { item: FlatRow }">
                  <div class="mr-tr" :class="{ 'mr-tr--first-of-file': item.firstOfFile }">
                    <div class="mr-td mr-col-status">
                      <span class="mr-dot" :class="rowStatusClass(item)" />
                      <span class="mr-status-text">{{ rowStatusText(item) }}</span>
                    </div>
                    <div class="mr-td mr-col-image">
                      <span class="mr-img-name" :title="item.link.url">{{ extractFilenameFromUrl(item.link.url) }}</span>
                      <span class="mr-img-url">{{ item.link.url }}</span>
                    </div>
                    <div class="mr-td mr-col-file">
                      <template v-if="item.firstOfFile">
                        <span class="mr-file-name" :title="item.link.sourceFile">{{ item.link.sourceFileName }}</span>
                        <span class="mr-file-path">{{ getFileDirectory(item.link.sourceFile) }}</span>
                      </template>
                    </div>
                    <div class="mr-td mr-col-action">
                      <button class="mr-action-btn" :title="item.status === 'replaced' ? '复制新链接' : '复制链接'" @click="copyRowLink(item)">
                        <i class="pi pi-copy" />
                        <span>复制</span>
                      </button>
                    </div>
                  </div>
                </template>
              </VirtualScroller>

              <div v-else class="mr-tbody">
                <div
                  v-for="(row, i) in filteredRows"
                  :key="row.link.sourceFile + '|' + row.link.url + '|' + i"
                  class="mr-tr"
                  :class="{ 'mr-tr--first-of-file': row.firstOfFile }"
                >
                  <div class="mr-td mr-col-status">
                    <span class="mr-dot" :class="rowStatusClass(row)" />
                    <span class="mr-status-text">{{ rowStatusText(row) }}</span>
                  </div>
                  <div class="mr-td mr-col-image">
                    <span class="mr-img-name" :title="row.link.url">{{ extractFilenameFromUrl(row.link.url) }}</span>
                    <span class="mr-img-url">{{ row.link.url }}</span>
                  </div>
                  <div class="mr-td mr-col-file">
                    <template v-if="row.firstOfFile">
                      <span class="mr-file-name" :title="row.link.sourceFile">{{ row.link.sourceFileName }}</span>
                      <span class="mr-file-path">{{ getFileDirectory(row.link.sourceFile) }}</span>
                    </template>
                  </div>
                  <div class="mr-td mr-col-action">
                    <button class="mr-action-btn" :title="row.status === 'replaced' ? '复制新链接' : '复制链接'" @click="copyRowLink(row)">
                      <i class="pi pi-copy" />
                      <span>复制</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 筛选后为空 -->
            <div v-else-if="flatBrokenLinks.length > 0" class="mr-empty-filter">
              <i class="pi pi-filter-slash" />
              <span>此筛选条件下没有记录</span>
            </div>

            <!-- 扫描骨架屏指示器 -->
            <div v-if="phase === 'scanning' && scanStage !== 'complete'" class="scan-skeleton-card">
              <i class="pi pi-spin pi-spinner scan-skeleton-spinner" />
              <span class="scan-skeleton-text">
                <template v-if="scanStage === 'checking'">正在扫描: {{ currentScanFileName }}</template>
                <template v-else>正在验证备用链接可用性...</template>
              </span>
            </div>

            <!-- 全部正常、无问题 -->
            <div v-if="phase === 'scanning' && scanStage === 'complete' && readyBrokenFiles.length === 0 && readyHealthyFiles.length > 0" class="report-empty">
              <i class="pi pi-check-circle report-empty-icon" />
              <p>所有图片链接正常</p>
            </div>

            <!-- 底部引导卡片：复制/导出行动出口 -->
            <div v-if="filterCounts.manual > 0 && (scanStage === 'complete' || phase === 'done')" class="mr-guidance">
              <div class="mr-guidance-text">
                <i class="pi pi-lightbulb" />
                <span>这些图片未上传到其他图床，无法自动修复。你可以复制链接后在「上传」中重新上传，或导出报告后手动处理。</span>
              </div>
              <div class="mr-guidance-actions">
                <button class="mr-btn-sm" @click="copyAllManualLinks">
                  <i class="pi pi-copy" />
                  <span>复制全部链接</span>
                </button>
                <button class="mr-btn-sm" @click="exportCsvReport">
                  <i class="pi pi-download" />
                  <span>导出 CSV</span>
                </button>
              </div>
            </div>

            <!-- done 阶段备份路径提示 -->
            <div v-if="phase === 'done' && repairReceipt?.backupPath" class="done-backup">
              <i class="pi pi-save" />
              <span :title="repairReceipt.backupPath">原文件已备份至 {{ truncatePath(repairReceipt.backupPath) }}</span>
            </div>
          </template>
        </template>

        <!-- fixing: 三态文件卡片 -->
        <template v-if="phase === 'fixing'">
          <div v-for="file in fileHealthList" :key="file.path" class="fixing-card" :class="fixingCardClass(file)">
            <div class="fixing-card-header">
              <i class="pi fixing-card-icon" :class="fixingCardIconClass(file)" />
              <span class="fixing-card-name">{{ file.name }}</span>
              <span class="fixing-card-status">
                <template v-if="file.healed">{{ file.rescuableCount }}/{{ file.rescuableCount }} 已修复</template>
                <template v-else-if="fixingFileIsActive(file)">修复中…</template>
                <template v-else>等待中</template>
              </span>
            </div>
            <div v-if="fixingFileIsActive(file)" class="fixing-card-body">
              <div v-for="(link, i) in getFileBrokenLinks(file.path)" :key="i" class="fixing-link-row">
                <i class="pi" :class="link.backupLinks?.some(b => b.checkResult?.is_valid) ? 'pi-check-circle fixing-link-ok' : 'pi-spin pi-spinner fixing-link-spin'" />
                <span class="fixing-link-text">{{ smartTruncateUrl(link.url, 40) }} → 替换中…</span>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- ============================================================
           底栏
           ============================================================ -->
      <div class="rescue-bottom">
        <!-- 主操作区 -->
        <div class="rescue-bottom-main">
          <!-- 左侧统计 -->
          <div class="rescue-bottom-left">
            <!-- 解析阶段：显示解析状态 -->
            <template v-if="phase === 'scanning' && !progress && scanStage === 'checking'">
              <span class="rescue-stat rescue-stat--phase">
                <i class="pi pi-spin pi-spinner rescue-stat-icon" />
                正在解析文件...
              </span>
              <template v-if="bottomStats.totalFiles > 0">
                <span class="rescue-stat-sep" />
                <span class="rescue-stat">
                  <i class="pi pi-file rescue-stat-icon" />
                  已发现 {{ bottomStats.totalFiles }} 个文件，{{ bottomStats.totalImages }} 张图片
                </span>
              </template>
            </template>

            <!-- 扫描 / 备用链接 / 完成 / done 阶段 -->
            <template v-else>
              <!-- 备用链接阶段前缀状态 -->
              <span v-if="phase === 'scanning' && scanStage === 'backups'" class="rescue-stat rescue-stat--phase">
                <i class="pi pi-spin pi-spinner rescue-stat-icon" />
                正在验证备用链接...
              </span>
              <span v-if="phase === 'scanning' && scanStage === 'backups'" class="rescue-stat-sep" />

              <span class="rescue-stat">
                <i class="pi pi-file rescue-stat-icon" />
                {{ bottomStats.totalFiles }} 文件
              </span>
              <span class="rescue-stat-sep" />
              <span class="rescue-stat">
                <i class="pi pi-image rescue-stat-icon" />
                {{ bottomStats.totalImages }} 图片
              </span>
              <template v-if="isRepaired">
                <span class="rescue-stat-sep" />
                <span class="rescue-stat rescue-stat--success">
                  <i class="pi pi-check-circle rescue-stat-icon" />
                  {{ bottomStats.repairedCount }} 已修复
                </span>
                <template v-if="bottomStats.manualCount > 0">
                  <span class="rescue-stat-sep" />
                  <span class="rescue-stat rescue-stat--warning">
                    <i class="pi pi-exclamation-triangle rescue-stat-icon" />
                    {{ bottomStats.manualCount }} 需手动
                  </span>
                </template>
              </template>
              <template v-else-if="bottomStats.checkedCount > 0">
                <span class="rescue-stat-sep" />
                <span class="rescue-stat rescue-stat--success">
                  <i class="pi pi-check-circle rescue-stat-icon" />
                  {{ bottomStats.normalCount }} 正常
                </span>
                <template v-if="bottomStats.problemCount > 0">
                  <span class="rescue-stat-sep" />
                  <span class="rescue-stat rescue-stat--warning">
                    <i class="pi pi-exclamation-triangle rescue-stat-icon" />
                    {{ bottomStats.problemCount }} 问题
                  </span>
                </template>
              </template>
            </template>
          </div>

          <!-- 右侧按钮 -->
          <div class="rescue-bottom-actions">
            <!-- scanning 中 -->
            <template v-if="phase === 'scanning' && scanStage !== 'complete'">
              <button class="btn-danger btn-sm" @click="cancelCheck">
                <i class="pi pi-stop" /> 取消
              </button>
            </template>

            <!-- scanning 完成，无问题 -->
            <template v-else-if="phase === 'scanning' && scanStage === 'complete' && !hasRescuable">
              <button class="btn-ghost btn-sm" @click="resetRescue">
                <i class="pi pi-refresh" /> 重新扫描
              </button>
            </template>

            <!-- scanning 完成，有问题 -->
            <template v-else-if="phase === 'scanning' && scanStage === 'complete' && hasRescuable">
              <button class="btn-ghost btn-sm" @click="resetRescue">
                <i class="pi pi-refresh" /> 重新扫描
              </button>
              <button class="btn-primary btn-sm" @click="openRepairDialog">
                <i class="pi pi-wrench" /> 修复链接
              </button>
            </template>

            <!-- fixing -->
            <template v-else-if="phase === 'fixing'">
              <!-- 修复进行中无取消按钮 -->
            </template>

            <!-- done -->
            <template v-else-if="phase === 'done'">
              <button class="btn-ghost btn-sm" @click="resetRescue">
                <i class="pi pi-refresh" /> 重新扫描
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- ============================================================
         修复策略弹窗
         ============================================================ -->
    <Dialog
      v-model:visible="showRepairDialog"
      modal
      header="链接修复策略"
      :style="{ width: '520px' }"
      :draggable="false"
      :closable="true"
    >
      <div class="repair-dialog-body">
        <p class="repair-dialog-desc">选择如何为失效图片分配备用链接：</p>

        <!-- 策略 1: 指定图床优先 -->
        <div class="repair-strategy-option" :class="{ active: repairStrategyType === 'priority' }" @click="repairStrategyType = 'priority'">
          <RadioButton v-model="repairStrategyType" value="priority" />
          <div class="repair-strategy-content">
            <span class="repair-strategy-label">指定图床优先</span>
            <span class="repair-strategy-desc">按优先级顺序选择第一个可用链接，点击药丸可调整顺序</span>
            <div v-if="repairStrategyType === 'priority'" class="repair-pref-pills">
              <template v-for="(serviceId, i) in tempPreference" :key="serviceId">
                <i v-if="i > 0" class="pi pi-ellipsis-v pill-grip" />
                <button
                  class="pill-pref-item"
                  :class="{ 'pill-pref-item--first': i === 0 }"
                  @click.stop="moveServiceUp(i)"
                >{{ i + 1 }} · {{ getServiceDisplayName(serviceId) }}</button>
              </template>
            </div>
          </div>
        </div>

        <!-- 策略 2: 响应最快 -->
        <div class="repair-strategy-option" :class="{ active: repairStrategyType === 'fastest' }" @click="repairStrategyType = 'fastest'">
          <RadioButton v-model="repairStrategyType" value="fastest" />
          <div class="repair-strategy-content">
            <span class="repair-strategy-label">响应最快</span>
            <span class="repair-strategy-desc">自动选择延迟最低的可用备用链接</span>
          </div>
        </div>

        <!-- 策略 3: 逐张手动选择（折叠） -->
        <div class="repair-strategy-option repair-strategy-manual" :class="{ active: repairStrategyType === 'manual' }">
          <div class="repair-strategy-manual-header" @click="repairStrategyType = 'manual'; showManualSection = true">
            <RadioButton v-model="repairStrategyType" value="manual" />
            <div class="repair-strategy-content">
              <span class="repair-strategy-label">逐张手动选择</span>
              <span class="repair-strategy-desc">为每张图片单独指定备用链接</span>
            </div>
            <i class="pi" :class="showManualSection && repairStrategyType === 'manual' ? 'pi-chevron-up' : 'pi-chevron-down'" @click.stop="showManualSection = !showManualSection" />
          </div>
          <div v-if="repairStrategyType === 'manual' && showManualSection" class="repair-manual-list">
            <div v-for="link in rescuableLinks" :key="link.url" class="repair-manual-item">
              <div class="repair-manual-url">
                <i class="pi pi-image" />
                <span>{{ smartTruncateUrl(link.url, 40) }}</span>
                <span class="repair-manual-file">{{ link.sourceFileName }}</span>
              </div>
              <div class="repair-manual-options">
                <label
                  v-for="b in link.backupLinks!.filter(b => b.checkResult?.is_valid)"
                  :key="b.url"
                  class="repair-manual-radio"
                  :class="{ selected: manualSelections.get(link.url) === b.url }"
                >
                  <input
                    type="radio"
                    :name="'manual-' + link.url"
                    :value="b.url"
                    :checked="manualSelections.get(link.url) === b.url"
                    @change="manualSelections.set(link.url, b.url)"
                  />
                  <span class="backup-chip">{{ getServiceDisplayName(b.serviceId) }}</span>
                  <span v-if="b.checkResult?.response_time" class="repair-manual-latency">{{ b.checkResult.response_time }}ms</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="repair-dialog-footer">
          <Button label="取消" severity="secondary" outlined @click="showRepairDialog = false" />
          <Button :label="`开始修复 (${rescuableCount} 张)`" icon="pi pi-wrench" @click="confirmRepair" />
        </div>
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.md-rescue {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.rescue-phase {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ============================================================
   idle: 紧凑居中拖放区
   ============================================================ */
.rescue-idle {
  align-items: center;
  justify-content: center;
  padding: 40px;
}

.idle-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  width: 100%;
  max-width: 480px;
  padding: 56px 40px 40px;
  border: 2px dashed var(--border-subtle);
  border-radius: 16px;
  cursor: default;
  transition: border-color 0.3s, background 0.3s;
}

.idle-zone:hover { border-color: var(--primary-alpha-40); }

.idle-zone.dragging {
  border-color: var(--primary);
  background: var(--primary-alpha-5);
  border-style: solid;
}

.idle-icon-wrap {
  margin-bottom: 20px;
  color: var(--primary);
  transition: transform 0.3s ease;
}

.idle-zone.dragging .idle-icon-wrap { transform: translateY(-4px) scale(1.1); }
.idle-icon-wrap i { font-size: 36px; }

.idle-main-text {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.idle-sub-text {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 36px;
}

.idle-buttons {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  max-width: 360px;
}

.idle-btn-primary.p-button {
  flex: 1; padding: 11px 0; font-size: 14px; font-weight: 600; border-radius: 8px;
}

.idle-btn-secondary.p-button {
  flex: 1; padding: 11px 0; font-size: 14px; font-weight: 500; border-radius: 8px;
  border-color: var(--border-subtle); color: var(--text-muted);
}

.idle-btn-secondary.p-button:hover { background: var(--hover-overlay-subtle); }

.idle-subfolder-option {
  display: flex; align-items: center; gap: 6px; margin-top: 16px;
  font-size: 12px; color: var(--text-tertiary); cursor: pointer; user-select: none;
}

/* ============================================================
   working: 统一布局
   ============================================================ */
.rescue-working {
  overflow: hidden;
  position: relative;
}

/* ---------- 顶栏 ---------- */
.wk-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; height: 48px; border-bottom: 1px solid var(--border-subtle); flex-shrink: 0;
}

.wk-title-group { display: flex; align-items: center; gap: 12px; }
.wk-title { font-size: 14px; font-weight: 600; color: var(--text-main); }
.wk-subtitle { font-size: var(--text-sm); color: var(--text-tertiary); }
.wk-done-icon { font-size: 18px; color: var(--success); }
.wk-actions { display: flex; gap: 8px; }

/* ---------- 进度条 ---------- */
.wk-progress { height: 4px; background: var(--border-subtle); flex-shrink: 0; }
.wk-progress-fill { height: 100%; background: var(--primary); transition: width 0.35s ease; border-radius: 0 2px 2px 0; }

/* ---------- 内容区 ---------- */
.wk-body {
  flex: 1; overflow-y: auto; padding: 10px 16px;
  display: flex; flex-direction: column; gap: 8px;
}

/* backup-chip 仍在修复策略对话框的手动选择里使用 */
.backup-chip {
  display: inline-flex; padding: 2px 8px; border-radius: 9999px; font-size: 10px;
  background: var(--success-alpha-10); color: var(--success);
}

/* ============================================================
   骨架屏指示器
   ============================================================ */
.scan-skeleton-card {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; border-radius: 8px;
  border: 1px dashed var(--border-subtle);
  background: var(--hover-overlay-subtle);
  animation: skeleton-pulse 2s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.scan-skeleton-spinner {
  font-size: 13px; color: var(--text-tertiary); flex-shrink: 0;
}

.scan-skeleton-text {
  font-size: 12px; font-weight: 500; color: var(--text-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* report 空状态 */
.report-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; flex: 1; color: var(--text-tertiary); font-size: var(--text-sm);
}

.report-empty-icon { font-size: 36px; color: var(--success); }

/* ============================================================
   底栏
   ============================================================ */
/* 对齐链接监控面板 .bottom：无 border-top、简洁 gap + padding */
.rescue-bottom {
  display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;
  padding: 10px 16px 14px;
}

.rescue-bottom-main {
  display: flex; align-items: center; justify-content: space-between;
}

.rescue-bottom-left {
  display: flex; align-items: center; gap: 0; flex-wrap: wrap;
}

.rescue-stat {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 500; color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.rescue-stat-icon { font-size: 12px; }

.rescue-stat--success { color: var(--success); }
.rescue-stat--warning { color: var(--warning); }
.rescue-stat--phase { color: var(--primary); }

.rescue-stat-sep {
  width: 1px; height: 12px; background: var(--border-subtle);
  margin: 0 10px; flex-shrink: 0;
}

.rescue-bottom-actions {
  display: flex; align-items: center; gap: 8px; margin-left: auto;
}

/* ============================================================
   按钮
   ============================================================ */
.btn-ghost, .btn-primary, .btn-danger {
  display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 11px;
  border-radius: 7px; font-size: 12px; font-weight: 500; cursor: pointer;
  white-space: nowrap; transition: background 0.15s, opacity 0.15s; border: none;
  font-family: inherit;
}

.btn-ghost i, .btn-primary i, .btn-danger i { font-size: 11px; }
.btn-ghost { background: var(--bg-input); color: var(--text-muted); }
.btn-ghost:hover { background: var(--hover-overlay); color: var(--text-main); }
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { opacity: 0.9; }
.btn-danger { background: var(--error-alpha-15); color: var(--error); }
.btn-danger:hover { background: var(--error-alpha-8); }

/* ============================================================
   Fixing 三态卡片
   ============================================================ */
.fixing-card {
  border-radius: 10px; border: 1px solid var(--border-subtle);
  overflow: hidden; transition: background 0.25s, border-color 0.25s;
}

.fixing-card--done { background: var(--success-alpha-8); border-color: var(--success-alpha-15); }
.fixing-card--active { background: var(--warning-alpha-8); border-color: var(--warning-alpha-15); }
.fixing-card--pending { background: var(--bg-input); border-color: var(--border-subtle); }

.fixing-card-header {
  display: flex; align-items: center; gap: 10px; padding: 12px 14px;
}

.fixing-card-icon { font-size: 16px; flex-shrink: 0; }
.fixing-card--done .fixing-card-icon { color: var(--success); }
.fixing-card--active .fixing-card-icon { color: var(--warning); }
.fixing-card--pending .fixing-card-icon { color: var(--text-tertiary); }

.fixing-card-name {
  flex: 1; font-size: 14px; font-weight: 500; color: var(--text-main);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.fixing-card--done .fixing-card-name { color: var(--success); }

.fixing-card-status { font-size: 12px; font-weight: 500; flex-shrink: 0; }
.fixing-card--done .fixing-card-status { color: var(--success); }
.fixing-card--active .fixing-card-status { color: var(--warning); }
.fixing-card--pending .fixing-card-status { color: var(--text-tertiary); }

.fixing-card-body {
  padding: 0 14px 12px; display: flex; flex-direction: column; gap: 4px;
}

.fixing-link-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 11px; font-family: var(--font-mono, 'JetBrains Mono', monospace); color: var(--text-muted);
}

.fixing-link-ok { color: var(--success); font-size: 14px; }
.fixing-link-spin { color: var(--warning); font-size: 14px; }

.fixing-link-text {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ============================================================
   Done 备份和提示
   ============================================================ */
.done-backup {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--text-tertiary);
  padding: 8px 12px; background: var(--bg-input); border-radius: 8px;
}

.done-backup i { font-size: 14px; flex-shrink: 0; }

/* (Done 统计卡片行和 done-unrescuable-hint 已移除，功能融入新表格+引导卡片) */

/* ============================================================
   修复策略弹窗
   ============================================================ */
.repair-dialog-body {
  display: flex; flex-direction: column; gap: 12px;
}

.repair-dialog-desc {
  font-size: 13px; color: var(--text-muted); margin: 0;
}

.repair-strategy-option {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; border-radius: 10px;
  border: 1px solid var(--border-subtle);
  cursor: pointer; transition: background 0.15s, border-color 0.15s;
}

.repair-strategy-option:hover { background: var(--hover-overlay-subtle); }

.repair-strategy-option.active {
  border-color: var(--primary-alpha-30);
  background: var(--primary-alpha-5);
}

.repair-strategy-content {
  display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0;
}

.repair-strategy-label {
  font-size: 13px; font-weight: 600; color: var(--text-main);
}

.repair-strategy-desc {
  font-size: 11px; color: var(--text-tertiary);
}

.repair-pref-pills {
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
}

.pill-pref-item {
  display: inline-flex; align-items: center; height: 28px; padding: 0 10px;
  border-radius: 14px; font-size: 12px; font-weight: 500; white-space: nowrap;
  cursor: pointer; border: 1px solid var(--border-subtle);
  background: var(--bg-input); color: var(--text-muted); font-family: inherit;
  transition: background 0.12s, border-color 0.12s;
}

.pill-pref-item:hover {
  background: var(--primary-alpha-8); border-color: var(--primary-alpha-30); color: var(--primary);
}

.pill-pref-item--first {
  background: var(--primary-alpha-10); border-color: var(--primary-alpha-30);
  color: var(--primary); font-weight: 600;
}

.pill-grip {
  font-size: 10px; color: var(--text-tertiary); opacity: 0.5; flex-shrink: 0;
}

/* 手动选择 */
.repair-strategy-manual { flex-direction: column; gap: 0; }

.repair-strategy-manual-header {
  display: flex; align-items: flex-start; gap: 10px; cursor: pointer; width: 100%;
}

.repair-strategy-manual-header > .pi {
  margin-left: auto; margin-top: 4px; font-size: 12px; color: var(--text-tertiary);
}

.repair-manual-list {
  display: flex; flex-direction: column; gap: 8px;
  margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-subtle);
  max-height: 280px; overflow-y: auto;
}

.repair-manual-item {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px; border-radius: 8px; background: var(--bg-input);
}

.repair-manual-url {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--text-muted);
}

.repair-manual-url i { font-size: 12px; color: var(--text-tertiary); }

.repair-manual-url span {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.repair-manual-file {
  font-family: inherit !important;
  margin-left: auto; flex-shrink: 0;
  color: var(--text-tertiary);
}

.repair-manual-options {
  display: flex; flex-wrap: wrap; gap: 6px; padding-left: 18px;
}

.repair-manual-radio {
  display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
}

.repair-manual-radio input { display: none; }

.repair-manual-radio.selected .backup-chip {
  background: var(--primary-alpha-10); color: var(--primary);
  border-color: var(--primary-alpha-30);
}

.repair-manual-latency {
  font-size: 10px; color: var(--text-tertiary);
}

.repair-dialog-footer {
  display: flex; justify-content: flex-end; gap: 8px;
}

/* ============================================================
   动画
   ============================================================ */
.fade-enter-active { transition: opacity 0.15s; }
.fade-leave-active { transition: opacity 0.1s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.slide-up-enter-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.slide-up-enter-from { opacity: 0; transform: translateY(16px); }
.slide-up-leave-active { transition: opacity 0.2s ease; }
.slide-up-leave-to { opacity: 0; }

/* ============================================================
   新设计：筛选芯片 + 扁平表格 + 引导卡片
   ============================================================ */

/* ---------- 操作栏：芯片 + 健康文件链接 ---------- */
.mr-action-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; flex-shrink: 0; min-height: 32px;
}

.mr-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* 对齐链接监控面板 .filter-chip 视觉 token：26px 胶囊 + bg-input 底色 + primary-alpha-10 激活态 */
.mr-chip {
  display: inline-flex; align-items: center; gap: 5px;
  height: 26px; padding: 0 10px; border-radius: 13px;
  font-size: 12px; font-weight: 500; cursor: pointer;
  background: var(--bg-input); color: var(--text-muted);
  border: 1px solid transparent;
  font-family: inherit; white-space: nowrap;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.mr-chip:hover {
  background: var(--hover-overlay); border-color: var(--border-subtle);
}

.mr-chip.active {
  background: var(--primary-alpha-10);
  color: var(--primary);
  border-color: var(--primary-alpha-10);
}

.mr-chip.active .mr-chip-count { color: var(--primary); opacity: 0.85; }

.mr-chip-count { font-weight: 600; font-variant-numeric: tabular-nums; }

.mr-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: var(--text-tertiary);
}

.mr-dot--amber { background: var(--warning); }

.mr-healthy-link {
  display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px;
  border: none; background: transparent; color: var(--text-muted);
  font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit;
  border-radius: 13px; transition: background 0.15s;
}

.mr-healthy-link:hover { background: var(--hover-overlay-subtle); }

.mr-healthy-link > .pi-check-circle { font-size: 13px; color: var(--success); }
.mr-healthy-link > .pi-chevron-right,
.mr-healthy-link > .pi-chevron-up { font-size: 11px; color: var(--text-tertiary); }

/* ---------- 健康文件展开面板 ---------- */
.mr-healthy-wrap {
  display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.25s ease;
  flex-shrink: 0;
}

.mr-healthy-wrap.expanded { grid-template-rows: 1fr; }

.mr-healthy-body {
  overflow: hidden auto; max-height: 200px;
  display: flex; flex-direction: column; gap: 2px;
}

.mr-healthy-wrap.expanded > .mr-healthy-body {
  padding: 8px 12px; border: 1px solid var(--border-subtle);
  border-radius: 8px; background: var(--bg-input);
}

.mr-healthy-row {
  display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 4px;
  font-size: 12px;
}

.mr-healthy-row:hover { background: var(--hover-overlay-subtle); }
.mr-healthy-row > .pi-check { font-size: 11px; color: var(--success); flex-shrink: 0; }
.mr-healthy-name {
  font-weight: 500; color: var(--text-main);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1;
}
.mr-healthy-count { color: var(--text-tertiary); font-size: 11px; flex-shrink: 0; }

/* ---------- 琥珀警告横幅 ---------- */
.mr-warning-banner {
  display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px;
  background: var(--warning-alpha-8); border: 1px solid var(--warning-alpha-15);
  border-radius: 8px; font-size: 13px; color: var(--warning);
  line-height: 1.5; flex-shrink: 0;
}

.mr-warning-banner > .pi { font-size: 15px; flex-shrink: 0; margin-top: 1px; }
.mr-warning-banner span { font-weight: 400; }

/* ---------- 问题链接表格 ---------- */
.mr-table {
  display: flex; flex-direction: column;
  background: var(--bg-card); border: 1px solid var(--border-subtle);
  border-radius: 8px; overflow: hidden; flex-shrink: 0;
}

.mr-thead {
  display: flex; align-items: center; height: 36px; padding: 0 16px;
  background: var(--bg-input); border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.mr-th {
  font-size: 11px; font-weight: 600; color: var(--text-tertiary);
  letter-spacing: 0.04em; text-transform: uppercase;
}

/* 非虚拟 tbody：不内部滚动，让外层 .wk-body 滚动 */
.mr-tbody { display: flex; flex-direction: column; }

/* 虚拟 tbody：固定高度 */
.mr-tbody--virtual { height: 520px; }

.mr-tr {
  display: flex; align-items: center; height: 60px; padding: 0 16px;
  border-bottom: 1px solid var(--border-subtle);
  transition: background 0.1s;
}

.mr-tr:last-child { border-bottom: none; }
.mr-tr:hover { background: var(--hover-overlay-subtle); }

.mr-tr--first-of-file {
  border-top: 1px solid var(--border-subtle);
}
.mr-tr:first-child.mr-tr--first-of-file { border-top: none; }

.mr-td {
  display: flex; flex-direction: column; justify-content: center; min-width: 0;
  padding-right: 16px;
}

/* 列宽 */
.mr-col-status { flex: 0 0 92px; flex-direction: row; align-items: center; gap: 6px; }
.mr-col-image { flex: 1 1 auto; min-width: 0; gap: 2px; }
.mr-col-file { flex: 0 0 240px; gap: 2px; }
.mr-col-action { flex: 0 0 80px; padding-right: 0; align-items: flex-end; }

/* 状态 */
.mr-status-text { font-size: 12px; font-weight: 500; color: var(--text-muted); white-space: nowrap; }
.mr-dot.row-status--manual { background: var(--warning); }
.mr-dot.row-status--rescuable { background: var(--primary); }
.mr-dot.row-status--replaced { background: var(--success); }
.mr-dot.row-status--manual + .mr-status-text { color: var(--warning); }
.mr-dot.row-status--rescuable + .mr-status-text { color: var(--primary); }
.mr-dot.row-status--replaced + .mr-status-text { color: var(--success); }

/* 图片名称 + URL */
.mr-img-name {
  font-size: 13px; font-weight: 500; color: var(--text-main);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.mr-img-url {
  font-size: 11px; font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--text-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 文件 */
.mr-file-name {
  font-size: 13px; color: var(--text-muted); font-weight: 400;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.mr-file-path {
  font-size: 11px; color: var(--text-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 操作 */
.mr-action-btn {
  display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px;
  border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer;
  border: 1px solid transparent; background: transparent; color: var(--text-muted);
  font-family: inherit; transition: background 0.12s, color 0.12s, border-color 0.12s;
}

.mr-action-btn:hover {
  background: var(--hover-overlay-subtle); color: var(--text-main);
  border-color: var(--border-subtle);
}

.mr-action-btn > .pi { font-size: 11px; }

/* 筛选后为空 */
.mr-empty-filter {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 32px; color: var(--text-tertiary); font-size: 12px;
}
.mr-empty-filter > .pi { font-size: 24px; }

/* ---------- 底部引导卡片 ---------- */
.mr-guidance {
  display: flex; align-items: center; gap: 16px; padding: 12px 16px;
  background: var(--bg-input); border: 1px solid var(--border-subtle);
  border-radius: 8px; flex-shrink: 0;
}

.mr-guidance-text {
  display: flex; align-items: flex-start; gap: 8px; flex: 1; min-width: 0;
  font-size: 12px; color: var(--text-muted); line-height: 1.5;
}

.mr-guidance-text > .pi { font-size: 14px; color: var(--text-tertiary); flex-shrink: 0; margin-top: 1px; }

.mr-guidance-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.mr-btn-sm {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer;
  border: 1px solid var(--border-subtle); background: var(--bg-card);
  color: var(--text-main); font-family: inherit;
  transition: background 0.12s, border-color 0.12s;
}

.mr-btn-sm:hover {
  background: var(--hover-overlay-subtle); border-color: var(--primary-alpha-30);
}

.mr-btn-sm > .pi { font-size: 11px; color: var(--text-muted); }
</style>
