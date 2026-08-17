/**
 * WebDAV 认证方案夹具 —— 验收「401 提示区分 Digest 与密码错」用
 *
 * Why 不起真的 Apache mod_dav：要验的是**提示文案**，而 PicNexus 本来就不支持 Digest、
 * 认证注定失败。所以服务端只需要如实声明自己要哪种认证即可，不需要真的实现 Digest 的
 * nonce/qop/nc 那一套。省掉一个 Docker 依赖，验收从「装环境」变成「跑一条命令」。
 *
 * 四个端口对应四种服务端形态，后两个是判据最容易失效的地方：
 *
 *   5011  只给 Digest                  → 应提示「服务端要求 Digest 认证」
 *   5012  只给 Basic                   → 应提示「认证失败，请检查用户名和密码」
 *   5013  两条同名 header，Digest 在前  → 应提示「认证失败，请检查用户名和密码」
 *   5014  Digest，realm 里带逗号        → 应提示「服务端要求 Digest 认证」
 *
 * 5013 是 `get_all()` vs `get()` 的真机判据：RFC 7235 允许服务端把 Basic 和 Digest
 * 拆成两条 `WWW-Authenticate` 发。只看第一条的实现会在这里把「两种都支持」误判成
 * 「只支持 Digest」，于是把一个密码填错的用户支去折腾服务端配置。单测里造得出这个
 * 形态，但只有真机能证明 reqwest 到 hyper 这一路没把它合并掉。
 *
 * 5014 补的是 `3eee955` 修掉的那个缺陷：`realm` 是 quoted-string，允许包含逗号。
 * 按逗号裸切会把 `Digest realm="NAS, Basic Zone"` 从中间切断，后半截 `Basic Zone"`
 * 让 `has_basic` 翻成 true，**反而遮掉 Digest 判定**，退回它本要消灭的那句通用提示。
 * Why 现在才补：那次修复（08-17）提交在真机验收（08-16）**之后**，而当时三个场景的
 * realm 都不带逗号，这个 case 从未在真机上跑过。
 *
 * 用法：node scripts/webdav-auth-fixture.mjs
 */

import http from 'node:http';

/** 每种形态返回的 WWW-Authenticate 头（数组 = 多条同名 header） */
const SCENARIOS = [
  {
    port: 5011,
    name: 'Digest only',
    expect: '服务端要求 Digest 认证',
    headers: ['Digest realm="picnexus-test", qop="auth", nonce="deadbeef"'],
  },
  {
    port: 5012,
    name: 'Basic only',
    expect: '认证失败，请检查用户名和密码',
    headers: ['Basic realm="picnexus-test"'],
  },
  {
    port: 5013,
    name: 'Digest + Basic（两条同名 header，Digest 在前）',
    expect: '认证失败，请检查用户名和密码',
    headers: [
      'Digest realm="picnexus-test", qop="auth", nonce="deadbeef"',
      'Basic realm="picnexus-test"',
    ],
  },
  {
    port: 5014,
    name: 'Digest，realm 里带逗号（3eee955 修的缺陷）',
    expect: '服务端要求 Digest 认证',
    headers: ['Digest realm="NAS, Basic Zone", qop="auth", nonce="deadbeef"'],
  },
];

const servers = SCENARIOS.map((scenario) => {
  const server = http.createServer((req, res) => {
    // 一律 401 并声明认证方案——本夹具只关心 challenge 长什么样
    res.writeHead(401, {
      'WWW-Authenticate': scenario.headers,
      'Content-Length': '0',
    });
    res.end();
    console.log(`  [${scenario.port}] ${req.method} ${req.url} → 401`);
  });

  server.listen(scenario.port, '127.0.0.1', () => {
    console.log(`✓ :${scenario.port}  ${scenario.name}`);
    console.log(`     地址 http://127.0.0.1:${scenario.port}/dav`);
    console.log(`     判据 「${scenario.expect}」\n`);
  });

  server.on('error', (err) => {
    console.error(`✗ :${scenario.port} 启动失败：${err.message}`);
    process.exit(1);
  });

  return server;
});

console.log('\nWebDAV 认证夹具已启动。三个地址都填同一套配置即可：');
console.log('  用户名/密码：随便填（本夹具一律返回 401，这正是要测的）');
console.log('  公开访问域名：与 WebDAV 地址填同一个');
console.log('\n按 Ctrl+C 停止。\n');

const shutdown = () => {
  console.log('\n正在关闭夹具…');
  servers.forEach((s) => s.close());
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
