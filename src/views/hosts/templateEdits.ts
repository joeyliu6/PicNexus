// 链接模板列表（微博链接前缀、GitHub 加速 CDN）的删除与撤销：删掉一项时选中的还是原来那一项，
// 删的就是选中的那项时退回前一项（没有前一项就是新的第一项）；撤销时放回原位置，删的是选中的那项就重新选上它。

export interface TemplateListState<T> {
  list: T[];
  selected: number;
}

export function removeTemplate<T>(list: readonly T[], selected: number, index: number): TemplateListState<T> {
  const next = list.filter((_, i) => i !== index);
  const shifted = selected > index || (selected === index && selected > 0) ? selected - 1 : selected;
  return { list: next, selected: Math.max(0, Math.min(shifted, next.length - 1)) };
}

export function restoreTemplate<T>(list: readonly T[], selected: number, item: T, index: number, reselect: boolean): TemplateListState<T> {
  const at = Math.min(index, list.length);
  const next = [...list.slice(0, at), item, ...list.slice(at)];
  return { list: next, selected: reselect ? at : selected >= at ? selected + 1 : selected };
}
