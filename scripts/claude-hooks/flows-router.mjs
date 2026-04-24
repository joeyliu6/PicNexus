#!/usr/bin/env node
// Claude Code UserPromptSubmit hook：按关键词把 docs/flows/ 下对应流程图注入 system-reminder。
// 协议：stdin 收到 { prompt, session_id, ... }，stdout 输出的内容会被当作 system-reminder。
// 没命中就静默退出，不污染 context。
// 详见 .claude/plans 里对应的 plan 文件。

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  let prompt = '';
  try {
    const parsed = JSON.parse(raw || '{}');
    prompt = typeof parsed.prompt === 'string' ? parsed.prompt : '';
  } catch {
    // 解析失败就当没收到 prompt，静默退出
    return;
  }
  if (!prompt) return;

  // 关键词到 flow 路径的映射表。顺序很重要：前面的优先命中。
  const routes = [
    { re: /上传|图床|uploader|upload/i, doc: 'docs/flows/upload-flow.md', tag: '上传' },
    { re: /历史|history|记录/i, doc: 'docs/flows/history-flow.md', tag: '历史' },
    { re: /同步|备份|webdav|sync/i, doc: 'docs/flows/sync-flow.md', tag: '同步/备份' },
    { re: /配置|缩略图|持久化|config\s*store/i, doc: 'docs/flows/data-persistence.md', tag: '持久化' },
    { re: /启动|白屏|闪退|cookie\s*登录|开机/i, doc: 'docs/flows/app-lifecycle.md', tag: '生命周期' },
    // 链接监控优先于压缩/链接检测：正则用否定环视避开"链接监控"被误判为辅助
    { re: /链接监控|link.?check|批量检测/i, doc: 'docs/flows/link-check-flow.md', tag: '链接监控' },
    { re: /镜像|mirror|切换主服务|主图失效|fallback/i, doc: 'docs/flows/mirror-fallback-flow.md', tag: '镜像 fallback' },
    { re: /压缩|链接检测(?!.*监控)/i, doc: 'docs/flows/auxiliary-flows.md', tag: '辅助' },
    { re: /文档修复|md.?rescue|markdown\s*修复/i, doc: 'docs/flows/md-rescue-flow.md', tag: 'MD 修复' },
    { re: /批量迁移|batch.?migrate|迁移/i, doc: 'docs/flows/batch-migrate-flow.md', tag: '批量迁移' },
    { re: /tauri|command|ipc|invoke|emit|事件/i, doc: 'docs/flows/ipc-command-flow.md', tag: 'IPC' },
    { re: /数据库|schema|migration|sqlite|加字段|改索引|表结构/i, doc: 'docs/flows/db-migration-flow.md', tag: 'DB 迁移' },
    { re: /窗口|托盘|tray|快捷键|shortcut|\bcli\b/i, doc: 'docs/flows/window-system-integration.md', tag: '窗口系统' },
    { re: /日志|logger|诊断|报障/i, doc: 'docs/flows/logger-diagnostics-flow.md', tag: '日志' },
    { re: /自动更新|发布|签名|updater/i, doc: 'docs/flows/auto-update-flow.md', tag: '自动更新' },
    { re: /设置|settings|主题|配置项/i, doc: 'docs/flows/settings-ui-architecture.md', tag: '设置面板' },
    { re: /新功能|架构|系统总览|不知道从哪|从哪下手/i, doc: 'docs/flows/system-overview.md', tag: '系统总览' },
  ];

  const hits = [];
  const seen = new Set();
  for (const r of routes) {
    if (r.re.test(prompt) && !seen.has(r.doc)) {
      hits.push(r);
      seen.add(r.doc);
    }
  }
  if (!hits.length) return;

  // 上限 3 条，避免 prompt 提到多模块时污染 context
  const top = hits.slice(0, 3);
  const lines = top.map((h) => `📊 ${h.tag}：先读 ${h.doc}`);
  process.stdout.write(lines.join(' | ') + '\n');
});
