<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import Button from 'primevue/button';
import Select from 'primevue/select';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
import MultiSelect from 'primevue/multiselect';
import { invoke } from '@tauri-apps/api/tauri';
import { writeText } from '@tauri-apps/api/clipboard';
import { save as saveDialog } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';
import { useHistoryManager } from '../../composables/useHistory';
import { useConfigManager } from '../../composables/useConfig';
import { getActivePrefix } from '../../config/types';
import { MultiServiceUploader } from '../../core/MultiServiceUploader';
import { Store } from '../../store';
import type { ServiceType, HistoryItem } from '../../config/types';

const toast = useToast();
const { confirmDelete } = useConfirm();
const { allHistoryItems, loadHistory } = useHistoryManager();
const { config } = useConfigManager();
const historyStore = new Store('.history.dat');

onMounted(async () => {
  await loadHistory();
  await preloadImageInfo();
});

// 检测状态
const isChecking = ref(false);
const isCancelled = ref(false);

// 筛选
const serviceFilter = ref('all');
const serviceOptions = [
  { label: '全部图床', value: 'all' },
  { label: '微博图床', value: 'weibo' },
  { label: 'Cloudflare R2', value: 'r2' },
  { label: 'TCL 图床', value: 'tcl' },
  { label: '京东图床', value: 'jd' },
  { label: '牛客图床', value: 'nowcoder' },
  { label: '七鱼图床', value: 'qiyu' },
  { label: '知乎图床', value: 'zhihu' },
  { label: '纳米图床', value: 'nami' }
];

watch(serviceFilter, async () => {
  if (!isChecking.value) await preloadImageInfo();
});

// 统计数据
const stats = ref({ total: 0, valid: 0, invalid: 0, pending: 0 });
const progress = ref(0);
const progressText = ref('准备就绪');

// 类型定义
type ErrorType = 'success' | 'http_4xx' | 'http_5xx' | 'timeout' | 'network' | 'pending';

interface ServiceCheckResult {
  serviceId: ServiceType;
  link: string;
  originalLink: string;
  isValid: boolean;
  statusCode?: number;
  errorType: ErrorType;
  error?: string;
  suggestion?: string;
  responseTime?: number;
}

interface CheckResult {
  historyItemId: string;
  fileName: string;
  filePath?: string;
  primaryService: ServiceType;
  serviceResults: ServiceCheckResult[];
  status: 'all_valid' | 'partial_valid' | 'all_invalid' | 'pending';
  validCount: number;
  invalidCount: number;
  canReupload: boolean;
}

const results = ref<CheckResult[]>([]);
const expandedRows = ref<CheckResult[]>([]);

const extractLinksFromHistory = (): CheckResult[] => {
  return allHistoryItems.value
    .filter(item => {
      if (serviceFilter.value !== 'all') {
        return item.results?.some(r => r.status === 'success' && r.result?.url && r.serviceId === serviceFilter.value);
      }
      return item.results && item.results.length > 0;
    })
    .map(item => {
      const serviceResults: ServiceCheckResult[] = item.results
        .filter(r => {
          if (r.status !== 'success' || !r.result?.url) return false;
          if (serviceFilter.value !== 'all' && r.serviceId !== serviceFilter.value) return false;
          return true;
        })
        .map(r => {
          const originalLink = r.result!.url;
          let linkToCheck = originalLink;
          if (r.serviceId === 'weibo' && config.value.outputFormat === 'baidu-proxy') {
            const activePrefix = getActivePrefix(config.value);
            if (activePrefix) linkToCheck = `${activePrefix}${originalLink}`;
          }
          return {
            serviceId: r.serviceId,
            link: linkToCheck,
            originalLink,
            isValid: false,
            errorType: 'pending' as ErrorType,
            statusCode: undefined,
            error: undefined,
            suggestion: undefined,
            responseTime: undefined
          };
        });

      return {
        historyItemId: item.id,
        fileName: item.localFileName,
        filePath: item.filePath,
        primaryService: item.primaryService,
        serviceResults,
        status: 'pending' as const,
        validCount: 0,
        invalidCount: 0,
        canReupload: serviceResults.length > 1
      };
    })
    .filter(item => item.serviceResults.length > 0);
};

const updateAggregateStatus = (checkResult: CheckResult): void => {
  const valid = checkResult.serviceResults.filter(r => r.isValid).length;
  const total = checkResult.serviceResults.length;
  checkResult.validCount = valid;
  checkResult.invalidCount = total - valid;
  if (valid === total) {
    checkResult.status = 'all_valid';
    checkResult.canReupload = false;
  } else if (valid === 0) {
    checkResult.status = 'all_invalid';
    checkResult.canReupload = false;
  } else {
    checkResult.status = 'partial_valid';
    checkResult.canReupload = true;
  }
};

const checkLink = async (serviceResult: ServiceCheckResult): Promise<void> => {
  try {
    const result = await invoke<{
      link: string; is_valid: boolean; status_code?: number; error?: string; error_type: string; suggestion?: string; response_time?: number;
    }>('check_image_link', { link: serviceResult.link });
    serviceResult.isValid = result.is_valid;
    serviceResult.statusCode = result.status_code;
    serviceResult.errorType = result.error_type as ErrorType;
    serviceResult.error = result.error;
    serviceResult.suggestion = result.suggestion;
    serviceResult.responseTime = result.response_time;
  } catch (error) {
    serviceResult.isValid = false;
    serviceResult.errorType = 'network';
    serviceResult.error = String(error);
    serviceResult.suggestion = '检测失败';
  }
};

const startCheck = async () => {
  if (isChecking.value) return;
  isChecking.value = true;
  isCancelled.value = false;

  if (results.value.length === 0) {
    progress.value = 0;
    try {
      await loadHistory();
      const checkResults = extractLinksFromHistory();
      if (checkResults.length === 0) {
        toast.warn('无链接', '历史记录中没有可检测的图片链接');
        isChecking.value = false;
        return;
      }
      results.value = checkResults;
      stats.value.total = checkResults.length;
      stats.value.pending = checkResults.length;
    } catch (error) {
      toast.error('加载失败', String(error));
      isChecking.value = false;
      return;
    }
  } else {
    results.value.forEach(result => {
      result.status = 'pending';
      result.validCount = 0;
      result.invalidCount = 0;
      result.serviceResults.forEach(sr => {
        sr.isValid = false;
        sr.errorType = 'pending';
        sr.statusCode = undefined;
        sr.error = undefined;
        sr.suggestion = undefined;
        sr.responseTime = undefined;
      });
    });
    stats.value = { total: results.value.length, valid: 0, invalid: 0, pending: results.value.length };
  }

  progress.value = 0;
  toast.info('开始检测', `共 ${results.value.length} 个文件待检测`);

  try {
    let checkedCount = 0;
    for (const checkResult of results.value) {
      if (isCancelled.value) break;
      for (const serviceResult of checkResult.serviceResults) {
        await checkLink(serviceResult);
      }
      updateAggregateStatus(checkResult);
      checkedCount++;
      stats.value.valid = results.value.filter(r => r.status === 'all_valid').length;
      stats.value.invalid = results.value.filter(r => r.status === 'all_invalid' || r.status === 'partial_valid').length;
      stats.value.pending = stats.value.total - checkedCount;
      progress.value = Math.round((checkedCount / stats.value.total) * 100);
      progressText.value = `${checkedCount} / ${stats.value.total}`;
    }
    if (!isCancelled.value) {
      const allValid = results.value.filter(r => r.status === 'all_valid').length;
      const partialValid = results.value.filter(r => r.status === 'partial_valid').length;
      const allInvalid = results.value.filter(r => r.status === 'all_invalid').length;
      toast.success('检测完成', `全部有效: ${allValid}, 部分有效: ${partialValid}, 全部失效: ${allInvalid}`);
    }
  } catch (error) {
    toast.error('检测失败', String(error));
  } finally {
    isChecking.value = false;
  }
};

const preloadImageInfo = async () => {
  try {
    if (allHistoryItems.value.length === 0) await loadHistory();
    const checkResults = extractLinksFromHistory();
    if (checkResults.length === 0) {
      results.value = [];
      stats.value = { total: 0, valid: 0, invalid: 0, pending: 0 };
      return;
    }
    results.value = checkResults;
    stats.value = { total: checkResults.length, valid: 0, invalid: 0, pending: checkResults.length };
  } catch (error) {}
};

const cancelCheck = () => { isCancelled.value = true; isChecking.value = false; };
const deleteInvalid = () => {
  const invalidCount = results.value.filter(r => r.status === 'all_invalid' || r.status === 'partial_valid').length;
  if (invalidCount === 0) return;
  confirmDelete(`确定要移除 ${invalidCount} 个失效链接吗？`, () => {
    results.value = results.value.filter(r => r.status === 'all_valid');
    stats.value.invalid = 0;
    stats.value.valid = results.value.filter(r => r.status === 'all_valid').length;
    stats.value.pending = results.value.filter(r => r.status === 'pending').length;
    stats.value.total = results.value.length;
  });
};

const recheckSingle = async (checkResult: CheckResult) => {
  for (const serviceResult of checkResult.serviceResults) await checkLink(serviceResult);
  updateAggregateStatus(checkResult);
};

const exportResults = async () => {
  if (results.value.length === 0) return;
  const exportData = {
    exportTime: new Date().toISOString(),
    results: results.value
  };
  const filePath = await saveDialog({ defaultPath: `link-check-${Date.now()}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (filePath) {
    await writeTextFile(filePath as string, JSON.stringify(exportData, null, 2));
    toast.success('导出成功', '已保存');
  }
};

// 重新上传逻辑
const showReuploadDialog = ref(false);
const selectedReuploadItem = ref<{
  checkResult: CheckResult; validServices: ServiceType[]; invalidServices: ServiceType[]; sourceService: ServiceType; targetServices: ServiceType[];
} | null>(null);

const openReuploadDialog = (checkResult: CheckResult) => {
  if (!checkResult.canReupload) { toast.warn('无法重传', '无有效源'); return; }
  const validServices = checkResult.serviceResults.filter(r => r.isValid).map(r => r.serviceId);
  const invalidServices = checkResult.serviceResults.filter(r => !r.isValid).map(r => r.serviceId);
  selectedReuploadItem.value = { checkResult, validServices, invalidServices, sourceService: validServices[0], targetServices: [...invalidServices] };
  showReuploadDialog.value = true;
};

const executeReupload = async () => {
    const item = selectedReuploadItem.value!;
    try {
        const sourceResult = item.checkResult.serviceResults.find(r => r.serviceId === item.sourceService);
        if (!sourceResult) throw new Error("无源");
        const tempFilePath = await invoke<string>('download_image_from_url', { url: sourceResult.originalLink });
        const uploader = new MultiServiceUploader();
        const uploadResult = await uploader.uploadToMultipleServices(tempFilePath, item.targetServices, config.value);
        const items = await historyStore.get<HistoryItem[]>('uploads', []);
        const historyItem = items.find(i => i.id === item.checkResult.historyItemId);
        if (historyItem) {
            uploadResult.results.forEach(newResult => {
                const existingIndex = historyItem.results.findIndex(r => r.serviceId === newResult.serviceId);
                if (existingIndex >= 0) historyItem.results[existingIndex] = newResult;
                else historyItem.results.push(newResult);
            });
            await historyStore.set('uploads', items);
            await historyStore.save();
        }
        await recheckSingle(item.checkResult);
        toast.success("成功", "重新上传完成");
    } catch(e) { toast.error("错误", String(e)); } finally { showReuploadDialog.value = false; }
};

const getRowClass = (data: CheckResult) => '';
const toggleRowExpansion = (event: any) => {
  const data = event.data as CheckResult;
  const isExpanded = expandedRows.value.some(r => r.historyItemId === data.historyItemId);
  expandedRows.value = isExpanded ? expandedRows.value.filter(r => r.historyItemId !== data.historyItemId) : [...expandedRows.value, data];
};

const truncate = (str: string, len: number) => str.length > len ? str.substring(0, len) + '...' : str;
</script>

<template>
  <div class="view-wrapper">
    <div class="dashboard-strip">
        <div class="controls-area">
            <span class="view-title">链接检测</span>
            <div class="v-divider"></div>

            <Select
                v-model="serviceFilter"
                :options="serviceOptions"
                optionLabel="label"
                optionValue="value"
                placeholder="筛选图床"
                class="minimal-select"
            />

            <Button
                label="开始检测"
                icon="pi pi-play"
                size="small"
                @click="startCheck"
                :loading="isChecking"
                class="minimal-btn primary-btn"
            />

            <Button
                v-if="isChecking"
                label="停止"
                icon="pi pi-stop"
                size="small"
                @click="cancelCheck"
                severity="secondary"
                class="minimal-btn"
            />

            <span v-if="isChecking" class="progress-text">{{ progressText }}</span>
        </div>

        <div class="stats-area">
            <div class="stat-item">
                <span class="stat-val">{{ stats.total }}</span>
                <span class="stat-key">总数</span>
            </div>
            <div class="v-divider"></div>
            <div class="stat-item success">
                <span class="stat-val">{{ stats.valid }}</span>
                <span class="stat-key">有效</span>
            </div>
            <div class="v-divider"></div>
            <div class="stat-item danger">
                <span class="stat-val">{{ stats.invalid }}</span>
                <span class="stat-key">失效</span>
            </div>

            <div class="actions-area" v-if="stats.invalid > 0">
                 <Button
                    label="清理失效"
                    icon="pi pi-trash"
                    size="small"
                    severity="danger"
                    text
                    @click="deleteInvalid"
                />
            </div>
        </div>
    </div>

    <div class="progress-line" :style="{ width: progress + '%', opacity: isChecking ? 1 : 0 }"></div>

    <div class="table-container">
        <DataTable
          :value="results"
          v-model:expandedRows="expandedRows"
          @row-click="toggleRowExpansion"
          paginator
          :rows="50"
          class="minimal-table"
          rowHover
        >
            <template #empty>
                <div class="empty-state">
                    <i class="pi pi-search" style="font-size: 2rem; color: var(--text-muted); margin-bottom: 10px;"></i>
                    <p>暂无数据，请点击左上角开始检测</p>
                </div>
            </template>

            <Column expander style="width: 3rem" />

            <Column field="fileName" header="文件名" style="min-width: 200px">
                <template #body="{ data }">
                    <span class="filename-text">{{ data.fileName }}</span>
                </template>
            </Column>

            <Column field="status" header="状态" style="width: 120px">
                <template #body="{ data }">
                    <div class="status-indicator" :class="data.status">
                        <span class="status-dot"></span>
                        <span v-if="data.status === 'all_valid'">全有效</span>
                        <span v-else-if="data.status === 'partial_valid'">部分失效</span>
                        <span v-else-if="data.status === 'all_invalid'">全失效</span>
                        <span v-else>待检测</span>
                    </div>
                </template>
            </Column>

            <Column header="有效率" style="width: 100px">
                <template #body="{ data }">
                    <span class="rate-text">
                        {{ data.validCount }} <span class="text-muted">/ {{ data.serviceResults.length }}</span>
                    </span>
                </template>
            </Column>

            <Column header="操作" style="width: 140px; text-align: right;">
                <template #body="{ data }">
                    <div class="row-actions">
                        <button class="icon-action-btn" @click.stop="recheckSingle(data)" title="重新检测">
                            <i class="pi pi-refresh"></i>
                        </button>
                        <button class="icon-action-btn" @click.stop="openReuploadDialog(data)" :disabled="!data.canReupload" title="修复/重传">
                            <i class="pi pi-cloud-upload"></i>
                        </button>
                    </div>
                </template>
            </Column>

            <template #expansion="{ data }">
                <div class="nested-table-wrapper">
                    <table class="nested-table">
                        <tbody>
                            <tr v-for="sr in data.serviceResults" :key="sr.serviceId">
                                <td width="100">
                                    <span class="service-label">{{ sr.serviceId }}</span>
                                </td>
                                <td width="80">
                                    <span class="mini-status" :class="sr.isValid ? 'valid' : 'invalid'">
                                        {{ sr.isValid ? 'OK' : 'ERR' }}
                                    </span>
                                </td>
                                <td class="link-cell">
                                    <a :href="sr.link" target="_blank" class="dashed-link" :title="sr.link">
                                        {{ truncate(sr.link, 60) }}
                                    </a>
                                </td>
                                <td width="100" class="mono-text text-muted text-right">
                                    {{ sr.responseTime ? sr.responseTime + 'ms' : '-' }}
                                </td>
                                <td width="150" class="text-muted text-right text-sm">
                                    {{ sr.statusCode ? 'HTTP ' + sr.statusCode : sr.errorType }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </template>
        </DataTable>
    </div>

    <Dialog v-model:visible="showReuploadDialog" header="修复失效链接" :style="{ width: '450px' }" modal class="minimal-dialog">
        <div class="dialog-form">
            <div class="form-row">
                <label>源图床 (下载)</label>
                <Select v-model="selectedReuploadItem.sourceService" :options="selectedReuploadItem?.validServices || []" class="w-full" />
            </div>
            <div class="form-row">
                <label>目标图床 (上传)</label>
                <MultiSelect v-model="selectedReuploadItem.targetServices" :options="selectedReuploadItem?.invalidServices || []" class="w-full" />
            </div>
        </div>
        <template #footer>
            <Button label="取消" @click="showReuploadDialog = false" text size="small" />
            <Button label="开始修复" @click="executeReupload" size="small" />
        </template>
    </Dialog>
  </div>
</template>

<style scoped>
/* 全局容器 */
.view-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--bg-app);
    font-family: var(--font-sans);
    overflow: hidden;
}

/* === Dashboard Strip (顶部仪表盘) === */
.dashboard-strip {
    flex-shrink: 0;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    background-color: var(--bg-card);
    border-bottom: 1px solid var(--border-subtle);
    max-width: 850px;
    margin: 0 auto;
    width: 100%;
}

.controls-area {
    display: flex;
    align-items: center;
    gap: 16px;
}

.view-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
}

.v-divider {
    width: 1px;
    height: 24px;
    background-color: var(--border-subtle);
}

/* 极简选择框 & 按钮 */
.minimal-select {
    width: 140px;
    height: 32px;
    font-size: 13px;
}

.minimal-btn {
    height: 32px;
    font-size: 13px;
}

.progress-text {
    font-size: 13px;
    font-family: var(--font-mono);
    color: var(--text-secondary);
    margin-left: 8px;
}

/* 统计数据区 */
.stats-area {
    display: flex;
    align-items: center;
    gap: 24px;
}

.stat-item {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1;
}

.stat-val {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
}

.stat-key {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin-top: 4px;
}

.stat-item.success .stat-val { color: var(--success); }
.stat-item.danger .stat-val { color: var(--error); }

/* === 进度条 === */
.progress-line {
    height: 2px;
    background-color: var(--primary);
    transition: width 0.3s ease, opacity 0.3s ease;
    max-width: 850px;
    margin: 0 auto;
}

/* === 极简表格样式 (Minimal Table) === */
.table-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 20px;
    max-width: 850px;
    margin: 0 auto;
    width: 100%;
}

.minimal-table {
    width: 100%;
}

:deep(.p-datatable-thead > tr > th) {
    background-color: transparent !important;
    border-bottom: 2px solid var(--border-subtle) !important;
    color: var(--text-secondary) !important;
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    padding: 12px 16px !important;
}

:deep(.p-datatable-tbody > tr) {
    background-color: transparent !important;
    transition: background-color 0.1s;
}

:deep(.p-datatable-tbody > tr:hover) {
    background-color: var(--hover-overlay-subtle) !important;
}

/* 斑马纹 */
:deep(.p-datatable-tbody > tr:nth-child(even)) {
    background-color: rgba(0,0,0,0.015) !important;
}

:deep(.p-datatable-tbody > tr > td) {
    border-bottom: 1px solid var(--border-subtle) !important;
    padding: 12px 16px !important;
    font-size: 13px;
    color: var(--text-primary);
}

/* 状态指示器 (Status Dot) */
.status-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-secondary);
}

.status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--text-muted);
}

.status-indicator.all_valid .status-dot { background-color: var(--success); box-shadow: 0 0 4px var(--success); }
.status-indicator.all_valid { color: var(--text-primary); font-weight: 500; }

.status-indicator.partial_valid .status-dot { background-color: var(--warning); }
.status-indicator.all_invalid .status-dot { background-color: var(--error); }

/* 操作按钮 (Icon Only) */
.row-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
}

.icon-action-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 6px;
    border-radius: 4px;
    transition: all 0.2s;
}

.icon-action-btn:hover:not(:disabled) {
    color: var(--primary);
    background-color: rgba(59, 130, 246, 0.1);
}

.icon-action-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
}

/* === 嵌套子表格 (Nested Table) === */
.nested-table-wrapper {
    padding: 0 16px 16px 48px;
    background-color: transparent;
}

.nested-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
}

.nested-table td {
    padding: 6px 8px;
    border-bottom: 1px dashed var(--border-subtle);
}

.nested-table tr:last-child td {
    border-bottom: none;
}

.service-label {
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    font-size: 11px;
}

.mini-status {
    font-weight: 600;
}
.mini-status.valid { color: var(--success); }
.mini-status.invalid { color: var(--error); }

/* 虚线链接样式 */
.dashed-link {
    color: var(--text-primary);
    text-decoration: none;
    border-bottom: 1px dashed var(--border-subtle);
    transition: all 0.2s;
    font-family: var(--font-mono);
}

.dashed-link:hover {
    color: var(--primary);
    border-color: var(--primary);
}

/* 工具类 */
.text-muted { color: var(--text-muted); }
.text-right { text-align: right; }
.text-sm { font-size: 12px; }
.mono-text { font-family: var(--font-mono); }
.empty-state {
    padding: 40px;
    text-align: center;
    color: var(--text-secondary);
}

/* Dialog Form */
.dialog-form {
    padding: 10px 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.form-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.form-row label {
    display: block;
    font-size: 13px;
    color: var(--text-secondary);
}
.w-full { width: 100%; }
</style>
