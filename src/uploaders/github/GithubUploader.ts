import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';
import { transformGithubUrl, parseGithubRawUrl } from '../../utils/githubCdn';
import type { GithubServiceConfig } from '../../config/types';

interface GithubRustResult {
  url: string;
  sha?: string;
  remotePath?: string;
}

export class GithubUploader extends BaseUploader {
  readonly serviceId = 'github';
  readonly serviceName = 'GitHub';

  protected getRustCommand(): string {
    return 'upload_to_github';
  }

  async validateConfig(config: any): Promise<ValidationResult> {
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
    const strategy = config.urlStrategy;

    if (strategy) {
      if (strategy.type === 'custom-domain' && strategy.customDomain) {
        const parts = parseGithubRawUrl(rawUrl);
        if (parts) {
          const domain = strategy.customDomain.replace(/\/$/, '');
          return `${domain}/${parts.path}`;
        }
      }
      if (strategy.type === 'cdn') {
        return transformGithubUrl(rawUrl, {
          enabled: true,
          selectedIndex: strategy.selectedCdnIndex,
          cdnList: strategy.cdnList
        });
      }
      return rawUrl;
    }

    // 向后兼容：未迁移的旧配置
    if (config.customDomain) {
      const parts = parseGithubRawUrl(rawUrl);
      if (parts) {
        const domain = config.customDomain.replace(/\/$/, '');
        return `${domain}/${parts.path}`;
      }
    }
    return transformGithubUrl(rawUrl, config.cdnConfig);
  }

  getPublicUrl(result: UploadResult): string {
    // URL 已在 upload 时完成转换，直接返回
    return result.url;
  }

  async testConnection(config: any): Promise<import('../base/types').ConnectionTestResult> {
    const startTime = Date.now();
    try {
      // 调用 GitHub API 验证仓库权限
      const response = await fetch(
        `https://api.github.com/repos/${config.owner}/${config.repo}`,
        { headers: { 'Authorization': `token ${config.token}`, 'User-Agent': 'PicNexus' } }
      );
      const latency = Date.now() - startTime;
      if (!response.ok) {
        return { success: false, latency, error: `HTTP ${response.status}` };
      }
      return { success: true, latency };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      return {
        success: false,
        latency,
        error: error.message || '连接测试失败'
      };
    }
  }
}
