// 启动时还原备份配置（Dialogs.dc.html D01 / D02）的收尾。
// 遇到本机密钥解不开的加密配置时，启动阶段各模块（主题、上传器、上传控制器…）读配置已经失败一轮，
// 所以无论还原成功还是跳过，调用方都要整页重新加载；要弹的通知记在 sessionStorage，重新加载后由 App 取出。
// 跳过 = 把加密配置原样另存在数据文件夹（「从文件导入…」可输入备份密码还原），再删掉原文件，以默认配置启动。

import { exists, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { getErrorMessage } from '@/types/errors';
import { getUserDataDir } from '@/utils/appPaths';
import { secureStorage } from './crypto';

const CONFIG_FILE = '.settings.dat';
const NOTICE_KEY = 'picnexus-startup-notice';

export type StartupNotice = { kind: 'restored' } | { kind: 'skipped'; file: string };

async function configPath(name = CONFIG_FILE): Promise<string> {
  return join(await getUserDataDir(), name);
}

function leaveNotice(notice: StartupNotice): void {
  sessionStorage.setItem(NOTICE_KEY, JSON.stringify(notice));
}

/** 重新加载后取一次；没有或内容坏了返回 null */
export function takeStartupNotice(): StartupNotice | null {
  const raw = sessionStorage.getItem(NOTICE_KEY);
  sessionStorage.removeItem(NOTICE_KEY);
  if (!raw) return null;
  try {
    const notice = JSON.parse(raw) as StartupNotice;
    return notice.kind === 'restored' || (notice.kind === 'skipped' && typeof notice.file === 'string') ? notice : null;
  } catch {
    return null;
  }
}

/**
 * 密码对了把派生密钥存进钥匙串并返回 restored；密码不对返回 wrong-password；其他错误抛出。
 * 每次都重新读一遍加密配置：上一次读不出（比如被别的程序占着）这次还能成；读不出时抛出原因，不算输错密码
 */
export async function restoreWithPassword(password: string): Promise<'restored' | 'wrong-password'> {
  let encrypted: string;
  try {
    encrypted = await readTextFile(await configPath());
  } catch (error) {
    throw new Error(`读不出加密的配置文件：${getErrorMessage(error)}`);
  }
  try {
    await secureStorage.initWithPassword(encrypted, password);
  } catch (error) {
    if (error instanceof Error && error.message === '迁移密码不正确') return 'wrong-password';
    throw error;
  }
  leaveNotice({ kind: 'restored' });
  return 'restored';
}

/** picnexus-encrypted-settings-20261019-080503.json：带时间免得重名，.json 才会出现在「从文件导入…」里 */
export function asideFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `picnexus-encrypted-settings-${date}-${time}.json`;
}

/** 跳过还原：另存一份并核对一字不差后才删原文件；返回另存的文件名。原文件已经不在时返回 null（直接以默认配置重新加载） */
export async function setAsideEncryptedConfig(now = new Date()): Promise<string | null> {
  const source = await configPath();
  if (!(await exists(source))) return null;
  const content = await readTextFile(source);
  const file = asideFileName(now);
  const target = await configPath(file);
  await writeTextFile(target, content);
  if ((await readTextFile(target)) !== content) throw new Error('另存的加密配置与原文件不一致');
  await remove(source);
  leaveNotice({ kind: 'skipped', file });
  return file;
}
