import { emit as tauriEmit, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow, Window } from '@tauri-apps/api/window';
import { exit as exitApp } from '@tauri-apps/plugin-process';
import {
  DEFAULT_CONFIG,
  PRIVATE_SERVICES,
  PUBLIC_SERVICES,
  isPublicRiskService,
  makeCustomS3Id,
  type ServiceType,
  type UserConfig,
} from '../config/types';
import { CUSTOM_S3_REQUIRED_FIELDS, NO_CONFIG_SERVICES, SERVICE_REQUIRED_FIELDS } from '../constants/serviceRequiredFields';
import { getServiceDisplayName } from '../constants/serviceNames';
import { configStore } from '../store/instances';
import { createLogger } from '../utils/logger';

export const MAIN_TRAY_ID = 'main-tray';
export const TRAY_MENU_WINDOW_LABEL = 'tray-menu';

export type TrayUploadAction = 'upload_clipboard' | 'select_upload_files';
export type TrayMenuItem = { item: 'Separator' } | TrayMenuCommand | TrayMenuServiceSubmenu;

export interface TrayMenuCommand {
  id: string;
  text: string;
  checked?: boolean;
  enabled?: boolean;
  serviceId?: string;
  action?: () => void;
}

export interface TrayMenuServiceSubmenu extends TrayMenuCommand {
  items: TrayMenuItem[];
}

interface TrayServiceEntry {
  id: string;
  label: string;
}

export interface TrayServiceGroups {
  publicServices: TrayServiceEntry[];
  privateServices: TrayServiceEntry[];
  customS3Services: TrayServiceEntry[];
}

export interface TrayMenuActions {
  openWindow(): void;
  uploadClipboard(): void;
  selectUploadFiles(): void;
  toggleService(serviceId: string): void;
  openHistory(): void;
  quit(): void;
}

export interface ToggleTrayServiceOptions {
  acceptPublicServiceRisk?: boolean;
}

const log = createLogger('TrayMenu');

function getAvailableServiceSet(config: UserConfig): Set<string> {
  return new Set(config.availableServices ?? DEFAULT_CONFIG.availableServices ?? []);
}

function hasFilledRequiredFields(source: Record<string, unknown> | undefined, fields: string[]): boolean {
  if (fields.length === 0) return true;
  if (!source) return false;
  return fields.every((field) => {
    const value = source[field];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function isConfiguredBuiltinService(serviceId: string, config: UserConfig): boolean {
  if ((NO_CONFIG_SERVICES as readonly string[]).includes(serviceId)) return true;

  const requiredFields = SERVICE_REQUIRED_FIELDS[serviceId as ServiceType];
  if (!requiredFields) return false;

  const serviceConfig = config.services?.[serviceId as ServiceType] as Record<string, unknown> | undefined;
  return hasFilledRequiredFields(serviceConfig, requiredFields);
}

function isConfiguredCustomS3Service(serviceId: string, config: UserConfig): boolean {
  const profileId = serviceId.slice('custom_s3:'.length);
  const profile = config.custom_s3_profiles?.find((item) => item.id === profileId);
  return hasFilledRequiredFields(profile as Record<string, unknown> | undefined, CUSTOM_S3_REQUIRED_FIELDS);
}

function isConfiguredService(serviceId: string, config: UserConfig): boolean {
  if (serviceId.startsWith('custom_s3:')) {
    return isConfiguredCustomS3Service(serviceId, config);
  }
  return isConfiguredBuiltinService(serviceId, config);
}

function makeServiceEntry(serviceId: string, config: UserConfig): TrayServiceEntry {
  return {
    id: serviceId,
    label: getServiceDisplayName(serviceId, config),
  };
}

function filterConfiguredServices(serviceIds: string[], config: UserConfig): TrayServiceEntry[] {
  const availableServices = getAvailableServiceSet(config);
  return serviceIds
    .filter((serviceId) => availableServices.has(serviceId) && isConfiguredService(serviceId, config))
    .map((serviceId) => makeServiceEntry(serviceId, config));
}

export function getTrayServiceGroups(config: UserConfig): TrayServiceGroups {
  const customS3Ids = (config.custom_s3_profiles ?? []).map((profile) => makeCustomS3Id(profile.id));

  return {
    publicServices: filterConfiguredServices(PUBLIC_SERVICES, config),
    privateServices: filterConfiguredServices(PRIVATE_SERVICES, config),
    customS3Services: filterConfiguredServices(customS3Ids, config),
  };
}

export function getSelectableTrayServiceIds(config: UserConfig): string[] {
  const groups = getTrayServiceGroups(config);
  return [
    ...groups.publicServices,
    ...groups.privateServices,
    ...groups.customS3Services,
  ].map((service) => service.id);
}

export function getSelectedTrayServiceIds(config: UserConfig): string[] {
  const selectable = new Set(getSelectableTrayServiceIds(config));
  return (config.enabledServices ?? []).filter((serviceId) => selectable.has(serviceId));
}

export function formatCurrentServicesLabel(config: UserConfig): string {
  const selectedServiceIds = getSelectedTrayServiceIds(config);
  const selectedNames = selectedServiceIds.map((serviceId) => getServiceDisplayName(serviceId, config));

  if (selectedNames.length === 0) return '当前图床：未选择';
  if (selectedNames.length === 1) return `当前图床：${selectedNames[0]}`;
  if (selectedNames.length === 2) return `当前图床：${selectedNames.join('、')}`;
  return `当前图床：${selectedNames[0]}等 ${selectedNames.length} 个`;
}

function separator(): TrayMenuItem {
  return { item: 'Separator' };
}

function trayServiceMenuItemId(serviceId: string): string {
  return `tray_service_${serviceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function appendServiceGroupItems(
  items: TrayMenuItem[],
  services: TrayServiceEntry[],
  selected: Set<string>,
  actions: TrayMenuActions,
): void {
  for (const service of services) {
    items.push({
      id: trayServiceMenuItemId(service.id),
      text: service.label,
      serviceId: service.id,
      checked: selected.has(service.id),
      action: () => actions.toggleService(service.id),
    });
  }
}

function buildCurrentServiceItems(config: UserConfig, actions: TrayMenuActions): TrayMenuItem[] {
  const groups = getTrayServiceGroups(config);
  const groupList = [
    groups.publicServices,
    groups.privateServices,
    groups.customS3Services,
  ].filter((group) => group.length > 0);

  if (groupList.length === 0) {
    return [{ id: 'current_service_empty', text: '暂无可用图床', enabled: false }];
  }

  const selected = new Set(getSelectedTrayServiceIds(config));
  const items: TrayMenuItem[] = [];

  groupList.forEach((group, index) => {
    appendServiceGroupItems(items, group, selected, actions);
    if (index < groupList.length - 1) {
      items.push(separator());
    }
  });

  return items;
}

export function buildTrayMenuItems(config: UserConfig, actions: TrayMenuActions): TrayMenuItem[] {
  return [
    { id: 'open_window', text: '打开界面', action: actions.openWindow },
    separator(),
    { id: 'upload_clipboard', text: '上传剪贴板', action: actions.uploadClipboard },
    { id: 'select_upload_files', text: '选择图片…', action: actions.selectUploadFiles },
    {
      id: 'current_service',
      text: formatCurrentServicesLabel(config),
      items: buildCurrentServiceItems(config, actions),
    },
    separator(),
    { id: 'open_history', text: '历史记录', action: actions.openHistory },
    separator(),
    { id: 'quit', text: '退出', action: actions.quit },
  ];
}

export async function hideTrayMenuWindow(): Promise<void> {
  const window = await Window.getByLabel(TRAY_MENU_WINDOW_LABEL);
  await window?.hide();
}

export async function revealMainWindow(): Promise<void> {
  const window = await Window.getByLabel('main') ?? getCurrentWindow();
  try {
    await window.unminimize();
  } catch (error) {
    log.warn('恢复主窗口最小化状态失败，继续显示窗口:', error);
  }
  await window.show();
  await window.setFocus();
}

export async function triggerUploadAction(action: TrayUploadAction): Promise<void> {
  await revealMainWindow();
  await tauriEmit('navigate-to', 'upload');
  await tauriEmit('tray-action', action);
}

export async function openHistory(): Promise<void> {
  await revealMainWindow();
  await tauriEmit('navigate-to', 'history');
}

export async function openPublicServiceRiskSettings(serviceId: string): Promise<void> {
  await revealMainWindow();
  await tauriEmit('navigate-to', { view: 'settings', tab: 'hosting', section: serviceId });
}

function runTrayTask(task: () => Promise<void>): void {
  void task().catch((error) => {
    log.warn('托盘菜单动作失败:', error);
  });
}

export function createTrayMenuActions(): TrayMenuActions {
  return {
    openWindow: () => runTrayTask(revealMainWindow),
    uploadClipboard: () => runTrayTask(() => triggerUploadAction('upload_clipboard')),
    selectUploadFiles: () => runTrayTask(() => triggerUploadAction('select_upload_files')),
    toggleService: (serviceId: string) => runTrayTask(async () => {
      await toggleTrayService(serviceId);
    }),
    openHistory: () => runTrayTask(openHistory),
    quit: () => runTrayTask(() => exitApp(0)),
  };
}

async function loadTrayConfig(): Promise<UserConfig> {
  return await configStore.get<UserConfig>('config') ?? structuredClone(DEFAULT_CONFIG);
}

export function requiresPublicServiceRiskAcknowledgement(serviceId: string, config: UserConfig): boolean {
  const selectedServices = config.enabledServices ?? [];
  return isPublicRiskService(serviceId)
    && !selectedServices.includes(serviceId)
    && !config.publicServiceRiskAccepted;
}

export async function toggleTrayService(
  serviceId: string,
  options: ToggleTrayServiceOptions = {},
): Promise<string[]> {
  const config = await loadTrayConfig();
  const selectable = new Set(getSelectableTrayServiceIds(config));
  const selectedServices = (config.enabledServices ?? []).filter((id) => selectable.has(id));
  if (!selectable.has(serviceId)) {
    return selectedServices;
  }

  const isEnabling = !selectedServices.includes(serviceId);

  if (requiresPublicServiceRiskAcknowledgement(serviceId, config) && !options.acceptPublicServiceRisk) {
    log.info('拦截未确认公共图床风险的托盘启用动作:', serviceId);
    return selectedServices;
  }

  const nextServices = !isEnabling
    ? selectedServices.filter((id) => id !== serviceId)
    : [...selectedServices, serviceId];

  const configToSave = JSON.parse(JSON.stringify(config)) as UserConfig;
  configToSave.enabledServices = nextServices;
  if (isEnabling && options.acceptPublicServiceRisk && isPublicRiskService(serviceId)) {
    configToSave.publicServiceRiskAccepted = true;
  }

  await configStore.set('config', configToSave);
  await configStore.save();
  await tauriEmit('config-updated', { timestamp: Date.now(), source: 'tray-menu' });

  return nextServices;
}

export async function setupTrayMenu(): Promise<UnlistenFn> {
  return () => {};
}
