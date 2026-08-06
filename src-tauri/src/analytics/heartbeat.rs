// GA4 Measurement Protocol 心跳：让「此刻有多少人在运行」出现在 GA4 实时面板。
//
// 为什么不复用同目录的隔离 WebView 通道（mod.rs）：
//   那条通道每次要起本地服务器 + 开隐藏窗口 + 下载 gtag.js，一趟数秒；心跳每 25
//   分钟一次，用它成本高出两个数量级。心跳只需要「这个用户还在」这一个信号，不
//   需要 gtag.js 才能采到的地区/设备维度——启动事件仍走原通道，那些维度不会丢。
//
// 为什么定时器在 Rust 侧而不是前端：
//   PicNexus 关窗是缩托盘继续运行，而托盘挂机正是「正在运行」最典型的状态。此时
//   主窗口 WebView 处于隐藏态，其 JS 定时器会被节流甚至冻结，心跳写在前端会恰好
//   漏掉最该统计的场景。

use crate::error::AppError;
use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;

use super::{is_valid_app_version, is_valid_client_id, OsInfo};

/// 必须与 analytics/bootstrap.js 里的 measurementId 保持一致
const MEASUREMENT_ID: &str = "G-E8LW7TS55J";
const MP_ENDPOINT: &str = "https://www.google-analytics.com/mp/collect";
const HEARTBEAT_EVENT_NAME: &str = "heartbeat";

/// GA4 实时面板的统计窗口是 30 分钟，留 5 分钟余量避免边界断档
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(25 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// GA4 判定「活跃用户」只看事件上有没有 engagement_time_msec，不看数值大小。
/// 这里刻意给一个小的占位值：填成真实的心跳间隔会让「平均互动时长」报表变成一个
/// 精确却无意义的数字——挂在托盘里不等于用户在互动。
const ENGAGEMENT_TIME_MSEC: u32 = 1_000;

/// 编译期注入，不落源码（仓库是公开的）。未注入时心跳静默禁用，本地开发默认如此。
const API_SECRET: Option<&str> = option_env!("PICNEXUS_GA_API_SECRET");

#[derive(Default)]
pub struct HeartbeatState {
    active: Mutex<Option<tokio::task::AbortHandle>>,
}

impl HeartbeatState {
    pub fn new() -> Self {
        Self::default()
    }

    /// 装入新的心跳任务并终止旧的，保证同一时刻只有一条心跳在跑
    fn replace(&self, handle: Option<tokio::task::AbortHandle>) {
        let mut active = self
            .active
            .lock()
            .expect("analytics heartbeat state poisoned");
        if let Some(previous) = active.take() {
            previous.abort();
        }
        *active = handle;
    }
}

#[derive(Debug, Serialize)]
struct HeartbeatParams {
    /// GA4 要求 session_id 是字符串，传数字会被丢弃
    session_id: String,
    engagement_time_msec: u32,
    app_version: String,
    os_info: OsInfo,
}

#[derive(Debug, Serialize)]
struct HeartbeatEvent {
    name: &'static str,
    params: HeartbeatParams,
}

#[derive(Debug, Serialize)]
struct HeartbeatPayload {
    client_id: String,
    events: Vec<HeartbeatEvent>,
}

fn current_unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

fn build_payload(
    client_id: String,
    app_version: String,
    os_info: OsInfo,
    session_id: u64,
) -> HeartbeatPayload {
    HeartbeatPayload {
        client_id,
        events: vec![HeartbeatEvent {
            name: HEARTBEAT_EVENT_NAME,
            params: HeartbeatParams {
                session_id: session_id.to_string(),
                engagement_time_msec: ENGAGEMENT_TIME_MSEC,
                app_version,
                os_info,
            },
        }],
    }
}

fn build_endpoint(secret: &str) -> String {
    format!(
        "{MP_ENDPOINT}?measurement_id={}&api_secret={}",
        urlencoding::encode(MEASUREMENT_ID),
        urlencoding::encode(secret)
    )
}

async fn heartbeat_loop(client: reqwest::Client, endpoint: String, payload: HeartbeatPayload) {
    let mut ticker = tokio::time::interval(HEARTBEAT_INTERVAL);
    loop {
        // interval 的首个 tick 立即完成：启动后马上报一次，用户不必等满 25 分钟才现身
        ticker.tick().await;
        match client.post(&endpoint).json(&payload).send().await {
            // MP 端点无论参数对错都返回 204，这里的成功只代表「请求送达」，
            // 真正的验证手段是 GA4 实时面板
            Ok(response) => log::debug!("[Analytics] 心跳已发送: HTTP {}", response.status()),
            // 断网是常态，用 debug 级别避免长期离线时刷屏
            Err(error) => log::debug!("[Analytics] 心跳发送失败，忽略本轮: {}", error),
        }
    }
}

/// 启动在线心跳。返回 `started` 表示已在跑，`disabled` 表示构建未注入密钥。
#[tauri::command]
pub async fn analytics_start_heartbeat(
    state: State<'_, HeartbeatState>,
    client_id: String,
    app_version: String,
    os_info: OsInfo,
) -> Result<&'static str, AppError> {
    if !is_valid_client_id(&client_id) {
        return Err(AppError::validation("Analytics client ID 格式无效"));
    }
    if !is_valid_app_version(&app_version) {
        return Err(AppError::validation("Analytics 应用版本无效"));
    }

    let secret = match API_SECRET {
        Some(value) if !value.is_empty() => value,
        _ => {
            state.replace(None);
            log::warn!(
                "[Analytics] 构建未注入 PICNEXUS_GA_API_SECRET，在线心跳已禁用（实时在线数将始终为空）"
            );
            return Ok("disabled");
        }
    };

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| AppError::external(format!("无法创建 Analytics 心跳客户端: {error}")))?;
    let payload = build_payload(client_id, app_version, os_info, current_unix_seconds());
    let task = tokio::spawn(heartbeat_loop(client, build_endpoint(secret), payload));
    state.replace(Some(task.abort_handle()));

    Ok("started")
}

/// 停止在线心跳。用户关闭统计开关时调用，幂等。
#[tauri::command]
pub fn analytics_stop_heartbeat(state: State<'_, HeartbeatState>) {
    state.replace(None);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload(os_info: OsInfo) -> serde_json::Value {
        let payload = build_payload(
            "1234567890.1234567890".to_string(),
            "1.0.10".to_string(),
            os_info,
            1_785_947_067,
        );
        serde_json::to_value(&payload).expect("payload 应可序列化")
    }

    #[test]
    fn payload_matches_verified_measurement_protocol_shape() {
        // 这个形状是拿真实 GA4 属性验证过的：改动前先确认实时面板仍然认
        let json = sample_payload(OsInfo::Windows);

        assert_eq!(json["client_id"], "1234567890.1234567890");
        assert_eq!(json["events"][0]["name"], "heartbeat");
        assert_eq!(json["events"][0]["params"]["session_id"], "1785947067");
        assert_eq!(json["events"][0]["params"]["engagement_time_msec"], 1000);
    }

    #[test]
    fn payload_keeps_session_id_as_string() {
        // GA4 只接受字符串型 session_id，退化成数字会让事件被静默丢弃
        let json = sample_payload(OsInfo::Linux);
        assert!(json["events"][0]["params"]["session_id"].is_string());
    }

    #[test]
    fn payload_carries_custom_dimensions() {
        // app_version / os_info 已在 GA4 后台注册为自定义维度，字段名不能改
        let json = sample_payload(OsInfo::Windows);
        assert_eq!(json["events"][0]["params"]["app_version"], "1.0.10");
        assert_eq!(json["events"][0]["params"]["os_info"], "Windows");
    }

    #[test]
    fn payload_serializes_macos_with_official_casing() {
        // 与前端 useAnalytics.ts 的 OsInfo 取值保持一致，否则维度里会分裂成两个值
        let json = sample_payload(OsInfo::MacOs);
        assert_eq!(json["events"][0]["params"]["os_info"], "macOS");
    }

    #[test]
    fn payload_contains_exactly_one_event() {
        let payload = build_payload(
            "1.1".to_string(),
            "1.0.0".to_string(),
            OsInfo::Unknown,
            1_785_947_067,
        );
        assert_eq!(payload.events.len(), 1);
    }

    #[test]
    fn endpoint_carries_measurement_id_and_secret() {
        let endpoint = build_endpoint("s3cr3t");
        assert!(endpoint.starts_with("https://www.google-analytics.com/mp/collect?"));
        assert!(endpoint.contains("measurement_id=G-E8LW7TS55J"));
        assert!(endpoint.contains("api_secret=s3cr3t"));
    }

    #[test]
    fn endpoint_percent_encodes_secret() {
        // 密钥来自环境变量，含 & 或 = 时不转义会把查询串截断
        let endpoint = build_endpoint("a&b=c");
        assert!(endpoint.contains("api_secret=a%26b%3Dc"));
    }

    #[test]
    fn session_id_is_seconds_not_millis() {
        // 秒级 unix 时间戳当前是 10 位；毫秒会变 13 位，GA4 会当成异常会话
        let seconds = current_unix_seconds();
        assert!(
            (1_700_000_000..10_000_000_000).contains(&seconds),
            "session_id 应为秒级时间戳，实际: {seconds}"
        );
    }

    #[test]
    fn replace_aborts_previous_task() {
        let runtime = tokio::runtime::Runtime::new().expect("应能创建测试 runtime");
        runtime.block_on(async {
            let state = HeartbeatState::new();
            let first = tokio::spawn(async {
                // 永不结束，只有被 abort 才会停
                std::future::pending::<()>().await;
            });
            let first_handle = first.abort_handle();
            state.replace(Some(first_handle));

            state.replace(None);
            // 让出执行权，等 abort 生效
            tokio::task::yield_now().await;
            assert!(first.await.unwrap_err().is_cancelled());
        });
    }
}
