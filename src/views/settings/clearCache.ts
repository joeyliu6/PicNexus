// 「数据与隐私 › 应用缓存 › 清理」：WebView 的清理接口不分类型，会连 localStorage 一起清掉。
// 本机记住的界面偏好（侧栏收起、提示看过没有、首屏主题）不是缓存，先存下、清完原样放回。
export async function clearCacheKeepingPreferences(clear: () => Promise<void>): Promise<void> {
  const saved = Object.keys(localStorage).map((key) => [key, localStorage.getItem(key) ?? ''] as const);
  try {
    await clear();
  } finally {
    for (const [key, value] of saved) localStorage.setItem(key, value);
  }
}
