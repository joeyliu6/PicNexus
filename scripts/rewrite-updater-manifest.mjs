/**
 * 把 latest.json 的 Windows 通用键改指向 NSIS 安装包。
 *
 * 为什么需要：tauri-action 把通用键 windows-x86_64 填成了 MSI（65.7MB，走 Windows Installer
 * 事务，实测安装 79s），而 NSIS setup.exe 只有 42.7MB 且是自解压。客户端本该先查
 * windows-x86_64-{installer}，但那依赖二进制里的 __TAURI_BUNDLE_TYPE 打包戳——实测产物里它仍是
 * 未替换的 __TAURI_BUNDLE_TYPE_VAR_UNK，bundle_type() 返回 None，于是所有 Windows 用户都落到
 * 通用键上拿 MSI。详见 docs/audits/windows-update-nsis-2026-08-24.md。
 *
 * 纯逻辑，不碰网络和磁盘：调用方负责取 latest.json、写回 latest.json。
 * 这样 .github/workflows/release.yml 与 scripts/test/updater-manifest-rewrite.test.mjs
 * 共用同一份实现，不会漂移。
 */

const GENERIC_KEY = 'windows-x86_64';
const NSIS_KEY = 'windows-x86_64-nsis';
const MSI_KEY = 'windows-x86_64-msi';
const NSIS_SUFFIX = '-setup.exe';

/**
 * @param {unknown} manifest 已解析的 latest.json
 * @returns {{manifest: object, previousUrl: string | null, nextUrl: string}}
 *   manifest 是改写后的新对象（不修改入参）
 * @throws 任何一道校验不过就抛错——静默降级比报错更糟：真跌回 MSI 时没人会发现，
 *   只会再收到一次「更新好慢」的反馈。
 */
export function rewriteUpdaterManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('latest.json is not an object');
  }

  const platforms = manifest.platforms;
  if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) {
    throw new Error('latest.json has no platforms object');
  }

  const nsis = platforms[NSIS_KEY];
  if (!nsis) {
    throw new Error(`${NSIS_KEY} missing — NSIS updater artifact was not produced`);
  }
  if (typeof nsis.url !== 'string' || !nsis.url.endsWith(NSIS_SUFFIX)) {
    throw new Error(`${NSIS_KEY}.url is not an NSIS installer: ${nsis.url}`);
  }
  if (typeof nsis.signature !== 'string' || nsis.signature.length === 0) {
    throw new Error(`${NSIS_KEY}.signature is empty`);
  }

  const previousUrl = typeof platforms[GENERIC_KEY]?.url === 'string'
    ? platforms[GENERIC_KEY].url
    : null;

  const nextPlatforms = { ...platforms, [GENERIC_KEY]: { ...nsis } };
  // 一并删掉 msi 键：将来 bundler 把打包戳修好后，MSI 安装的用户会先查它；
  // 留着等于埋一颗「又跌回 MSI」的雷。
  delete nextPlatforms[MSI_KEY];

  return {
    manifest: { ...manifest, platforms: nextPlatforms },
    previousUrl,
    nextUrl: nsis.url,
  };
}

export const UPDATER_MANIFEST_KEYS = {
  GENERIC_KEY,
  NSIS_KEY,
  MSI_KEY,
  NSIS_SUFFIX,
};
