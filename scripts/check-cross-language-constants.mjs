/**
 * 跨语言常量一致性检查
 *
 * 有些给用户看的文案在 Rust 和前端各写一份——前端在设置页当场拦（只拦得住字面量），
 * Rust 在真正发请求时拦（能按 DNS 结果裁决）。两道关卡拦的是**同一件事**，
 * 所以必须说**同一句话**：措辞一旦分叉，用户会以为自己撞上了两个不同的故障。
 *
 * 这种一致性以前只靠源码注释维持（"与 xxx 保持逐字一致"）。注释拦不住任何东西：
 * 改了一边不会红、测试不会挂、CI 不会拦，用户也不会报告——他只会以为是两个 bug。
 * 本脚本把这条约定变成硬门禁。
 *
 * ── 新增一对常量 ──
 * 往 PAIRS 里加一条：name（报错时显示）、why（为什么必须一致）、
 * sources（每个文件一条，正则必须带**一个捕获组**框住字符串字面量的内容）。
 *
 * ── 不适合放进来的 ──
 * 只有"必须逐字一致的字符串字面量"适合这里。像"三份实现的保留网段必须对齐"
 * 那种跨语言的**逻辑**一致性，正则查不可靠，继续由两侧的单元测试守着
 * （`reserved_ranges_match_frontend_and_link_checker` 等）。
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

const PAIRS = [
  {
    name: 'FAKE_IP_HOST_MESSAGE',
    why: 'fake-ip 地址被当成局域网时的提示。设置页由前端拦、上传时由 Rust 拦，是同一件事的两个拦截点',
    sources: [
      {
        file: 'src-tauri/src/url_policy.rs',
        pattern: /const\s+FAKE_IP_HOST_MESSAGE\s*:\s*&str\s*=\s*"((?:\\.|[^"\\])*)"/,
      },
      {
        file: 'src/security/networkPolicy.ts',
        pattern: /const\s+FAKE_IP_HOST_MESSAGE\s*=\s*'((?:\\.|[^'\\])*)'/,
      },
    ],
  },
  {
    name: 'WEBDAV_AUTH_FAILED_MESSAGE',
    why: 'WebDAV 认证失败的提示。图床链路由 Rust 在上传/测试时报，备份链路由前端在解析响应码时报，是同一件事的两个报点；措辞分叉会让用户以为撞上了两个不同的故障',
    sources: [
      {
        file: 'src-tauri/src/commands/webdav_upload.rs',
        pattern: /const\s+WEBDAV_AUTH_FAILED_MESSAGE\s*:\s*&str\s*=\s*"((?:\\.|[^"\\])*)"/,
      },
      {
        file: 'src/utils/webdav.ts',
        pattern: /const\s+WEBDAV_AUTH_FAILED_MESSAGE\s*=\s*'((?:\\.|[^'\\])*)'/,
      },
    ],
  },
  {
    name: 'WEBDAV_FORBIDDEN_MESSAGE',
    why: 'WebDAV 权限不足（403）的提示。拦截点分布与 WEBDAV_AUTH_FAILED_MESSAGE 完全一样；这两句本身必须泾渭分明——403 是「认过了但没权限」，说成认证失败会把用户支去改本来就没错的密码',
    sources: [
      {
        file: 'src-tauri/src/commands/webdav_upload.rs',
        pattern: /const\s+WEBDAV_FORBIDDEN_MESSAGE\s*:\s*&str\s*=\s*"((?:\\.|[^"\\])*)"/,
      },
      {
        file: 'src/utils/webdav.ts',
        pattern: /const\s+WEBDAV_FORBIDDEN_MESSAGE\s*=\s*'((?:\\.|[^'\\])*)'/,
      },
    ],
  },
  {
    name: 'DEFAULT_WEBDAV_URL_TEMPLATE',
    why: 'WebDAV 公开链接的默认模板。主上传链路由前端 WebDAVUploader 兜底，编辑器/CLI 链路由 Rust render_public_url 兜底；两边漂移会让同一个 profile 在主界面和 Typora/CLI 里生成不同的链接',
    sources: [
      {
        file: 'src-tauri/src/commands/webdav_upload.rs',
        pattern: /const\s+DEFAULT_WEBDAV_URL_TEMPLATE\s*:\s*&str\s*=\s*"((?:\\.|[^"\\])*)"/,
      },
      {
        file: 'src/config/serviceTypes.ts',
        pattern: /const\s+DEFAULT_WEBDAV_URL_TEMPLATE\s*=\s*'((?:\\.|[^'\\])*)'/,
      },
    ],
  },
  {
    name: 'BACKUP_DIR_NAME',
    why: 'MD 修复的备份目录名。前端用它建备份目录，Rust 扫描用它跳过备份目录；一旦漂移，扫描会把"修复前的原件"当正常文档再修一遍，备份被改写、还会产生嵌套备份',
    sources: [
      {
        file: 'src-tauri/src/commands/md_scanner.rs',
        pattern: /const\s+BACKUP_DIR_NAME\s*:\s*&str\s*=\s*"((?:\\.|[^"\\])*)"/,
      },
      {
        file: 'src/composables/md-rescue/useFileBackup.ts',
        pattern: /const\s+BACKUP_DIR_NAME\s*=\s*'((?:\\.|[^'\\])*)'/,
      },
    ],
  },
  {
    name: 'UPYUN_S3_ENDPOINT',
    why: '又拍云 S3 兼容端点。GUI 上传由前端把它传进 upload_to_s3_compatible，设置页「测试连接」由 Rust 自己拼；两边漂移会让测试连接验的不是上传真正会去的那台服务器，绿灯退化成没有意义的绿灯——那正是这个图床的缺陷长期潜伏的形态',
    sources: [
      {
        file: 'src-tauri/src/commands/s3_compatible.rs',
        pattern: /const\s+UPYUN_S3_ENDPOINT\s*:\s*&str\s*=\s*"((?:\\.|[^"\\])*)"/,
      },
      {
        file: 'src/uploaders/upyun/UpyunUploader.ts',
        pattern: /const\s+UPYUN_S3_ENDPOINT\s*=\s*'((?:\\.|[^'\\])*)'/,
      },
    ],
  },
  {
    name: 'UPYUN_S3_REGION',
    why: '又拍云 SigV4 签名用的 region。又拍云不校验它的取值，但它参与签名计算，两侧填的必须是同一个字符串，否则测试连接与真实上传签出来的不是同一个签名',
    sources: [
      {
        file: 'src-tauri/src/commands/s3_compatible.rs',
        pattern: /const\s+UPYUN_S3_REGION\s*:\s*&str\s*=\s*"((?:\\.|[^"\\])*)"/,
      },
      {
        file: 'src/uploaders/upyun/UpyunUploader.ts',
        pattern: /const\s+UPYUN_S3_REGION\s*=\s*'((?:\\.|[^'\\])*)'/,
      },
    ],
  },
];

for (const pair of PAIRS) {
  checkPair(pair);
}

if (failures.length > 0) {
  console.error('Cross-language constant check failed:\n' + failures.join('\n'));
  process.exit(1);
}

function checkPair(pair) {
  const found = [];

  for (const source of pair.sources) {
    const fullPath = path.join(root, source.file);

    if (!fs.existsSync(fullPath)) {
      failures.push(`${pair.name}: 文件不存在 ${source.file}（文件被移动或改名了？顺手更新 scripts/check-cross-language-constants.mjs 里的 PAIRS）`);
      continue;
    }

    const match = source.pattern.exec(fs.readFileSync(fullPath, 'utf8'));
    if (!match) {
      failures.push(`${pair.name}: 在 ${source.file} 里找不到常量定义（改名了、还是换了写法？删掉它之前请先确认另一侧也不再需要这句文案）`);
      continue;
    }

    found.push({ file: source.file, value: unescapeLiteral(match[1]) });
  }

  // 定位失败已各自报过错，这里只判"都找到了但对不上"
  if (found.length !== pair.sources.length) return;

  const [first, ...rest] = found;
  const drifted = rest.filter(entry => entry.value !== first.value);
  if (drifted.length === 0) return;

  failures.push(
    `${pair.name}: 各处文案不一致——${pair.why}\n`
    + [first, ...drifted].map(entry => `    ${entry.file}\n      ${entry.value}`).join('\n'),
  );
}

/** 只处理这批文案里可能出现的转义；复杂转义不该出现在给用户看的句子里 */
function unescapeLiteral(raw) {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\(["'\\])/g, '$1');
}
