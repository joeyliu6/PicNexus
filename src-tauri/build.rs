fn main() {
    // analytics/heartbeat.rs 用 option_env! 在编译期读取该密钥。cargo 默认感知不到
    // 环境变量变化，没有这行的话：先前无密钥编译过一次，之后配上密钥重新构建会命中
    // 缓存、继续编出"心跳已禁用"的产物。
    println!("cargo:rerun-if-env-changed=PICNEXUS_GA_API_SECRET");
    tauri_build::build()
}
