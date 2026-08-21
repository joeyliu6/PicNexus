// src-tauri/src/commands/s3_compatible.rs
// S3 兼容存储通用上传模块
// 支持腾讯云 COS、阿里云 OSS、七牛云、又拍云

use aws_sdk_s3::config::{Credentials, Region};
use aws_sdk_s3::error::{DisplayErrorContext, ProvideErrorMetadata};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::{Client, Config};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Window};
use tokio::time::{timeout, Duration};

use super::utils::{guess_object_content_type, probe_upload_file_size};
use crate::error::AppError;
use crate::log_utils::safe_path;

// ==================== 常量 ====================

/// S3 操作默认超时时间（秒）
const S3_OPERATION_TIMEOUT_SECS: u64 = 30;

/// 又拍云 S3 兼容端点
///
/// 与前端 `src/uploaders/upyun/UpyunUploader.ts` 的同名常量由
/// `scripts/check-cross-language-constants.mjs` 钉住必须逐字一致：GUI 上传由前端把
/// endpoint 传进 `upload_to_s3_compatible`，而「测试连接」由这里自己拼。两边一旦漂移，
/// 测试连接验的就不是上传真正会去的那台服务器，绿灯重新退化成没有意义的绿灯。
const UPYUN_S3_ENDPOINT: &str = "https://s3.api.upyun.com";

/// 又拍云 SigV4 签名用的 region
///
/// 又拍云文档称不支持配置区域，但 region 仍参与签名计算，两侧必须填同一个值。
/// 同样由跨语言常量守卫钉住，理由见 `UPYUN_S3_ENDPOINT`。
const UPYUN_S3_REGION: &str = "upyun";

/// S3 兼容上传结果
#[derive(Debug, Serialize, Deserialize)]
pub struct S3UploadResult {
    pub url: String,
    pub key: String,
}

/// 创建 S3 客户端（内部复用函数）
fn create_s3_client(endpoint: &str, access_key: &str, secret_key: &str, region: &str) -> Client {
    let credentials = Credentials::new(access_key, secret_key, None, None, "PicNexus");

    let config = Config::builder()
        .endpoint_url(endpoint)
        .region(Region::new(region.to_string()))
        .credentials_provider(credentials)
        .force_path_style(true)
        .build();

    Client::from_conf(config)
}

fn validate_https_endpoint(endpoint: &str) -> Result<(), AppError> {
    let parsed = url::Url::parse(endpoint)
        .map_err(|_| AppError::config("Endpoint 不是合法的 URL，请输入完整的 https://... 地址"))?;
    if parsed.scheme() != "https" {
        return Err(AppError::config(
            "外部 S3 Endpoint 仅支持 HTTPS，请改用 https:// 地址",
        ));
    }
    Ok(())
}

/// 校验公开访问域名；明文 HTTP 只在用户已对**该主机名**显式确认时放行
///
/// Why 收的是主机名而不是 bool：确认必须跟着域名走。存 bool 的话，用户确认了
/// `http://a.example` 之后改成 `http://b.example`，那个 true 会原样留下，
/// 等于给新域名发了一张没人审过的通行证。前端 `HttpDomainConfirmable` 存的也是主机名，
/// 两侧用同一判据，任何一侧漏了另一侧都还拦得住。
///
/// Why 允许明文 HTTP：又拍云一类图床根本给不出 HTTPS——免费测试域名只有 HTTP，
/// 要 HTTPS 必须绑自有域名而绑域名要备案。一刀切拒绝的结果是这些图床整个不可用。
/// 详见 `docs/audits/upyun-http-domain-2026-08-19.md`。
///
/// Endpoint 不吃这条逃生舱（见 `validate_https_endpoint`）：那条请求带着 AK/SK 签名，
/// 明文传输等于把凭证摊在链路上；公开域名只是取图，风险量级不同。
fn validate_public_domain(public_domain: &str, confirmed_for: Option<&str>) -> Result<(), AppError> {
    let public_domain = public_domain.trim();
    if public_domain.is_empty() {
        return Ok(());
    }

    let parsed = url::Url::parse(public_domain)
        .map_err(|_| AppError::config("公开访问域名不是合法的 URL，请输入完整的 https://... 地址"))?;
    if parsed.scheme() == "https" {
        return Ok(());
    }

    if parsed.scheme() == "http" {
        let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
        let confirmed = confirmed_for.unwrap_or_default().trim().to_ascii_lowercase();
        if !host.is_empty() && host == confirmed {
            return Ok(());
        }
        return Err(AppError::config(
            "公开访问域名是明文 HTTP，需要先在设置页「测试连接」里确认一次才能使用",
        ));
    }

    Err(AppError::config("公开访问域名仅支持 HTTPS，请改用 https:// 地址"))
}

/// 上传文件到 S3 兼容存储
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri IPC 参数与 S3 兼容配置字段一致，避免大改前端调用。
pub async fn upload_to_s3_compatible(
    window: Window,
    id: String,
    file_path: String,
    endpoint: String,
    access_key: String,
    secret_key: String,
    region: String,
    bucket: String,
    key: String,
    public_domain: String,
    // 用户已确认可走明文 HTTP 的主机名；None = 未确认（fail-closed）
    http_domain_confirmed_for: Option<String>,
) -> Result<S3UploadResult, AppError> {
    log::info!("[S3兼容] 开始上传文件: {}", safe_path(&file_path));
    validate_https_endpoint(&endpoint)?;
    validate_public_domain(&public_domain, http_domain_confirmed_for.as_deref())?;

    // 发送进度: 0% - 读取文件
    let _ = window.emit(
        "upload://progress",
        serde_json::json!({
            "id": id,
            "progress": 0,
            "total": 100,
            "step": "读取文件...",
            "step_index": 1,
            "total_steps": 3
        }),
    );

    // 1. 检查文件大小（不读内容）
    let file_size = probe_upload_file_size(&file_path, 50 * 1024 * 1024).await?;

    log::debug!("[S3兼容] 文件大小: {} bytes", file_size);

    // 发送进度: 33% - 创建客户端
    let _ = window.emit(
        "upload://progress",
        serde_json::json!({
            "id": id,
            "progress": 33,
            "total": 100,
            "step": "创建客户端...",
            "step_index": 2,
            "total_steps": 3
        }),
    );

    // 2. 创建 S3 客户端
    let client = create_s3_client(&endpoint, &access_key, &secret_key, &region);

    // 发送进度: 66% - 正在上传
    let _ = window.emit(
        "upload://progress",
        serde_json::json!({
            "id": id,
            "progress": 66,
            "total": 100,
            "step": "正在上传...",
            "step_index": 3,
            "total_steps": 3
        }),
    );

    // 3. 上传文件（带超时保护）
    //
    // Why: 用 ByteStream::from_path 而非把整份文件读进 Vec<u8>——SDK 会按需从磁盘读取
    // 并自动带上 Content-Length，避免多图床并发时每个服务各持有一份完整文件副本。
    let body = ByteStream::from_path(&file_path)
        .await
        .map_err(|e| AppError::file_io(format!("读取文件失败: {}", e)))?;

    let content_type = guess_object_content_type(&file_path);
    log::debug!("[S3兼容] Content-Type: {}", content_type);

    timeout(
        Duration::from_secs(S3_OPERATION_TIMEOUT_SECS * 2), // 上传操作给予更长超时
        client
            .put_object()
            .bucket(&bucket)
            .key(&key)
            .body(body)
            .content_type(&content_type)
            .send(),
    )
    .await
    .map_err(|_| {
        AppError::upload(
            "S3兼容",
            format!("上传超时 ({}秒)", S3_OPERATION_TIMEOUT_SECS * 2),
        )
    })?
    // 同样要摊平错误链，不能直接 Display——否则每个图床上传失败都只说
    // 「service error」，用户既不知道是密钥不对还是桶不存在。理由见 describe_sdk_error。
    .map_err(|e| {
        let described = describe_sdk_error(&e);
        log::error!("[S3兼容] 上传失败: {}", described.full);
        AppError::upload("S3兼容", format!("上传失败: {}", described.brief))
    })?;

    log::info!("[S3兼容] 上传成功 - Key: {}", key);

    // 4. 构建公开访问 URL
    let url = if public_domain.is_empty() {
        format!("{}/{}/{}", endpoint, bucket, key)
    } else {
        // 移除 public_domain 末尾的斜杠
        let domain = public_domain.trim().trim_end_matches('/');
        format!("{}/{}", domain, key)
    };

    Ok(S3UploadResult { url, key })
}

/// S3 兼容存储测试配置
/// 支持多种字段名映射，兼容不同云服务商的配置格式
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3TestConfig {
    // R2 专用
    pub account_id: Option<String>,
    // 通用 access key（支持多种命名）
    pub access_key_id: Option<String>,
    pub secret_id: Option<String>,
    pub access_key: Option<String>,
    pub operator: Option<String>,
    // 通用 secret key（支持多种命名）
    pub secret_access_key: Option<String>,
    pub secret_key: Option<String>,
    pub access_key_secret: Option<String>,
    pub password: Option<String>,
    // 又拍云专用：控制台「操作员授权 → S3 访问凭证」单独生成的那一对
    //
    // Why 不并进上面的通用取值链：那条链是「同一把钥匙的不同叫法」，谁先命中都一样；
    // 又拍云这两个字段是**另一把钥匙**，混进去会让 REST 链路拿到 S3 凭证去做 Basic Auth。
    pub s3_access_key: Option<String>,
    pub s3_secret_key: Option<String>,
    // bucket
    pub bucket_name: Option<String>,
    pub bucket: Option<String>,
    // region
    pub region: Option<String>,
    // 自定义 S3 端点（custom_s3 专用）
    pub endpoint: Option<String>,
}

impl S3TestConfig {
    fn get_access_key(&self) -> Option<String> {
        self.access_key_id
            .clone()
            .or_else(|| self.secret_id.clone())
            .or_else(|| self.access_key.clone())
            .or_else(|| self.operator.clone())
    }

    fn get_secret_key(&self) -> Option<String> {
        self.secret_access_key
            .clone()
            .or_else(|| self.secret_key.clone())
            .or_else(|| self.access_key_secret.clone())
            .or_else(|| self.password.clone())
    }

    fn get_bucket(&self) -> Option<String> {
        self.bucket_name.clone().or_else(|| self.bucket.clone())
    }
}

/// 取出去掉首尾空白后仍非空的值
///
/// 单纯 `filter(|s| !s.is_empty())` 拦不住用户粘贴时带进来的空格：那样的凭证会原样
/// 发出去，换回一个「认证失败」，用户盯着看起来填好的输入框只会怀疑是密码记错了。
fn non_empty(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// 测试 S3 兼容存储连接
/// 根据 service_id 自动构建对应的 endpoint 进行验证
/// 包含重试机制（最多 1 次）以快速反馈配置问题
#[tauri::command]
pub async fn test_s3_connection(
    service_id: String,
    config: S3TestConfig,
) -> Result<String, AppError> {
    log::info!("[S3测试] 开始测试 {} 连接", service_id);

    // 又拍云先分流：它有两套互不通用的凭证，下面那条通用取值链会把 operator 当成
    // access key 取走，走完只验得到半条链路——那正是这个缺陷长期潜伏的形态。
    if service_id == "upyun" {
        return test_upyun_connection(&config).await;
    }

    let access_key = config
        .get_access_key()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::config("Access Key 不能为空"))?;

    let secret_key = config
        .get_secret_key()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::config("Secret Key 不能为空"))?;

    let bucket = config
        .get_bucket()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::config("Bucket 名称不能为空"))?;

    // 构建 endpoint 和 region
    let (endpoint, region) = build_s3_endpoint(&service_id, &config, &bucket)?;

    log::debug!(
        "[S3测试] Endpoint: {}, Region: {}, Bucket: {}",
        endpoint,
        region,
        bucket
    );

    // 单次测试，快速反馈优先
    let test_timeout = Duration::from_secs(10);
    let client = create_s3_client(&endpoint, &access_key, &secret_key, &region);

    let result = timeout(test_timeout, async {
        client
            .list_objects_v2()
            .bucket(&bucket)
            .max_keys(1)
            .send()
            .await
    })
    .await;

    match result {
        Ok(Ok(response)) => {
            let object_count = response.contents().len();
            log::info!(
                "[S3测试] {} 连接成功，存储桶内有 {} 个对象",
                service_id,
                object_count
            );
            Ok(format!("{} 连接成功！", get_service_name(&service_id)))
        }
        Ok(Err(e)) => {
            // 同样不能用 e.to_string()——理由见 describe_sdk_error。
            // 这条路径上的 R2 / 腾讯 / 阿里 / 七牛 / 自定义 S3 此前也一直只显示
            // 「连接失败: service error」，密钥填错了也看不出是密钥的问题。
            let described = describe_sdk_error(&e);
            let error_msg = described.full;
            log::error!("[S3测试] 连接失败: {}", error_msg);

            if error_msg.contains("NoSuchBucket") {
                Err(AppError::storage(format!("存储桶不存在: {}", bucket)))
            } else if error_msg.contains("AccessDenied") || error_msg.contains("InvalidAccessKeyId")
            {
                Err(AppError::auth("认证失败: 请检查 Access Key 和 Secret Key"))
            } else if error_msg.contains("SignatureDoesNotMatch") {
                Err(AppError::auth("签名错误: 请检查 Secret Key 是否正确"))
            } else if error_msg.contains("InvalidBucketName") {
                Err(AppError::config(format!("无效的存储桶名称: {}", bucket)))
            } else {
                // 兜底走短句：全文是整个 HTTP 响应，塞进 toast 就是一堵墙
                Err(AppError::storage(format!("连接失败: {}", described.brief)))
            }
        }
        Err(_) => {
            log::warn!("[S3测试] 连接超时");
            Err(AppError::storage("连接超时，请检查网络或配置"))
        }
    }
}

/// 根据服务类型构建 S3 endpoint
fn build_s3_endpoint(
    service_id: &str,
    config: &S3TestConfig,
    _bucket: &str,
) -> Result<(String, String), AppError> {
    match service_id {
        "r2" => {
            let account_id = config
                .account_id
                .as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("R2 Account ID 不能为空"))?;
            Ok((
                format!("https://{}.r2.cloudflarestorage.com", account_id),
                "auto".to_string(),
            ))
        }
        "tencent" => {
            let region = config
                .region
                .as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("腾讯云 Region 不能为空"))?;
            Ok((
                format!("https://cos.{}.myqcloud.com", region),
                region.clone(),
            ))
        }
        "aliyun" => {
            let region = config
                .region
                .as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("阿里云 Region 不能为空"))?;
            Ok((
                format!("https://oss-{}.aliyuncs.com", region),
                region.clone(),
            ))
        }
        "qiniu" => {
            let region = config
                .region
                .as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("七牛云 Region 不能为空"))?;
            Ok((format!("https://s3-{}.qiniucs.com", region), region.clone()))
        }
        s if s == "custom_s3" || s.starts_with("custom_s3:") => {
            let endpoint = config
                .endpoint
                .as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("自定义 S3 Endpoint 不能为空"))?;

            // 校验 endpoint 是合法的 HTTP(S) URL，防止 SSRF
            let parsed = url::Url::parse(endpoint).map_err(|_| {
                AppError::config("Endpoint 不是合法的 URL，请输入完整的 https://... 地址")
            })?;
            match parsed.scheme() {
                "https" => {}
                "http" => {
                    return Err(AppError::config(
                        "外部 S3 Endpoint 仅支持 HTTPS，请改用 https:// 地址",
                    ))
                }
                _ => return Err(AppError::config("Endpoint 仅支持 https 协议")),
            }
            // 拒绝内网 / 元数据地址（RFC 1918 + link-local + loopback + 云元数据）
            if let Some(host) = parsed.host_str() {
                let is_private = host == "127.0.0.1"
                    || host == "localhost"
                    || host == "[::1]"
                    || host.starts_with("10.")
                    || host.starts_with("192.168.")
                    || host == "169.254.169.254"
                    || host == "metadata.google.internal"
                    || (host.starts_with("172.") && {
                        host.split('.')
                            .nth(1)
                            .and_then(|s| s.parse::<u8>().ok())
                            .is_some_and(|n| (16..=31).contains(&n))
                    });
                if is_private {
                    return Err(AppError::config("Endpoint 不能指向内网或元数据地址"));
                }
            }

            let region = config
                .region
                .as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("自定义 S3 Region 不能为空"))?;
            Ok((endpoint.clone(), region.clone()))
        }
        _ => Err(AppError::config(format!(
            "不支持的服务类型: {}",
            service_id
        ))),
    }
}

/// 测试又拍云连接：REST 与 S3 两条链路各验一次
///
/// Why 两条都验：又拍云有两套**互不通用**的凭证。操作员账号密码走它自家 REST API
/// （Typora / Obsidian / CLI 三条编辑器链路用），控制台「操作员授权 → S3 访问凭证」里
/// 单独生成的 AK/SK 走 S3 兼容端点（软件内 GUI 上传用）。老实现只验 REST，于是在
/// GUI 上传彻底不可用的那整段时间里「测试连接」一直亮绿灯——用户看到的是「配置明明
/// 是好的、一传就失败」，唯一合理的结论就是软件坏了。绿灯必须意味着两条链路都能用。
///
/// Why 报错要点名是哪把钥匙：两套凭证长得一样、填在同一张卡片上，只说「认证失败」
/// 会让用户去改那把本来没错的钥匙。
async fn test_upyun_connection(config: &S3TestConfig) -> Result<String, AppError> {
    let bucket = non_empty(&config.get_bucket())
        .ok_or_else(|| AppError::config("服务空间名称不能为空"))?;

    let operator = non_empty(&config.operator)
        .ok_or_else(|| AppError::config(UPYUN_REST_CREDENTIAL_MISSING))?;
    let password = non_empty(&config.password)
        .ok_or_else(|| AppError::config(UPYUN_REST_CREDENTIAL_MISSING))?;
    let s3_access_key = non_empty(&config.s3_access_key)
        .ok_or_else(|| AppError::config(UPYUN_S3_CREDENTIAL_MISSING))?;
    let s3_secret_key = non_empty(&config.s3_secret_key)
        .ok_or_else(|| AppError::config(UPYUN_S3_CREDENTIAL_MISSING))?;

    test_upyun_rest_chain(&operator, &password, &bucket).await?;
    test_upyun_s3_chain(&s3_access_key, &s3_secret_key, &bucket).await?;

    log::info!("[S3测试] 又拍云 REST + S3 两条链路均连接成功");
    Ok("又拍云连接成功！编辑器（REST）与软件内上传（S3）两条链路均已验证".to_string())
}

/// 缺 S3 凭证时的提示
///
/// 老用户升级后必然撞上这一句：旧版本这两个字段压根不存在。所以它不能只说「不能为空」，
/// 得把「去哪儿拿」一起讲了，否则用户只知道缺东西、不知道缺的是哪个页面里的东西。
const UPYUN_S3_CREDENTIAL_MISSING: &str =
    "缺少 S3 访问凭证：请在又拍云控制台「操作员授权 → S3 访问凭证」单独生成一对，填进「S3 AccessKey / S3 SecretKey」。软件内上传走这一对，与上面的操作员账号密码不是同一套。";

/// 缺操作员凭证时的提示
const UPYUN_REST_CREDENTIAL_MISSING: &str =
    "缺少操作员账号或密码：这一对供 Typora / Obsidian / CLI 使用，与下面的 S3 访问凭证不是同一套。";

/// REST 链路（Basic Auth，`v0.api.upyun.com`）——编辑器 / CLI 走这条
async fn test_upyun_rest_chain(
    operator: &str,
    password: &str,
    bucket: &str,
) -> Result<(), AppError> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let url = format!("https://v0.api.upyun.com/{}/", bucket);
    let auth = STANDARD.encode(format!("{}:{}", operator, password));

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", format!("Basic {}", auth))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                AppError::storage("REST 链路（编辑器 / CLI）连接超时")
            } else if e.is_connect() {
                AppError::storage("REST 链路（编辑器 / CLI）无法连接到又拍云服务器")
            } else {
                AppError::storage(format!("REST 链路（编辑器 / CLI）请求失败: {}", e))
            }
        })?;

    let status = response.status();
    if status.is_success() {
        log::info!("[S3测试] 又拍云 REST 链路连接成功");
        return Ok(());
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::auth(
            "操作员凭证认证失败：请检查「操作员账号」和「操作员密码」（这一对供 Typora / Obsidian / CLI 使用）",
        ));
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::storage(format!("服务空间不存在: {}", bucket)));
    }
    Err(AppError::storage(format!(
        "REST 链路（编辑器 / CLI）连接失败: HTTP {}",
        status
    )))
}

/// S3 链路（SigV4，`s3.api.upyun.com`）——软件内 GUI 上传走这条
///
/// Why 探测动作用 ListObjectsV2 而不是 HeadBucket：又拍云官方 S3 兼容清单里**没有**
/// HeadBucket（2026-08-20 核对 <https://help.upyun.com/knowledge-base/s3-api/>，
/// 只列了 ListBuckets / ListObjectsV2 / Put / Get / Head / Delete / Copy / 分片几类）。
/// 拿一个它不实现的动作去探测，会把好凭证判成坏的——比不测更糟。
///
/// Why 走 Rust 而不是前端自己发一次：GUI 上传本身就是把 endpoint/AK/SK 交给
/// `upload_to_s3_compatible`，同一个 SDK、同一套签名。在这里探测才是「测的就是传的」。
async fn test_upyun_s3_chain(
    access_key: &str,
    secret_key: &str,
    bucket: &str,
) -> Result<(), AppError> {
    let client = create_s3_client(
        UPYUN_S3_ENDPOINT,
        access_key,
        secret_key,
        UPYUN_S3_REGION,
    );

    let result = timeout(Duration::from_secs(10), async {
        client
            .list_objects_v2()
            .bucket(bucket)
            .max_keys(1)
            .send()
            .await
    })
    .await;

    match result {
        Ok(Ok(_)) => {
            log::info!("[S3测试] 又拍云 S3 链路连接成功");
            Ok(())
        }
        Ok(Err(e)) => {
            let described = describe_sdk_error(&e);
            Err(classify_upyun_s3_error(&described.full, &described.brief, bucket))
        }
        Err(_) => Err(AppError::storage(
            "S3 链路（软件内上传）连接超时，请检查网络",
        )),
    }
}

/// SDK 错误的两种说法
///
/// Why 要分两份：摊平后的错误链**极长**（整个 HTTP 响应 + 响应头 + XML 正文，
/// 轻松上千字符）。日志里这是排查金矿，塞进 toast 就是一堵墙。
/// 2026-08-20 真机验收时正是靠日志里那一大坨才定位到问题，所以两边都要，但不能混。
struct SdkErrorText {
    /// 完整错误链（含错误码）。用于分类匹配和写日志
    full: String,
    /// 短句。用于给用户看的提示——优先服务端错误码，没有就截断的概要
    brief: String,
}

/// 摊平 SDK 错误，取出真正的错误码
///
/// ⚠️ 直接 `e.to_string()` 是不行的：SdkError 的 Display 只给一句概要，
/// 服务端真正回的错误码在 source 链里。2026-08-20 真机实测，拿错误的又拍云 S3
/// 凭证去连，`to_string()` 只有五个字 `service error`——于是所有靠
/// `contains("...")` 的分类**一条都命中不了**，全落进兜底分支，用户看到的是
/// 「连接失败: service error」，等于什么也没说。
///
/// 这个坑单测抓不到：喂给分类函数的是手写的字符串，那种字符串现实中不会出现。
/// 守着它的是源码哨兵 `sdk_errors_never_go_through_plain_display`。
///
/// 两样都取：
/// - `code()` 是服务端返回的错误码本身（`ErrInvalidAccessKeyID` 这种），最准
/// - `DisplayErrorContext` 展开整条 source 链，覆盖连不上 / 超时这类没有错误码的情况
fn describe_sdk_error<E, R>(error: &aws_sdk_s3::error::SdkError<E, R>) -> SdkErrorText
where
    aws_sdk_s3::error::SdkError<E, R>: ProvideErrorMetadata + std::error::Error,
{
    let code = error.code().unwrap_or_default();
    let detail = DisplayErrorContext(error).to_string();

    let full = if code.is_empty() {
        detail.clone()
    } else {
        format!("{}: {}", code, detail)
    };

    let brief = if code.is_empty() {
        truncate_chars(&detail, SDK_ERROR_BRIEF_MAX_CHARS)
    } else {
        code.to_string()
    };

    SdkErrorText { full, brief }
}

/// 给用户看的错误概要最长多少字符
///
/// 没有错误码时才会用到（连不上、超时这类）。取 120 是「一句话能读完、
/// toast 里不超过三行」的经验值，不是精确排版。
const SDK_ERROR_BRIEF_MAX_CHARS: usize = 120;

/// 按**字符**截断，不是按字节——按字节切会把中文劈成乱码
fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let head: String = text.chars().take(max).collect();
    format!("{}…", head)
}

/// 把 S3 链路的原始错误翻译成「用户该去动哪一格」
///
/// `ErrInvalidAccessKeyID` 是又拍云自己的拼法（不是 AWS 的 `InvalidAccessKeyId`），
/// 2026-08-19 实测拿操作员账号去签 S3 请求收到的就是它。两种拼法都要认。
fn classify_upyun_s3_error(error_msg: &str, brief: &str, bucket: &str) -> AppError {
    log::error!("[S3测试] 又拍云 S3 链路失败: {}", error_msg);

    if error_msg.contains("NoSuchBucket") {
        return AppError::storage(format!("服务空间不存在: {}", bucket));
    }
    if error_msg.contains("ErrInvalidAccessKeyID")
        || error_msg.contains("InvalidAccessKeyId")
        || error_msg.contains("SignatureDoesNotMatch")
        || error_msg.contains("AccessDenied")
    {
        return AppError::auth(
            "S3 访问凭证认证失败：请确认填的是控制台「操作员授权 → S3 访问凭证」里生成的那一对，而不是上面的操作员账号密码（软件内上传走这一对）",
        );
    }
    // 兜底走短句，理由同上：全文能有上千字符
    AppError::storage(format!("S3 链路（软件内上传）连接失败: {}", brief))
}

/// 获取服务显示名称
fn get_service_name(service_id: &str) -> &str {
    match service_id {
        "r2" => "Cloudflare R2",
        "tencent" => "腾讯云 COS",
        "aliyun" => "阿里云 OSS",
        "qiniu" => "七牛云",
        "upyun" => "又拍云",
        s if s == "custom_s3" || s.starts_with("custom_s3:") => "自定义 S3 存储",
        _ => service_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn custom_s3_config(endpoint: &str) -> S3TestConfig {
        S3TestConfig {
            account_id: None,
            access_key_id: Some("ak".to_string()),
            secret_id: None,
            access_key: None,
            operator: None,
            secret_access_key: Some("sk".to_string()),
            secret_key: None,
            access_key_secret: None,
            password: None,
            s3_access_key: None,
            s3_secret_key: None,
            bucket_name: None,
            bucket: Some("bucket".to_string()),
            region: Some("us-east-1".to_string()),
            endpoint: Some(endpoint.to_string()),
        }
    }

    /// 哨兵：本文件里 S3 SDK 的错误一律不许直接 Display
    ///
    /// 2026-08-20 真机踩到的：`SdkError` 的 Display 只有五个字 `service error`，
    /// 真正的错误码在 source 链里。于是所有靠 `contains("...")` 的分类一条都命中不了，
    /// 全落进兜底分支——「连接失败: service error」，等于什么也没说。
    ///
    /// **这个坑单测抓不到**：喂给分类函数的是手写字符串，那种字符串现实中不会出现。
    /// 所以改成扫源码。三处都得走 `describe_sdk_error`：通用连接测试、又拍云 S3 链路、
    /// 以及上传失败提示（那处用户看得最多）。
    ///
    /// 两个讲究，少一个哨兵就失灵：
    /// - **在 `#[cfg(test)]` 处截断**：`include_str!` 把本测试自己也读进来了，
    ///   下面那些违规字面量会自己把自己喂饱。
    /// - **滤掉注释行**：上面那段说明里就写着违规写法。
    #[test]
    fn sdk_errors_never_go_through_plain_display() {
        let raw = include_str!("s3_compatible.rs").replace("
", "
");
        let code_only = raw
            .split_once("
#[cfg(test)]")
            .map(|(before, _)| before)
            .expect("找不到 #[cfg(test)]，截断失效——哨兵会自己触发自己")
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("
");

        // ⚠️ 不能直接 contains("e.to_string()")：`code.to_string()`、`source.to_string()`
        // 这些正当写法都以 `e.to_string()` 结尾，会被误判。2026-08-20 这条哨兵上线
        // 第一次就把自己抓了。只认**独立变量 e** ——前一个字符不是标识符的一部分。
        assert!(
            !has_bare_error_to_string(&code_only),
            "发现把 SDK 错误直接 to_string() 的写法——改走 describe_sdk_error，             否则用户只会看到「service error」",
        );
        assert!(
            !code_only.contains("上传失败: {}\", e)"),
            "上传失败提示在直接 Display SDK 错误——改走 describe_sdk_error",
        );

        // 正向：三处都确实接上了。只查"没有违规写法"的话，把整段删掉也算通过。
        assert!(
            code_only.matches("describe_sdk_error(&").count() >= 3,
            "describe_sdk_error 的调用点少于 3 处，是不是哪条链路漏接了？",
        );
    }

    /// 又拍云拿操作员账号去签 S3 请求时，服务端回的是它自家拼法 `ErrInvalidAccessKeyID`，
    /// 不是 AWS 的 `InvalidAccessKeyId`。只认 AWS 那个拼法的话，这条最常见的
    /// 「填错了哪把钥匙」会掉进兜底分支，提示退回没有指向性的「连接失败」。
    #[test]
    fn upyun_s3_error_names_the_credential_for_both_spellings() {
        for raw in [
            "service error: ErrInvalidAccessKeyID: access key not found",
            "service error: InvalidAccessKeyId",
            "SignatureDoesNotMatch: signature mismatch",
            "AccessDenied",
        ] {
            let message = classify_upyun_s3_error(raw, "brief", "bucket").to_string();
            assert!(
                message.contains("S3 访问凭证"),
                "「{}」应指向 S3 访问凭证，实际: {}",
                raw,
                message
            );
            assert!(
                message.contains("操作员授权"),
                "「{}」应告诉用户去哪儿生成，实际: {}",
                raw,
                message
            );
        }
    }

    /// 找出「独立变量 `e` 直接 to_string()」的写法
    ///
    /// 只看 `e.to_string()` 前面那个字符：是字母 / 数字 / 下划线 / 点的话，
    /// 说明这是 `code.to_string()` 这类正当写法的尾巴，不算。
    fn has_bare_error_to_string(src: &str) -> bool {
        let needle = "e.to_string()";
        src.match_indices(needle).any(|(idx, _)| {
            idx == 0
                || !src[..idx]
                    .chars()
                    .next_back()
                    .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '.')
        })
    }

    /// 哨兵的哨兵：上面那个收紧过的判断本身得既抓得住、又不误伤
    #[test]
    fn bare_error_to_string_detector_is_neither_blind_nor_trigger_happy() {
        // 抓得住：这些都是要拦的
        assert!(has_bare_error_to_string("let x = e.to_string();"));
        assert!(has_bare_error_to_string("classify(&e.to_string(), b)"));
        assert!(has_bare_error_to_string("foo(e.to_string())"));

        // 不误伤：这些是正当写法
        assert!(!has_bare_error_to_string("code.to_string()"));
        assert!(!has_bare_error_to_string("let s = source.to_string();"));
        assert!(!has_bare_error_to_string("self.value.to_string()"));
    }

    /// 真机形态的回归用例
    ///
    /// 2026-08-20 真机拿错误的又拍云 S3 凭证连出来的原文就长这样：错误码在最前，
    /// 后面跟着一整坨 HTTP 响应。之前的用例喂的是手搓短字符串，**跟现实对不上**，
    /// 所以 `to_string()` 只给 "service error" 那个缺陷一路绿灯到真机才暴露。
    #[test]
    fn upyun_s3_error_handles_the_real_world_shape() {
        let real = "ErrInvalidAccessKeyID: service error: unhandled error (ErrInvalidAccessKeyID):                     Error { code: \"ErrInvalidAccessKeyID\", message: \"ErrInvalidAccessKeyID\",                     aws_request_id: \"18CD78639C718B77\" } (ServiceError(ServiceError { source: ...";

        let message = classify_upyun_s3_error(real, "ErrInvalidAccessKeyID", "img-ypyp").to_string();

        assert!(message.contains("S3 访问凭证"), "实得: {}", message);
        // 分类命中时不该把原文抖出来
        assert!(!message.contains("aws_request_id"), "实得: {}", message);
    }

    /// 兜底分支给用户的是**短句**，不是那一大坨错误链
    ///
    /// 摊平后的错误链是整个 HTTP 响应（响应头 + XML 正文），轻松上千字符。
    /// 日志里要，toast 里塞进去就是一堵墙。
    #[test]
    fn unknown_upyun_s3_error_shows_the_brief_not_the_dump() {
        let dump = format!("SomeUnknownCode: {}", "x".repeat(2000));

        let message = classify_upyun_s3_error(&dump, "SomeUnknownCode", "bucket").to_string();

        assert!(message.contains("SomeUnknownCode"), "实得: {}", message);
        assert!(
            message.chars().count() < 200,
            "兜底提示不该把整坨错误链倒给用户，实测 {} 字符",
            message.chars().count(),
        );
    }

    /// 按字符截断而不是按字节：按字节切会把中文劈成乱码
    #[test]
    fn truncate_chars_never_splits_a_character() {
        let cn = "中".repeat(200);
        let cut = truncate_chars(&cn, 10);

        assert_eq!(cut.chars().count(), 11);  // 10 个字 + 省略号
        assert!(cut.ends_with('…'));
        assert_eq!(truncate_chars("短", 10), "短");
    }

    /// 桶不存在与凭证不对必须分开报：混为一谈会让用户去改本来没错的那一格
    #[test]
    fn upyun_s3_error_separates_missing_bucket_from_bad_credential() {
        let message = classify_upyun_s3_error("NoSuchBucket: the bucket is gone", "NoSuchBucket", "mybucket")
            .to_string();

        assert!(message.contains("mybucket"), "实际: {}", message);
        assert!(!message.contains("S3 访问凭证"), "实际: {}", message);
    }

    /// 认不出来的错误照原样透出，不能悄悄吞成「凭证不对」——那会把网络故障
    /// 误导成配置问题，用户会去反复重生成一对本来就没问题的凭证。
    #[test]
    fn upyun_s3_error_passes_through_unknown_failures() {
        let message = classify_upyun_s3_error("dispatch failure: connection reset", "dispatch failure: connection reset", "bucket")
            .to_string();

        assert!(message.contains("connection reset"), "实际: {}", message);
        assert!(!message.contains("认证失败"), "实际: {}", message);
    }

    /// 粘贴凭证时带进来的首尾空格必须当成「没填」，否则会换回一个认证失败，
    /// 用户盯着看起来填好的输入框只会怀疑是密码记错了。
    #[test]
    fn non_empty_treats_whitespace_only_as_missing() {
        assert_eq!(non_empty(&Some("  ".to_string())), None);
        assert_eq!(non_empty(&Some(String::new())), None);
        assert_eq!(non_empty(&None), None);
        assert_eq!(
            non_empty(&Some("  ak  ".to_string())),
            Some("ak".to_string())
        );
    }

    /// 又拍云的两套凭证不能混：通用取值链认得 operator/password，
    /// 但**认不得** s3AccessKey/s3SecretKey——真混进去就会拿 S3 凭证去做 Basic Auth。
    #[test]
    fn upyun_s3_credentials_stay_out_of_the_generic_key_chain() {
        let config = S3TestConfig {
            account_id: None,
            access_key_id: None,
            secret_id: None,
            access_key: None,
            operator: Some("op".to_string()),
            secret_access_key: None,
            secret_key: None,
            access_key_secret: None,
            password: Some("pw".to_string()),
            s3_access_key: Some("s3ak".to_string()),
            s3_secret_key: Some("s3sk".to_string()),
            bucket_name: None,
            bucket: Some("bucket".to_string()),
            region: None,
            endpoint: None,
        };

        assert_eq!(config.get_access_key(), Some("op".to_string()));
        assert_eq!(config.get_secret_key(), Some("pw".to_string()));
    }

    /// 前端传的是 camelCase 的 `s3AccessKey`；名字对不上会静默变成 None，
    /// 表现为「明明填了却说缺少 S3 访问凭证」。
    #[test]
    fn upyun_s3_credentials_deserialize_from_camel_case() {
        let config: S3TestConfig = serde_json::from_str(
            r#"{"operator":"op","password":"pw","bucket":"b","s3AccessKey":"ak","s3SecretKey":"sk"}"#,
        )
        .expect("camelCase payload should deserialize");

        assert_eq!(config.s3_access_key.as_deref(), Some("ak"));
        assert_eq!(config.s3_secret_key.as_deref(), Some("sk"));
    }

    #[test]
    fn validate_https_endpoint_rejects_http() {
        let err = validate_https_endpoint("http://s3.example.com")
            .expect_err("external HTTP endpoint should be rejected");

        assert!(err.to_string().contains("仅支持 HTTPS"));
    }

    #[test]
    fn validate_public_domain_allows_confirmed_http_only_for_that_host() {
        // 确认过的那个主机名放行
        assert!(validate_public_domain("http://cdn.example.com", Some("cdn.example.com")).is_ok());
        // 大小写与端口不影响判据（判的是主机名）
        assert!(validate_public_domain("http://CDN.Example.com:8080/img", Some("cdn.example.com")).is_ok());

        // 反向判据：确认了 A 不等于放行 B。存 bool 的实现会在这里放行，属于必须拦住的回归
        let err = validate_public_domain("http://other.example.com", Some("cdn.example.com"))
            .unwrap_err()
            .to_string();
        assert!(err.contains("明文 HTTP"), "换个域名必须重新确认，实得: {}", err);

        // 没确认过就拒
        let err = validate_public_domain("http://cdn.example.com", None)
            .unwrap_err()
            .to_string();
        assert!(err.contains("明文 HTTP"), "未确认必须拒绝，实得: {}", err);

        // 非 http/https 一律拒，确认过也不行
        assert!(validate_public_domain("ftp://cdn.example.com", Some("cdn.example.com")).is_err());
    }

    #[test]
    fn validate_public_domain_allows_empty_and_https() {
        assert!(validate_public_domain("", None).is_ok());
        assert!(validate_public_domain(" https://cdn.example.com ", None).is_ok());
    }

    #[test]
    fn build_custom_s3_endpoint_rejects_http() {
        let err = build_s3_endpoint(
            "custom_s3:local",
            &custom_s3_config("http://s3.example.com"),
            "bucket",
        )
        .expect_err("custom S3 endpoint should require HTTPS");

        assert!(err.to_string().contains("仅支持 HTTPS"));
    }

    #[test]
    fn build_custom_s3_endpoint_allows_public_https() {
        let (endpoint, region) = build_s3_endpoint(
            "custom_s3:prod",
            &custom_s3_config("https://s3.example.com"),
            "bucket",
        )
        .expect("public HTTPS custom S3 endpoint should be accepted");

        assert_eq!(endpoint, "https://s3.example.com");
        assert_eq!(region, "us-east-1");
    }
}
