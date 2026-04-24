import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';
import type { GithubServiceConfig } from '../../config/types';
import { getErrorMessage } from '../../types/errors';

interface GithubRustResult {
  url: string;
  sha?: string;
  remotePath?: string;
}

export class GithubUploader extends BaseUploader<GithubServiceConfig> {
  readonly serviceId = 'github';
  readonly serviceName = 'GitHub';

  protected getRustCommand(): string {
    return 'upload_to_github';
  }

  async validateConfig(config: GithubServiceConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const missingFields: string[] = [];

    if (this.isEmpty(config.token)) {
      missingFields.push('token');
      errors.push('Personal Access Token 不能为空');
    }
    if (this.isEmpty(config.owner)) {
      missingFields.push('owner');
      errors.push('仓库所有者不能为空');
    }
    if (this.isEmpty(config.repo)) {
      missingFields.push('repo');
      errors.push('仓库名称不能为空');
    }
    if (this.isEmpty(config.branch)) {
      missingFields.push('branch');
      errors.push('分支名称不能为空');
    }

    if (errors.length > 0) {
      return { valid: false, missingFields, errors };
    }

    return { valid: true };
  }

  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    this.log('info', '开始上传到 GitHub', { filePath });

    const config = options.config as GithubServiceConfig;

    const rustResult = await this.uploadViaRust(
      filePath,
      {
        githubToken: config.token,
        owner: config.owner,
        repo: config.repo,
        branch: config.branch || 'main',
        path: config.path || 'images/'
      },
      onProgress
    ) as GithubRustResult;

    // 应用 CDN 转换或自定义域名
    const finalUrl = this.applyUrlTransform(rustResult.url, config);

    this.log('info', 'GitHub 上传成功', { rawUrl: rustResult.url, finalUrl });

    return {
      serviceId: 'github',
      fileKey: rustResult.sha || rustResult.remotePath || rustResult.url,
      url: finalUrl,
      metadata: {
        sha: rustResult.sha,
        remotePath: rustResult.remotePath,
        rawUrl: rustResult.url
      }
    };
  }

  private applyUrlTransform(rawUrl: string, config: GithubServiceConfig): string {
    if (!config.cdnConfig?.enabled) return rawUrl;

    const { cdnList, selectedIndex } = config.cdnConfig;
    const cdn = cdnList[selectedIndex] || cdnList[0];
    if (!cdn?.url || !cdn?.template) return rawUrl;

    // 用配置中的 owner/repo/branch 构造已知前缀，再切出剩余 path
    // Why: 正则 `[^/]+` 无法正确切分含斜杠的分支名（例如 `feature/foo`），
    //      会误把 `feature` 当分支、把 `foo/...` 当 path
    // Why: GitHub `download_url` 会对非 ASCII 分支/路径做 URL 编码（如中文、空格），
    //      若 expectedPrefix 用裸字符串拼，会导致 startsWith 失配、CDN 规则整个失效；
    //      对 branch 的每一段分别 encode 以保留 `feat/foo` 这样的斜杠结构。
    const branch = config.branch || 'main';
    const encodedBranch = branch.split('/').map(encodeURIComponent).join('/');
    const expectedPrefix = `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${encodedBranch}/`;
    if (!rawUrl.startsWith(expectedPrefix)) return rawUrl;
    const path = rawUrl.slice(expectedPrefix.length);
    if (!path) return rawUrl;

    const domain = cdn.url.replace(/\/$/, '');

    return cdn.template
      .replace(/\{domain\}/g, domain)
      .replace(/\{owner\}/g, config.owner)
      .replace(/\{repo\}/g, config.repo)
      // Why: {path} 来自 encodedBranch 切割后的剩余串（已编码），{branch} 必须同样用编码值，
      //      否则模板里 `{branch}/{path}` 拼出来的 CDN URL 编码不一致，含中文/空格分支会 404。
      .replace(/\{branch\}/g, encodedBranch)
      .replace(/\{path\}/g, path)
      .replace(/\{rawUrl\}/g, rawUrl);
  }

  getPublicUrl(result: UploadResult): string {
    // URL 已在 upload 时完成转换，直接返回
    return result.url;
  }

  async testConnection(config?: GithubServiceConfig): Promise<import('../base/types').ConnectionTestResult> {
    if (!config) {
      return { success: false, error: '缺少 GitHub 配置' };
    }
    const startTime = Date.now();
    try {
      // 调用 GitHub API 验证仓库权限
      // Why: 无超时时遇上 GFW/代理 TCP 半开会挂到浏览器默认超时（分钟级），UI 卡 loading
      const response = await fetch(
        `https://api.github.com/repos/${config.owner}/${config.repo}`,
        {
          headers: { 'Authorization': `token ${config.token}`, 'User-Agent': 'PicNexus' },
          signal: AbortSignal.timeout(10_000)
        }
      );
      const latency = Date.now() - startTime;
      if (!response.ok) {
        return { success: false, latency, error: `HTTP ${response.status}` };
      }
      return { success: true, latency };
    } catch (error) {
      const latency = Date.now() - startTime;
      return {
        success: false,
        latency,
        error: getErrorMessage(error) || '连接测试失败'
      };
    }
  }
}
