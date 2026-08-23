import { describe, expect, it } from 'vitest';
import { formatUpdateFailure } from '@/utils/updateFailureMessage';

/**
 * 用例里的原始错误串都取自权威来源，不是编的：
 * - `tauri-plugin-updater-2.10.0/src/error.rs` 的 `#[error(...)]` 文案
 * - 透传变体按底层库的 Display：reqwest 0.11/0.12、minisign-verify 0.2.5
 */
describe('formatUpdateFailure', () => {
  describe('网络类', () => {
    it('reqwest 0.11 带 URL 的连接失败 → 连不上更新服务器（用户实际遇到的那条）', () => {
      const raw = 'error sending request for url (https://github.com/joeyliu6/PicNexus/releases/latest/download/latest.json)';
      const text = formatUpdateFailure('check', raw);

      expect(text.title).toBe('连不上更新服务器');
      expect(text.hint).toContain('手动下载');
      // 关键回归：翻译后的文案里不能再出现英文原文或长 URL
      expect(text.hint).not.toContain('error sending request');
      expect(text.hint).not.toContain('https://');
    });

    it('reqwest 0.12 不带 URL 的连接失败同样命中', () => {
      expect(formatUpdateFailure('check', 'error sending request').title).toBe('连不上更新服务器');
    });

    it('超时归入网络类（reqwest 顶层 Display 不含 timeout，这里兜的是其它来源）', () => {
      expect(formatUpdateFailure('check', 'operation timed out').title).toBe('连不上更新服务器');
    });

    it('同一个网络错误在下载阶段换一套措辞', () => {
      const text = formatUpdateFailure('download', 'error sending request for url (https://example.com/a.exe)');

      expect(text.title).toBe('更新包下载中断');
      expect(text.hint).toContain('重新下载');
    });
  });

  describe('签名类', () => {
    it('minisign 校验失败 → 更新包校验未通过，且不劝用户重试', () => {
      const text = formatUpdateFailure('download', 'The signature verification failed');

      expect(text.title).toBe('更新包校验未通过');
      expect(text.hint).toContain('已中止');
      expect(text.hint).not.toContain('重试');
    });

    it('签名 base64 解码失败也归签名类', () => {
      const raw = 'The signature xxx could not be decoded, please check if it is a valid base64 string.';
      expect(formatUpdateFailure('download', raw).title).toBe('更新包校验未通过');
    });

    it('latest.json 少了 signature 字段属于发布配置问题，不能报成"包被篡改"', () => {
      const text = formatUpdateFailure('check', 'missing field `signature` at line 1 column 120');

      expect(text.title).toBe('暂时读不到更新信息');
    });
  });

  describe('更新信息解析类', () => {
    it('ReleaseNotFound → 暂时读不到更新信息', () => {
      const text = formatUpdateFailure('check', 'Could not fetch a valid release JSON from the remote');

      expect(text.title).toBe('暂时读不到更新信息');
      expect(text.hint).toContain('手动下载');
    });

    it('JSON 解析失败同样归此类', () => {
      expect(formatUpdateFailure('check', 'expected value at line 1 column 1').title)
        .toBe('暂时读不到更新信息');
    });
  });

  describe('平台类', () => {
    it('TargetNotFound → 当前系统暂无更新包', () => {
      const raw = 'the platform `windows-x86_64` was not found in the response `platforms` object';
      expect(formatUpdateFailure('check', raw).title).toBe('当前系统暂无更新包');
    });

    it('UnsupportedArch 同样归平台类', () => {
      const raw = 'Unsupported application architecture, expected one of `x86`, `x86_64`, `arm` or `aarch64`.';
      expect(formatUpdateFailure('check', raw).title).toBe('当前系统暂无更新包');
    });
  });

  describe('HTTP 状态类', () => {
    it('下载返回非 2xx → 把状态码摆到提示里', () => {
      const text = formatUpdateFailure('download', 'Download request failed with status: 404 Not Found');

      expect(text.title).toBe('更新包下载失败');
      expect(text.hint).toContain('404 Not Found');
    });

    it('抠不出状态码时退回泛化说法', () => {
      const text = formatUpdateFailure('download', 'Download request failed with status: unknown');

      expect(text.title).toBe('更新包下载失败');
      expect(text.hint).toContain('拒绝了下载请求');
    });
  });

  describe('权限与安装类', () => {
    it('os error 5 优先判成权限问题，不被安装规则吃掉', () => {
      const text = formatUpdateFailure('download', 'Access is denied. (os error 5)');

      expect(text.title).toBe('没有权限完成更新安装');
      expect(text.hint).toContain('管理员');
    });

    it('中文系统的"拒绝访问"同样命中权限类', () => {
      expect(formatUpdateFailure('download', '拒绝访问。 (os error 5)').title)
        .toBe('没有权限完成更新安装');
    });

    it('AuthenticationFailed（用户取消提权）归权限类', () => {
      expect(formatUpdateFailure('download', 'Authentication failed or was cancelled').title)
        .toBe('没有权限完成更新安装');
    });

    it('PackageInstallFailed → 更新安装失败', () => {
      const text = formatUpdateFailure('download', 'Failed to install package');

      expect(text.title).toBe('更新安装失败');
      expect(text.hint).toContain('关闭正在运行的 PicNexus');
    });
  });

  describe('配置类', () => {
    it('EmptyEndpoints → 明确告诉用户重试没用', () => {
      const text = formatUpdateFailure('check', 'Updater does not have any endpoints set.');

      expect(text.title).toBe('更新功能未正确配置');
      expect(text.hint).toContain('重试无效');
    });

    it('endpoint 协议不安全同样归配置类', () => {
      const raw = 'The configured updater endpoint must use a secure protocol like `https`.';
      expect(formatUpdateFailure('check', raw).title).toBe('更新功能未正确配置');
    });
  });

  describe('兜底', () => {
    it('认不出的错误按阶段退回泛化文案', () => {
      expect(formatUpdateFailure('check', 'something totally unexpected').title).toBe('检查更新失败');
      expect(formatUpdateFailure('download', 'something totally unexpected').title).toBe('下载更新失败');
    });

    it('空错误也给得出可读文案，不会渲染成空白', () => {
      const text = formatUpdateFailure('check', '');

      expect(text.title).toBe('检查更新失败');
      expect(text.hint).not.toBe('');
    });
  });
});
