/**
 * 时间轴月份点智能过滤算法
 * 参考 Google 相册的处理策略：
 * 1. 层级降级：根据时间跨度自动调整显示粒度
 * 2. 最小间距过滤：贪心选点，保证点不重叠
 * 3. 优先级选点：重要时间点优先显示
 * 4. 低密度过滤：数量过少的月份点隐藏
 */

import type { TimePeriodStats } from '../services/HistoryDatabase';

// ==================== 类型定义 ====================

/** 显示粒度 */
export type Granularity = 'month' | 'quarter' | 'year' | 'decade';

/** 过滤后的月份点 */
export interface FilteredPoint {
  id: string;           // "2024-5" (year-month)
  year: number;
  month: number;        // 0-11
  position: number;     // 0-1 进度
  priority: number;     // 优先级分数
  label: string;        // 显示文本
  count: number;        // 照片数量
  isLoaded: boolean;    // 是否已加载
}

// ==================== 常量配置 ====================

/** 优先级权重 */
const PRIORITY = {
  boundary: 150,
  yearStart: 100,
  quarterStart: 50,
  highDensity: 20,
  otherMonth: 10,
};

/** 默认最小间距（像素）- 更密集显示 */
const DEFAULT_MIN_GAP_PX = 18;

/** 低密度阈值：低于平均值的此比例将被过滤（0.02 = 2%） */
const LOW_DENSITY_THRESHOLD = 0.02;

// ==================== 核心函数 ====================

/**
 * 根据时间跨度和可用空间计算标签粒度
 * @param timeSpanMonths 时间跨度（月数）
 * @param availableHeight 可用像素高度
 * @returns 显示粒度
 */
export function getLabelGranularity(timeSpanMonths: number, availableHeight: number): Granularity {
  if (availableHeight <= 0) return 'year';

  // 密度 = 每像素代表多少个月
  const density = timeSpanMonths / availableHeight;

  // 阈值设计（放宽以显示更多月份点）：
  // density < 0.1  → 空间充足，显示所有月份
  // density < 0.5  → 中等，显示季度
  // density < 2    → 紧凑，只显示年份
  // density >= 2   → 超密集，显示年代

  if (density < 0.1) return 'month';
  if (density < 0.5) return 'quarter';
  if (density < 2) return 'year';
  return 'decade';
}

/**
 * 低密度过滤：去掉照片数低于平均值 2% 的月份
 * 边界月份（第一个和最后一个）始终保留
 */
export function filterLowDensity(periods: TimePeriodStats[]): TimePeriodStats[] {
  if (periods.length <= 1) return periods;

  const totalCount = periods.reduce((sum, p) => sum + p.count, 0);
  const avgCount = totalCount / periods.length;
  const threshold = avgCount * LOW_DENSITY_THRESHOLD;

  // 边界月份（第一个和最后一个）始终保留
  return periods.filter((p, i) => {
    const isBoundary = i === 0 || i === periods.length - 1;
    return isBoundary || p.count >= threshold;
  });
}

/**
 * 根据粒度决定是否包含该月份
 */
function shouldIncludeByGranularity(month: number, year: number, granularity: Granularity): boolean {
  switch (granularity) {
    case 'month':
      return true;
    case 'quarter':
      return [0, 3, 6, 9].includes(month);
    case 'year':
      return month === 0;
    case 'decade':
      return month === 0 && year % 5 === 0;
  }
}

/**
 * 计算月份的优先级
 */
function calculatePriority(
  period: TimePeriodStats,
  avgCount: number,
  index: number,
  total: number
): number {
  let priority = PRIORITY.otherMonth;

  if (period.month === 0) {
    priority = PRIORITY.yearStart;
  } else if ([3, 6, 9].includes(period.month)) {
    priority = PRIORITY.quarterStart;
  }

  if (period.count > avgCount * 1.5) {
    priority += PRIORITY.highDensity;
  }

  if (index === 0 || index === total - 1) {
    priority += PRIORITY.boundary;
  }

  return priority;
}

/**
 * 格式化月份标签
 */
function formatLabel(year: number, month: number): string {
  return `${year}年${month + 1}月`;
}

/**
 * 生成候选点（带优先级）
 * @param periods 时间段统计数据（已过滤低密度）
 * @param loadedMonths 已加载的月份集合
 * @param granularity 显示粒度
 * @returns 候选点数组
 */
export function generateCandidatePoints(
  periods: TimePeriodStats[],
  loadedMonths: Set<string>,
  granularity: Granularity
): FilteredPoint[] {
  if (periods.length === 0) return [];

  const totalCount = periods.reduce((sum, p) => sum + p.count, 0);
  const avgCount = totalCount / periods.length;

  if (totalCount === 0) return [];

  let cumulative = 0;
  const candidates: FilteredPoint[] = [];

  for (let i = 0; i < periods.length; i++) {
    const period = periods[i];
    const monthKey = `${period.year}-${period.month}`;

    // 计算位置（基于累计照片数）
    const position = cumulative / totalCount;
    cumulative += period.count;

    // 根据粒度决定是否包含
    // 但边界点始终保留
    const isBoundary = i === 0 || i === periods.length - 1;
    const includeByGranularity = shouldIncludeByGranularity(period.month, period.year, granularity);

    if (!isBoundary && !includeByGranularity) {
      continue;
    }

    // 计算优先级
    const priority = calculatePriority(period, avgCount, i, periods.length);

    candidates.push({
      id: monthKey,
      year: period.year,
      month: period.month,
      position,
      priority,
      label: formatLabel(period.year, period.month),
      count: period.count,
      isLoaded: loadedMonths.has(monthKey),
    });
  }

  return candidates;
}

/**
 * 最小间距过滤（贪心算法）
 * 按优先级选择点，确保间距足够
 * @param candidates 候选点数组
 * @param containerHeight 容器高度（像素）
 * @param minGapPx 最小间距（像素）
 * @returns 过滤后的点数组
 */
export function filterByMinGap(
  candidates: FilteredPoint[],
  containerHeight: number,
  minGapPx: number = DEFAULT_MIN_GAP_PX
): FilteredPoint[] {
  if (candidates.length <= 1 || containerHeight <= 0) return candidates;

  // 步骤1：按优先级降序排列
  const sortedByPriority = [...candidates].sort((a, b) => b.priority - a.priority);

  // 步骤2：贪心选择
  const selected: FilteredPoint[] = [];
  const occupiedRanges: Array<{ start: number; end: number }> = [];

  for (const point of sortedByPriority) {
    const pixelY = point.position * containerHeight;
    const rangeStart = pixelY - minGapPx / 2;
    const rangeEnd = pixelY + minGapPx / 2;

    // 检查是否与已选点冲突
    const hasConflict = occupiedRanges.some(range =>
      rangeStart < range.end && rangeEnd > range.start
    );

    if (!hasConflict) {
      selected.push(point);
      occupiedRanges.push({ start: rangeStart, end: rangeEnd });
    }
  }

  // 步骤3：恢复时间顺序（按位置排序）
  return selected.sort((a, b) => a.position - b.position);
}

/**
 * 确保边界点始终显示
 * @param filtered 过滤后的点
 * @param allCandidates 所有候选点
 * @returns 包含边界点的数组
 */
function ensureBoundaryPoints(
  filtered: FilteredPoint[],
  allCandidates: FilteredPoint[]
): FilteredPoint[] {
  if (allCandidates.length === 0) return filtered;

  const result = [...filtered];
  const first = allCandidates[0];
  const last = allCandidates[allCandidates.length - 1];

  // 确保第一个点存在
  if (!result.some(p => p.id === first.id)) {
    result.unshift(first);
  }

  // 确保最后一个点存在
  if (!result.some(p => p.id === last.id)) {
    result.push(last);
  }

  return result;
}

// ==================== 主函数 ====================

/**
 * 月份点智能过滤管道（主入口）
 *
 * 处理流程：
 * 1. 低密度过滤 → 去掉照片数 < 平均值 2% 的月份
 * 2. 计算时间跨度
 * 3. 确定显示粒度 (month/quarter/year/decade)
 * 4. 生成候选点（带优先级）
 * 5. 最小间距过滤（贪心算法）
 * 6. 确保边界点保留
 *
 * @param periods 时间段统计数据（按时间降序排列）
 * @param loadedMonths 已加载的月份集合
 * @param containerHeight 容器高度（像素）
 * @returns 过滤后的月份点数组
 */
export function filterMonthPoints(
  periods: TimePeriodStats[],
  loadedMonths: Set<string>,
  containerHeight: number
): FilteredPoint[] {
  if (periods.length === 0 || containerHeight <= 0) return [];

  // 1. 低密度过滤
  const filteredPeriods = filterLowDensity(periods);

  if (filteredPeriods.length === 0) return [];

  // 2. 计算时间跨度（月数）
  // periods 按时间降序排列，第一个是最新，最后一个是最老
  const newest = filteredPeriods[0];
  const oldest = filteredPeriods[filteredPeriods.length - 1];
  const timeSpanMonths =
    (newest.year - oldest.year) * 12 +
    (newest.month - oldest.month) + 1;

  // 3. 确定显示粒度
  const granularity = getLabelGranularity(timeSpanMonths, containerHeight);

  // 4. 生成候选点
  const candidates = generateCandidatePoints(filteredPeriods, loadedMonths, granularity);

  // 5. 最小间距过滤
  // 根据容器高度调整最小间距（更密集显示）
  const adaptiveMinGap = containerHeight < 400 ? 14 : containerHeight < 600 ? 16 : DEFAULT_MIN_GAP_PX;
  const filtered = filterByMinGap(candidates, containerHeight, adaptiveMinGap);

  // 6. 确保边界点保留
  return ensureBoundaryPoints(filtered, candidates);
}
