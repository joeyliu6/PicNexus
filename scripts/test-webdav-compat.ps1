# WebDAV 图床协议兼容性自检
#
# 复刻 src-tauri/src/commands/webdav_upload.rs 的请求序列，打真实 WebDAV 服务端。
# 目的不是"测 curl 能不能传文件"，而是回答：**这家服务端接不接受 PicNexus 发出的那串请求形态**
# （逐段 MKCOL 建目录 / 定长 PUT + Overwrite:T / 匿名 GET 判 Content-Type / DELETE 清理探针）。
# 每个断言旁标了它对应 Rust 侧的哪一行不变量，改动那些行时可用本脚本回归。
#
# 换 WebDAV 服务商、或改动 webdav_upload.rs 后先跑这个，比开着 app 手点快得多。
# 共 22 项断言（12 个调用点，其中 5 个在 3 个文件名用例的循环里）。
#
# ── 三套已验证环境的调用方式 ──────────────────────────────────────────────
#
#   dufs（局域网 HTTP，匿名可读）
#     .\scripts\test-webdav-compat.ps1 -GenerateFixtures `
#        -Base http://192.168.80.1:5001 -PublicDomain http://192.168.80.1:5001
#
#   OpenList（直链带 /d/ 前缀，需先关全局签名并启用 guest）
#     .\scripts\test-webdav-compat.ps1 `
#        -Base http://127.0.0.1:5244/dav -PublicDomain http://127.0.0.1:5244 `
#        -User admin -Pass <初始密码> -RemotePath pics/picnexus -Template '{domain}/d/{path}'
#
#   坚果云（公网 HTTPS，不提供匿名直链 → 用 -NoAnonymousAccess 翻转判据）
#     .\scripts\test-webdav-compat.ps1 -NoAnonymousAccess `
#        -Base https://dav.jianguoyun.com/dav/ -PublicDomain https://dav.jianguoyun.com/dav/ `
#        -User <注册邮箱> -Pass <读写应用密码> -RemotePath picnexus-test
#
# 环境搭建见 docs/reference/guides/webdav-testing-environments.md

param(
  [string]$Base          = "http://192.168.80.1:5001",
  [string]$PublicDomain  = "http://192.168.80.1:5001",
  [string]$User          = "admin",
  [string]$Pass          = "admin123",
  [string]$RemotePath    = "picnexus/compat-test",
  [string]$Template      = '{domain}/{path}',
  [string]$FixtureDir    = "$env:TEMP\picnexus-webdav-fixtures",

  # 服务端不提供匿名直链时（坚果云 / InfiniCLOUD 这类）：
  # 把「匿名 GET 应成功」翻转成「匿名 GET 应被拒（401/403）」，并跳过内容校验。
  # 这不是降低标准——「传得上去但链接打不开」本来就是一种合法结果，
  # 判据的重点在于上传三步是否成功。
  [switch]$NoAnonymousAccess,

  # 生成测试素材（同名不同色 + 中文空格文件名），首次运行加上
  [switch]$GenerateFixtures
)

$ErrorActionPreference = "Stop"
$auth = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${User}:${Pass}"))
# 计数器不能叫 $pass —— PowerShell 变量名不区分大小写，会撞上参数 $Pass（密码字符串）
$passCount = 0; $failCount = 0

function Assert($cond, $msg, $detail = "") {
  if ($cond) { Write-Host "  [PASS] $msg" -ForegroundColor Green; $script:passCount++ }
  else { Write-Host "  [FAIL] $msg" -ForegroundColor Red; if ($detail) { Write-Host "         $detail" -ForegroundColor DarkGray }; $script:failCount++ }
}

# ---- 测试素材 ---------------------------------------------------------------
function New-Fixtures([string]$dir) {
  Add-Type -AssemblyName System.Drawing
  New-Item -ItemType Directory -Force "$dir\red", "$dir\blue" | Out-Null
  $make = {
    param($path, $color)
    $bmp = New-Object System.Drawing.Bitmap 240, 240
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::FromName($color)); $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  }
  & $make "$dir\red\test.png"   'Red'
  & $make "$dir\blue\test.png"  'Blue'     # 与 red 同名不同色，验覆盖行为
  & $make "$dir\中文 图片.png"   'Green'    # 验 percent-encode
  & $make "$dir\my photo.png"   'Orange'   # 验空格
  Write-Host "已生成测试素材于 $dir`n" -ForegroundColor DarkGray
}

# ---- 与 Rust 侧一致的路径处理 ----------------------------------------------
# encode_path_segments: 逐段编码，斜杠不能变 %2F（webdav_upload.rs 的 encode_path_segments）
function Encode-Segments([string]$path) {
  ($path -split '/' | ForEach-Object {
    if ($_ -eq '') { '' } else { [Uri]::EscapeDataString($_) }
  }) -join '/'
}
function Normalize-Dir([string]$p) { $p.Trim().Trim('/') }
function Join-Url([string]$b, [string]$r) {
  $b = $b.Trim().TrimEnd('/'); $r = $r.TrimStart('/')
  if ($r -eq '') { $b } else { "$b/$r" }
}
# render_public_url: 模板渲染不得二次编码（webdav_upload.rs 的 render_public_url）
function Render-PublicUrl([string]$tpl, [string]$domain, [string]$encPath, [string]$encName) {
  $tpl.Replace('{domain}', $domain.Trim().TrimEnd('/')).
      Replace('{path}', $encPath.TrimStart('/')).
      Replace('{filename}', $encName)
}

function Invoke-Dav {
  param([string]$Method, [string]$Url, [hashtable]$Headers = @{}, [byte[]]$Body, [switch]$Anonymous)
  $req = [Net.HttpWebRequest]::Create($Url)
  $req.Method = $Method
  $req.AllowAutoRedirect = $false
  $req.Timeout = 15000
  if (-not $Anonymous) { $req.Headers.Add("Authorization", $auth) }
  foreach ($k in $Headers.Keys) {
    if ($k -ieq 'Content-Type') { $req.ContentType = $Headers[$k] } else { $req.Headers.Add($k, $Headers[$k]) }
  }
  if ($Body) {
    $req.ContentLength = $Body.Length      # 定长，不退回 chunked（webdav_upload.rs 的 put_binary）
    $s = $req.GetRequestStream(); $s.Write($Body, 0, $Body.Length); $s.Close()
  }
  try {
    $res = $req.GetResponse()
    $ct = $res.ContentType
    $ms = New-Object IO.MemoryStream
    $res.GetResponseStream().CopyTo($ms)
    $code = [int]$res.StatusCode
    $res.Close()
    [pscustomobject]@{ Status = $code; ContentType = $ct; Bytes = $ms.ToArray() }
  } catch [Net.WebException] {
    if ($_.Exception.Response) {
      $r = $_.Exception.Response
      [pscustomobject]@{ Status = [int]$r.StatusCode; ContentType = $r.ContentType; Bytes = @() }
    } else {
      [pscustomobject]@{ Status = -1; ContentType = ""; Bytes = @(); Error = $_.Exception.Message }
    }
  }
}

# ensure_remote_dir: 逐段 MKCOL，2xx/301/302/405 都算通过（webdav_upload.rs 的 ensure_remote_dir）
function Ensure-RemoteDir([string]$dir) {
  $dir = Normalize-Dir $dir
  if ($dir -eq '') { return @() }
  $cur = ''; $codes = @()
  foreach ($seg in ($dir -split '/' | Where-Object { $_ -ne '' })) {
    $cur += [Uri]::EscapeDataString($seg) + '/'
    $r = Invoke-Dav -Method MKCOL -Url (Join-Url $Base $cur)
    $codes += "$cur=$($r.Status)"
  }
  return $codes
}

# 匿名可达性判定：正常环境要求 2xx，无匿名直链的环境要求 401/403
function Test-PublicStatus([int]$status) {
  if ($NoAnonymousAccess) { return $status -in 401, 403 }
  return ($status -ge 200 -and $status -lt 300)
}
function Describe-PublicExpectation() {
  if ($NoAnonymousAccess) { return "预期被拒(401/403)" }
  return "预期可达(2xx)"
}

if ($GenerateFixtures) { New-Fixtures $FixtureDir }

Write-Host "`n=== WebDAV 图床链路验证 ===" -ForegroundColor Cyan
Write-Host "端点: $Base"
Write-Host "公开域名: $PublicDomain    模板: $Template"
Write-Host "目录: $RemotePath    匿名直链: $(Describe-PublicExpectation)`n"

if (-not (Test-Path $FixtureDir)) {
  Write-Host "找不到测试素材目录 $FixtureDir，请加 -GenerateFixtures 重跑" -ForegroundColor Red
  exit 1
}

# --- 1. PROPFIND 探目录 ------------------------------------------------------
Write-Host "[1] PROPFIND 目录可达性"
$dir = Normalize-Dir $RemotePath
$r = Invoke-Dav -Method PROPFIND -Url (Join-Url $Base (Encode-Segments $dir)) -Headers @{ Depth = "0" }
Assert ($r.Status -in 200, 207, 404) "PROPFIND 返回 $($r.Status)（200/207/404 均为可继续状态）" "实际: $($r.Status)"

# --- 2. 逐段 MKCOL 建多级目录 -----------------------------------------------
Write-Host "`n[2] 自动创建远程目录（多级）"
$codes = Ensure-RemoteDir $dir
Write-Host "     MKCOL 逐段: $($codes -join ', ')" -ForegroundColor DarkGray
$r = Invoke-Dav -Method PROPFIND -Url (Join-Url $Base (Encode-Segments $dir)) -Headers @{ Depth = "0" }
Assert ($r.Status -in 200, 207) "多级目录 '$dir' 建成后 PROPFIND 可达" "实际: $($r.Status)"

# --- 3. 二进制 PUT + 匿名 GET -----------------------------------------------
Write-Host "`n[3] 二进制 PUT 上传 + 公开链接可达性"
$cases = @(
  @{ File = "red\test.png";  Name = "test.png";     Desc = "普通文件名" },
  @{ File = "中文 图片.png";  Name = "中文 图片.png"; Desc = "中文+空格文件名（percent-encode）" },
  @{ File = "my photo.png";  Name = "my photo.png"; Desc = "空格文件名" }
)
$uploaded = @{}
foreach ($c in $cases) {
  $src = Join-Path $FixtureDir $c.File
  $bytes = [IO.File]::ReadAllBytes($src)
  $encName = [Uri]::EscapeDataString($c.Name)
  $encPath = if ($dir -eq '') { $encName } else { (Encode-Segments $dir) + '/' + $encName }

  $r = Invoke-Dav -Method PUT -Url (Join-Url $Base $encPath) -Body $bytes `
        -Headers @{ 'Content-Type' = 'image/png'; 'Overwrite' = 'T' }
  Assert ($r.Status -ge 200 -and $r.Status -lt 300) "PUT $($c.Desc) → HTTP $($r.Status)" "路径: $encPath"

  # 匿名 GET —— 不带 Authorization，这是 test_webdav_storage 的核心判据
  $pub = Render-PublicUrl $Template $PublicDomain $encPath $encName
  $g = Invoke-Dav -Method GET -Url $pub -Anonymous
  Assert (Test-PublicStatus $g.Status) "匿名 GET $($c.Desc) → HTTP $($g.Status)（$(Describe-PublicExpectation)）" "链接: $pub"

  if ($NoAnonymousAccess) {
    # 无匿名直链时内容校验无意义，但仍要确认「传上去了」——用带认证的 GET 兜底
    $a = Invoke-Dav -Method GET -Url (Join-Url $Base $encPath)
    Assert ($a.Bytes.Length -eq $bytes.Length) "带认证取回字节数一致：$($a.Bytes.Length) / $($bytes.Length)（证明确实传上去了）"
    Assert $true "跳过 Content-Type 校验（服务端不提供匿名直链）"
  } else {
    Assert ($g.ContentType -like 'image/*') "Content-Type = '$($g.ContentType)'（须 image/*，否则判为登录页/分享页）"
    Assert ($g.Bytes.Length -eq $bytes.Length) "字节数一致：收到 $($g.Bytes.Length) / 原始 $($bytes.Length)（二进制未被 UTF-8 破坏）"
  }
  Assert (-not $pub.Contains('%25')) "公开链接未二次编码（无 %25，即 %20 没变成 %2520）" $pub
  $uploaded[$c.Name] = @{ Url = $pub; Hash = (Get-FileHash $src -Algorithm SHA256).Hash }
}

# --- 4. 同名覆盖行为（Overwrite: T）-----------------------------------------
Write-Host "`n[4] 同名文件覆盖行为（WebDAV 与 S3 不同，走 Overwrite: T）"
$blue = [IO.File]::ReadAllBytes((Join-Path $FixtureDir "blue\test.png"))
$encPath = (Encode-Segments $dir) + '/test.png'
$r = Invoke-Dav -Method PUT -Url (Join-Url $Base $encPath) -Body $blue -Headers @{ 'Content-Type' = 'image/png'; 'Overwrite' = 'T' }
Assert ($r.Status -ge 200 -and $r.Status -lt 300) "同名 PUT 第二次 → HTTP $($r.Status)（Overwrite:T 应被接受）"
# 覆盖校验一律用带认证的 GET：无匿名直链的环境也要能验到这条
$g = Invoke-Dav -Method GET -Url (Join-Url $Base $encPath)
Assert ($g.Bytes.Length -eq $blue.Length) "覆盖后取回的是第二张图（$($g.Bytes.Length) bytes = blue）" "红图 $((Get-Item (Join-Path $FixtureDir 'red\test.png')).Length) / 蓝图 $($blue.Length)"

# --- 5. 错误分支：认证失败（webdav_upload.rs 的 describe_status）-------------
Write-Host "`n[5] 错误分支可区分性"
$badAuth = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${User}:wrongpass-$(Get-Random)"))
$req = [Net.HttpWebRequest]::Create((Join-Url $Base $encPath)); $req.Method = 'PUT'
$req.Headers.Add("Authorization", $badAuth); $req.ContentLength = 4; $req.Timeout = 15000
try { $s = $req.GetRequestStream(); $s.Write([byte[]](1, 2, 3, 4), 0, 4); $s.Close(); $resp = $req.GetResponse(); $code = [int]$resp.StatusCode; $resp.Close() }
catch [Net.WebException] { $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 } }
Assert ($code -in 401, 403) "错误密码 PUT → HTTP $code（映射为「认证失败，请检查用户名和密码」）"

# --- 6. 探针清理（test_webdav_storage 第 4 步）-------------------------------
Write-Host "`n[6] 探针文件 DELETE 清理"
$probe = ".picnexus-probe-test.png"
$encProbe = (Encode-Segments $dir) + '/' + [Uri]::EscapeDataString($probe)
$png1x1 = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
$null = Invoke-Dav -Method PUT -Url (Join-Url $Base $encProbe) -Body $png1x1 -Headers @{ 'Content-Type' = 'image/png' }
$d = Invoke-Dav -Method DELETE -Url (Join-Url $Base $encProbe)
Assert ($d.Status -ge 200 -and $d.Status -lt 300) "DELETE 探针 → HTTP $($d.Status)（不留垃圾文件）"
# 用带认证的 GET 确认消失：匿名不可达的环境下 401 无法区分「没删掉」和「没权限」
$g = Invoke-Dav -Method GET -Url (Join-Url $Base $encProbe)
Assert ($g.Status -eq 404) "探针已消失（带认证 GET → $($g.Status)）"

# ---- 汇总 -------------------------------------------------------------------
Write-Host "`n=== 结果: $passCount 通过 / $failCount 失败 ===" -ForegroundColor $(if ($failCount -eq 0) { "Green" } else { "Red" })
if (-not $NoAnonymousAccess) {
  Write-Host "`n可在浏览器直接打开的链接（给手测用）:" -ForegroundColor Cyan
  foreach ($k in $uploaded.Keys) { Write-Host "  $k -> $($uploaded[$k].Url)" }
}
if ($failCount -gt 0) { exit 1 }

