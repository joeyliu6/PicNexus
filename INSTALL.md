# 安装指南

## 前置要求

### 1. Node.js
- 版本要求：Node.js 18.0 或更高版本
- 下载地址：https://nodejs.org/

### 2. Rust
- 版本要求：Rust 1.70 或更高版本
- 安装方法：
  ```bash
  # Windows (使用 PowerShell)
  # 下载并运行 rustup-init.exe
  # 或使用以下命令：
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

  # macOS
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

  # Linux
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```

### 3. 系统依赖

#### Windows
- Microsoft Visual C++ Build Tools
- 下载地址：https://visualstudio.microsoft.com/visual-cpp-build-tools/

#### macOS
- Xcode Command Line Tools
  ```bash
  xcode-select --install
  ```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.0-dev \
    build-essential \
    curl \
    wget \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
```

## 安装步骤

### 1. 克隆或下载项目
```bash
git clone <repository-url>
cd WeiboDR-Uploader
```

### 2. 安装 Node.js 依赖
```bash
npm install
```

### 3. 准备图标文件
- 将图标文件放入 `src-tauri/icons/` 目录
- 参考 `src-tauri/icons/README.md` 了解所需图标文件

### 4. 开发模式运行
```bash
npm run tauri dev
```

### 5. 构建生产版本
```bash
npm run tauri build
```

构建完成后，可执行文件将位于：
- Windows: `src-tauri/target/release/weibodr-uploader.exe`
- macOS: `src-tauri/target/release/bundle/macos/WeiboDR-Uploader.app`
- Linux: `src-tauri/target/release/weibodr-uploader`

## 常见问题

### Q: 安装依赖时出错
A: 确保已安装所有系统依赖，特别是 Rust 和 Node.js。

### Q: 构建失败，提示找不到图标
A: 请确保 `src-tauri/icons/` 目录中包含所有必需的图标文件。

### Q: 运行时提示权限错误
A: 
- Windows: 以管理员身份运行
- macOS: 在系统偏好设置中授予权限
- Linux: 检查文件权限

### Q: Tauri 命令未找到
A: 运行 `npm install` 确保所有依赖已正确安装。

## 下一步

安装完成后，请参考 `README.md` 了解如何使用应用。

