/**
 * Shift+Click 范围选择纯函数
 *
 * 返回新的 Set 和锚点状态；调用方负责写入响应式变量。
 * 若 shift+click 条件不满足则回退为普通 toggle。
 */

export interface ShiftSelectAnchor {
  lastId: string | null;
  wasSelect: boolean; // true = 上次操作是加选
}

export interface ShiftSelectResult {
  nextSet: Set<string>;
  anchor: ShiftSelectAnchor;
}

export function shiftSelect(
  id: string,
  shiftKey: boolean,
  orderedIds: string[],
  currentSet: Set<string>,
  anchor: ShiftSelectAnchor,
): ShiftSelectResult {
  // Shift+Click 范围操作
  if (shiftKey && anchor.lastId !== null) {
    const fromIdx = orderedIds.indexOf(anchor.lastId);
    const toIdx = orderedIds.indexOf(id);
    if (fromIdx !== -1 && toIdx !== -1) {
      const [start, end] = [Math.min(fromIdx, toIdx), Math.max(fromIdx, toIdx)];
      const next = new Set(currentSet);
      for (let i = start; i <= end; i++) {
        if (anchor.wasSelect) next.add(orderedIds[i]);
        else next.delete(orderedIds[i]);
      }
      return { nextSet: next, anchor }; // shift+click 不更新锚点
    }
  }

  // 普通 toggle + 更新锚点
  const wasSelected = currentSet.has(id);
  const next = new Set(currentSet);
  if (wasSelected) next.delete(id);
  else next.add(id);
  return {
    nextSet: next,
    anchor: { lastId: id, wasSelect: !wasSelected },
  };
}
