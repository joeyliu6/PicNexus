// 上传器统一导出和初始化

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

/**
 * 初始化所有上传器
 * 在应用启动时调用一次
 */
export function initializeUploaders(): void {
  console.log('[Uploaders] 开始注册上传器...');

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
  console.log('[Uploaders] 已注册的上传器:', registered);
}

// 导出所有上传器
export { WeiboUploader } from './weibo';
export { R2Uploader } from './r2';

export { JDUploader } from './jd';
export { NowcoderUploader } from './nowcoder';
export { QiyuUploader } from './qiyu';
export { ZhihuUploader } from './zhihu';
export { NamiUploader } from './nami';
export { BilibiliUploader } from './bilibili';
export { ChaoxingUploader } from './chaoxing';
export { SmmsUploader } from './smms';
export { GithubUploader } from './github';
export { ImgurUploader } from './imgur';
export { TencentUploader } from './tencent';
export { AliyunUploader } from './aliyun';
export { QiniuUploader } from './qiniu';
export { UpyunUploader } from './upyun';
export { UploaderFactory } from './base/UploaderFactory';

