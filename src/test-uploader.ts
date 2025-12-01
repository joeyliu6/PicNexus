/**
 * 上传器测试工具
 * 用于测试新架构的微博和 R2 上传功能
 *
 * ⚠️ 注意：此测试文件使用已弃用的 UploadOrchestrator API
 * 实际测试请使用 MultiServiceUploader
 *
 * 使用方法：
 * 1. 在浏览器控制台中导入此模块
 * 2. 调用测试函数
 *
 * 示例：
 * import { testWeiboUpload, testR2Upload, testFullFlow } from './test-uploader';
 * await testWeiboUpload('/path/to/image.jpg');
 *
 * @deprecated 请参考 main.ts 中 MultiServiceUploader 的实际用法
 * @ts-nocheck - 此文件为测试代码，暂时忽略类型检查
 */

import { WeiboUploader } from './uploaders/weibo';
import { R2Uploader } from './uploaders/r2';
import { UploadOrchestrator } from './core';
import { Store } from './store';
import { UserConfig } from './config/types';

/**
 * 测试微博上传
 */
export async function testWeiboUpload(filePath: string): Promise<void> {
  console.log('=== 测试微博上传 ===');

  try {
    // 1. 创建微博上传器
    const uploader = new WeiboUploader();
    console.log('✓ 微博上传器已创建');

    // 2. 读取配置
    const configStore = new Store('.settings.dat');
    const config = await configStore.get<UserConfig>('config');

    if (!config?.services?.weibo?.cookie) {
      throw new Error('未配置微博 Cookie，请先在设置中配置');
    }

    // 3. 验证配置
    const validation = await uploader.validateConfig(config.services.weibo);
    console.log('✓ 配置验证:', validation);

    if (!validation.valid) {
      throw new Error(`配置无效: ${validation.errors?.join(', ')}`);
    }

    // 4. 上传文件
    console.log('开始上传:', filePath);

    const result = await uploader.upload(
      filePath,
      { config: config.services.weibo },
      (percent) => {
        console.log(`上传进度: ${percent}%`);
      }
    );

    console.log('✓ 上传成功!');
    console.log('  - 服务: ', result.serviceId);
    console.log('  - PID: ', result.fileKey);
    console.log('  - URL: ', result.url);
    console.log('  - 大小: ', result.size, 'bytes');
    console.log('  - 尺寸: ', result.width, 'x', result.height);

    return result;
  } catch (error) {
    console.error('✗ 测试失败:', error);
    throw error;
  }
}

/**
 * 测试 R2 上传
 */
export async function testR2Upload(filePath: string): Promise<void> {
  console.log('=== 测试 R2 上传 ===');

  try {
    // 1. 创建 R2 上传器
    const uploader = new R2Uploader();
    console.log('✓ R2 上传器已创建');

    // 2. 读取配置
    const configStore = new Store('.settings.dat');
    const config = await configStore.get<UserConfig>('config');

    if (!config?.services?.r2) {
      throw new Error('未配置 R2，请先在设置中配置');
    }

    // 3. 验证配置
    const validation = await uploader.validateConfig(config.services.r2);
    console.log('✓ 配置验证:', validation);

    if (!validation.valid) {
      throw new Error(`配置无效: ${validation.errors?.join(', ')}`);
    }

    // 4. 上传文件
    console.log('开始上传:', filePath);

    const result = await uploader.upload(
      filePath,
      { config: config.services.r2 },
      (percent) => {
        console.log(`上传进度: ${percent}%`);
      }
    );

    console.log('✓ 上传成功!');
    console.log('  - 服务: ', result.serviceId);
    console.log('  - Key: ', result.fileKey);
    console.log('  - URL: ', result.url);
    console.log('  - 大小: ', result.size, 'bytes');

    return result;
  } catch (error) {
    console.error('✗ 测试失败:', error);
    throw error;
  }
}

/**
 * 测试完整上传流程（使用 UploadOrchestrator）
 */
export async function testFullFlow(filePath: string, primaryService: 'weibo' | 'r2' = 'weibo'): Promise<void> {
  console.log('=== 测试完整上传流程 ===');
  console.log('主力图床:', primaryService);

  try {
    // 1. 创建上传调度器
    const orchestrator = new UploadOrchestrator();
    console.log('✓ 上传调度器已创建');

    // 2. 读取配置
    const configStore = new Store('.settings.dat');
    let config = await configStore.get<UserConfig>('config');

    if (!config) {
      throw new Error('未找到配置');
    }

    // 3. 设置主力图床
    config = { ...config, primaryService };

    // 4. 上传文件
    console.log('开始上传:', filePath);

    const historyItem = await orchestrator.uploadFile(
      filePath,
      config,
      (percent) => {
        console.log(`上传进度: ${percent}%`);
      }
    );

    console.log('✓ 上传成功!');
    console.log('  - ID: ', historyItem.id);
    console.log('  - 文件名: ', historyItem.localFileName);
    console.log('  - 主力服务: ', historyItem.primaryService);
    console.log('  - 主力结果: ', historyItem.primaryResult);
    console.log('  - 生成链接: ', historyItem.generatedLink);

    if (historyItem.backups) {
      console.log('  - 备份结果: ', historyItem.backups);
    }

    return historyItem;
  } catch (error) {
    console.error('✗ 测试失败:', error);
    throw error;
  }
}

/**
 * 测试微博到 R2 的备份流程
 */
export async function testWeiboWithR2Backup(filePath: string): Promise<void> {
  console.log('=== 测试微博 + R2 备份 ===');

  try {
    const orchestrator = new UploadOrchestrator();
    const configStore = new Store('.settings.dat');
    let config = await configStore.get<UserConfig>('config');

    if (!config) {
      throw new Error('未找到配置');
    }

    // 配置：主力微博，备份 R2
    config = {
      ...config,
      primaryService: 'weibo',
      backup: {
        enabled: true,
        services: ['r2']
      }
    };

    console.log('配置: 主力=微博, 备份=R2');

    const historyItem = await orchestrator.uploadFile(filePath, config);

    console.log('✓ 上传成功!');
    console.log('  - 主力 (微博): ', historyItem.primaryResult.url);
    console.log('  - 生成链接: ', historyItem.generatedLink);

    // 等待备份完成
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 重新读取历史记录（备份是异步的）
    const historyStore = new Store('.history.dat');
    const history = await historyStore.get<any[]>('uploads', []);
    const updatedItem = history.find(h => h.id === historyItem.id);

    if (updatedItem?.backups) {
      console.log('  - 备份结果: ', updatedItem.backups);
    }

    return updatedItem || historyItem;
  } catch (error) {
    console.error('✗ 测试失败:', error);
    throw error;
  }
}

/**
 * 测试配置验证
 */
export async function testConfigValidation(): Promise<void> {
  console.log('=== 测试配置验证 ===');

  const weiboUploader = new WeiboUploader();
  const r2Uploader = new R2Uploader();

  // 测试空配置
  console.log('\n测试 1: 空微博配置');
  const result1 = await weiboUploader.validateConfig({ enabled: true, cookie: '' });
  console.log('  结果:', result1);

  // 测试有效配置
  console.log('\n测试 2: 有效微博配置');
  const result2 = await weiboUploader.validateConfig({ enabled: true, cookie: 'valid_cookie' });
  console.log('  结果:', result2);

  // 测试不完整的 R2 配置
  console.log('\n测试 3: 不完整的 R2 配置');
  const result3 = await r2Uploader.validateConfig({
    enabled: true,
    accountId: '',
    accessKeyId: '',
    secretAccessKey: '',
    bucketName: '',
    path: '',
    publicDomain: ''
  });
  console.log('  结果:', result3);

  // 测试完整的 R2 配置
  console.log('\n测试 4: 完整的 R2 配置');
  const result4 = await r2Uploader.validateConfig({
    enabled: true,
    accountId: 'test',
    accessKeyId: 'test',
    secretAccessKey: 'test',
    bucketName: 'test',
    path: 'images/',
    publicDomain: 'https://cdn.example.com'
  });
  console.log('  结果:', result4);

  console.log('\n✓ 配置验证测试完成');
}

/**
 * 显示当前注册的上传器
 */
export async function showRegisteredUploaders(): Promise<void> {
  const { UploaderFactory } = await import('./uploaders/base/UploaderFactory');

  console.log('=== 已注册的上传器 ===');

  const services = UploaderFactory.getAvailableServices();
  console.log('可用服务:', services);

  for (const serviceId of services) {
    try {
      const uploader = UploaderFactory.create(serviceId);
      console.log(`  - ${serviceId}: ${uploader.serviceName}`);
    } catch (error) {
      console.error(`  - ${serviceId}: 创建失败`, error);
    }
  }
}

// 导出到全局对象（方便在控制台中使用）
if (typeof window !== 'undefined') {
  (window as any).testUploader = {
    testWeiboUpload,
    testR2Upload,
    testFullFlow,
    testWeiboWithR2Backup,
    testConfigValidation,
    showRegisteredUploaders
  };

  console.log('测试工具已加载！使用方法:');
  console.log('  window.testUploader.testWeiboUpload("/path/to/image.jpg")');
  console.log('  window.testUploader.testR2Upload("/path/to/image.jpg")');
  console.log('  window.testUploader.testFullFlow("/path/to/image.jpg", "weibo")');
  console.log('  window.testUploader.showRegisteredUploaders()');
}
