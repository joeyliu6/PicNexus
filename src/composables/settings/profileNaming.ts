// 多实例配置（profile）默认名的生成规则
//
// Why 单独一个模块：备份 WebDAV（`config.webdav`）和图床 profile（`custom_s3_profiles` /
// `webdav_profiles`）是两套互不相干的编辑逻辑，却共用同一条命名规则。各写一份的下场
// 已经发生过——`useStorageProfiles` 把撞名修掉了，`useWebDAVProfileEditor` 还留着旧的
// `length + 1`，同一个 bug 在仓库里活了两份。

/**
 * 用「现存最大序号 + 1」生成默认名
 *
 * Why 不用 `profiles.length + 1`：删掉中间项之后会撞名。三份「配置 1/2/3」删掉「配置 2」，
 * 再新建时 length + 1 又等于 3，界面上出现两个「配置 3」——tab 上只显示名字，
 * 用户没有任何办法分辨自己在改哪一个。
 *
 * 不匹配 `<prefix> <数字>` 的名字（用户自己改过的，如「坚果云」）不参与计数，
 * 所以第一次自动命名总是从 1 开始。
 */
export function nextProfileName(names: (string | undefined)[], prefix: string): string {
  const pattern = new RegExp(`^${prefix} (\\d+)$`);
  const usedIndices = names
    .map(name => parseInt(name?.match(pattern)?.[1] ?? '', 10))
    .filter(n => Number.isFinite(n));
  return `${prefix} ${usedIndices.length ? Math.max(...usedIndices) + 1 : 1}`;
}
