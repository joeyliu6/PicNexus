// 上传器注册：启动时注册内建图床，多份图床（自定义 S3 / WebDAV）按 profile 列表重建

import { UploaderFactory } from './base/UploaderFactory';
import { WeiboUploader } from './weibo/WeiboUploader';
import { R2Uploader } from './r2/R2Uploader';

import { JDUploader } from './jd/JDUploader';
import { NowcoderUploader } from './nowcoder/NowcoderUploader';
import { QiyuUploader } from './qiyu/QiyuUploader';
import { ZhihuUploader } from './zhihu/ZhihuUploader';
import { NamiUploader } from './nami/NamiUploader';
import { BilibiliUploader } from './bilibili/BilibiliUploader';
import { ChaoxingUploader } from './chaoxing/ChaoxingUploader';
import { SmmsUploader } from './smms/SmmsUploader';
import { GithubUploader } from './github/GithubUploader';
import { ImgurUploader } from './imgur/ImgurUploader';
import { TencentUploader } from './tencent/TencentUploader';
import { AliyunUploader } from './aliyun/AliyunUploader';
import { QiniuUploader } from './qiniu/QiniuUploader';
import { UpyunUploader } from './upyun/UpyunUploader';
import { CustomS3Uploader } from './custom-s3/CustomS3Uploader';
import { WebDAVUploader } from './webdav/WebDAVUploader';
import type { CustomS3Profile, WebDAVStorageProfile } from '@/config/types';
import { createLogger } from '@/utils/logger';

const log = createLogger('Uploaders');

/**
 * 初始化所有上传器
 * 在应用启动时调用一次
 */
export function initializeUploaders(): void {
  log.info('开始注册上传器...');

  // 注册微博上传器
  UploaderFactory.register('weibo', () => new WeiboUploader());

  // 注册 R2 上传器
  UploaderFactory.register('r2', () => new R2Uploader());



  // 注册京东上传器
  UploaderFactory.register('jd', () => new JDUploader());

  // 注册牛客上传器
  UploaderFactory.register('nowcoder', () => new NowcoderUploader());

  // 注册七鱼上传器
  UploaderFactory.register('qiyu', () => new QiyuUploader());

  // 注册知乎上传器
  UploaderFactory.register('zhihu', () => new ZhihuUploader());

  // 注册纳米上传器
  UploaderFactory.register('nami', () => new NamiUploader());

  // 注册哔哩哔哩上传器
  UploaderFactory.register('bilibili', () => new BilibiliUploader());

  // 注册超星上传器
  UploaderFactory.register('chaoxing', () => new ChaoxingUploader());

  // 注册 SM.MS 上传器
  UploaderFactory.register('smms', () => new SmmsUploader());

  // 注册 GitHub 上传器
  UploaderFactory.register('github', () => new GithubUploader());

  // 注册 Imgur 上传器
  UploaderFactory.register('imgur', () => new ImgurUploader());

  // 注册腾讯云上传器
  UploaderFactory.register('tencent', () => new TencentUploader());

  // 注册阿里云上传器
  UploaderFactory.register('aliyun', () => new AliyunUploader());

  // 注册七牛云上传器
  UploaderFactory.register('qiniu', () => new QiniuUploader());

  // 注册又拍云上传器
  UploaderFactory.register('upyun', () => new UpyunUploader());

  const registered = UploaderFactory.getAvailableServices();
  log.info('已注册的上传器:', registered);
}

/**
 * 同步自定义 S3 上传器注册
 * 根据 profiles 列表注册/注销对应的上传器实例
 */
export function syncCustomS3Uploaders(profiles: CustomS3Profile[]): void {
  // 先清理旧的 custom_s3:xxx 注册
  for (const id of UploaderFactory.getAvailableServices()) {
    if (id.startsWith('custom_s3:')) {
      UploaderFactory.unregister(id);
    }
  }
  // 为每个 profile 注册上传器
  for (const profile of profiles) {
    UploaderFactory.register(`custom_s3:${profile.id}`, () => new CustomS3Uploader());
  }
}

/**
 * 同步 WebDAV 图床上传器注册
 * 根据 profiles 列表注册/注销对应的上传器实例
 */
export function syncWebDAVUploaders(profiles: WebDAVStorageProfile[]): void {
  // 先清理旧的 webdav:xxx 注册
  for (const id of UploaderFactory.getAvailableServices()) {
    if (id.startsWith('webdav:')) {
      UploaderFactory.unregister(id);
    }
  }
  // 为每个 profile 注册上传器
  for (const profile of profiles) {
    UploaderFactory.register(`webdav:${profile.id}`, () => new WebDAVUploader());
  }
}
