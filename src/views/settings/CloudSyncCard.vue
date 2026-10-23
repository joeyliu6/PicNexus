<script setup lang="ts">
// 云同步卡（S05 / S11–S14）：顶部状态 + 一个「同步」按钮，下面勾选同步哪些内容；危险的覆盖操作收进「⋯」。
// 同步中按钮原地变「同步中」并禁用，失败变「重试」；结果写在状态行，不弹通知。没设置时卡片写「未设置云同步」+「设置…」。
import { computed } from 'vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuItem from '@/components/pn/PnMenuItem.vue';
import PnMenuSeparator from '@/components/pn/PnMenuSeparator.vue';
import type { WebDAVProfile } from '@/config/types';
import { useConfirm } from '@/composables/useConfirm';
import { useSyncRecords } from '@/composables/backup-sync/syncRecords';
import { formatCount, formatRelativeTime } from '@/utils/formatters';
import SettingsCard from './SettingsCard.vue';
import { useCloudSync, type SyncItems } from './useCloudSync';
import { useSettingsConfig } from './useSettingsConfig';

const props = defineProps<{
  profile: WebDAVProfile | null;
  historyCount: number | null;
  /** 勾了「配置」但还没设备份密码 */
  passwordMissing: boolean;
}>();

const emit = defineEmits<{ configure: []; needPassword: [] }>();

const settings = useSettingsConfig();
const cloud = useCloudSync();
const records = useSyncRecords();
const { confirm } = useConfirm();

const items = computed<SyncItems>(() => settings.config.value.webdav?.syncItems ?? { config: true, history: true });
const nothingPicked = computed(() => !items.value.config && !items.value.history);

const status = computed<{ text: string; tone: 'muted' | 'normal' | 'brand' | 'success' | 'danger' }>(() => {
  if (cloud.phase.value === 'syncing') return { text: cloud.stage.value === 'history' ? '正在同步上传记录…' : '正在同步配置…', tone: 'brand' };
  if (cloud.phase.value === 'failed') return { text: cloud.message.value, tone: 'danger' };
  if (cloud.phase.value === 'done') return { text: cloud.message.value, tone: 'success' };
  if (nothingPicked.value) return { text: '未选择同步内容', tone: 'muted' };
  const at = props.profile ? records.lastSyncAt(props.profile.id) : null;
  return at ? { text: `已同步 · ${formatRelativeTime(at)}`, tone: 'normal' } : { text: '尚未同步', tone: 'muted' };
});

function toggle(key: keyof SyncItems): void {
  void settings.patch('cloudSync', (c) => {
    const webdav = c.webdav ?? { profiles: [], activeId: null };
    c.webdav = { ...webdav, syncItems: { ...(webdav.syncItems ?? { config: true, history: true }), [key]: !items.value[key] } };
  });
}

function sync(): void {
  if (!props.profile) return;
  if (items.value.config && props.passwordMissing) { emit('needPassword'); return; }
  void cloud.sync(props.profile, items.value);
}

async function overwriteCloud(): Promise<void> {
  if (!props.profile) return;
  if (items.value.config && props.passwordMissing) { emit('needPassword'); return; }
  const what = items.value.config && items.value.history ? '配置和上传记录' : items.value.config ? '配置' : '上传记录';
  const ok = await confirm(`将以本机的${what}替换${props.profile.name}上的数据，云端现有内容会丢失且无法撤销。`, {
    header: '覆盖云端？', acceptLabel: '覆盖云端', rejectLabel: '取消', tone: 'danger',
  });
  if (ok) void cloud.overwriteCloud(props.profile, items.value);
}

async function overwriteLocal(): Promise<void> {
  if (!props.profile) return;
  const ok = await confirm(`将以${props.profile.name}上的配置替换本机全部图床账号、上传组合与偏好，当前本地配置会丢失且无法撤销。上传记录不受影响。`, {
    header: '覆盖本地配置？', acceptLabel: '覆盖本地', rejectLabel: '取消', tone: 'danger',
  });
  if (ok) void cloud.overwriteLocal(props.profile);
}

const ITEMS = computed(() => [
  { key: 'config' as const, name: '配置', desc: '图床账号、上传设置与偏好' },
  { key: 'history' as const, name: '上传记录', desc: props.historyCount === null ? '记录与收藏' : `${formatCount(props.historyCount)} 条记录与收藏` },
]);
</script>

<template>
  <SettingsCard large class="cloud" data-setting-row="cloudSync">
    <div class="cloud__head">
      <span class="cloud__icon" aria-hidden="true"><PnIcon name="cloud" :size="18" :stroke="1.8" /></span>
      <div class="cloud__info">
        <span class="cloud__name">{{ profile ? `${profile.name} · WebDAV` : '未设置云同步' }}</span>
        <span v-if="profile" class="cloud__status" :class="`cloud__status--${status.tone}`" :role="status.tone === 'danger' ? 'alert' : 'status'">
          <span v-if="status.tone === 'brand' || status.tone === 'danger'" class="cloud__dot" aria-hidden="true" />{{ status.text }}
        </span>
        <span v-else class="cloud__status cloud__status--muted">设置后可在多台电脑间同步配置与上传记录</span>
      </div>
      <template v-if="profile">
        <PnButton variant="secondary" size="md" :loading="cloud.busy.value" :disabled="nothingPicked" @click="sync">
          {{ cloud.busy.value ? '同步中' : cloud.phase.value === 'failed' ? '重试' : '同步' }}
        </PnButton>
        <PnMenu :width="260">
          <template #trigger>
            <button type="button" class="cloud__more" aria-label="更多" :disabled="cloud.busy.value"><PnIcon name="more" :size="15" :stroke="2" /></button>
          </template>
          <PnMenuItem description="云端以这台电脑为准" :disabled="nothingPicked" @select="overwriteCloud">用本机覆盖云端…</PnMenuItem>
          <PnMenuItem description="这台电脑以云端为准" @select="overwriteLocal">用云端覆盖本机…</PnMenuItem>
          <PnMenuSeparator />
          <PnMenuItem description="WebDAV" @select="emit('configure')">更换同步方式…</PnMenuItem>
        </PnMenu>
      </template>
      <PnButton v-else variant="secondary" size="md" @click="emit('configure')">设置…</PnButton>
    </div>
    <template v-if="profile">
      <button
        v-for="item in ITEMS"
        :key="item.key"
        type="button"
        role="checkbox"
        class="cloud__item"
        :aria-checked="items[item.key]"
        :disabled="cloud.busy.value"
        @click="toggle(item.key)"
      >
        <span class="cloud__item-text">
          <span>{{ item.name }}</span>
          <span class="cloud__item-desc">{{ item.desc }}</span>
        </span>
        <PnIcon class="cloud__check" name="check" :size="14" :stroke="2.6" />
      </button>
    </template>
  </SettingsCard>
</template>

<style scoped>
.cloud__head {
  display: flex;
  align-items: center;
  gap: var(--pn-space-cloud-head-gap);
  padding: var(--pn-space-16);
}

.cloud__icon {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-settings-badge);
  height: var(--pn-size-settings-badge);
  border-radius: var(--pn-radius-lg);
  background: var(--pn-brand-soft);
  color: var(--pn-brand-text);
}

.cloud__info {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.cloud__name { font-weight: var(--pn-weight-semibold); }

.cloud__status {
  display: flex;
  align-items: center;
  gap: var(--pn-space-6);
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
}

.cloud__status--muted { color: var(--pn-text3); }
.cloud__status--normal { color: var(--pn-text2); }
.cloud__status--brand { color: var(--pn-brand-text); }
.cloud__status--success { color: var(--pn-success); }
.cloud__status--danger { color: var(--pn-danger); }

.cloud__dot {
  flex: none;
  width: var(--pn-size-status-dot);
  height: var(--pn-size-status-dot);
  border-radius: 50%;
  background: currentcolor;
}

.cloud__status--brand .cloud__dot { background: var(--pn-brand); }
.cloud__status--danger .cloud__dot { background: var(--pn-danger-fill); }

.cloud__more {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-button-md);
  height: var(--pn-size-button-md);
  border: 0;
  border-radius: var(--pn-radius-md);
  background: transparent;
  color: var(--pn-text2);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

/* 「⋯」：悬停 / 按下照文字按钮的两级；菜单开着时按设计稿（S14）用选中底色，鼠标还停在上面也不变回悬停色（这条写在后面、同权重） */
.cloud__more:not(:disabled):hover { background: var(--pn-ghost-hover); }
.cloud__more:not(:disabled):active { background: var(--pn-ghost-press); }
.cloud__more[data-state='open']:not(:disabled) { background: var(--pn-selected); }
.cloud__more:disabled { opacity: var(--pn-opacity-disabled); }

.cloud__item {
  display: flex;
  align-items: center;
  gap: var(--pn-space-12);
  width: 100%;
  min-height: var(--pn-size-settings-row);
  box-sizing: border-box;
  padding: var(--pn-space-settings-cloud-item);
  border: 0;
  border-top: 1px solid var(--pn-border);
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  text-align: left;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

/* 勾选行：点了就切换勾选，勾的颜色有过渡，不另加按下色 */
.cloud__item:last-child { border-radius: 0 0 var(--pn-radius-xl) var(--pn-radius-xl); }
.cloud__item:not(:disabled):hover { background: var(--pn-row-hover); }

.cloud__item-text {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.cloud__item-desc {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
}

.cloud__check { flex: none; color: var(--pn-disabled); transition: color var(--pn-dur-fast) var(--pn-ease-in); }
.cloud__item[aria-checked='true'] .cloud__check { color: var(--pn-brand-text); }
</style>
