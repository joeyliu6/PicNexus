// src-tauri/src/commands/cookie_login/tests.rs
// cookie_login 的纯函数单测。
//
// 拆成独立文件是因为 cookie_login.rs 带上测试后会顶破 1500 行的文件规模约定
// （AGENTS.md）。这里只测**无平台依赖、无 Tauri 依赖**的那一组：字段名白名单、
// Cookie 字段边界扫描、字段值检查、以及四层默认规则的合流。
//
// 带 `#[tauri::command]` 的入口不在这里测——它们需要真实的 AppHandle，
// `cargo test` 里造不出来，硬写只会得到一堆 `is_err()` 断言，价值极低还会
// 掩盖真正的覆盖缺口。WebView2 相关路径同理，只能真机验，
// 见 docs/audits/cookie-monitoring-silent-failure-2026-09-09.md 的验收清单。

use super::{
    check_cookie_field, check_field_value_matches, get_default_field_value_checks,
    get_default_validation_rules, is_safe_field_name, is_safe_service_id,
    validate_cookie_fields, validate_cookie_fields_with_value_checks,
};
use std::collections::HashMap;

/// 内置服务清单。新增服务时这里也要加，否则 D 组的不变量测试盖不到它。
const BUILTIN_SERVICES: [&str; 6] =
    ["weibo", "zhihu", "nowcoder", "nami", "bilibili", "chaoxing"];

fn checks(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn owned(fields: &[&str]) -> Vec<String> {
    fields.iter().map(|s| s.to_string()).collect()
}

// ── check_cookie_field：本文件最容易改坏的那段边界扫描 ──

#[test]
fn field_name_must_not_match_as_a_suffix_of_another_field() {
    // 这是 is_valid_start 那段判断存在的唯一理由。删掉它，函数照样编译、
    // 对正常输入照样返回 true，只有这条会红。
    assert!(!check_cookie_field("XSUB=abc", "SUB", "weibo"));
}

#[test]
fn field_name_must_not_match_as_a_prefix_of_another_field() {
    // 微博真实场景：SUBP 是另一个字段，不能被当成 SUB。
    assert!(!check_cookie_field("SUBP=abc", "SUB", "weibo"));
}

#[test]
fn scan_continues_after_a_false_prefix_match() {
    // 覆盖 `search_start = absolute_pos + 1` 的续扫。写成 `+= pattern.len()`
    // 可能漏，写成 `break` 必漏——两种都是很自然的"优化"改法。
    assert!(check_cookie_field("XSUB=1; SUB=real", "SUB", "weibo"));
}

#[test]
fn empty_value_counts_as_absent() {
    // 服务端登出时常把 cookie 值置空而不是删除。判成 true 就会把废 cookie
    // 存进配置，用户界面显示"已登录"但上传全部 401。
    assert!(!check_cookie_field("SUB=; SUBP=x", "SUB", "weibo"));
}

#[test]
fn field_matches_at_start_middle_and_end_of_the_cookie() {
    assert!(check_cookie_field("SUB=a", "SUB", "weibo"));
    assert!(check_cookie_field("o=1; SUB=a", "SUB", "weibo"));
    // 无空格分隔也必须认，靠的是 trim_end().ends_with(';')
    assert!(check_cookie_field("o=1;SUB=a", "SUB", "weibo"));
    assert!(check_cookie_field("SUB=a; o=1", "SUB", "weibo"));
}

#[test]
fn single_character_field_name_is_not_matched_inside_another_field() {
    // 牛客的必填字段就叫 `t`，是最容易被子串误匹配的形态。
    assert!(check_cookie_field("acw_tc=1; t=2", "t", "nowcoder"));
    assert!(!check_cookie_field("acw_tc=1", "t", "nowcoder"));
}

#[test]
fn unsafe_field_name_short_circuits_before_scanning() {
    // 注入防线的第二道。save_cookie_from_login 那条路没有前置的字段名校验，
    // 全靠这里兜。
    assert!(!check_cookie_field("a';x=1", "a';x", "weibo"));
    assert!(!check_cookie_field("a b=1", "a b", "weibo"));
    assert!(!check_cookie_field("x=1", "", "weibo"));
}

// ── check_field_value_matches：登录状态判定的核心 ──

#[test]
fn empty_checks_accept_anything() {
    // 短路分支。改成 false 会让 6 个服务里没有值检查的那 5 个集体登录失败。
    assert!(check_field_value_matches("", &HashMap::new()));
    assert!(check_field_value_matches("SUB=a", &HashMap::new()));
}

#[test]
fn weibo_mlogin_zero_is_rejected_and_one_is_accepted() {
    // 微博移动版打开登录页时 MLOGIN=0，登录成功后才变 1。
    // 这条就是"过早保存无效 cookie"与"等到真登录"的分界线。
    let rule = checks(&[("MLOGIN", "1")]);
    assert!(!check_field_value_matches("SUB=a; MLOGIN=0", &rule));
    assert!(check_field_value_matches("SUB=a; MLOGIN=1", &rule));
}

#[test]
fn missing_field_is_rejected_not_silently_ignored() {
    // 少了末尾那个 `if !found` 就会变成"没检查到就放行"——典型的静默失效改法。
    assert!(!check_field_value_matches("SUB=x", &checks(&[("MLOGIN", "1")])));
}

#[test]
fn value_is_compared_after_trim() {
    assert!(check_field_value_matches(
        "MLOGIN= 1 ",
        &checks(&[("MLOGIN", "1")])
    ));
}

#[test]
fn suffix_field_name_does_not_satisfy_the_value_check() {
    // 这段边界判断在本文件里写了两遍（check_cookie_field 一份、这里一份）。
    // 钉住它，防止改一处忘另一处。
    assert!(!check_field_value_matches(
        "XMLOGIN=1",
        &checks(&[("MLOGIN", "1")])
    ));
}

#[test]
fn first_occurrence_wins_on_value_mismatch() {
    // 值不匹配时直接 return false，不会继续找第二个同名字段。
    // 记录这个非显然的行为，把它变成契约而不是巧合。
    assert!(!check_field_value_matches(
        "MLOGIN=0; MLOGIN=1",
        &checks(&[("MLOGIN", "1")])
    ));
}

// ── validate_cookie_fields*：四层默认值合流 ──

#[test]
fn service_defaults_apply_when_frontend_sends_no_rules() {
    // 一次性穿过 validate_cookie_fields → _with_value_checks →
    // get_default_validation_rules → get_default_field_value_checks →
    // check_field_value_matches 五层，证明"前端什么都不传时，微博的
    // MLOGIN=1 默认检查依然生效"。这条路径深到人工 review 看不出断没断。
    assert!(validate_cookie_fields(
        "weibo",
        "SUB=a; SUBP=b; MLOGIN=1",
        &[],
        &[]
    ));
    assert!(!validate_cookie_fields(
        "weibo",
        "SUB=a; SUBP=b; MLOGIN=0",
        &[],
        &[]
    ));
    // 缺 SUBP
    assert!(!validate_cookie_fields("weibo", "SUB=a; MLOGIN=1", &[], &[]));
}

#[test]
fn frontend_required_fields_override_defaults_but_value_checks_still_apply() {
    // 前端传了 requiredFields 就不再要 SUB/SUBP……
    assert!(validate_cookie_fields(
        "weibo",
        "FOO=1; MLOGIN=1",
        &owned(&["FOO"]),
        &[]
    ));
    // ……但服务默认的**值检查**不受 requiredFields 影响，仍然要求 MLOGIN=1。
    // 这个不对称很容易被误读成"传了自定义规则就全接管了"。
    assert!(!validate_cookie_fields(
        "weibo",
        "FOO=1",
        &owned(&["FOO"]),
        &[]
    ));
}

#[test]
fn any_of_fields_requires_at_least_one_present() {
    // 纳米：必填 Auth-Token，另需 Q / T 任一。`any` 写成 `all` 是一字之差。
    assert!(!validate_cookie_fields("nami", "Auth-Token=x", &[], &[]));
    assert!(validate_cookie_fields("nami", "Auth-Token=x; T=1", &[], &[]));
    assert!(validate_cookie_fields("nami", "Auth-Token=x; Q=1", &[], &[]));
}

#[test]
fn explicit_value_checks_take_priority_over_service_defaults() {
    assert!(validate_cookie_fields_with_value_checks(
        "weibo",
        "SUB=a; SUBP=b; MLOGIN=0",
        &[],
        &[],
        &Some(checks(&[("MLOGIN", "0")])),
    ));
}

#[test]
fn empty_explicit_checks_map_falls_back_to_service_defaults() {
    // 前端传的是 `fieldValueChecks || {}`，所以大多数 provider 实际送进来的
    // 就是一张空 map。把守卫写成 `Some(c) => c`（漏掉 !c.is_empty()）会让
    // 微博的默认检查静默失效，而其他所有测试都不会红。
    assert!(!validate_cookie_fields_with_value_checks(
        "weibo",
        "SUB=a; SUBP=b; MLOGIN=0",
        &[],
        &[],
        &Some(HashMap::new()),
    ));
}

#[test]
fn unknown_service_accepts_any_nonempty_cookie_but_rejects_blank() {
    // 无规则兜底。给 `_ =>` 分支加字段会打断所有未收录的服务。
    assert!(validate_cookie_fields("unknown_svc", "x=1", &[], &[]));
    assert!(!validate_cookie_fields("unknown_svc", "   ", &[], &[]));
}

#[test]
fn unsafe_frontend_field_name_is_rejected_not_panicking() {
    assert!(!validate_cookie_fields(
        "weibo",
        "A=1",
        &owned(&["a';drop"]),
        &[]
    ));
}

// ── 跨函数不变量 ──

#[test]
fn every_builtin_service_rule_survives_the_safety_filters() {
    // check_cookie_field 对不合法字段名只 warn 一句就返回 false。若哪天把白名单
    // 收紧（比如去掉 '-' 或 '_'），"Auth-Token" / "__snaker__id" / "z_c0" 这些
    // 真实字段名会集体失效——表现是那几个服务永远登录不上，日志里只有一行 warn。
    // 这条把「默认规则表」和「字段名白名单」这两个各自演进的东西焊在一起。
    for service in BUILTIN_SERVICES {
        assert!(
            is_safe_service_id(service),
            "内置服务 ID {service} 过不了白名单"
        );
        let (required, any_of) = get_default_validation_rules(service);
        for field in required.iter().chain(any_of.iter()) {
            assert!(
                is_safe_field_name(field),
                "{service} 的默认字段 {field} 过不了字段名白名单"
            );
        }
        for key in get_default_field_value_checks(service).keys() {
            assert!(
                is_safe_field_name(key),
                "{service} 的值检查 key {key} 过不了字段名白名单"
            );
        }
    }
}

#[test]
fn only_weibo_carries_a_default_value_check() {
    // 防止有人加一条"全局默认值检查"把其余 5 个服务一起打死。
    assert_eq!(
        get_default_field_value_checks("weibo"),
        checks(&[("MLOGIN", "1")])
    );
    for service in BUILTIN_SERVICES.iter().filter(|s| **s != "weibo") {
        assert!(
            get_default_field_value_checks(service).is_empty(),
            "{service} 不该有默认值检查"
        );
    }
    assert!(get_default_field_value_checks("unknown_svc").is_empty());
}

// ── 白名单边界 ──

#[test]
fn field_and_service_name_length_limits_differ() {
    // 两者上限不同（64 / 32），抄代码时极易写混。
    assert!(is_safe_field_name(&"a".repeat(64)));
    assert!(!is_safe_field_name(&"a".repeat(65)));
    assert!(is_safe_service_id(&"a".repeat(32)));
    assert!(!is_safe_service_id(&"a".repeat(33)));
}

#[test]
fn name_whitelists_reject_empty_and_non_ascii_and_path_tricks() {
    for bad in ["", "a b", "a=b", "../weibo", "服务", "a.b"] {
        assert!(!is_safe_field_name(bad), "字段名 {bad:?} 不该通过");
        assert!(!is_safe_service_id(bad), "服务 ID {bad:?} 不该通过");
    }
    assert!(is_safe_field_name("Auth-Token"));
    assert!(is_safe_field_name("__snaker__id"));
    assert!(is_safe_service_id("nowcoder"));
}
