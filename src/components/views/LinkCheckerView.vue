<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import Button from 'primevue/button';
import Select from 'primevue/select';
import ProgressBar from 'primevue/progressbar';
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

// 使用历史记录管理器
const { allHistoryItems, loadHistory } = useHistoryManager();

// 使用配置管理器
const { config } = useConfigManager();

// 历史记录存储
const historyStore = new Store('.history.dat');

// 组件挂载时加载历史记录并预加载图片信息
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

// 监听筛选条件变化
watch(serviceFilter, async () => {
  // 如果不在检测中，重新预加载
  if (!isChecking.value) {
    await preloadImageInfo();
  }
});

// 统计数据
const stats = ref({
  total: 0,
  valid: 0,
  invalid: 0,
  pending: 0
});

// 进度
const progress = ref(0);
const progressText = ref('检测中... 0/0');

// 错误类型
type ErrorType = 'success' | 'http_4xx' | 'http_5xx' | 'timeout' | 'network' | 'pending';

// 单个图床的检测结果
interface ServiceCheckResult {
  serviceId: ServiceType;
  link: string;           // 检测的链接（可能含代理前缀）
  originalLink: string;   // 原始链接（不含前缀）
  isValid: boolean;
  statusCode?: number;
  errorType: ErrorType;
  error?: string;
  suggestion?: string;
  responseTime?: number;
}

// 完整检测结果（一个文件包含多个图床）
interface CheckResult {
  historyItemId: string;
  fileName: string;
  filePath?: string;
  primaryService: ServiceType;

  serviceResults: ServiceCheckResult[];

  // 聚合状态
  status: 'all_valid' | 'partial_valid' | 'all_invalid' | 'pending';
  validCount: number;
  invalidCount: number;
  canReupload: boolean;
}

const results = ref<CheckResult[]>([]);
const expandedRows = ref<CheckResult[]>([]);

// 从历史记录中提取链接（多图床检测）
const extractLinksFromHistory = (): CheckResult[] => {
  return allHistoryItems.value
    .filter(item => {
      // 如果有图床筛选，确保至少有一个图床匹配筛选条件
      if (serviceFilter.value !== 'all') {
        return item.results?.some(r =>
          r.status === 'success' &&
          r.result?.url &&
          r.serviceId === serviceFilter.value
        );
      }
      return item.results && item.results.length > 0;
    })
    .map(item => {
      const serviceResults: ServiceCheckResult[] = item.results
        .filter(r => {
          // 只提取成功的结果
          if (r.status !== 'success' || !r.result?.url) return false;

          // 应用图床筛选
          if (serviceFilter.value !== 'all' && r.serviceId !== serviceFilter.value) {
            return false;
          }

          return true;
        })
        .map(r => {
          const originalLink = r.result!.url;

          // 微博图床且启用代理前缀时，加上前缀
          let linkToCheck = originalLink;
          if (r.serviceId === 'weibo' && config.value.outputFormat === 'baidu-proxy') {
            const activePrefix = getActivePrefix(config.value);
            if (activePrefix) {
              linkToCheck = `${activePrefix}${originalLink}`;
            }
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

// 更新聚合状态
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

// 调用 Rust 后端检测单个链接
const checkLink = async (serviceResult: ServiceCheckResult): Promise<void> => {
  try {
    const result = await invoke<{
      link: string;
      is_valid: boolean;
      status_code?: number;
      error?: string;
      error_type: string;
      suggestion?: string;
      response_time?: number;
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

// 开始检测
const startCheck = async () => {
  if (isChecking.value) return;

  isChecking.value = true;
  isCancelled.value = false;

  // 如果已有预加载的数据，复用它
  if (results.value.length === 0) {
    // 没有预加载数据，执行完整加载流程
    progress.value = 0;

    try {
      // 1. 加载历史记录
      await loadHistory();

      // 2. 提取链接（多图床检测）
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
    // 已有预加载数据，重置检测状态
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

    stats.value = {
      total: results.value.length,
      valid: 0,
      invalid: 0,
      pending: results.value.length
    };
  }

  progress.value = 0;
  toast.info('开始检测', `共 ${results.value.length} 个文件待检测`);

  try {
    // 3. 批量检测（每个文件的所有图床串行检测）
    let checkedCount = 0;

    for (const checkResult of results.value) {
      if (isCancelled.value) break;

      // 检测当前文件的所有图床
      for (const serviceResult of checkResult.serviceResults) {
        await checkLink(serviceResult);
      }

      // 更新聚合状态（触发 Vue 响应式更新）
      updateAggregateStatus(checkResult);

      // 更新统计
      checkedCount++;
      stats.value.valid = results.value.filter(r => r.status === 'all_valid').length;
      stats.value.invalid = results.value.filter(r => r.status === 'all_invalid' || r.status === 'partial_valid').length;
      stats.value.pending = stats.value.total - checkedCount;

      // 更新进度
      progress.value = Math.round((checkedCount / stats.value.total) * 100);
      progressText.value = `检测中... ${checkedCount}/${stats.value.total}`;
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

/**
 * 预加载图片信息（不执行检测）
 * 在进入窗口时调用，显示待检测的图片列表
 */
const preloadImageInfo = async () => {
  try {
    // 1. 确保历史记录已加载
    if (allHistoryItems.value.length === 0) {
      await loadHistory();
    }

    // 2. 提取链接（复用 extractLinksFromHistory）
    const checkResults = extractLinksFromHistory();

    if (checkResults.length === 0) {
      console.log('[预加载] 无可检测的图片');
      results.value = [];
      stats.value = { total: 0, valid: 0, invalid: 0, pending: 0 };
      return;
    }

    // 3. 设置结果（所有状态均为 pending）
    results.value = checkResults;

    // 4. 更新统计数据
    stats.value = {
      total: checkResults.length,
      valid: 0,
      invalid: 0,
      pending: checkResults.length
    };

    console.log(`[预加载] 已加载 ${checkResults.length} 个文件的信息`);
  } catch (error) {
    console.error('[预加载] 加载失败:', error);
    // 静默失败，不影响用户体验
  }
};

// 取消检测
const cancelCheck = () => {
  isCancelled.value = true;
  isChecking.value = false;
  toast.info('已取消', '链接检测已取消');
};

// 删除失效链接
const deleteInvalid = () => {
  const invalidCount = results.value.filter(r =>
    r.status === 'all_invalid' || r.status === 'partial_valid'
  ).length;

  if (invalidCount === 0) {
    toast.warn('无失效链接', '没有找到失效的链接');
    return;
  }

  confirmDelete(
    `确定要从检测结果中移除 ${invalidCount} 个失效链接吗？`,
    () => {
      // 只从检测结果中移除，不修改历史记录
      results.value = results.value.filter(r => r.status === 'all_valid');

      // 更新统计
      stats.value.invalid = 0;
      stats.value.valid = results.value.filter(r => r.status === 'all_valid').length;
      stats.value.pending = results.value.filter(r => r.status === 'pending').length;
      stats.value.total = results.value.length;

      toast.success('移除成功', `已从结果中移除 ${invalidCount} 个失效链接`);
    }
  );
};

// 单条重新检测
const recheckSingle = async (checkResult: CheckResult) => {
  toast.info('开始检测', `正在重新检测 ${checkResult.fileName}`);

  for (const serviceResult of checkResult.serviceResults) {
    await checkLink(serviceResult);
  }

  updateAggregateStatus(checkResult);
  toast.success('检测完成', `${checkResult.fileName} 检测完成`);
};

// 批量导出 JSON
const exportResults = async () => {
  if (results.value.length === 0) {
    toast.warn('无数据', '没有可导出的检测结果');
    return;
  }

  const exportData = {
    exportTime: new Date().toISOString(),
    totalFiles: results.value.length,
    summary: {
      allValid: results.value.filter(r => r.status === 'all_valid').length,
      partialValid: results.value.filter(r => r.status === 'partial_valid').length,
      allInvalid: results.value.filter(r => r.status === 'all_invalid').length
    },
    results: results.value.map(r => ({
      fileName: r.fileName,
      status: r.status,
      validCount: r.validCount,
      invalidCount: r.invalidCount,
      services: r.serviceResults.map(sr => ({
        serviceId: sr.serviceId,
        isValid: sr.isValid,
        link: sr.link,
        originalLink: sr.originalLink,
        statusCode: sr.statusCode,
        errorType: sr.errorType,
        error: sr.error,
        suggestion: sr.suggestion,
        responseTime: sr.responseTime
      }))
    }))
  };

  const jsonContent = JSON.stringify(exportData, null, 2);

  const filePath = await saveDialog({
    defaultPath: `link-check-${Date.now()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (filePath) {
    await writeTextFile(filePath as string, jsonContent);
    toast.success('导出成功', `已导出 ${results.value.length} 条检测结果`);
  }
};

// 复制链接
const copyLink = async (link: string) => {
  try {
    await writeText(link);
    toast.success('已复制', '链接已复制到剪贴板');
  } catch (error) {
    toast.error('复制失败', String(error));
  }
};

// 重新上传相关
const showReuploadDialog = ref(false);
const selectedReuploadItem = ref<{
  checkResult: CheckResult;
  validServices: ServiceType[];
  invalidServices: ServiceType[];
  sourceService: ServiceType;
  targetServices: ServiceType[];
} | null>(null);

// 打开重新上传对话框
const openReuploadDialog = (checkResult: CheckResult) => {
  if (!checkResult.canReupload) {
    toast.warn('无法重新上传', '没有有效的源图床可供下载');
    return;
  }

  const validServices = checkResult.serviceResults
    .filter(r => r.isValid)
    .map(r => r.serviceId);

  const invalidServices = checkResult.serviceResults
    .filter(r => !r.isValid)
    .map(r => r.serviceId);

  selectedReuploadItem.value = {
    checkResult,
    validServices,
    invalidServices,
    sourceService: validServices[0], // 默认选择第一个有效图床
    targetServices: [...invalidServices]  // 默认选择所有失效图床
  };

  showReuploadDialog.value = true;
};

// 执行重新上传
const executeReupload = async () => {
  const item = selectedReuploadItem.value!;

  try {
    // 1. 从有效图床下载
    const sourceResult = item.checkResult.serviceResults
      .find(r => r.serviceId === item.sourceService);

    if (!sourceResult) {
      throw new Error('未找到源图床');
    }

    toast.info('下载中', `正在从 ${item.sourceService} 下载图片...`);

    const tempFilePath = await invoke<string>('download_image_from_url', {
      url: sourceResult.originalLink
    });

    // 2. 重新上传到目标图床
    toast.info('上传中', `正在上传到 ${item.targetServices.join(', ')}...`);

    const uploader = new MultiServiceUploader();
    const uploadResult = await uploader.uploadToMultipleServices(
      tempFilePath,
      item.targetServices,
      config.value
    );

    // 3. 更新历史记录
    const items = await historyStore.get<HistoryItem[]>('uploads', []);
    const historyItem = items.find(i => i.id === item.checkResult.historyItemId);

    if (historyItem) {
      uploadResult.results.forEach(newResult => {
        const existingIndex = historyItem.results.findIndex(
          r => r.serviceId === newResult.serviceId
        );

        if (existingIndex >= 0) {
          historyItem.results[existingIndex] = newResult;
        } else {
          historyItem.results.push(newResult);
        }
      });

      await historyStore.set('uploads', items);
      await historyStore.save();
    }

    // 4. 重新检测
    await recheckSingle(item.checkResult);

    toast.success('重新上传成功', `已更新 ${uploadResult.results.length} 个图床`);

  } catch (error) {
    toast.error('重新上传失败', String(error));
  } finally {
    showReuploadDialog.value = false;
  }
};

// 获取状态标签样式
const getStatusSeverity = (status: string): 'success' | 'danger' | 'warn' | 'secondary' | undefined => {
  switch (status) {
    case 'all_valid': return 'success';
    case 'partial_valid': return 'warn';
    case 'all_invalid': return 'danger';
    default: return 'secondary';
  }
};

// 获取状态标签文本
const getStatusLabel = (status: string): string => {
  switch (status) {
    case 'all_valid': return '全部有效';
    case 'partial_valid': return '部分有效';
    case 'all_invalid': return '全部失效';
    default: return '待检测';
  }
};

// 截断链接用于显示
const truncate = (str: string, length: number): string => {
  return str.length > length ? str.substring(0, length) + '...' : str;
};

// 获取行的CSS类名（根据状态）
const getRowClass = (data: CheckResult): string => {
  switch (data.status) {
    case 'all_valid':
      return 'row-all-valid';
    case 'partial_valid':
      return 'row-partial-valid';
    case 'all_invalid':
      return 'row-all-invalid';
    case 'pending':
      return 'row-pending';
    default:
      return '';
  }
};

// 切换行的展开/收起状态
const toggleRowExpansion = (event: any) => {
  const data = event.data as CheckResult;

  // 检查当前行是否已展开
  const isExpanded = expandedRows.value.some((row: CheckResult) => row.historyItemId === data.historyItemId);

  if (isExpanded) {
    // 收起：从数组中移除
    expandedRows.value = expandedRows.value.filter(
      (row: CheckResult) => row.historyItemId !== data.historyItemId
    );
  } else {
    // 展开：添加到数组
    expandedRows.value = [...expandedRows.value, data];
  }
};
</script>

<template>
  <div class="link-checker-view">
    <!-- 顶部细进度条 -->
    <div class="top-progress-bar" :class="{ active: isChecking }">
      <div class="top-progress-fill" :style="{ width: progress + '%' }"></div>
    </div>

    <div class="link-checker-container">
      <!-- 控制区域 -->
      <div class="link-checker-controls">
        <div class="link-checker-filter-group">
          <label>筛选图床：</label>
          <Select
            v-model="serviceFilter"
            :options="serviceOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="选择图床"
            class="service-filter"
          />
        </div>

        <Button
          label="开始检测"
          icon="pi pi-play"
          @click="startCheck"
          :disabled="isChecking"
          severity="success"
        />

        <Button
          label="取消"
          icon="pi pi-stop"
          @click="cancelCheck"
          :disabled="!isChecking"
          outlined
        />

        <Button
          label="导出JSON"
          icon="pi pi-download"
          @click="exportResults"
          :disabled="results.length === 0"
          outlined
        />
      </div>

      <!-- 统计卡片 -->
      <div class="link-checker-stats">
        <div class="link-checker-stat-card">
          <div class="stat-value">{{ stats.total }}</div>
          <div class="stat-label">总数</div>
        </div>
        <div class="link-checker-stat-card valid">
          <div class="stat-value">{{ stats.valid }}</div>
          <div class="stat-label">有效</div>
        </div>
        <div class="link-checker-stat-card invalid">
          <div class="stat-value">{{ stats.invalid }}</div>
          <div class="stat-label">失效</div>
        </div>
        <div class="link-checker-stat-card pending">
          <div class="stat-value">{{ stats.pending }}</div>
          <div class="stat-label">待检测</div>
        </div>
      </div>

      <!-- 检测结果 -->
      <div class="link-checker-results">
        <div class="link-checker-results-header">
          <h3>检测结果</h3>
          <Button
            label="删除失效"
            icon="pi pi-trash"
            @click="deleteInvalid"
            :disabled="stats.invalid === 0"
            severity="danger"
            outlined
            size="small"
          />
        </div>

        <DataTable
          :value="results"
          v-model:expandedRows="expandedRows"
          :rowClass="getRowClass"
          @row-click="toggleRowExpansion"
          paginator
          :rows="50"
          :rowsPerPageOptions="[10, 20, 50, 100]"
          class="link-checker-table"
          emptyMessage="点击【开始检测】检查历史记录中的图片链接"
        >
          <Column field="fileName" header="文件名" sortable style="width: 200px">
            <template #body="{ data }">
              <span :title="data.fileName">{{ data.fileName }}</span>
            </template>
          </Column>

          <Column field="status" header="聚合状态" sortable style="width: 150px">
            <template #body="{ data }">
              <Tag
                :value="getStatusLabel(data.status)"
                :severity="getStatusSeverity(data.status)"
              />
              <span class="ml-2 text-sm">{{ data.validCount }}/{{ data.serviceResults.length }}</span>
            </template>
          </Column>

          <Column header="图床数量" style="width: 100px">
            <template #body="{ data }">
              {{ data.serviceResults.length }} 个
            </template>
          </Column>

          <Column header="操作" style="width: 180px">
            <template #body="{ data }">
              <Button
                icon="pi pi-refresh"
                @click="recheckSingle(data)"
                size="small"
                text
                rounded
                v-tooltip.top="'重新检测'"
                class="mr-1"
              />
              <Button
                icon="pi pi-upload"
                @click="openReuploadDialog(data)"
                :disabled="!data.canReupload"
                size="small"
                text
                rounded
                v-tooltip.top="'重新上传'"
              />
            </template>
          </Column>

          <!-- 展开内容：显示所有图床的检测结果 -->
          <template #expansion="{ data }">
            <div class="service-details">
              <DataTable :value="data.serviceResults" class="service-results-table">
                <Column field="serviceId" header="图床" style="width: 100px">
                  <template #body="{ data: sr }">
                    <Tag :value="sr.serviceId" severity="info" />
                  </template>
                </Column>

                <Column header="状态" style="width: 150px">
                  <template #body="{ data: sr }">
                    <Tag
                      :severity="sr.isValid ? 'success' : 'danger'"
                      :value="sr.isValid ? '有效' : '失效'"
                    />
                    <span v-if="sr.statusCode" class="ml-2 text-sm text-muted">HTTP {{ sr.statusCode }}</span>
                  </template>
                </Column>

                <Column header="链接" style="width: 400px">
                  <template #body="{ data: sr }">
                    <a :href="sr.link" target="_blank" class="link-url" :title="sr.link">
                      {{ truncate(sr.link, 60) }}
                    </a>
                  </template>
                </Column>

                <Column header="响应时间" style="width: 100px">
                  <template #body="{ data: sr }">
                    <span v-if="sr.responseTime" class="text-sm">{{ sr.responseTime }}ms</span>
                    <span v-else class="text-sm text-muted">-</span>
                  </template>
                </Column>

                <Column header="建议" style="min-width: 250px">
                  <template #body="{ data: sr }">
                    <small v-if="sr.suggestion" class="suggestion-text">{{ sr.suggestion }}</small>
                    <span v-else class="text-sm text-muted">-</span>
                  </template>
                </Column>
              </DataTable>
            </div>
          </template>
        </DataTable>
      </div>
    </div>

    <!-- 重新上传对话框 -->
    <Dialog
      v-model:visible="showReuploadDialog"
      header="重新上传"
      :style="{ width: '500px' }"
      modal
    >
      <template v-if="selectedReuploadItem">
        <div class="reupload-dialog-content">
          <p><strong>文件：</strong>{{ selectedReuploadItem.checkResult.fileName }}</p>

          <div class="form-group">
            <label>从哪个图床下载：</label>
            <Select
              v-model="selectedReuploadItem.sourceService"
              :options="selectedReuploadItem.validServices"
              placeholder="选择源图床"
              class="w-full"
            />
          </div>

          <div class="form-group">
            <label>重新上传到：</label>
            <MultiSelect
              v-model="selectedReuploadItem.targetServices"
              :options="selectedReuploadItem.invalidServices"
              placeholder="选择目标图床"
              class="w-full"
            />
          </div>
        </div>
      </template>

      <template #footer>
        <Button
          label="取消"
          icon="pi pi-times"
          @click="showReuploadDialog = false"
          outlined
        />
        <Button
          label="确认上传"
          icon="pi pi-check"
          @click="executeReupload"
          severity="success"
        />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
/* ===== 精致优雅风格 - 细腻阴影、流畅动画、精致细节 ===== */

/* 基础布局 */
.link-checker-view {
  display: flex;
  flex-direction: column;
  padding: 20px;
  background: var(--bg-app);
}

.link-checker-container {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ===== 顶部细进度条 ===== */
.top-progress-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: transparent;
  z-index: 1000;
  opacity: 0;
  transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.top-progress-bar.active {
  opacity: 1;
}

.top-progress-fill {
  height: 100%;
  background: linear-gradient(90deg,
    var(--primary) 0%,
    var(--accent) 50%,
    var(--primary) 100%);
  background-size: 200% 100%;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  animation: progressShimmer 2s ease-in-out infinite;
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.5),
              0 0 20px rgba(59, 130, 246, 0.3);
}

@keyframes progressShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ===== 控制区域 - 精致紧凑 ===== */
.link-checker-controls {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  background: var(--bg-card);
  padding: 16px 20px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05),
              0 1px 3px 0 rgba(0, 0, 0, 0.03);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.link-checker-controls:hover {
  box-shadow: 0 2px 4px 0 rgba(0, 0, 0, 0.08),
              0 4px 8px 0 rgba(0, 0, 0, 0.06);
}

.link-checker-filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: auto;
}

.link-checker-filter-group label {
  color: var(--text-primary);
  font-weight: 500;
  font-size: 0.9rem;
}

.service-filter {
  min-width: 150px;
}

/* ===== 统计卡片 - 柔和渐变 ===== */
.link-checker-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 10px;
}

.link-checker-stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 14px 12px;
  text-align: center;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.04),
              0 1px 3px 0 rgba(0, 0, 0, 0.02);
}

.link-checker-stat-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1),
              0 2px 4px -1px rgba(0, 0, 0, 0.06),
              0 8px 16px -4px rgba(0, 0, 0, 0.08);
  border-color: rgba(59, 130, 246, 0.3);
}

.stat-value {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
  transition: color 0.2s ease;
}

.stat-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  font-weight: 500;
  letter-spacing: 0.02em;
}

/* 统计卡片渐变背景 */
.link-checker-stat-card.valid {
  background: linear-gradient(135deg,
    var(--bg-card) 0%,
    rgba(16, 185, 129, 0.03) 100%);
}

.link-checker-stat-card.valid:hover {
  background: linear-gradient(135deg,
    var(--bg-card) 0%,
    rgba(16, 185, 129, 0.06) 100%);
}

.link-checker-stat-card.valid .stat-value {
  color: var(--success);
}

.link-checker-stat-card.invalid {
  background: linear-gradient(135deg,
    var(--bg-card) 0%,
    rgba(239, 68, 68, 0.03) 100%);
}

.link-checker-stat-card.invalid:hover {
  background: linear-gradient(135deg,
    var(--bg-card) 0%,
    rgba(239, 68, 68, 0.06) 100%);
}

.link-checker-stat-card.invalid .stat-value {
  color: var(--error);
}

.link-checker-stat-card.pending {
  background: linear-gradient(135deg,
    var(--bg-card) 0%,
    rgba(148, 163, 184, 0.03) 100%);
}

.link-checker-stat-card.pending:hover {
  background: linear-gradient(135deg,
    var(--bg-card) 0%,
    rgba(148, 163, 184, 0.06) 100%);
}

.link-checker-stat-card.pending .stat-value {
  color: var(--text-muted);
}

/* ===== 检测结果 - 精致表格 ===== */
.link-checker-results {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 18px 20px;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05),
              0 1px 3px 0 rgba(0, 0, 0, 0.03);
}

.link-checker-results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.link-checker-results-header h3 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.link-checker-table {
  background: transparent;
}

/* 表格单元格优化 */
:deep(.p-datatable .p-datatable-thead > tr > th) {
  padding: 8px 10px;
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  background: var(--bg-app);
}

:deep(.p-datatable .p-datatable-tbody > tr > td) {
  padding: 8px 10px;
  font-size: 0.85rem;
  word-break: break-word;
  white-space: normal;
  border-color: var(--border-subtle);
  transition: all 0.2s ease;
}

:deep(.p-datatable .p-datatable-tbody > tr) {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

:deep(.p-datatable .p-datatable-tbody > tr:hover) {
  /* 背景色已由状态类控制 */
}

/* 状态色彩编码 - 柔和背景 */
:deep(.p-datatable .p-datatable-tbody > tr.row-all-valid) {
  background: linear-gradient(90deg,
    rgba(16, 185, 129, 0.08) 0%,
    rgba(16, 185, 129, 0.04) 100%) !important;
  border-left: 3px solid var(--success);
}

:deep(.p-datatable .p-datatable-tbody > tr.row-all-valid:hover) {
  background: linear-gradient(90deg,
    rgba(16, 185, 129, 0.12) 0%,
    rgba(16, 185, 129, 0.06) 100%) !important;
}

:deep(.p-datatable .p-datatable-tbody > tr.row-partial-valid) {
  background: linear-gradient(90deg,
    rgba(234, 179, 8, 0.08) 0%,
    rgba(234, 179, 8, 0.04) 100%) !important;
  border-left: 3px solid var(--warning);
}

:deep(.p-datatable .p-datatable-tbody > tr.row-partial-valid:hover) {
  background: linear-gradient(90deg,
    rgba(234, 179, 8, 0.12) 0%,
    rgba(234, 179, 8, 0.06) 100%) !important;
}

:deep(.p-datatable .p-datatable-tbody > tr.row-all-invalid) {
  background: linear-gradient(90deg,
    rgba(239, 68, 68, 0.08) 0%,
    rgba(239, 68, 68, 0.04) 100%) !important;
  border-left: 3px solid var(--error);
}

:deep(.p-datatable .p-datatable-tbody > tr.row-all-invalid:hover) {
  background: linear-gradient(90deg,
    rgba(239, 68, 68, 0.12) 0%,
    rgba(239, 68, 68, 0.06) 100%) !important;
}

:deep(.p-datatable .p-datatable-tbody > tr.row-pending) {
  background: linear-gradient(90deg,
    rgba(148, 163, 184, 0.06) 0%,
    rgba(148, 163, 184, 0.03) 100%) !important;
  border-left: 3px solid var(--text-muted);
}

:deep(.p-datatable .p-datatable-tbody > tr.row-pending:hover) {
  background: linear-gradient(90deg,
    rgba(148, 163, 184, 0.10) 0%,
    rgba(148, 163, 184, 0.05) 100%) !important;
}

.link-url {
  color: var(--primary);
  text-decoration: none;
  word-break: break-all;
  width: 100%;
  display: block;
  white-space: normal;
  line-height: 1.5;
  transition: all 0.2s ease;
  opacity: 0.9;
}

.link-url:hover {
  text-decoration: underline;
  opacity: 1;
  color: var(--primary-hover);
}

/* 展开表格样式 */
.service-details {
  padding: 10px 14px;
  background: var(--bg-app);
  border-radius: 6px;
  margin: 2px 0;
}

.service-results-table {
  background: transparent;
}

/* 子表格行也更紧凑 */
:deep(.service-results-table .p-datatable-tbody > tr > td) {
  padding: 6px 8px !important;
  font-size: 0.8rem !important;
}

/* 展开行动画优化 */
:deep(.p-datatable-row-expansion) {
  animation: fadeInSlide 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes fadeInSlide {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ===== 滚动条 ===== */
.link-checker-view::-webkit-scrollbar {
  width: 8px;
}

.link-checker-view::-webkit-scrollbar-track {
  background: var(--bg-input);
}

.link-checker-view::-webkit-scrollbar-thumb {
  background: var(--border-subtle);
  border-radius: 4px;
}

.link-checker-view::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

/* ===== 工具类 ===== */
.text-muted {
  color: var(--text-secondary);
}

.ml-2 {
  margin-left: 0.5rem;
}

.mr-1 {
  margin-right: 0.25rem;
}

.text-sm {
  font-size: 0.875rem;
}

.suggestion-text {
  color: var(--text-secondary);
  font-style: italic;
  line-height: 1.4;
}

/* ===== 重新上传对话框 - 精致圆润 ===== */
.reupload-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-weight: 500;
  color: var(--text-primary);
  font-size: 0.9rem;
  letter-spacing: 0.01em;
}

.w-full {
  width: 100%;
}

/* Dialog样式优化 */
:deep(.p-dialog) {
  border-radius: 10px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15),
              0 10px 10px -5px rgba(0, 0, 0, 0.08),
              0 0 0 1px rgba(0, 0, 0, 0.05);
}

:deep(.p-dialog .p-dialog-header) {
  padding: 18px 20px;
  border-bottom: 1px solid var(--border-subtle);
}

:deep(.p-dialog .p-dialog-content) {
  padding: 18px 20px;
}

:deep(.p-dialog .p-dialog-footer) {
  padding: 14px 20px;
  border-top: 1px solid var(--border-subtle);
  gap: 8px;
}

/* ===== Tag标签 - 柔和半透明 ===== */
:deep(.p-tag) {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

:deep(.p-tag.p-tag-success) {
  background-color: rgba(16, 185, 129, 0.12);
  color: var(--success);
  border: 1px solid rgba(16, 185, 129, 0.25);
}

:deep(.p-tag.p-tag-danger) {
  background-color: rgba(239, 68, 68, 0.12);
  color: var(--error);
  border: 1px solid rgba(239, 68, 68, 0.25);
}

:deep(.p-tag.p-tag-warn) {
  background-color: rgba(234, 179, 8, 0.12);
  color: var(--warning);
  border: 1px solid rgba(234, 179, 8, 0.25);
}

:deep(.p-tag.p-tag-secondary) {
  background-color: rgba(148, 163, 184, 0.12);
  color: var(--text-secondary);
  border: 1px solid rgba(148, 163, 184, 0.25);
}

:deep(.p-tag.p-tag-info) {
  background-color: rgba(59, 130, 246, 0.12);
  color: var(--primary);
  border: 1px solid rgba(59, 130, 246, 0.25);
}

/* ===== 全局动画优化 ===== */
* {
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

:deep(.p-button) {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

:deep(.p-button:hover:not(:disabled)) {
  transform: translateY(-1px);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1),
              0 2px 4px -1px rgba(0, 0, 0, 0.06);
}

:deep(.p-button:active:not(:disabled)) {
  transform: translateY(0);
}

:deep(.p-inputtext:focus),
:deep(.p-select:focus) {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
</style>
