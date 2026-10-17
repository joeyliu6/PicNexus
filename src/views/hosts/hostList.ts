// 左栏与目录（交接说明 8.4、P01 / P13）：已添加的图床排成左栏，没添加的排进「添加图床」目录。
// 纯函数：输入是外壳已经算好的「已添加」清单（useUploadController.hosts，与首页「上传到」同一份）。

import { COOKIE_BASED_SERVICES } from '@/constants/serviceRequiredFields';
import { CATALOG_GROUPS, HOST_CATALOG, describeHost, type CatalogFilter, type HostDescriptor } from './hostCatalog';

/** 已添加的一个图床（来自 useUploadController.hosts） */
export interface AddedHost {
  id: string;
  name: string;
  selected: boolean;
  /** 有问题时的说明（健康状态 error），正常为 null */
  warning: string | null;
}

export interface HostRow {
  id: string;
  name: string;
  enabled: boolean;
  /** 问题的短说法（「登录失效」「凭证无效」），正常为 null */
  problem: string | null;
  /** 第二行：检测中… / 问题 / 类型 / 已停用 */
  sub: string;
  testing: boolean;
}

/**
 * 问题的短说法：Cookie 图床一律「登录失效」（P01），其余按原因归类。
 * 原因认不出时写「连接异常」，详细原因在详情的结果条与首页 ⚠ 的悬停说明里。
 */
export function problemLabel(hostId: string, reason: string): string {
  if ((COOKIE_BASED_SERVICES as readonly string[]).includes(hostId)) return '登录失效';
  if (/凭证|签名|密钥|Key|Token|token|401|403|Unauthorized|Forbidden|InvalidAccessKeyId|SignatureDoesNotMatch|无效/.test(reason)) return '凭证无效';
  if (/公开|链接打不开|Content-Type/.test(reason)) return '公开链接异常';
  return '连接异常';
}

/** 左栏：有问题的 → 已启用的 → 停用的；同一组里保持配置里的顺序 */
export function buildHostRows(hosts: readonly AddedHost[], testing: ReadonlySet<string>): HostRow[] {
  const rows = hosts.map((host, order) => {
    const problem = host.warning ? problemLabel(host.id, host.warning) : null;
    const isTesting = testing.has(host.id);
    const type = describeHost(host.id)?.type ?? '';
    const sub = isTesting ? '检测中…' : (problem ?? (host.selected ? type : '已停用'));
    return { row: { id: host.id, name: host.name, enabled: host.selected, problem, sub, testing: isTesting }, order };
  });
  const rank = (r: HostRow) => (r.problem ? 0 : r.enabled ? 1 : 2);
  return rows.sort((a, b) => rank(a.row) - rank(b.row) || a.order - b.order).map((r) => r.row);
}

export interface CatalogItem {
  /** 内置图床 id，或多份图床的模板 id（webdav / s3） */
  id: string;
  name: string;
  sub: string;
  descriptor: HostDescriptor;
}

export interface CatalogGroup {
  title: string;
  note: string;
  items: CatalogItem[];
}

/**
 * 目录：已添加的不出现（多份图床的模板一直在）；按接入方式分组，搜索按名字（不分大小写），
 * 没有结果的组不出现。
 */
export function buildCatalog(addedIds: ReadonlySet<string>, query: string, filter: CatalogFilter): CatalogGroup[] {
  const needle = query.trim().toLowerCase();
  return CATALOG_GROUPS
    .filter((group) => filter === 'all' || group.filter === filter)
    .map((group) => ({
      title: group.title,
      note: group.note,
      items: HOST_CATALOG
        .filter((h) => group.kinds.includes(h.kind))
        .filter((h) => h.kind === 'webdav' || h.kind === 's3' || !addedIds.has(h.id))
        .filter((h) => !needle || h.catalogName.toLowerCase().includes(needle) || h.catalogSub.toLowerCase().includes(needle))
        .map((h) => ({ id: h.id, name: h.catalogName, sub: h.catalogSub, descriptor: h })),
    }))
    .filter((group) => group.items.length > 0);
}
