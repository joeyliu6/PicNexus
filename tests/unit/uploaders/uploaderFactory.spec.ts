import { describe, it, expect, beforeEach } from 'vitest';
import { UploaderFactory } from '@/uploaders/base/UploaderFactory';
import { createMockUploader } from '../helpers/factories';

describe('UploaderFactory', () => {
  beforeEach(() => {
    UploaderFactory.clear();
  });

  // ─── register ──────────────────────────────────────────

  describe('register', () => {
    it('成功注册上传器', () => {
      UploaderFactory.register('test', () => createMockUploader({ serviceId: 'test' }));
      expect(UploaderFactory.isRegistered('test')).toBe(true);
    });

    it('空服务 ID 抛出错误', () => {
      expect(() => {
        UploaderFactory.register('', () => createMockUploader());
      }).toThrow('服务 ID 不能为空');
    });

    it('空白服务 ID 抛出错误', () => {
      expect(() => {
        UploaderFactory.register('   ', () => createMockUploader());
      }).toThrow('服务 ID 不能为空');
    });

    it('重复注册覆盖已有服务', () => {
      UploaderFactory.register('test', () => createMockUploader({ url: 'https://old.com' }));
      UploaderFactory.register('test', () => createMockUploader({ url: 'https://new.com' }));

      const uploader = UploaderFactory.create('test');
      expect(uploader.getPublicUrl({} as never)).toBe('https://new.com');
    });
  });

  // ─── create ────────────────────────────────────────────

  describe('create', () => {
    it('创建已注册的上传器实例', () => {
      UploaderFactory.register('weibo', () => createMockUploader({ serviceId: 'weibo', serviceName: '微博' }));

      const uploader = UploaderFactory.create('weibo');
      expect(uploader.serviceId).toBe('weibo');
      expect(uploader.serviceName).toBe('微博');
    });

    it('创建未注册服务时抛出错误', () => {
      expect(() => {
        UploaderFactory.create('nonexistent');
      }).toThrow('未知的图床服务: "nonexistent"');
    });

    it('错误信息中列出可用服务', () => {
      UploaderFactory.register('a', () => createMockUploader());
      UploaderFactory.register('b', () => createMockUploader());

      expect(() => {
        UploaderFactory.create('c');
      }).toThrow(/可用服务: a, b/);
    });

    it('工厂函数抛出错误时包装错误信息', () => {
      UploaderFactory.register('broken', () => {
        throw new Error('初始化失败');
      });

      expect(() => {
        UploaderFactory.create('broken');
      }).toThrow(/创建上传器 "broken" 失败/);
    });
  });

  // ─── getAvailableServices ─────────────────────────────

  describe('getAvailableServices', () => {
    it('返回所有已注册服务 ID', () => {
      UploaderFactory.register('weibo', () => createMockUploader());
      UploaderFactory.register('r2', () => createMockUploader());

      const services = UploaderFactory.getAvailableServices();
      expect(services).toContain('weibo');
      expect(services).toContain('r2');
      expect(services).toHaveLength(2);
    });

    it('无注册服务时返回空数组', () => {
      expect(UploaderFactory.getAvailableServices()).toEqual([]);
    });
  });

  // ─── isRegistered ─────────────────────────────────────

  describe('isRegistered', () => {
    it('已注册返回 true', () => {
      UploaderFactory.register('test', () => createMockUploader());
      expect(UploaderFactory.isRegistered('test')).toBe(true);
    });

    it('未注册返回 false', () => {
      expect(UploaderFactory.isRegistered('none')).toBe(false);
    });
  });

  // ─── unregister ───────────────────────────────────────

  describe('unregister', () => {
    it('注销已注册服务返回 true', () => {
      UploaderFactory.register('test', () => createMockUploader());
      expect(UploaderFactory.unregister('test')).toBe(true);
      expect(UploaderFactory.isRegistered('test')).toBe(false);
    });

    it('注销未注册服务返回 false', () => {
      expect(UploaderFactory.unregister('none')).toBe(false);
    });
  });

  // ─── clear ────────────────────────────────────────────

  describe('clear', () => {
    it('清空所有注册', () => {
      UploaderFactory.register('a', () => createMockUploader());
      UploaderFactory.register('b', () => createMockUploader());

      UploaderFactory.clear();
      expect(UploaderFactory.getAvailableServices()).toEqual([]);
    });
  });

  // ─── getRegistrySnapshot ──────────────────────────────

  describe('getRegistrySnapshot', () => {
    it('返回服务 ID 到名称的映射', () => {
      UploaderFactory.register('weibo', () => createMockUploader({ serviceName: '微博' }));
      UploaderFactory.register('r2', () => createMockUploader({ serviceName: 'R2' }));

      const snapshot = UploaderFactory.getRegistrySnapshot();
      expect(snapshot.get('weibo')).toBe('微博');
      expect(snapshot.get('r2')).toBe('R2');
    });

    it('工厂函数异常时标记为创建失败', () => {
      UploaderFactory.register('broken', () => {
        throw new Error('boom');
      });

      const snapshot = UploaderFactory.getRegistrySnapshot();
      expect(snapshot.get('broken')).toBe('(创建失败)');
    });
  });
});
