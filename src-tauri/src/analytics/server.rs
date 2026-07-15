use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderValue, Response, StatusCode},
    routing::{get, post},
    Router,
};
use tokio::{net::TcpListener, sync::mpsc};

const ANALYTICS_HTML: &str = include_str!("analytics.html");
const ANALYTICS_BOOTSTRAP: &str = include_str!("bootstrap.js");
const MAX_CALLBACK_BODY_SIZE: usize = 32;
const EVENT_CHANNEL_CAPACITY: usize = 8;
const REQUEST_ID_HEX_LENGTH: usize = 32;

const CONTENT_SECURITY_POLICY: &str = "default-src 'none'; \
    script-src 'self' https://www.googletagmanager.com; \
    connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com; \
    img-src data: https://www.google-analytics.com https://*.google-analytics.com; \
    base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

#[derive(Debug, PartialEq, Eq)]
pub enum ServerEvent {
    Ready,
    LoadFailed,
    Acknowledged(String),
}

#[derive(Clone)]
struct RouterState {
    events: mpsc::Sender<ServerEvent>,
}

pub struct RunningServer {
    pub page_url: url::Url,
    pub events: mpsc::Receiver<ServerEvent>,
    pub abort_handle: tokio::task::AbortHandle,
}

fn secured_response(content_type: &'static str, body: &'static str) -> Response<Body> {
    let mut response = Response::new(Body::from(body));
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(CONTENT_SECURITY_POLICY),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert("Referrer-Policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        "X-Content-Type-Options",
        HeaderValue::from_static("nosniff"),
    );
    response
}

async fn serve_page() -> Response<Body> {
    secured_response("text/html; charset=utf-8", ANALYTICS_HTML)
}

async fn serve_bootstrap() -> Response<Body> {
    secured_response("application/javascript; charset=utf-8", ANALYTICS_BOOTSTRAP)
}

async fn receive_status(State(state): State<RouterState>, body: Bytes) -> StatusCode {
    let event = match body.as_ref() {
        b"ready" => ServerEvent::Ready,
        b"load_failed" => ServerEvent::LoadFailed,
        _ => return StatusCode::BAD_REQUEST,
    };

    match state.events.try_send(event) {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(mpsc::error::TrySendError::Full(_)) => StatusCode::TOO_MANY_REQUESTS,
        Err(mpsc::error::TrySendError::Closed(_)) => StatusCode::GONE,
    }
}

async fn receive_ack(
    State(state): State<RouterState>,
    Path(request_id): Path<String>,
    body: Bytes,
) -> StatusCode {
    if request_id.len() != REQUEST_ID_HEX_LENGTH
        || !request_id.bytes().all(|byte| byte.is_ascii_hexdigit())
        || body.as_ref() != b"processed"
    {
        return StatusCode::BAD_REQUEST;
    }

    match state.events.try_send(ServerEvent::Acknowledged(request_id)) {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(mpsc::error::TrySendError::Full(_)) => StatusCode::TOO_MANY_REQUESTS,
        Err(mpsc::error::TrySendError::Closed(_)) => StatusCode::GONE,
    }
}

fn build_router(token: &str, events: mpsc::Sender<ServerEvent>) -> Router {
    let base = format!("/a/{token}");
    Router::new()
        .route(&format!("{base}/"), get(serve_page))
        .route(&format!("{base}/bootstrap.js"), get(serve_bootstrap))
        .route(&format!("{base}/status"), post(receive_status))
        .route(&format!("{base}/ack/:request_id"), post(receive_ack))
        .layer(DefaultBodyLimit::max(MAX_CALLBACK_BODY_SIZE))
        .with_state(RouterState { events })
}

pub async fn start(token: String) -> Result<RunningServer, String> {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|error| format!("无法绑定 Analytics 回环端口: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("无法读取 Analytics 回环地址: {error}"))?;
    let (event_tx, event_rx) = mpsc::channel(EVENT_CHANNEL_CAPACITY);
    let app = build_router(&token, event_tx);
    let page_url = url::Url::parse(&format!("http://127.0.0.1:{}/a/{token}/", address.port()))
        .map_err(|error| format!("无法构造 Analytics 页面地址: {error}"))?;
    let task = tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            log::warn!("[Analytics] 本地隔离服务已停止: {}", error);
        }
    });
    Ok(RunningServer {
        page_url,
        events: event_rx,
        abort_handle: task.abort_handle(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use tower::ServiceExt;

    fn router() -> Router {
        let (events, _receiver) = mpsc::channel(EVENT_CHANNEL_CAPACITY);
        build_router("secret-token", events)
    }

    #[tokio::test]
    async fn serves_only_token_scoped_assets_with_security_headers() {
        let response = router()
            .oneshot(
                Request::builder()
                    .uri("/a/secret-token/")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
        assert_eq!(
            response.headers().get("Referrer-Policy").unwrap(),
            "no-referrer"
        );
        assert!(response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
        assert_eq!(
            response.headers().get("X-Content-Type-Options").unwrap(),
            "nosniff"
        );
        let csp = response
            .headers()
            .get(header::CONTENT_SECURITY_POLICY)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(csp.contains("default-src 'none'"));
        assert!(csp.contains("frame-ancestors 'none'"));
    }

    #[tokio::test]
    async fn rejects_unknown_token() {
        let response = router()
            .oneshot(
                Request::builder()
                    .uri("/a/wrong-token/")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn forwards_ready_and_ack_events() {
        let (events, mut receiver) = mpsc::channel(EVENT_CHANNEL_CAPACITY);
        let app = build_router("secret-token", events);
        let ready = app
            .clone()
            .oneshot(
                Request::post("/a/secret-token/status")
                    .body(Body::from("ready"))
                    .unwrap(),
            )
            .await
            .unwrap();
        let ack = app
            .oneshot(
                Request::post("/a/secret-token/ack/0123456789abcdef0123456789abcdef")
                    .body(Body::from("processed"))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(ready.status(), StatusCode::NO_CONTENT);
        assert_eq!(ack.status(), StatusCode::NO_CONTENT);
        assert_eq!(receiver.recv().await, Some(ServerEvent::Ready));
        assert_eq!(
            receiver.recv().await,
            Some(ServerEvent::Acknowledged(
                "0123456789abcdef0123456789abcdef".to_string()
            ))
        );
    }

    #[tokio::test]
    async fn rejects_wrong_methods_unknown_paths_and_invalid_ack_ids() {
        let wrong_method = router()
            .oneshot(
                Request::post("/a/secret-token/")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let unknown_path = router()
            .oneshot(
                Request::get("/a/secret-token/unknown")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let invalid_ack = router()
            .oneshot(
                Request::post("/a/secret-token/ack/not-hex")
                    .body(Body::from("processed"))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(wrong_method.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(unknown_path.status(), StatusCode::NOT_FOUND);
        assert_eq!(invalid_ack.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn rejects_oversized_callback_bodies() {
        let response = router()
            .oneshot(
                Request::post("/a/secret-token/status")
                    .body(Body::from(vec![b'a'; MAX_CALLBACK_BODY_SIZE + 1]))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn applies_backpressure_to_callback_events() {
        let (events, _receiver) = mpsc::channel(EVENT_CHANNEL_CAPACITY);
        let app = build_router("secret-token", events);
        for _ in 0..EVENT_CHANNEL_CAPACITY {
            let response = app
                .clone()
                .oneshot(
                    Request::post("/a/secret-token/status")
                        .body(Body::from("ready"))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NO_CONTENT);
        }

        let response = app
            .oneshot(
                Request::post("/a/secret-token/status")
                    .body(Body::from("ready"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn bootstrap_has_fixed_privacy_controls_and_no_tauri_bridge_usage() {
        for required in [
            "send_page_view: false",
            "allow_google_signals: false",
            "allow_ad_personalization_signals: false",
            "ignore_referrer: true",
            "page_location: 'http://127.0.0.1/analytics'",
            "if (debugMode === true) tagConfig.debug_mode = true",
        ] {
            assert!(ANALYTICS_BOOTSTRAP.contains(required));
        }
        assert!(!ANALYTICS_BOOTSTRAP.contains("__TAURI"));
        assert!(!ANALYTICS_HTML.contains("<form"));
    }

    #[tokio::test]
    async fn aborting_a_running_server_releases_its_task() {
        let running = start("a".repeat(64)).await.unwrap();
        assert_eq!(running.page_url.host_str(), Some("127.0.0.1"));
        assert!(!running.abort_handle.is_finished());

        running.abort_handle.abort();
        for _ in 0..10 {
            if running.abort_handle.is_finished() {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(running.abort_handle.is_finished());
    }
}
