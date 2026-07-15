mod server;

use crate::error::AppError;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{
    webview::NewWindowResponse, AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder,
};
use tokio::sync::Mutex as TokioMutex;

const ANALYTICS_WINDOW_LABEL: &str = "analytics-transport";
const TAG_READY_TIMEOUT: Duration = Duration::from_secs(8);
const EVENT_ACK_TIMEOUT: Duration = Duration::from_secs(7);
const REQUEST_DRAIN_DELAY: Duration = Duration::from_millis(500);
const MAX_APP_VERSION_LENGTH: usize = 64;
const CLIENT_ID_PATTERN_MAX_PART_LENGTH: usize = 16;
const ANALYTICS_DEBUG_ENV: &str = "PICNEXUS_ANALYTICS_DEBUG";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalyticsBatch {
    client_id: String,
    events: Vec<AnalyticsEvent>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnalyticsEvent {
    name: AnalyticsEventName,
    params: AnalyticsEventParams,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum AnalyticsEventName {
    FirstRun,
    AppStart,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnalyticsEventParams {
    app_version: String,
    os_info: OsInfo,
    app_platform: AppPlatform,
}

#[derive(Debug, Deserialize, Serialize)]
enum OsInfo {
    Windows,
    #[serde(rename = "macOS")]
    MacOs,
    Linux,
    Unknown,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum AppPlatform {
    TauriDesktop,
}

struct ActiveRuntime {
    generation: u64,
    server_abort: tokio::task::AbortHandle,
}

pub struct AnalyticsRuntimeState {
    operation: TokioMutex<()>,
    active: Mutex<Option<ActiveRuntime>>,
    generation: AtomicU64,
}

impl AnalyticsRuntimeState {
    pub fn new() -> Self {
        Self {
            operation: TokioMutex::new(()),
            active: Mutex::new(None),
            generation: AtomicU64::new(0),
        }
    }

    fn next_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn is_current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == generation
    }

    fn set_active(&self, active: ActiveRuntime) {
        *self.active.lock().expect("analytics state poisoned") = Some(active);
    }

    fn take_active(&self, generation: Option<u64>) -> Option<ActiveRuntime> {
        let mut active = self.active.lock().expect("analytics state poisoned");
        if generation.is_some_and(|expected| {
            active
                .as_ref()
                .is_some_and(|runtime| runtime.generation != expected)
        }) {
            return None;
        }
        active.take()
    }
}

fn is_valid_client_id(value: &str) -> bool {
    let mut parts = value.split('.');
    let first = parts.next().unwrap_or_default();
    let second = parts.next().unwrap_or_default();
    parts.next().is_none()
        && !first.is_empty()
        && !second.is_empty()
        && first.len() <= CLIENT_ID_PATTERN_MAX_PART_LENGTH
        && second.len() <= CLIENT_ID_PATTERN_MAX_PART_LENGTH
        && first.bytes().all(|byte| byte.is_ascii_digit())
        && second.bytes().all(|byte| byte.is_ascii_digit())
}

fn is_valid_app_version(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_APP_VERSION_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-' | b'_'))
}

fn validate_batch(batch: &AnalyticsBatch) -> Result<(), AppError> {
    if !is_valid_client_id(&batch.client_id) {
        return Err(AppError::validation("Analytics client ID 格式无效"));
    }
    if batch.events.is_empty() || batch.events.len() > 2 {
        return Err(AppError::validation("Analytics 批次必须包含 1 到 2 个事件"));
    }

    let app_start_count = batch
        .events
        .iter()
        .filter(|event| event.name == AnalyticsEventName::AppStart)
        .count();
    let first_run_count = batch
        .events
        .iter()
        .filter(|event| event.name == AnalyticsEventName::FirstRun)
        .count();
    if app_start_count != 1 || first_run_count > 1 {
        return Err(AppError::validation(
            "Analytics 批次必须包含一个 app_start，且最多包含一个 first_run",
        ));
    }
    if batch.events.iter().any(|event| {
        !is_valid_app_version(&event.params.app_version)
            || event.params.app_platform != AppPlatform::TauriDesktop
    }) {
        return Err(AppError::validation("Analytics 事件参数无效"));
    }

    Ok(())
}

fn random_hex(bytes: usize) -> String {
    let mut buffer = vec![0_u8; bytes];
    rand::thread_rng().fill_bytes(&mut buffer);
    buffer.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn analytics_debug_mode_enabled() -> bool {
    std::env::var(ANALYTICS_DEBUG_ENV).as_deref() == Ok("1")
}

fn cleanup_runtime(app: &AppHandle, state: &AnalyticsRuntimeState, generation: Option<u64>) {
    if let Some(active) = state.take_active(generation) {
        active.server_abort.abort();
    }
    if let Some(window) = app.get_webview_window(ANALYTICS_WINDOW_LABEL) {
        let _ = window.destroy();
    }
}

async fn wait_for_ready(
    events: &mut tokio::sync::mpsc::Receiver<server::ServerEvent>,
) -> Result<(), AppError> {
    wait_for_ready_with_timeout(events, TAG_READY_TIMEOUT).await
}

async fn wait_for_ready_with_timeout(
    events: &mut tokio::sync::mpsc::Receiver<server::ServerEvent>,
    timeout: Duration,
) -> Result<(), AppError> {
    let event = tokio::time::timeout(timeout, events.recv())
        .await
        .map_err(|_| AppError::external("Google tag 加载超时"))?
        .ok_or_else(|| AppError::external("Analytics 本地服务提前停止"))?;
    match event {
        server::ServerEvent::Ready => Ok(()),
        server::ServerEvent::LoadFailed => Err(AppError::external("Google tag 加载失败")),
        server::ServerEvent::Acknowledged(_) => {
            Err(AppError::external("Analytics 页面返回了无效状态"))
        }
    }
}

async fn wait_for_ack(
    events: &mut tokio::sync::mpsc::Receiver<server::ServerEvent>,
    request_id: &str,
) -> Result<(), AppError> {
    wait_for_ack_with_timeout(events, request_id, EVENT_ACK_TIMEOUT).await
}

async fn wait_for_ack_with_timeout(
    events: &mut tokio::sync::mpsc::Receiver<server::ServerEvent>,
    request_id: &str,
    timeout: Duration,
) -> Result<(), AppError> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let event = tokio::time::timeout_at(deadline, events.recv())
            .await
            .map_err(|_| AppError::external("Google tag 事件处理超时"))?
            .ok_or_else(|| AppError::external("Analytics 本地服务提前停止"))?;
        if matches!(event, server::ServerEvent::Acknowledged(ref id) if id == request_id) {
            return Ok(());
        }
        if event == server::ServerEvent::LoadFailed {
            return Err(AppError::external("Google tag 加载失败"));
        }
    }
}

#[tauri::command]
pub async fn analytics_send_batch(
    app: AppHandle,
    state: State<'_, AnalyticsRuntimeState>,
    batch: AnalyticsBatch,
) -> Result<&'static str, AppError> {
    validate_batch(&batch)?;
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| AppError::external("Analytics 已有批次正在处理"))?;
    cleanup_runtime(&app, &state, None);

    let generation = state.next_generation();
    let token = random_hex(32);
    let mut running_server = server::start(token).await.map_err(AppError::external)?;
    state.set_active(ActiveRuntime {
        generation,
        server_abort: running_server.abort_handle.clone(),
    });
    if !state.is_current(generation) {
        cleanup_runtime(&app, &state, Some(generation));
        return Err(AppError::external("Analytics 操作已取消"));
    }

    let allowed_url = running_server.page_url.clone();
    let window_result = WebviewWindowBuilder::new(
        &app,
        ANALYTICS_WINDOW_LABEL,
        WebviewUrl::External(running_server.page_url.clone()),
    )
    .title("PicNexus Analytics")
    .inner_size(1.0, 1.0)
    .visible(false)
    .focused(false)
    .decorations(false)
    .resizable(false)
    .skip_taskbar(true)
    .incognito(true)
    .on_navigation(move |url| url == &allowed_url)
    .on_new_window(|_, _| NewWindowResponse::Deny)
    .on_download(|_, _| false)
    .build();
    let window = match window_result {
        Ok(window) => window,
        Err(_) => {
            cleanup_runtime(&app, &state, Some(generation));
            return Err(AppError::external("无法创建 Analytics 隔离窗口"));
        }
    };
    if !state.is_current(generation) {
        cleanup_runtime(&app, &state, Some(generation));
        return Err(AppError::external("Analytics 操作已取消"));
    }

    let result = async {
        wait_for_ready(&mut running_server.events).await?;
        if !state.is_current(generation) {
            return Err(AppError::external("Analytics 操作已取消"));
        }

        let request_id = random_hex(16);
        let serialized_batch = serde_json::to_string(&batch)?;
        let serialized_request_id = serde_json::to_string(&request_id)?;
        let serialized_debug_mode = serde_json::to_string(&analytics_debug_mode_enabled())?;
        window
            .eval(format!(
                "window.__PICNEXUS_ANALYTICS__.sendBatch({serialized_batch}, {serialized_request_id}, {serialized_debug_mode});"
            ))
            .map_err(|_| AppError::external("无法提交 Analytics 事件"))?;

        wait_for_ack(&mut running_server.events, &request_id).await?;
        if !state.is_current(generation) {
            return Err(AppError::external("Analytics 操作已取消"));
        }
        tokio::time::sleep(REQUEST_DRAIN_DELAY).await;
        Ok("processed")
    }
    .await;

    cleanup_runtime(&app, &state, Some(generation));
    result
}

#[tauri::command]
pub fn analytics_shutdown(app: AppHandle, state: State<'_, AnalyticsRuntimeState>) {
    state.next_generation();
    cleanup_runtime(&app, &state, None);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(name: AnalyticsEventName, version: &str) -> AnalyticsEvent {
        AnalyticsEvent {
            name,
            params: AnalyticsEventParams {
                app_version: version.to_string(),
                os_info: OsInfo::Windows,
                app_platform: AppPlatform::TauriDesktop,
            },
        }
    }

    #[test]
    fn validates_expected_startup_batch() {
        let batch = AnalyticsBatch {
            client_id: "123456789.1700000000".to_string(),
            events: vec![
                event(AnalyticsEventName::FirstRun, "1.0.10"),
                event(AnalyticsEventName::AppStart, "1.0.10"),
            ],
        };
        assert!(validate_batch(&batch).is_ok());
    }

    #[test]
    fn rejects_invalid_identity_and_event_shapes() {
        let invalid_id = AnalyticsBatch {
            client_id: "not-an-id".to_string(),
            events: vec![event(AnalyticsEventName::AppStart, "1.0.10")],
        };
        let missing_start = AnalyticsBatch {
            client_id: "123.1700000000".to_string(),
            events: vec![event(AnalyticsEventName::FirstRun, "1.0.10")],
        };
        let unsafe_version = AnalyticsBatch {
            client_id: "123.1700000000".to_string(),
            events: vec![event(AnalyticsEventName::AppStart, "</script>")],
        };
        let duplicate_start = AnalyticsBatch {
            client_id: "123.1700000000".to_string(),
            events: vec![
                event(AnalyticsEventName::AppStart, "1.0.10"),
                event(AnalyticsEventName::AppStart, "1.0.10"),
            ],
        };

        assert!(validate_batch(&invalid_id).is_err());
        assert!(validate_batch(&missing_start).is_err());
        assert!(validate_batch(&unsafe_version).is_err());
        assert!(validate_batch(&duplicate_start).is_err());
    }

    #[test]
    fn random_tokens_have_expected_entropy_and_shape() {
        let first = random_hex(32);
        let second = random_hex(32);
        assert_eq!(first.len(), 64);
        assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn rejects_unknown_serialized_fields_and_event_names() {
        let extra_field = serde_json::json!({
            "clientId": "123.1700000000",
            "events": [{
                "name": "app_start",
                "params": {
                    "appVersion": "1.0.10",
                    "osInfo": "Windows",
                    "appPlatform": "tauri_desktop",
                    "callback": "injected"
                }
            }]
        });
        let unknown_event = serde_json::json!({
            "clientId": "123.1700000000",
            "events": [{
                "name": "page_view",
                "params": {
                    "appVersion": "1.0.10",
                    "osInfo": "Windows",
                    "appPlatform": "tauri_desktop"
                }
            }]
        });

        assert!(serde_json::from_value::<AnalyticsBatch>(extra_field).is_err());
        assert!(serde_json::from_value::<AnalyticsBatch>(unknown_event).is_err());
    }

    #[tokio::test]
    async fn ready_wait_handles_success_failure_invalid_order_and_timeout() {
        let (sender, mut receiver) = tokio::sync::mpsc::channel(4);
        sender.send(server::ServerEvent::Ready).await.unwrap();
        assert!(
            wait_for_ready_with_timeout(&mut receiver, Duration::from_millis(10))
                .await
                .is_ok()
        );

        sender.send(server::ServerEvent::LoadFailed).await.unwrap();
        assert!(
            wait_for_ready_with_timeout(&mut receiver, Duration::from_millis(10))
                .await
                .is_err()
        );

        sender
            .send(server::ServerEvent::Acknowledged("stale".to_string()))
            .await
            .unwrap();
        assert!(
            wait_for_ready_with_timeout(&mut receiver, Duration::from_millis(10))
                .await
                .is_err()
        );

        assert!(
            wait_for_ready_with_timeout(&mut receiver, Duration::from_millis(1))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn ack_wait_ignores_stale_callbacks_and_times_out() {
        let (sender, mut receiver) = tokio::sync::mpsc::channel(4);
        sender
            .send(server::ServerEvent::Acknowledged("stale".to_string()))
            .await
            .unwrap();
        sender
            .send(server::ServerEvent::Acknowledged("expected".to_string()))
            .await
            .unwrap();
        assert!(
            wait_for_ack_with_timeout(&mut receiver, "expected", Duration::from_millis(10))
                .await
                .is_ok()
        );

        assert!(wait_for_ack_with_timeout(
            &mut receiver,
            "never-arrives",
            Duration::from_millis(1)
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn active_runtime_can_be_cancelled_and_rejects_stale_generation() {
        let state = AnalyticsRuntimeState::new();
        let generation = state.next_generation();
        let task = tokio::spawn(std::future::pending::<()>());
        state.set_active(ActiveRuntime {
            generation,
            server_abort: task.abort_handle(),
        });

        assert!(state.take_active(Some(generation + 1)).is_none());
        assert!(state.is_current(generation));
        state.next_generation();
        assert!(!state.is_current(generation));

        let active = state.take_active(Some(generation)).unwrap();
        active.server_abort.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(state.take_active(None).is_none());
    }

    #[tokio::test]
    async fn runtime_allows_only_one_in_flight_operation() {
        let state = AnalyticsRuntimeState::new();
        let operation = state.operation.try_lock().unwrap();

        assert!(state.operation.try_lock().is_err());
        drop(operation);
        assert!(state.operation.try_lock().is_ok());
    }
}
