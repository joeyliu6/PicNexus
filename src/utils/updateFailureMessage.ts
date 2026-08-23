/**
 * 自动更新失败文案 —— 把 tauri-plugin-updater 抛出的英文技术错误翻译成用户能看懂的话
 *
 * Why 需要它：`useAutoUpdate` 把 `e.message` 原样塞进 `errorMessage`，UI 直接渲染。
 * 用户在设置页看到的是这种东西：
 *
 *   检查更新失败
 *   上次检查：2 分钟前 · error sending request for url (https://github.com/joeyliu6/PicNexus/releases/latest/download/latest.json)
 *
 * 三个问题：英文技术原文看不懂、长 URL 折三行撑高卡片、看完也不知道该干嘛。
 *
 * 规则来源不是猜的，是照着 `tauri-plugin-updater-2.10.0/src/error.rs` 的
 * `#[error(...)]` 文案清单逐条对的（本地 cargo registry 可查）。透传型变体
 * （`Reqwest` / `Minisign` / `Io` 等标了 `#[error(transparent)]`）则按对应
 * 底层库的 Display 实现匹配。
 *
 * 设计上跟批量迁移的 `categorizeMigrateError`（`uploadFailureMessage.ts`）保持同一个调子：
 * 界面显示归类后的人话，技术原文塞 tooltip，排障时信息不丢。
 *
 * 写文案的两条约束：
 * - **控制在 20 字上下**。副行前面还要拼「上次检查：2 分钟前 · 」，太长又会折行撑高卡片，
 *   等于换个方式重演原来的毛病。
 * - **不要复述按钮标签**。右侧按钮上就写着「手动下载」，每条都补一句"从官网获取最新版"是废话。
 */

/** 失败发生在哪个阶段 —— 同一类底层错误在两个阶段该说的话不一样 */
export type UpdateFailurePhase = 'check' | 'download';

export interface UpdateFailureText {
  /** 卡片主标题，直接说清是什么问题 */
  title: string;
  /** 副行提示，告诉用户下一步能做什么 */
  hint: string;
}

interface FailureRule {
  pattern: RegExp;
  /** 命中后产出文案；phase 用于区分检查阶段与下载阶段的措辞 */
  resolve: (phase: UpdateFailurePhase, raw: string) => UpdateFailureText;
}

/**
 * 从 `Download request failed with status: 404 Not Found` 里抠出状态码文本
 * 抠不到就返回空串，让调用方退回泛化文案
 */
function extractHttpStatus(raw: string): string {
  const match = /status(?:\s*code)?[:\s]+([0-9]{3}[^`'"\n]*)/iu.exec(raw);
  return match ? match[1].trim().replace(/[`'"]+$/u, '') : '';
}

/**
 * 规则按声明顺序匹配，**顺序即优先级**，调整前先想清楚重叠关系：
 * - 权限要排在安装前面（`os error 5` 本身是一个 Io 错误，会被安装规则吃掉）
 * - 签名要排在网络前面（签名失败的消息里可能带 URL）
 * - HTTP 状态码要排在网络前面（`Error::Network` 是插件自己拼的字符串，不是 reqwest 连接失败）
 */
const UPDATE_FAILURE_RULES: FailureRule[] = [
  // ── 配置类：应用自身的问题，重试多少次都没用 ────────────────────────────
  {
    // error.rs: EmptyEndpoints / InsecureTransportProtocol，以及 UrlParse 透传
    pattern: /does not have any endpoints set|must use a secure protocol|relative URL without a base|invalid (?:IPv[46] address|port number|domain character)/iu,
    resolve: () => ({
      title: '更新功能未正确配置',
      hint: '这是应用自身的问题，重试无效，请点「手动下载」',
    }),
  },

  // ── 签名类：安全红线，绝不能提示用户"重试" ──────────────────────────────
  {
    // minisign-verify 的 Display + error.rs: SignatureUtf8 / Base64 透传
    // 刻意不写裸 `signature`：latest.json 少字段时 serde 报 `missing field \`signature\``，
    // 那是发布配置漏了，不是包被篡改，必须让它落到下面的"读不到更新信息"规则
    pattern: /signature verification failed|invalid signature|invalid encoding in minisign data|unexpected signature algorithm|could not be decoded, please check if it is a valid base64/iu,
    resolve: () => ({
      title: '更新包校验未通过',
      hint: '为防止安装被篡改的文件已中止，请点「手动下载」',
    }),
  },

  // ── 平台类：这个版本没出你这个系统的包 ──────────────────────────────────
  {
    // error.rs: TargetNotFound / TargetsNotFound / UnsupportedArch / UnsupportedOs
    pattern: /was not found in the response `platforms` object|were found in the response `platforms` object|unsupported application architecture|unsupported os/iu,
    resolve: () => ({
      title: '当前系统暂无更新包',
      hint: '这个版本还没适配你的系统，可稍后再试',
    }),
  },

  // ── 权限类：Windows 上最常见的安装失败原因 ──────────────────────────────
  {
    // error.rs: AuthenticationFailed，以及 Io 透传里的系统权限错误
    pattern: /authentication failed or was cancelled|os error 5\b|access is denied|拒绝访问|permission denied|elevation|requires? elevation/iu,
    resolve: () => ({
      title: '没有权限完成更新安装',
      hint: '请关闭 PicNexus 后以管理员身份重试',
    }),
  },

  // ── HTTP 状态类：服务器答了，但答的不是文件 ─────────────────────────────
  {
    // error.rs: Error::Network(format!("Download request failed with status: {}"))
    pattern: /download request failed with status|http status (?:client|server) error/iu,
    resolve: (_phase, raw) => {
      const status = extractHttpStatus(raw);
      return {
        title: '更新包下载失败',
        hint: status
          ? `服务器返回 ${status}，请点「手动下载」`
          : '服务器拒绝了下载请求，请点「手动下载」',
      };
    },
  },

  // ── 更新信息解析类：连上了，但读不懂返回内容 ────────────────────────────
  {
    // error.rs: ReleaseNotFound / Serialization 透传 / reqwest 的 Decode
    // 注意：latest.json 返回 404 时插件不会报 404，只会走到 ReleaseNotFound
    pattern: /could not fetch a valid release json|error decoding response body|expected value at line|missing field|invalid type: |failed to format date/iu,
    resolve: () => ({
      title: '暂时读不到更新信息',
      hint: '更新服务返回的内容无法识别，可稍后重试或手动下载',
    }),
  },

  // ── 网络类：最高频的一类，用户截图里那条就是这个 ────────────────────────
  {
    // reqwest 的 Display：0.11 是 `error sending request for url (...)`，0.12 是 `error sending request`
    // 超时在 reqwest 里被包成 Request kind，顶层文案不含 timeout，所以这里一并收进网络类
    pattern: /error sending request|error following redirect|request or response body error|builder error|error upgrading connection|timed? ?out|timeout|\bdns\b|connection (?:reset|refused|closed|aborted)|network (?:is )?unreachable|certificate|\btls\b|\bssl\b/iu,
    resolve: (phase) => phase === 'download'
      ? {
        title: '更新包下载中断',
        hint: '网络不稳定，可重新下载或手动下载',
      }
      : {
        title: '连不上更新服务器',
        hint: '网络不通或 GitHub 访问受限，可重试或手动下载',
      },
  },

  // ── 安装类：包下来了，装不进去 ──────────────────────────────────────────
  {
    // error.rs: PackageInstallFailed / DebInstallFailed / InvalidUpdaterFormat /
    // Extract(zip) / TempDir* / BinaryNotFoundInArchive / FailedToDetermineExtractPath
    pattern: /failed to install|invalid updater binary format|binary for the current target not found|failed to create temporary directory|temp directory is not on the same mount point|failed to determine updater package extract path|invalid zip archive|os error/iu,
    resolve: () => ({
      title: '更新安装失败',
      hint: '请关闭正在运行的 PicNexus 后重试',
    }),
  },
];

const FALLBACK: Record<UpdateFailurePhase, UpdateFailureText> = {
  check: {
    title: '检查更新失败',
    hint: '请稍后重试，或点「手动下载」',
  },
  download: {
    title: '下载更新失败',
    hint: '请重新下载，或点「手动下载」',
  },
};

/**
 * 把更新失败的原始错误翻译成一组界面文案
 *
 * @param phase 失败发生的阶段：`check` = 检查版本，`download` = 下载或安装
 * @param rawMessage `useAutoUpdate.errorMessage` 里的原始英文错误
 * @returns 主标题 + 副行提示；识别不出来时退回该阶段的泛化文案
 */
export function formatUpdateFailure(
  phase: UpdateFailurePhase,
  rawMessage: string,
): UpdateFailureText {
  const raw = (rawMessage || '').trim();
  if (!raw) return FALLBACK[phase];

  for (const rule of UPDATE_FAILURE_RULES) {
    if (rule.pattern.test(raw)) return rule.resolve(phase, raw);
  }

  return FALLBACK[phase];
}
