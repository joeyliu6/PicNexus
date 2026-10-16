/**
 * 通用格式化工具函数
 */

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** 格式化时间戳为本地日期时间字符串 */
export function formatTime(timestamp: number): string {
  return dateFormatter.format(new Date(timestamp));
}

/**
 * 格式化相对时间（中文）
 */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/**
 * 图库按天分组的标题（GalleryScreen.dc.html）：今天、昨天写名字并在旁边写日期，更早的只写完整日期
 * @param month 0–11（与 DayStats 一致）
 */
export function formatDayHeading(year: number, month: number, day: number, now: number = Date.now()): { title: string; sub: string } {
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDay = new Date(year, month, day).getTime();
  const date = `${month + 1}月${day}日`;
  if (startOfDay === startOfToday) return { title: '今天', sub: date };
  if (startOfDay === new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime()) return { title: '昨天', sub: date };
  return { title: `${year}年${date}`, sub: '' };
}

/**
 * 较早记录的时间（首页「最近上传 · 更早」）：今天写「HH:mm」，昨天写「昨天 HH:mm」，
 * 今年写「M月D日」，更早写「YYYY年M月D日」
 */
export function formatShortDateTime(timestamp: number, now: number = Date.now()): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (timestamp >= startOfToday) return hm;
  if (timestamp >= startOfToday - 24 * 60 * 60 * 1000) return `昨天 ${hm}`;
  return formatCalendarDate(timestamp, now);
}

/** 图库列表的上传时间：「今天 14:22」「昨天 18:30」，更早写日期加时刻（GalleryScreen.dc.html G02） */
export function formatListTime(timestamp: number, now: number = Date.now()): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (timestamp >= startOfToday) return `今天 ${hm}`;
  if (timestamp >= startOfToday - 24 * 60 * 60 * 1000) return `昨天 ${hm}`;
  return `${formatCalendarDate(timestamp, now)} ${hm}`;
}

/** 只写日期：今年「10月14日」，往年「2024年8月2日」（图库详情这类不说「昨天」的地方） */
export function formatCalendarDate(timestamp: number, now: number = Date.now()): string {
  const date = new Date(timestamp);
  const md = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === new Date(now).getFullYear() ? md : `${date.getFullYear()}年${md}`;
}

/**
 * 格式化文件大小
 * @param bytes 字节数
 * @param options.emptyText 0 字节时显示的文本，默认 '0 B'
 */
export function formatFileSize(bytes: number, options?: { emptyText?: string }): string {
  if (bytes === 0) return options?.emptyText ?? '0 B';
  if (bytes < 1024) return `${bytes} B`;
  // 设计稿的写法：KB 取整（「386 KB」），MB / GB 不到 10 留一位小数（「1.2 MB」），10 以上取整（「18 MB」）
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const large = (value: number, unit: string) => `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
  if (bytes < 1024 * 1024 * 1024) return large(bytes / (1024 * 1024), 'MB');
  return large(bytes / (1024 * 1024 * 1024), 'GB');
}

/** 上传前压缩过：「1.2 MB → 410 KB」；没压小（或没压）只写原大小 */
export function formatSizeChange(originalBytes: number, compressedBytes?: number): string {
  const original = formatFileSize(originalBytes);
  return compressedBytes && compressedBytes < originalBytes ? `${original} → ${formatFileSize(compressedBytes)}` : original;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 时间戳 → dayKey（如 "2026-3-25"）
 * 注意：month 是 0-11，与 Date.getMonth() 一致；用作 Map key 而非展示文本。
 * 必须保持此格式以与 DayStats / TimelineData 内部约定兼容。
 */
export function getDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** 完整时间戳 "YYYY-MM-DD HH:mm:ss"，用于日志/同步标记 */
export function formatTimestampFull(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** 紧凑日期 "YYYYMMDD"，可用于安全文件名 / 对象名前缀 */
export function formatDateCompact(date: Date = new Date()): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

/** 紧凑时间戳 "YYYYMMDD_HHmmss"，可用于安全文件名 */
export function formatTimestampCompact(date: Date = new Date()): string {
  return `${formatDateCompact(date)}_${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

