import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';

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

    const rustResult = await this.uploadViaRust(
      filePath,
      {
        githubToken: options.config.token,
        owner: options.config.owner,
        repo: options.config.repo,
        branch: options.config.branch || 'main',
        path: options.config.path || 'images/'
      },
      onProgress
    ) as GithubRustResult;

    this.log('info', 'GitHub 上传成功', { url: rustResult.url });

    return {
      serviceId: 'github',
      fileKey: rustResult.sha || rustResult.remotePath || rustResult.url,
      url: rustResult.url,
      metadata: {
        sha: rustResult.sha,
        remotePath: rustResult.remotePath
      }
    };
  }

  getPublicUrl(result: UploadResult): string {
    if (result.metadata?.remotePath) {
      return `https://raw.githubusercontent.com/${result.metadata.owner}/${result.metadata.repo}/${result.metadata.branch}/${result.metadata.remotePath}`;
    }
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
