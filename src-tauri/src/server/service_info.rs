// src-tauri/src/server/service_info.rs
// 一份编辑器 / 命令行图床配置对应哪个图床：/status 回给编辑器、命令行报错、软件外上传记历史共用。

use super::ServerUploadConfig;

impl ServerUploadConfig {
    /// （图床类型 ID，显示名）。
    ///
    /// WebDAV / 自定义 S3 只给类型 `webdav` / `custom_s3`，不是带档案号的完整 ID：配置里本来就没存档案号。
    /// 需要完整 ID 的地方（历史记录）由前端按设置补全，见 externalUploads.ts。
    pub fn service_info(&self) -> (&'static str, &'static str) {
        match self {
            ServerUploadConfig::Jd => ("jd", "京东图床"),
            ServerUploadConfig::Github { .. } => ("github", "GitHub"),
            ServerUploadConfig::Smms { .. } => ("smms", "SM.MS"),
            ServerUploadConfig::Imgur { .. } => ("imgur", "Imgur"),
            ServerUploadConfig::Weibo { .. } => ("weibo", "微博"),
            ServerUploadConfig::Bilibili { .. } => ("bilibili", "哔哩哔哩"),
            ServerUploadConfig::Nowcoder { .. } => ("nowcoder", "牛客"),
            ServerUploadConfig::Chaoxing { .. } => ("chaoxing", "超星"),
            ServerUploadConfig::Zhihu { .. } => ("zhihu", "知乎"),
            ServerUploadConfig::R2 { .. } => ("r2", "Cloudflare R2"),
            ServerUploadConfig::Tencent { .. } => ("tencent", "腾讯云 COS"),
            ServerUploadConfig::Aliyun { .. } => ("aliyun", "阿里云 OSS"),
            ServerUploadConfig::Qiniu { .. } => ("qiniu", "七牛云"),
            ServerUploadConfig::Upyun { .. } => ("upyun", "又拍云"),
            ServerUploadConfig::CustomS3 { .. } => ("custom_s3", "自定义 S3"),
            ServerUploadConfig::Webdav { .. } => ("webdav", "WebDAV"),
            ServerUploadConfig::Nami { .. } => ("nami", "纳米图床"),
            ServerUploadConfig::Qiyu => ("qiyu", "七鱼图床"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ServerUploadConfig;

    #[test]
    fn webdav_service_info_uses_generic_label() {
        let config = ServerUploadConfig::Webdav {
            url: "https://dav.example.com/dav".to_string(),
            username: "user".to_string(),
            password: "pw".to_string(),
            remote_path: "/images/".to_string(),
            public_domain: "https://cdn.example.com".to_string(),
            public_url_template: "{domain}/{path}".to_string(),
            lan_http_confirmed: false,
            unique_file_name: true,
        };

        assert_eq!(config.service_info(), ("webdav", "WebDAV"));
    }
}
