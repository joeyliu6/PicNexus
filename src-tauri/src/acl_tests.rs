// src-tauri/src/acl_tests.rs
// 应用命令的权限边界测试（2026-10-06 对抗式审查 P0：登录窗口里的外部网页能调用全部应用命令）。
//
// Tauri 只在两种情况下检查调用权限：插件命令，或应用在 build.rs 里登记过命令清单（AppManifest）。
// 没登记时，任何页面——包括登录窗口里打开的微博、B 站等外部网站——都能直接调用 PicNexus 的全部命令。
//
// 这里用 Tauri 自带的模拟运行时 + 本应用真实的 generate_context!()（含 build.rs 登记的清单和
// capabilities/ 下的真实权限文件），从 IPC 入口直接发请求。命令一旦过了权限关口，假处理器就回一个
// 固定值，不执行任何真实逻辑。断言三件事：
//   1. 外部网页调用任何已注册命令都被拒；
//   2. 每个窗口只能调到 capability 放行给它的命令，一个不多一个不少；
//   3. 对外的几个窗口（登录窗口两块、统计窗口）放行范围不超过这里写死的上限——防止有人
//      图省事给它们加一行宽泛的权限。
// 「放行清单有没有漏掉前端实际要用的命令」不归这里管，由 scripts/check-window-capabilities.mjs
// （npm run lint）按前端代码逐窗口核对。

use std::collections::BTreeSet;
use std::path::Path;

use serde_json::Value;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};
use tauri::webview::{InvokeRequest, WebviewBuilder};
use tauri::{App, LogicalPosition, LogicalSize, Url, Webview, WebviewUrl, WebviewWindowBuilder};

const MAIN_RS: &str = include_str!("main.rs");
const REACHED: &str = "reached";

/// 本应用会创建的全部 webview：(窗口 label, webview label)。
/// 来源：tauri.conf.json（main）、main.rs（tray-menu）、commands/cookie_login.rs（登录窗口两块）、
/// analytics/mod.rs（统计窗口）。新增窗口时这里也要加，否则它的权限没人测。
const WEBVIEWS: [(&str, &str); 5] = [
    ("main", "main"),
    ("tray-menu", "tray-menu"),
    ("login-window", "login-titlebar"),
    ("login-window", "login-content"),
    ("analytics-transport", "analytics-transport"),
];

/// 对外窗口的放行上限：这些 webview 会加载外部网站或只承载 PicNexus 的一小页，
/// 放行范围必须是下面列出的子集。
const OUTWARD_CEILINGS: [(&str, &[&str]); 3] = [
    ("login-titlebar", &[]),
    // 登录引导页（login-webview.html）跳去外部网站之前要用这两个；跳走之后来源变成远程，一个都用不了
    (
        "login-content",
        &["setup_cookie_event_monitoring", "show_login_window"],
    ),
    ("analytics-transport", &[]),
];

/// Tauri 认定为「本地页」的地址：自定义协议的根（Windows 上是 http://tauri.localhost）
fn local_url() -> Url {
    let raw = if cfg!(windows) {
        "http://tauri.localhost/index.html"
    } else {
        "tauri://localhost/index.html"
    };
    raw.parse().expect("local url")
}

fn remote_urls() -> Vec<Url> {
    [
        // 登录入口真实会打开的站点
        "https://m.weibo.cn/",
        // 任意第三方站点
        "https://example.com/",
        // 统计窗口加载的本机统计页就是这种形态：对 Tauri 来说它也是远程页
        "http://127.0.0.1:61449/a/token/?cid=1.2",
    ]
    .iter()
    .map(|raw| raw.parse().expect("remote url"))
    .collect()
}

/// main.rs 里 generate_handler! 注册的全部命令名（取每条路径的最后一段）
fn registered_commands() -> Vec<String> {
    let start = MAIN_RS
        .find("generate_handler![")
        .expect("main.rs 里找不到 generate_handler![")
        + "generate_handler![".len();
    let end = start + MAIN_RS[start..].find(']').expect("generate_handler! 没有闭合");
    // 先按行去掉 `//` 注释再切：被注释掉的命令不算注册
    let without_comments: String = MAIN_RS[start..end]
        .lines()
        .map(|line| line.split("//").next().unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\n");
    let commands: Vec<String> = without_comments
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(|path| path.rsplit("::").next().unwrap_or(path).to_string())
        .collect();
    assert!(
        commands.len() > 50,
        "只解析出 {} 个命令，generate_handler! 的写法可能变了",
        commands.len()
    );
    commands
}

/// 一份 capability 对应用命令的放行：它管哪些窗口/webview，放行了哪些命令
struct CapabilityGrant {
    windows: Vec<String>,
    webviews: Vec<String>,
    commands: BTreeSet<String>,
}

fn string_list(value: &Value, key: &str) -> Vec<String> {
    value[key]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// 读 tauri.conf.json 启用的 capability，提取其中的应用命令权限（`allow-<命令名>`，不带插件前缀）
fn active_capability_grants() -> Vec<CapabilityGrant> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let conf: Value = serde_json::from_str(
        &std::fs::read_to_string(manifest_dir.join("tauri.conf.json")).expect("read tauri.conf.json"),
    )
    .expect("parse tauri.conf.json");
    let active = string_list(&conf["app"]["security"], "capabilities");

    let mut grants = Vec::new();
    for entry in std::fs::read_dir(manifest_dir.join("capabilities")).expect("read capabilities/") {
        let path = entry.expect("capability entry").path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let capability: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("read capability"))
                .expect("parse capability");
        let identifier = capability["identifier"].as_str().unwrap_or_default();
        if !active.iter().any(|id| id == identifier) {
            continue;
        }
        assert!(
            capability.get("remote").is_none(),
            "{} 给远程页面开了口子（remote 字段）。本应用没有任何远程页面需要调用命令",
            path.display()
        );

        let commands = capability["permissions"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|permission| permission.as_str())
            .filter(|permission| !permission.contains(':'))
            .map(|permission| {
                permission
                    .strip_prefix("allow-")
                    .unwrap_or_else(|| panic!("{}：应用命令权限只该用 allow-<命令名>，看到 {permission}", path.display()))
                    .replace('-', "_")
            })
            .collect();

        let grant = CapabilityGrant {
            windows: string_list(&capability, "windows"),
            webviews: string_list(&capability, "webviews"),
            commands,
        };
        // Tauri 支持通配符窗口名，但那会把命令悄悄放行给将来新建的任何窗口；下面的
        // granted_to 也只按精确名字算，混进通配符就测不准了
        assert!(
            grant.commands.is_empty()
                || !grant.windows.iter().chain(&grant.webviews).any(|label| label.contains('*')),
            "{} 用通配符窗口名放行应用命令，请写出具体的窗口 / webview 名",
            path.display()
        );
        grants.push(grant);
    }
    assert!(!grants.is_empty(), "一份启用的 capability 都没读到");
    grants
}

/// 按 Tauri 的匹配口径（窗口 label 或 webview label 命中即生效）算出某个 webview 的放行合集
fn granted_to(grants: &[CapabilityGrant], window: &str, webview: &str) -> BTreeSet<String> {
    grants
        .iter()
        .filter(|grant| {
            grant.windows.iter().any(|label| label == window)
                || grant.webviews.iter().any(|label| label == webview)
        })
        .flat_map(|grant| grant.commands.iter().cloned())
        .collect()
}

/// get_ipc_response 只接受 AsRef<Webview>，而 Tauri 只给 WebviewWindow 实现了它
struct Target(Webview<MockRuntime>);

impl AsRef<Webview<MockRuntime>> for Target {
    fn as_ref(&self) -> &Webview<MockRuntime> {
        &self.0
    }
}

fn mock_app() -> App<MockRuntime> {
    mock_builder()
        // 只验证权限关口：过了关口就回固定值，绝不执行真实命令
        .invoke_handler(|invoke| {
            invoke.resolver.resolve(REACHED);
            true
        })
        .build(tauri::generate_context!())
        .expect("build mock app")
}

/// 按真实的窗口结构建出全部 webview，返回 (窗口 label, webview label, webview)
fn build_webviews(app: &App<MockRuntime>) -> Vec<(&'static str, &'static str, Webview<MockRuntime>)> {
    let window_page = |label: &str| {
        WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
            .build()
            .unwrap_or_else(|e| panic!("create {label}: {e}"))
    };

    let main = window_page("main");
    let tray = window_page("tray-menu");
    let analytics = window_page("analytics-transport");

    let login_window = tauri::window::WindowBuilder::new(app, "login-window")
        .build()
        .expect("create login-window");
    let child = |label: &str, page: &str| {
        login_window
            .add_child(
                WebviewBuilder::new(label, WebviewUrl::App(page.into())),
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(800.0, 600.0),
            )
            .unwrap_or_else(|e| panic!("create {label}: {e}"))
    };
    let titlebar = child("login-titlebar", "login-titlebar.html");
    let content = child("login-content", "login-webview.html");

    let webviews = vec![
        ("main", "main", main.as_ref().clone()),
        ("tray-menu", "tray-menu", tray.as_ref().clone()),
        ("login-window", "login-titlebar", titlebar),
        ("login-window", "login-content", content),
        ("analytics-transport", "analytics-transport", analytics.as_ref().clone()),
    ];
    assert_eq!(
        webviews.iter().map(|(w, v, _)| (*w, *v)).collect::<Vec<_>>(),
        WEBVIEWS.to_vec(),
        "build_webviews 与 WEBVIEWS 清单不一致"
    );
    webviews
}

fn reaches(webview: &Webview<MockRuntime>, command: &str, url: &Url) -> bool {
    get_ipc_response(
        &Target(webview.clone()),
        InvokeRequest {
            cmd: command.to_string(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: url.clone(),
            body: InvokeBody::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .is_ok()
}

#[test]
fn remote_pages_cannot_reach_any_app_command() {
    let app = mock_app();
    let commands = registered_commands();

    let mut leaks = Vec::new();
    for (window, webview_label, webview) in build_webviews(&app) {
        for url in remote_urls() {
            for command in &commands {
                if reaches(&webview, command, &url) {
                    leaks.push(format!("{window}/{webview_label} @ {url} → {command}"));
                }
            }
        }
    }

    assert!(
        leaks.is_empty(),
        "外部网页能调用 {} 次应用命令（应为 0），例如：\n{}",
        leaks.len(),
        leaks.iter().take(10).cloned().collect::<Vec<_>>().join("\n")
    );
}

#[test]
fn each_window_reaches_exactly_its_granted_commands() {
    let app = mock_app();
    let commands = registered_commands();
    let grants = active_capability_grants();
    let local = local_url();

    let mut mismatches = Vec::new();
    for (window, webview_label, webview) in build_webviews(&app) {
        let granted = granted_to(&grants, window, webview_label);
        for command in &commands {
            let expected = granted.contains(command);
            if reaches(&webview, command, &local) != expected {
                mismatches.push(format!(
                    "{window}/{webview_label} → {command}：期望{}，实际相反",
                    if expected { "放行" } else { "拒绝" }
                ));
            }
        }
    }

    assert!(
        mismatches.is_empty(),
        "{} 处权限与 capability 文件不符，例如：\n{}",
        mismatches.len(),
        mismatches.iter().take(10).cloned().collect::<Vec<_>>().join("\n")
    );
}

#[test]
fn outward_facing_webviews_stay_within_their_ceiling() {
    let grants = active_capability_grants();
    for (webview_label, ceiling) in OUTWARD_CEILINGS {
        let window = WEBVIEWS
            .iter()
            .find(|(_, label)| *label == webview_label)
            .map(|(window, _)| *window)
            .expect("ceiling for unknown webview");
        let ceiling: BTreeSet<String> = ceiling.iter().map(|c| c.to_string()).collect();
        let extra: Vec<_> = granted_to(&grants, window, webview_label)
            .difference(&ceiling)
            .cloned()
            .collect();
        assert!(
            extra.is_empty(),
            "{webview_label} 会加载外部网站或只是一页引导，却被放行了上限以外的命令：{extra:?}"
        );
    }
}
