<script setup lang="ts">
import { computed, nextTick, onMounted, provide, ref } from 'vue';
import ReloadBanner from '@/components/common/ReloadBanner.vue';
import GeneralSettingsPanel from '@/components/settings/GeneralSettingsPanel.vue';
import ServiceEnableSection from '@/components/settings/hosting/ServiceEnableSection.vue';
import DataItemCard from '@/components/settings/backup-sync/DataItemCard.vue';
import WebDAVConfigCollapsible from '@/components/settings/backup-sync/WebDAVConfigCollapsible.vue';
import BackupPasswordDialog from '@/components/dialogs/BackupPasswordDialog.vue';
import WechatQrDialog from '@/components/settings/about-update/WechatQrDialog.vue';
import OnboardingDialog from '@/components/onboarding/OnboardingDialog.vue';
import PnConfirmHost from '@/components/pn/PnConfirmHost.vue';
import { useConfirm } from '@/composables/useConfirm';
import { useOnboarding } from '@/composables/useOnboarding';
import type { ProfileSyncRecord, ThemeMode, WebDAVConfig } from '@/config/types';
import type { ServiceHealthStatus } from '@/types/serviceHealth';
import type { ServiceCheckSession } from '@/types/serviceCheck';
import type { LinkFormat } from '@/utils/linkFormatter';

type VisualPage = 'backup-sync' | 'settings' | 'dialogs';
type VisualState = string;

const params = new URLSearchParams(window.location.search);
const page = (params.get('page') || 'settings') as VisualPage;
const state = (params.get('state') || 'empty') as VisualState;
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const isDark = state === 'dark-theme' || prefersDark;
const rootClass = isDark ? 'dark-theme' : 'light-theme';
const isSettingsPage = computed(() => page === 'settings' || page === 'backup-sync');

document.documentElement.classList.toggle('dark-theme', isDark);
document.documentElement.classList.toggle('light-theme', !isDark);
document.documentElement.dataset.theme = isDark ? 'dark' : 'light';

/* ---- dialogs 页：集中覆盖不隶属于任何业务页面的独立弹窗 ---- */
const showWechatQrDialog = ref(page === 'dialogs' && state === 'wechat-qr');
const isOnboardingState = computed(() => page === 'dialogs' && state.startsWith('onboarding'));

/* OnboardingDialog 的显隐是 useOnboarding 的模块级状态，只能用它自己的 API 驱动 */
const onboardingStepIndex: Record<string, number> = {
  'onboarding-welcome': 0,
  'onboarding-upload': 1,
  'onboarding-services': 2,
};
if (page === 'dialogs' && state in onboardingStepIndex) {
  const onboarding = useOnboarding();
  onboarding.reopen();
  for (let i = 0; i < onboardingStepIndex[state]; i++) onboarding.nextStep();
}

const passwordDialogStates = [
  'password-dialog',
  'password-set-dialog',
  'password-change-dialog',
  'password-disable-dialog',
  'restore-password-error',
];
const showBackupPasswordDialog = ref(passwordDialogStates.includes(state));
const backupPasswordDialogRef = ref<InstanceType<typeof BackupPasswordDialog>>();
const backupPasswordDialogMode = computed<'set' | 'change' | 'disable' | 'restore'>(() => {
  if (state === 'password-set-dialog') return 'set';
  if (state === 'password-change-dialog') return 'change';
  if (state === 'password-disable-dialog') return 'disable';
  return 'restore';
});
const connectedWebDAVProfile = {
  id: 'visual-nas',
  name: 'Studio NAS',
  url: 'https://dav.example.local',
  username: 'picnexus',
  password: 'fixture-only',
  remotePath: '/PicNexus/',
  connectionStatus: 'success' as const,
  lastTestedAt: Date.now() - 3_600_000,
};
const connectedWebDAV: WebDAVConfig = {
  activeId: 'visual-nas',
  profiles: [connectedWebDAVProfile],
};
const unavailableWebDAV: WebDAVConfig = {
  activeId: 'visual-nas',
  profiles: [{
    ...connectedWebDAVProfile,
    connectionStatus: 'failed',
    lastError: '连接超时，WebDAV 服务器不可用',
  }],
};
const backupWebDAVConfig = computed<WebDAVConfig>(() => state === 'webdav-unavailable' ? unavailableWebDAV : connectedWebDAV);
const backupWebDAVTesting = computed(() => state === 'cloud-syncing' || state === 'webdav-testing');
const backupCloudEnabled = computed(() => backupWebDAVConfig.value.profiles[0]?.connectionStatus === 'success');
const backupCloudHint = computed(() => backupCloudEnabled.value ? '' : '连接失败，请重新验证');
const backupSyncStatus = computed(() => {
  if (['local-success', 'cloud-syncing', 'download-needs-refresh'].includes(state)) {
    return { lastSync: new Date(Date.now() - 12 * 60_000).toISOString(), result: 'success' as const };
  }
  if (state === 'error') {
    return {
      lastSync: new Date(Date.now() - 2 * 60_000).toISOString(),
      result: 'failed' as const,
      error: 'WebDAV 返回 401，用户名或密码不正确',
    };
  }
  return { lastSync: null, result: null };
});
const backupOtherProfiles: ProfileSyncRecord[] = [{
  providerName: 'Laptop WebDAV',
  configLastSync: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  configSyncResult: 'success',
  historyLastSync: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  historySyncResult: 'success',
}];
const backupLocalLoading = computed(() => ({ export: state === 'local-backing-up', import: false }));
const backupCloudLoading = computed(() => ({
  sync: state === 'cloud-syncing',
  forceUpload: false,
  forceDownload: false,
}));
const backupLogRows = computed(() => {
  if (state === 'operation-history-empty') return [];
  if (state === 'error') return [
    { icon: 'pi-exclamation-circle', tone: 'error', title: '双向同步配置', meta: '刚刚 · Studio NAS', detail: 'WebDAV 返回 401' },
    { icon: 'pi-clock', tone: 'muted', title: '导出历史到本地', meta: '18 分钟前', detail: '245 条记录' },
  ];
  if (state === 'local-success') return [
    { icon: 'pi-check', tone: 'success', title: '导出配置到本地', meta: '刚刚', detail: 'settings.backup.json' },
    { icon: 'pi-check', tone: 'success', title: '导出历史到本地', meta: '刚刚', detail: '245 条记录' },
  ];
  if (state === 'cloud-syncing') return [
    { icon: 'pi-spin pi-spinner', tone: 'primary', title: '双向同步记录', meta: '进行中 · Studio NAS', detail: '正在合并云端记录' },
    { icon: 'pi-check', tone: 'success', title: '上传配置到云端', meta: '12 分钟前', detail: '完成' },
  ];
  return [
    { icon: 'pi-check', tone: 'success', title: '上传配置到云端', meta: '12 分钟前 · Studio NAS', detail: '完成' },
    { icon: 'pi-check', tone: 'success', title: '双向同步记录', meta: '1 小时前 · Studio NAS', detail: '245 条记录' },
  ];
});

onMounted(async () => {
  if (state === 'restore-password-error') {
    await nextTick();
    backupPasswordDialogRef.value?.onPasswordFailed();
  }

  if (state === 'overwrite-confirm-dialog') {
    await nextTick();
    useConfirm().showConfirm({
      header: '覆盖本地数据',
      message: '本地现有的所有记录将被删除，替换为云端数据。此操作不可撤销。',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '覆盖',
      rejectLabel: '取消',
      acceptClass: 'p-button-danger',
    });
  }
});

const themeMode = ref<ThemeMode>(isDark ? 'dark' : 'light');
const settingsLinkFormat = computed<LinkFormat>(() => state === 'custom-template' ? 'custom' : 'markdown');
const healthMap = computed<Record<string, ServiceHealthStatus>>(() => ({
  jd: state === 'error' ? 'error' : 'verified',
  qiyu: state === 'connection-testing' ? 'pending' : 'verified',
  weibo: state === 'error' ? 'error' : 'pending',
  r2: 'verified',
  github: 'pending',
  smms: 'unconfigured',
  zhihu: 'unconfigured',
  nami: 'unconfigured',
  bilibili: 'unconfigured',
  chaoxing: 'unconfigured',
  nowcoder: 'unconfigured',
  tencent: 'unconfigured',
  aliyun: 'unconfigured',
  qiniu: 'unconfigured',
  upyun: 'unconfigured',
  imgur: 'unconfigured',
}));
const tooltipMap = Object.fromEntries(Object.keys(healthMap.value).map((id) => [id, null])) as Record<string, string | null>;
const serviceNames = Object.fromEntries(Object.keys(healthMap.value).map((id) => [id, id.toUpperCase()]));
const testingConnections = computed((): Record<string, boolean> => state === 'connection-testing' ? { jd: true, qiyu: true } : {});
const serviceSession = computed<ServiceCheckSession | null>(() => {
  if (state !== 'connection-testing') return null;
  return {
    mode: 'batch',
    startedAt: Date.now(),
    targetIds: ['jd', 'qiyu', 'weibo', 'r2'],
    refreshingIds: ['jd', 'qiyu'],
    runningIds: ['qiyu'],
    completedIds: ['jd'],
    baselineStatuses: healthMap.value,
    resultStatuses: { jd: 'verified' },
    summarySkeletonStatuses: ['verified', 'error', 'pending', 'unconfigured'],
    summarySnapshot: {
      verified: '2 checked',
      error: '1 failed',
      pending: '1 pending',
      unconfigured: '4 unconfigured',
      counts: { verified: 2, error: 1, pending: 1, unconfigured: 4 },
    },
  };
});
</script>

<template>
  <div :class="['visual-shell', rootClass]" data-visual-root data-visual-ready="true">
    <aside class="visual-sidebar">
      <div class="visual-logo">PN</div>
      <div class="visual-nav"><i class="pi pi-cloud-upload"></i><span>Upload</span></div>
      <div class="visual-nav"><i class="pi pi-images"></i><span>History</span></div>
      <div class="visual-nav"><i class="pi pi-wrench"></i><span>Links</span></div>
      <div class="visual-nav" :class="{ active: isSettingsPage }"><i class="pi pi-cog"></i><span>Settings</span></div>
    </aside>

    <main class="visual-main">
      <section v-if="page === 'backup-sync'" class="visual-page visual-settings visual-backup-sync">
        <div class="settings-layout visual-settings-layout">
          <div class="settings-sidebar">
            <div class="sidebar-title">Settings</div>
            <button class="nav-item"><i class="pi pi-cog"></i><span>General</span></button>
            <button class="nav-item"><i class="pi pi-images"></i><span>Hosting</span></button>
            <button class="nav-item active"><i class="pi pi-database"></i><span>Backup</span></button>
          </div>
          <div class="settings-content">
            <div class="settings-section visual-backup-section">
              <div class="section-header">
                <h2>备份与同步</h2>
                <p class="section-desc">管理你的设置和上传记录，支持多设备同步</p>
              </div>

              <div v-if="state === 'local-success'" class="visual-success-banner">
                <i class="pi pi-check-circle"></i>
                <span>本地备份已完成，配置和上传记录已写入 fixture 路径。</span>
              </div>
              <div v-if="state === 'error'" class="visual-error-banner">
                <i class="pi pi-exclamation-triangle"></i>
                <span>同步失败：WebDAV 返回 401，用户名或密码不正确。</span>
              </div>
              <ReloadBanner
                :visible="state === 'download-needs-refresh'"
                message="Cloud backup was downloaded locally. Refresh to apply the restored settings."
                @reload="() => {}"
              />

              <div class="form-group">
                <label class="group-label">备份密码</label>
                <div class="visual-password-card">
                  <span class="visual-security-status-inactive"><span>●</span>未设置</span>
                  <button class="visual-outline-button"><i class="pi pi-lock"></i><span>设置密码</span></button>
                </div>
              </div>

              <div class="visual-divider"></div>

              <div class="form-group">
                <label class="group-label">WebDAV 连接</label>
                <WebDAVConfigCollapsible
                  :model-value="backupWebDAVConfig"
                  :testing="backupWebDAVTesting"
                  @update:model-value="() => {}"
                  @save="() => {}"
                  @test="() => {}"
                />
              </div>

              <div class="visual-divider"></div>

              <div class="form-group">
                <label class="group-label">数据管理</label>
                <div class="data-section">
                  <div class="data-section-header">
                    <span class="data-section-title">配置文件</span>
                    <span class="data-section-desc">你的图床账号和设置</span>
                  </div>
                  <DataItemCard
                    type="config"
                    :sync-status="backupSyncStatus"
                    :is-cloud-enabled="backupCloudEnabled"
                    :cloud-hint="backupCloudHint"
                    provider-name="Studio NAS"
                    :other-profiles="backupOtherProfiles"
                    :local-loading="backupLocalLoading"
                    :cloud-loading="backupCloudLoading"
                    @export-local="() => {}"
                    @import-local="() => {}"
                    @sync-cloud="() => {}"
                    @force-upload="() => {}"
                    @force-download="() => {}"
                  />
                </div>
                <div class="data-section">
                  <div class="data-section-header">
                    <span class="data-section-title">上传记录</span>
                    <span class="data-section-desc">所有已上传的图片链接</span>
                  </div>
                  <DataItemCard
                    type="history"
                    :sync-status="backupSyncStatus"
                    :is-cloud-enabled="backupCloudEnabled"
                    :cloud-hint="backupCloudHint"
                    provider-name="Studio NAS"
                    :other-profiles="backupOtherProfiles"
                    :local-loading="backupLocalLoading"
                    :cloud-loading="backupCloudLoading"
                    @export-local="() => {}"
                    @import-local="() => {}"
                    @sync-cloud="() => {}"
                    @force-upload="() => {}"
                    @force-download="() => {}"
                  />
                </div>
                <div class="data-section">
                  <div class="data-section-header">
                    <span class="data-section-title">操作历史</span>
                    <span class="data-section-desc">备份、导入导出等操作记录</span>
                  </div>
                  <div class="visual-sync-log">
                    <div v-if="backupLogRows.length === 0" class="visual-sync-log-empty">
                      <i class="pi pi-inbox"></i>
                      <span>No backup operations yet</span>
                    </div>
                    <template v-else>
                      <div v-for="row in backupLogRows" :key="row.title + row.meta" class="visual-sync-log-row" :class="`tone-${row.tone}`">
                        <i :class="['pi', row.icon]"></i>
                        <div>
                          <strong>{{ row.title }}</strong>
                          <span>{{ row.meta }} · {{ row.detail }}</span>
                        </div>
                      </div>
                    </template>
                  </div>
                </div>
              </div>

              <BackupPasswordDialog
                ref="backupPasswordDialogRef"
                v-model="showBackupPasswordDialog"
                :mode="backupPasswordDialogMode"
                @confirm="() => {}"
                @skip="() => {}"
                @cancel="() => {}"
              />
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="page === 'settings'" class="visual-page visual-settings">
        <div class="settings-layout visual-settings-layout">
          <div class="settings-sidebar">
            <div class="sidebar-title">Settings</div>
            <button class="nav-item active"><i class="pi pi-cog"></i><span>General</span></button>
            <button class="nav-item"><i class="pi pi-images"></i><span>Hosting</span></button>
            <button class="nav-item"><i class="pi pi-database"></i><span>Backup</span></button>
          </div>
          <div class="settings-content">
            <div v-if="state === 'default' || state === 'dark-theme'" class="settings-section">
              <GeneralSettingsPanel
                :current-theme="themeMode"
                :auto-start="false"
                :minimize-to-tray-on-start="false"
                close-to-tray
                analytics-enabled
                :is-clearing-cache="false"
                :link-default-format="settingsLinkFormat"
                link-custom-template="![{filename}]({url}?w={width}&h={height})"
                link-auto-copy
                global-shortcut-enabled
                shortcut-upload-clipboard="Ctrl+Shift+V"
                shortcut-upload-from-file="Ctrl+Shift+U"
                @update:current-theme="themeMode = $event"
              />
            </div>
            <div v-else class="settings-section">
              <div class="section-header">
                <h2>Hosting status</h2>
                <p class="section-desc">Visual fixture for service connection status.</p>
              </div>
              <div v-if="state === 'error'" class="visual-error-banner"><i class="pi pi-exclamation-triangle"></i><span>Connection failed for Weibo and JD. Check tokens or cookies before uploading.</span></div>
              <ServiceEnableSection
                :health-status-map="healthMap"
                :health-tooltip-map="tooltipMap"
                :is-batch-testing="state === 'connection-testing'"
                :batch-test-progress="state === 'connection-testing' ? { current: 2, total: 4, currentService: 'qiyu' } : null"
                :service-check-session="serviceSession"
                :refreshing-service-ids="state === 'connection-testing' ? new Set(['jd', 'qiyu']) : new Set()"
                :testing-connections="testingConnections"
                :is-checking-jd="state === 'connection-testing'"
                :is-checking-qiyu="state === 'connection-testing'"
                :available-services="['jd', 'qiyu', 'weibo', 'r2', 'github']"
                :service-names="serviceNames"
                :public-service-risk-accepted="false"
              />
            </div>
          </div>
        </div>
      </section>

      <!-- 独立弹窗集中覆盖页：守住"全项目弹窗外壳统一"这条线 -->
      <section v-else-if="page === 'dialogs'" class="visual-page visual-dialogs">
        <div class="visual-dialogs-backdrop">Dialog visual fixtures</div>

        <WechatQrDialog v-model:visible="showWechatQrDialog" />
        <OnboardingDialog v-if="isOnboardingState" />
      </section>
    </main>
    <PnConfirmHost />
  </div>
</template>
