// 用户交出来的路径 → fs 插件运行时白名单
//
// `capabilities/default.json` 的静态 scope 只覆盖 app 自己的目录（appdata / temp 等），
// 用户目录一概不在内。文件选择对话框会**自动**把选中的路径加进白名单，**拖放不会**：
// 同一个文件，点「选择单个文件」能读，拖进来就是
// `forbidden path ... allow-stat permission`——而拖放恰恰是文档修复最显眼的主入口。
//
// 这里补上对话框替我们做的那一步。授权对象只限用户**主动交出来**的路径
// （拖进窗口的、自己存进「最近打开」的），与对话框插件的既有行为一致。

import { invoke } from '@tauri-apps/api/core';
import { createLogger } from '../utils/logger';

const log = createLogger('FsScope');

/**
 * 为一批用户路径申请访问权限
 *
 * 目录按递归授权（文档修复要读子目录的 `.md`，还要在里面建 `.picnexus-backup`），
 * 文件按单个授权——由 Rust 侧看过 metadata 后决定，前端不用先猜是文件还是目录。
 *
 * Why 失败只告警不抛：静态 scope 已覆盖的路径本来就不需要这一步；真的没权限时，
 * 紧随其后的 `stat` / `readFile` 会给出比"授权失败"更贴近现场的报错。
 * 在这里抛错只会把真正的原因盖住。
 *
 * ⚠️ 授权只活在本次进程内（项目未装 `persisted-scope`）。重启后要再访问同一路径，
 * 必须重新调一次——「最近打开」列表就是这么处理的。
 */
export async function allowUserPaths(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (path) => {
      try {
        await invoke('allow_user_path', { path });
      } catch (error) {
        log.warn('路径授权失败，继续尝试访问', error);
      }
    }),
  );
}
