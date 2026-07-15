# 贡献指南

感谢您对 PicNexus 项目感兴趣！我们欢迎任何形式的贡献。

## 🤝 如何贡献

### 报告问题

如果您发现了 Bug 或有功能建议，请：

1. 先在 [Issues](https://github.com/joeyliu6/PicNexus/issues) 中搜索是否已有相关问题
2. 如果没有，创建一个新的 Issue
3. 使用清晰的标题和详细的描述
4. 如果是 Bug，请提供：
   - 操作系统版本
   - 应用版本
   - 复现步骤
   - 预期行为 vs 实际行为
   - 相关日志或截图

### 提交代码

#### 开发流程

1. **Fork 本仓库**
   ```bash
   # 在 GitHub 上 Fork 项目
   ```

2. **克隆到本地**
   ```bash
   git clone https://github.com/joeyliu6/PicNexus.git
   cd PicNexus
   ```

3. **创建分支**
   ```bash
   git checkout -b feature/your-feature-name
   # 或
   git checkout -b fix/your-bug-fix
   ```

4. **安装依赖**
   ```bash
   npm ci
   npm run setup:sidecars
   ```

5. **开发和测试**
   ```bash
   npm run tauri dev
   ```

6. **提交更改**
   ```bash
   git add .
   git commit -m "feat: 添加某某功能"
   # 或
   git commit -m "fix: 修复某某问题"
   ```

7. **推送到远程**
   ```bash
   git push origin feature/your-feature-name
   ```

8. **创建 Pull Request**
   - 在 GitHub 上创建 PR
   - 填写 PR 模板
   - 等待 Review

#### 提交信息规范

我们使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范：

- `feat: 新功能`
- `fix: 修复问题`
- `docs: 文档更新`
- `style: 代码格式（不影响功能）`
- `refactor: 重构代码`
- `perf: 性能优化`
- `test: 测试相关`
- `chore: 构建/工具链相关`

**示例：**
```
feat: 添加批量删除功能

- 支持选择多个文件
- 添加确认对话框
- 更新 UI 交互
```

## 📝 代码规范

### TypeScript 规范

```typescript
/**
 * 函数功能描述
 * @param paramName 参数说明
 * @returns 返回值说明
 * @throws {Error} 可能抛出的错误
 */
async function exampleFunction(paramName: string): Promise<void> {
  try {
    // 使用 const 和 let，避免 var
    const result = await someAsyncOperation(paramName);
    
    // 详细的日志记录
    console.log('[模块名] 操作成功:', result);
  } catch (error) {
    // 完整的错误处理
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[模块名] 操作失败:', error);
    throw new Error(`操作失败: ${errorMsg}`);
  }
}
```

**要点：**
- 使用 TypeScript 严格模式
- 函数使用 `async/await` 处理异步操作
- 使用 `const` 和 `let`，避免 `var`
- 驼峰命名法（camelCase）
- 所有错误处理必须包含详细的错误信息
- 使用 JSDoc 注释说明函数用途

### Rust 规范

```rust
/// 函数功能描述
/// 
/// # 参数
/// * `param_name` - 参数说明
/// 
/// # 返回
/// 返回 `Result<String, String>`，成功时返回消息，失败时返回错误信息
#[tauri::command]
async fn example_command(param: String) -> Result<String, String> {
    if param.is_empty() {
        return Err("参数不能为空".to_string());
    }
    
    // 操作逻辑
    
    Ok("操作成功".to_string())
}
```

**要点：**
- 遵循 Rust 官方代码风格（rustfmt）
- 使用 `Result<T, E>` 进行错误处理
- 蛇形命名法（snake_case）
- 使用 `?` 操作符进行错误传播
- 添加文档注释（`///`）

### CSS 规范

```css
/* 模块或组件名称 */
.component-name {
  /* 布局属性 */
  display: flex;
  flex-direction: column;
  
  /* 尺寸属性 */
  width: 100%;
  height: auto;
  
  /* 视觉属性 */
  background-color: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  
  /* 文本属性 */
  font-size: 14px;
  color: #333333;
  
  /* 其他属性 */
  cursor: pointer;
  transition: all 0.3s ease;
}

/* 使用媒体查询适配不同屏幕 */
@media (max-width: 768px) {
  .component-name {
    font-size: 12px;
  }
}
```

**要点：**
- 使用 kebab-case 命名类名
- 按属性类型分组
- 使用注释说明模块功能
- 使用响应式设计

## ✅ 提交前检查清单

在提交 PR 前，请确保：

- [ ] 代码符合项目规范
- [ ] 所有功能正常工作
- [ ] 没有 TypeScript 或 Rust 编译错误
- [ ] 没有 linter 警告或错误
- [ ] 添加了必要的注释和文档
- [ ] 测试了主要功能流程
- [ ] 更新了相关文档（如需要）
- [ ] 提交信息符合规范

## 🧪 测试指南

### 功能测试

1. **上传功能**
   - 单文件上传
   - 多文件批量上传
   - 拖拽上传
   - 点击选择上传

2. **R2 备份**
   - R2 上传成功
   - R2 上传失败（网络错误）
   - R2 配置错误

3. **WebDAV 同步**
   - WebDAV 同步成功
   - WebDAV 同步失败
   - WebDAV 配置错误

4. **历史记录**
   - 记录保存
   - 记录查看
   - 链接复制

5. **R2 管理器**
   - 文件列表加载
   - 文件预览
   - 文件删除

### 边界测试

- 空文件列表
- 非常大的文件（>20MB）
- Cookie 过期场景
- 网络断开场景
- 配置错误场景
- 非法文件类型

### 性能测试

- 10+ 文件同时上传
- 快速连续操作
- 长时间运行稳定性

## 📚 文档贡献

文档同样重要！您可以：

- 修复文档中的错误
- 改进文档的清晰度
- 添加使用示例
- 翻译文档为其他语言

### 文档规范

- 使用中文撰写（主要面向中文用户）
- 使用 Markdown 格式
- 包含清晰的标题层次结构
- 添加示例和截图（如适用）
- 保持内容简洁明了

## 🎯 开发建议

### 推荐开发工具

- **IDE**: Visual Studio Code 或 Cursor
- **插件**:
  - rust-analyzer (Rust 语言支持)
  - ESLint (JavaScript/TypeScript 代码检查)
  - Prettier (代码格式化)
  - Tauri (Tauri 开发支持)

### 调试技巧

**前端调试：**
```bash
npm run tauri dev
# 自动打开 DevTools
```

**后端调试：**
```rust
// 在 main.rs 中添加日志
println!("[Rust] Debug info: {:?}", variable);
```

**查看日志：**
- Windows: `%APPDATA%\us.picnex.app\logs\`
- macOS: `~/Library/Application Support/us.picnex.app/logs/`
- Linux: `~/.config/us.picnex.app/logs/`

## 🤔 需要帮助？

如果您在贡献过程中遇到问题：

1. 查看 [README](README.md) 和 [文档](docs/README.md)
2. 搜索已有的 [Issues](https://github.com/joeyliu6/PicNexus/issues)
3. 在 [Discussions](https://github.com/joeyliu6/PicNexus/discussions) 中提问
4. 联系维护者

## 📜 行为准则

请遵守以下准则：

- 尊重所有贡献者
- 使用包容性语言
- 接受建设性批评
- 关注项目的最佳利益
- 对社区成员表现出同理心
- 涉及公共图床或第三方平台适配的贡献，不得加入绕过限流、反盗链、认证校验、访问控制或其他平台限制的滥用逻辑

## 📄 许可证

通过贡献代码，您同意您的贡献将在 [Apache License 2.0](LICENSE) 下发布。

---

<div align="center">

**感谢您的贡献！** ❤️

[返回主页](README.md)

</div>

