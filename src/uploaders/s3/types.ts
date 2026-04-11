// S3 兼容上传器的共享类型定义

/**
 * S3 兼容上传器配置的类型上界约束。
 *
 * 故意保持最宽松（`object` 表示任意非原始类型），因为 6 家 S3
 * （Qiniu / Upyun / Tencent / Aliyun / R2 / CustomS3）的访问密钥字段名完全不统一
 * （secretId / accessKeyId / accessKey / operator / secretAccessKey），
 * 这些字段必须由各派生类自己的 abstract getter 提取，基类无法统一声明公共字段。
 *
 * 用 `object` 作为上界约束可以兼容所有 6 家 S3 的 Config 类型
 * （包括不继承 BaseServiceConfig 的 CustomS3Profile）。
 */
export type S3BaseConfig = object;
