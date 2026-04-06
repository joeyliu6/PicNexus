<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, onActivated, onDeactivated } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Dialog from 'primevue/dialog';
import RadioButton from 'primevue/radiobutton';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { dirname } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
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
  isCollecting,
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
  scanProgress,
} = useMdRescueManager();

// Tauri 拖放
const isDragging = ref(false);
const isViewActive = ref(true);
let dropUnlisten: (() => void) | null = null;

async function setupDropListener() {
  try {
    const webview = getCurrentWebview();
    dropUnlisten = await webview.onDragDropEvent(async (event) => {
      if (!isViewActive.value) return;

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
onBeforeUnmount(() => {
  dropUnlisten?.();
  if (scanFinishTimer) { clearTimeout(scanFinishTimer); scanFinishTimer = null; }
});
onActivated(() => { isViewActive.value = true; });
onDeactivated(() => { isViewActive.value = false; });

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

/** 扫描中展示的最近健康文件（最多 8 条，新的在前） */
const recentHealthyFiles = computed(() =>
  readyHealthyFiles.value.slice(-8).reverse(),
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

/** 是否在修复完成状态（done 阶段或有已修复文件） */
const isRepaired = computed(() => phase.value === 'done');

/** 扫描完成后的"完成态"停留标记 */
const scanFinishing = ref(false);
let scanFinishTimer: ReturnType<typeof setTimeout> | null = null;

/** 进度条是否可见：正在扫描 或 完成态停留期间 */
const showScanSkeleton = computed(() =>
  isCollecting.value
  || (phase.value === 'scanning' && scanStage.value !== 'complete')
  || scanFinishing.value,
);

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

      // 进度条切换为"完成态"，停留 1.5 秒后淡出
      scanFinishing.value = true;
      scanFinishTimer = setTimeout(() => {
        scanFinishing.value = false;
        scanFinishTimer = null;
      }, 1500);
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

function truncatePath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.length <= 2) return path;
  return '.../' + parts.slice(-2).join('/');
}

function getFileDirectory(fullPath: string): string {
  const normalized = fullPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) return '';
  return parts[parts.length - 2];
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

/** 从 URL 中提取 host（用于行内 badge） */
function extractHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** 已知失效图床域名判定 */
function isDefunctHost(url: string): boolean {
  const host = extractHost(url);
  return host.endsWith('.sinaimg.cn') || host === 'sinaimg.cn';
}

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

// ============================================================
// 分组视图：按所在文件分组展示坏链接
// ============================================================

interface GroupedFile {
  filePath: string;
  fileName: string;
  directory: string;
  rows: FlatRow[];
}

/** 按 sourceFile 分组的 filteredRows */
const groupedRows = computed<GroupedFile[]>(() => {
  const map = new Map<string, GroupedFile>();
  for (const r of filteredRows.value) {
    const key = r.link.sourceFile;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        filePath: key,
        fileName: r.link.sourceFileName,
        directory: getFileDirectory(key),
        rows: [],
      };
      map.set(key, entry);
    }
    entry.rows.push(r);
  }
  return Array.from(map.values());
});

/** 会话内折叠状态（默认全部展开） */
const collapsedGroups = ref<Set<string>>(new Set());

function toggleGroupCollapse(filePath: string): void {
  const next = new Set(collapsedGroups.value);
  if (next.has(filePath)) next.delete(filePath);
  else next.add(filePath);
  collapsedGroups.value = next;
}

// ============================================================
// 行动函数：定位文件 / 打开编辑器 / 在浏览器打开 / 复制 URL
// ============================================================

async function revealInFolder(filePath: string): Promise<void> {
  try {
    const dir = await dirname(filePath);
    // 用后端 opener crate 绕过 shell scope 的 regex 限制（只允许 http/mailto/tel）
    await invoke('open_path', { path: dir });
  } catch (err) {
    toast.error('无法打开文件夹', String(err));
  }
}

async function openMdFile(filePath: string): Promise<void> {
  try {
    await invoke('open_path', { path: filePath });
  } catch (err) {
    toast.error('无法打开文件', String(err));
  }
}

async function openInBrowser(url: string): Promise<void> {
  try {
    await shellOpen(url);
  } catch (err) {
    toast.error('无法打开链接', String(err));
  }
}

async function copyRowUrl(url: string): Promise<void> {
  try {
    await writeText(url);
    toast.success('已复制', 'URL 已复制到剪贴板');
  } catch (err) {
    toast.error('复制失败', String(err));
  }
}

// ============================================================
// 状态分色：按 error_type + status_code 映射到红/黄/紫
// ============================================================

interface StatusDisplay {
  color: 'red' | 'amber' | 'purple';
  label: string;
}

function getStatusDisplay(cr: CheckLinkResult | null | undefined): StatusDisplay {
  if (!cr) return { color: 'red', label: '失败' };
  if (cr.error_type === 'timeout') return { color: 'amber', label: '超时' };
  if (cr.error_type === 'suspicious' || cr.browser_might_work) {
    return { color: 'purple', label: '可疑' };
  }
  if (cr.error_type === 'http_4xx') {
    if (cr.status_code === 404 || cr.status_code === 410) return { color: 'red', label: '404' };
    if (cr.status_code === 403) return { color: 'red', label: '403' };
    return { color: 'red', label: cr.status_code ? `${cr.status_code}` : '4XX' };
  }
  if (cr.error_type === 'http_5xx') return { color: 'red', label: cr.status_code ? `${cr.status_code}` : '5XX' };
  if (cr.error_type === 'network') return { color: 'red', label: '网络' };
  return { color: 'red', label: '失败' };
}

/** 点击筛选芯片 */
function selectFilter(f: 'all' | 'rescuable' | 'manual') {
  if (activeFilter.value === f) return;
  activeFilter.value = f;
}

</script>

<template>
  <div class="md-rescue">

    <!-- ====== idle: 紧凑拖放区 ====== -->
    <div v-if="phase === 'idle' && !isCollecting" class="rescue-phase rescue-idle">
      <div class="idle-zone" :class="{ dragging: isDragging }">
        <div class="idle-icon-wrap"><i class="pi pi-upload" /></div>
        <p class="idle-feature-desc">扫描文档中的图片链接，检测失效并从历史备用链接自动修复</p>
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

      <!-- fixing / done 阶段顶栏（互斥切换） -->
      <Transition name="fade" mode="out-in">
        <div v-if="phase === 'fixing'" key="fixing-header" class="wk-header">
          <span class="wk-title">正在修复...</span>
          <span class="wk-subtitle">{{ fixingProgress.current }}/{{ fixingProgress.total }} ({{ fixingPercent }}%)</span>
        </div>
        <div v-else-if="phase === 'done'" key="done-header" class="wk-header">
          <div class="wk-title-group">
            <i class="pi pi-check-circle wk-done-icon" />
            <span class="wk-title">修复完成</span>
            <span v-if="repairReceipt" class="wk-subtitle">共修复 {{ repairReceipt.linksFixed }} 张图片链接</span>
          </div>
          <div class="wk-actions">
            <Button label="撤销" severity="secondary" size="small" icon="pi pi-undo" outlined :disabled="!repairReceipt?.fileBackupMap.length" @click="undoReplace" />
          </div>
        </div>
      </Transition>

      <!-- fixing 阶段进度条 -->
      <Transition name="fade">
        <div v-if="phase === 'fixing'" class="wk-progress">
          <div class="wk-progress-fill" :style="{ width: fixingPercent + '%' }" />
        </div>
      </Transition>

      <!-- 内容区 -->
      <div class="wk-body">

        <!-- 扫描进度骨架屏（收集 / 扫描 / 验证备用链接 三阶段统一展示） -->
        <Transition name="scan-bar">
          <div v-if="showScanSkeleton" class="mr-scan-skeleton" :class="{ 'is-finishing': scanFinishing }">
            <i :class="scanFinishing ? 'pi pi-check-circle mr-scan-skeleton-done' : 'pi pi-spin pi-spinner mr-scan-skeleton-spinner'" />
            <span class="mr-scan-skeleton-text">
              <template v-if="scanFinishing">扫描完成 · {{ bottomStats.totalImages }} 张图片</template>
              <template v-else-if="isCollecting">正在收集图片链接…</template>
              <template v-else-if="scanStage === 'backups'">正在验证备用链接…</template>
              <template v-else-if="scanProgress && scanProgress.total > 0">
                正在扫描图片 · {{ scanProgress.checked }} / {{ scanProgress.total }}<template v-if="currentScanFileName"> · {{ currentScanFileName }}</template>
              </template>
              <template v-else>正在扫描图片…</template>
            </span>
            <span v-if="!scanFinishing && bottomStats.totalFiles > 0" class="mr-scan-skeleton-meta">
              {{ bottomStats.totalFiles }} 文件 · {{ bottomStats.totalImages }} 图片
            </span>
          </div>
        </Transition>

        <!-- 扫描中无异常时：已检查的健康文件流水 -->
        <Transition name="fade">
          <div
            v-if="phase === 'scanning' && scanStage !== 'complete' && groupedRows.length === 0 && recentHealthyFiles.length > 0"
            class="mr-healthy-stream"
          >
            <div v-for="f in recentHealthyFiles" :key="f.path" class="mr-healthy-row">
              <i class="pi pi-check-circle mr-healthy-icon" />
              <span class="mr-healthy-name">{{ f.name }}</span>
              <span class="mr-healthy-meta">{{ f.totalCount }} 张图片均正常</span>
            </div>
          </div>
        </Transition>

        <!-- scanning / done: 扁平表格布局 -->
        <template v-if="phase === 'scanning' || phase === 'done'">

            <!-- 顶部筛选芯片（"可修复" 计数为 0 时隐藏） -->
            <Transition name="slide-up">
            <div v-if="flatBrokenLinks.length > 0" class="mr-action-bar">
              <div class="mr-chips">
                <button class="mr-chip" :class="{ active: activeFilter === 'all' }" @click="selectFilter('all')">
                  <span>全部</span>
                  <span class="mr-chip-count">{{ filterCounts.all }}</span>
                </button>
                <button
                  class="mr-chip"
                  :class="{ active: activeFilter === 'rescuable', disabled: filterCounts.rescuable === 0 }"
                  :disabled="filterCounts.rescuable === 0"
                  @click="selectFilter('rescuable')"
                >
                  <span>{{ rescuableChipLabel }}</span>
                  <span class="mr-chip-count">{{ filterCounts.rescuable }}</span>
                </button>
                <button
                  class="mr-chip"
                  :class="{ active: activeFilter === 'manual', disabled: filterCounts.manual === 0 }"
                  :disabled="filterCounts.manual === 0"
                  @click="selectFilter('manual')"
                >
                  <span class="mr-dot mr-dot--amber" />
                  <span>需手动</span>
                  <span class="mr-chip-count">{{ filterCounts.manual }}</span>
                </button>
              </div>
            </div>
            </Transition>

            <!-- 问题链接分组列表 / 筛选为空（互斥切换） -->
            <Transition name="slide-up" mode="out-in">
              <div v-if="groupedRows.length > 0" key="groups" class="mr-groups">
                <div v-for="group in groupedRows" :key="group.filePath" class="mr-group">
                  <button
                    type="button"
                    class="mr-group-header"
                    @click="toggleGroupCollapse(group.filePath)"
                  >
                    <i class="pi mr-group-chev" :class="collapsedGroups.has(group.filePath) ? 'pi-chevron-right' : 'pi-chevron-down'" />
                    <i class="pi pi-file mr-group-file-icon" />
                    <div class="mr-group-info">
                      <span class="mr-group-name" :title="group.filePath">{{ group.fileName }}</span>
                      <span class="mr-group-dir" :title="group.filePath">{{ group.directory }}</span>
                    </div>
                    <span class="mr-group-count">{{ group.rows.length }} 条异常链接</span>
                    <span class="mr-group-actions" @click.stop>
                      <button type="button" class="mr-group-icon-btn" title="在文件管理器中定位" @click="revealInFolder(group.filePath)">
                        <i class="pi pi-folder-open" />
                      </button>
                      <button type="button" class="mr-group-icon-btn" title="用默认编辑器打开" @click="openMdFile(group.filePath)">
                        <i class="pi pi-pencil" />
                      </button>
                    </span>
                  </button>
                  <div v-if="!collapsedGroups.has(group.filePath)" class="mr-group-body">
                    <div
                      v-for="(row, i) in group.rows"
                      :key="row.link.url + '|' + i"
                      class="mr-row"
                    >
                      <div class="mr-row-status">
                        <span class="mr-status-label" :class="`mr-status-label--${getStatusDisplay(row.link.checkResult).color}`">{{ getStatusDisplay(row.link.checkResult).label }}</span>
                      </div>
                      <span class="mr-img-name" :title="row.link.url">{{ extractFilenameFromUrl(row.link.url) }}</span>
                      <span class="mr-host-badge" :class="{ 'mr-host-badge--defunct': isDefunctHost(row.link.url) }" :title="row.link.url">{{ extractHost(row.link.url) }}</span>
                      <div class="mr-row-actions">
                        <button type="button" class="mr-row-icon-btn" title="复制 URL" @click="copyRowUrl(row.link.url)">
                          <i class="pi pi-copy" />
                        </button>
                        <button type="button" class="mr-row-icon-btn" title="在浏览器打开" @click="openInBrowser(row.link.url)">
                          <i class="pi pi-external-link" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else-if="flatBrokenLinks.length > 0" key="empty-filter" class="mr-empty-filter">
                <i class="pi pi-filter-slash" />
                <span>此筛选条件下没有记录</span>
              </div>
            </Transition>

            <!-- 全部正常、无问题 -->
            <Transition name="slide-up">
              <div v-if="phase === 'scanning' && scanStage === 'complete' && readyBrokenFiles.length === 0 && readyHealthyFiles.length > 0" class="report-empty">
                <i class="pi pi-check-circle report-empty-icon" />
                <p>所有图片链接正常</p>
              </div>
            </Transition>

            <!-- done 阶段备份路径提示 -->
            <Transition name="fade">
              <div v-if="phase === 'done' && repairReceipt?.backupPath" class="done-backup">
                <i class="pi pi-save" />
                <span :title="repairReceipt.backupPath">原文件已备份至 {{ truncatePath(repairReceipt.backupPath) }}</span>
              </div>
            </Transition>
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
          <!-- 左侧统计（扫描状态已移至顶部进度区，此处只显示最终统计） -->
          <div class="rescue-bottom-left">
            <span class="rescue-stat">
              <i class="pi pi-file rescue-stat-icon" />
              {{ bottomStats.totalFiles }} 文件
              <span v-if="bottomStats.problemFileCount > 0" class="rescue-stat-sub">
                ({{ bottomStats.normalFileCount }} 正常 / {{ bottomStats.problemFileCount }} 异常)
              </span>
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
          </div>

          <!-- 右侧按钮 -->
          <div class="rescue-bottom-actions">
            <!-- scanning 中 -->
            <template v-if="phase === 'scanning' && scanStage !== 'complete'">
              <button class="btn-danger btn-sm" @click="cancelCheck">
                <i class="pi pi-stop" /> 取消
              </button>
            </template>

            <!-- scanning 完成：始终显示两个按钮，按 hasRescuable 互换主次 -->
            <template v-else-if="phase === 'scanning' && scanStage === 'complete'">
              <button
                :class="['btn-sm', hasRescuable ? 'btn-ghost' : 'btn-primary']"
                @click="resetRescue"
              >
                <i class="pi pi-refresh" /> 重新扫描
              </button>
              <button
                :class="['btn-sm', hasRescuable ? 'btn-primary' : 'btn-ghost']"
                :disabled="!hasRescuable"
                :title="hasRescuable ? '自动修复有备用链接的图片' : '当前没有可自动修复的链接'"
                @click="openRepairDialog"
              >
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
  padding: 40px 40px 36px;
  border: 2px dashed var(--border-subtle);
  border-radius: 8px;
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
.idle-icon-wrap i { font-size: 32px; }

.idle-feature-desc {
  font-size: 13px; color: var(--text-muted);
  margin: 0 0 20px; text-align: center; line-height: 1.5;
}

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
.btn-ghost:hover:not(:disabled) { background: var(--hover-overlay); color: var(--text-main); }
.btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover:not(:disabled) { opacity: 0.9; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
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
.fade-enter-active { transition: opacity 0.2s ease; }
.fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* 扫描进度条：进入快、离开柔和 */
.scan-bar-enter-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.scan-bar-leave-active {
  transition:
    opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.8s cubic-bezier(0.4, 0, 0.2, 1),
    max-height 0.6s 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    padding 0.6s 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    border-width 0.6s 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.scan-bar-enter-from { opacity: 0; transform: translateY(-4px); }
.scan-bar-leave-to { opacity: 0; transform: translateY(-8px); max-height: 0; padding-top: 0; padding-bottom: 0; border-width: 0; }

.slide-up-enter-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.slide-up-enter-from { opacity: 0; transform: translateY(12px); }
.slide-up-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.slide-up-leave-to { opacity: 0; transform: translateY(-8px); }

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

.mr-chip.disabled,
.mr-chip:disabled {
  opacity: 0.4; cursor: not-allowed; pointer-events: none;
  background: var(--bg-input); color: var(--text-tertiary); border-color: transparent;
}

.mr-chip-count { font-weight: 600; font-variant-numeric: tabular-nums; }

.mr-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: var(--text-tertiary);
}

.mr-dot--amber { background: var(--warning); }

/* ---------- 扫描骨架屏（收集/扫描/验证三阶段通用，虚线灰底） ---------- */
.mr-scan-skeleton {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; flex-shrink: 0;
  border: 1px dashed var(--border-subtle);
  border-radius: 8px;
  background: var(--hover-overlay-subtle);
  max-height: 60px;
  animation: mr-skeleton-pulse 2s ease-in-out infinite;
}

@keyframes mr-skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.mr-scan-skeleton-spinner {
  font-size: 13px; color: var(--text-tertiary); flex-shrink: 0;
}

.mr-scan-skeleton-done {
  font-size: 13px; color: var(--green-500, #22c55e); flex-shrink: 0;
}

.mr-scan-skeleton.is-finishing {
  animation: none;
}

.mr-scan-skeleton.is-finishing .mr-scan-skeleton-text {
  color: var(--green-500, #22c55e);
}

.mr-scan-skeleton-text {
  flex: 1; min-width: 0;
  font-size: 12px; font-weight: 500; color: var(--text-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.mr-scan-skeleton-meta {
  flex-shrink: 0;
  font-size: 11px; color: var(--text-tertiary); font-variant-numeric: tabular-nums;
}

/* ---------- 扫描中：健康文件实时流水 ---------- */
.mr-healthy-stream {
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 14px;
}

.mr-healthy-row {
  display: flex; align-items: center; gap: 8px;
  height: 32px; font-size: 12px;
  animation: mr-fade-in 0.25s ease;
}

.mr-healthy-icon {
  font-size: 12px; color: var(--success); flex-shrink: 0;
}

.mr-healthy-name {
  color: var(--text-muted); font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0; flex: 1;
}

.mr-healthy-meta {
  flex-shrink: 0; color: var(--text-tertiary); font-variant-numeric: tabular-nums;
}

@keyframes mr-fade-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ---------- 分组列表：每个分组独立成块，组间 6px gap ---------- */
.mr-groups {
  display: flex; flex-direction: column; gap: 6px;
  flex-shrink: 0;
}

.mr-group {
  border: 1px solid var(--border-subtle); border-radius: 8px;
  background: var(--bg-card); overflow: hidden;
}

/* 分组头（可点击折叠，sticky 粘顶） */
.mr-group-header {
  display: flex; align-items: center; gap: 10px; width: 100%;
  min-height: 52px; padding: 8px 14px;
  background: var(--bg-input); border: none; cursor: pointer; font-family: inherit;
  text-align: left; position: sticky; top: 0; z-index: 2;
  transition: background 0.12s;
}

.mr-group-header:hover { background: var(--hover-overlay-subtle); }

.mr-group-chev {
  font-size: 11px; color: var(--text-tertiary); flex-shrink: 0;
  transition: transform 0.15s;
}

.mr-group-file-icon { font-size: 14px; color: var(--primary); flex-shrink: 0; }

.mr-group-info {
  display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0;
}

.mr-group-name {
  font-size: var(--text-sm); font-weight: var(--weight-bold); color: var(--text-main);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.mr-group-dir {
  font-size: var(--text-xs); color: var(--text-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.mr-group-count {
  font-size: 11px; font-weight: 500;
  padding: 2px 8px; border-radius: 10px;
  background: var(--hover-overlay); color: var(--text-muted);
  flex-shrink: 0; font-variant-numeric: tabular-nums;
}

.mr-group-actions { display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; }

/* 默认半透明，hover 分组头后不透明 */
.mr-group-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 6px; border: none;
  background: transparent; color: var(--text-tertiary); cursor: pointer;
  opacity: 0.4;
  transition: background 0.12s, color 0.12s, opacity 0.12s;
  font-family: inherit;
}

.mr-group-header:hover .mr-group-icon-btn { opacity: 1; }
.mr-group-icon-btn:hover { background: var(--hover-overlay-subtle); color: var(--primary); }
.mr-group-icon-btn > .pi { font-size: 13px; }

/* 分组体（行） */
.mr-group-body {
  display: flex; flex-direction: column;
  background: var(--bg-card);
}

/* 单行：紧凑单行布局（图片名 + host badge + 操作），靠 hover 自然分离 */
.mr-row {
  display: flex; align-items: center; gap: 12px;
  height: 40px; padding: 0 14px;
  transition: background 0.1s;
}
.mr-row:hover { background: var(--hover-overlay-subtle); }

.mr-row-status {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; width: 72px;
}

/* 状态点分色：红/黄/紫 */
.mr-dot--red { background: var(--error); }
.mr-dot--amber { background: var(--warning); }
.mr-dot--purple { background: var(--pending); }

/* 状态标签 */
.mr-status-label {
  font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  padding: 2px 6px; border-radius: 3px; min-width: 44px; text-align: center;
  white-space: nowrap;
}

.mr-status-label--red { background: var(--error-alpha-10); color: var(--error); }
.mr-status-label--amber { background: var(--warning-alpha-8); color: var(--warning); }
.mr-status-label--purple { background: var(--pending-alpha-8); color: var(--pending); }

/* 行内：图片名（主，flex: 1）+ host badge（尾部固定） */
.mr-img-name {
  flex: 1 1 auto; min-width: 0;
  font-size: 13px; font-weight: 500; color: var(--text-main);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.mr-host-badge {
  flex-shrink: 0;
  display: inline-flex; align-items: center;
  height: 20px; padding: 0 8px; border-radius: 4px;
  background: var(--bg-input); color: var(--text-muted);
  border: 1px solid var(--border-subtle);
  font-size: 11px; font-family: var(--font-mono, 'JetBrains Mono', monospace);
  max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.mr-row:hover .mr-host-badge { background: var(--hover-overlay); }

.mr-host-badge--defunct {
  background: var(--error-alpha-10); color: var(--error);
  border-color: var(--error-alpha-15);
}
.mr-row:hover .mr-host-badge--defunct { background: var(--error-alpha-15); }

.mr-row-actions {
  display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0;
  opacity: 0; transition: opacity 0.15s;
}
.mr-row:hover .mr-row-actions { opacity: 1; }

.mr-row-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 6px; border: none;
  background: transparent; color: var(--text-tertiary); cursor: pointer;
  transition: background 0.12s, color 0.12s; font-family: inherit;
}
.mr-row-icon-btn:hover { background: var(--hover-overlay); color: var(--primary); }
.mr-row-icon-btn > .pi { font-size: 12px; }

/* 筛选后为空 */
.mr-empty-filter {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 32px; color: var(--text-tertiary); font-size: 12px;
}
.mr-empty-filter > .pi { font-size: 24px; }

/* 底栏统计：文件数后跟的小字"正常/异常" */
.rescue-stat-sub {
  margin-left: 4px; font-size: 11px; font-weight: 400; color: var(--text-tertiary);
}
</style>
