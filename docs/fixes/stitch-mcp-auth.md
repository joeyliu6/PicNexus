# Stitch MCP 认证失败修复记录

## 问题现象

在 Claude Code 中连接 Stitch MCP 服务器时报错：

```
SDK auth failed: Incompatible auth server: does not support dynamic client registration
```

状态显示 `Needs Auth`，点击 Authenticate 也无效。

## 根本原因

Claude Code 的已知 Bug（issues [#41664](https://github.com/anthropics/claude-code/issues/41664)、[#3273](https://github.com/anthropics/claude-code/issues/3273)）：

连接 **HTTP 类型** MCP 服务器时，**无论是否配置了 `headers`**，Claude Code 都会无条件触发 OAuth 动态客户端注册（Dynamic Client Registration）流程。Google Stitch 不支持该流程，故报错。

这意味着以下配置虽然格式正确，但**不起作用**：

```json
"stitch": {
  "type": "http",
  "url": "https://stitch.googleapis.com/mcp",
  "headers": {
    "X-Goog-Api-Key": "YOUR_API_KEY"
  }
}
```

## 解决方案

用 `supergateway` 作为 stdio 桥接，绕过 Claude Code 的 OAuth 触发逻辑。

**原理**：Claude Code 只对 `http` 类型 MCP 服务器触发 OAuth，对 `stdio` 类型不触发。`supergateway` 以 stdio 方式运行，在本地代理连接到 Stitch HTTP 端点并携带 API Key header。

### 第一步：清理 OAuth 缓存

编辑 `~/.claude/.credentials.json`，找到 `mcpOAuth` 字段并清空：

```json
"mcpOAuth": {}
```

### 第二步：修改 `~/.claude.json` 配置

将 stitch 的 MCP 配置改为：

```json
"stitch": {
  "type": "stdio",
  "command": "npx.cmd",
  "args": [
    "-y",
    "supergateway@latest",
    "--streamableHttp",
    "https://stitch.googleapis.com/mcp",
    "--header",
    "X-Goog-Api-Key: YOUR_API_KEY"
  ]
}
```

> Windows 用 `npx.cmd`，Mac/Linux 用 `npx`

### 第三步：重启 Claude Code

重启后 Stitch MCP 应显示为已连接状态。

## 获取 Stitch API Key

1. 打开 Stitch 网站，进入 Settings 页面
2. 找到 API Keys 区块
3. 点击 "Create API Key"
4. 复制并保存（只显示一次）

## 相关 GitHub Issues

- [#41664 - Stitch MCP 报错](https://github.com/anthropics/claude-code/issues/41664)
- [#3273 - HTTP MCP 强制 OAuth](https://github.com/anthropics/claude-code/issues/3273)
- [#28293 - Headers 未转发](https://github.com/anthropics/claude-code/issues/28293)
