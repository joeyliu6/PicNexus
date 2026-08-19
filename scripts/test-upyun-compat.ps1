# 又拍云图床协议兼容性自检
#
# 复刻 PicNexus 三条又拍云链路各自的请求形态，打真实又拍云服务端。
# 目的不是"测能不能传图"，而是回答三个从代码上看不出答案的问题：
#
#   1. GUI 上传把「操作员账号/密码」当 S3 的 AccessKey/SecretKey 用，又拍云认不认？
#      （官方文档说 S3 凭证要去控制台「操作员-编辑」或「操作员授权-S3访问凭证」单独取）
#   2. 编辑器链路加上 path 前缀后，父目录不存在时又拍云会自动建吗？
#      （官方文档只说创建目录是独立的 POST folder=true 接口，没写 PUT 的行为）
#   3. 又拍云协议层面允不允许同名覆盖？（决定代码要不要做文件名唯一化——结论：要，已做）
#
# 又拍云在 PicNexus 里是**三条独立链路**，用不同的域名和认证方式，必须分开测：
#
#   A 连接测试   REST GET  v0.api.upyun.com  <- s3_compatible.rs::test_upyun_connection
#   B 编辑器上传 REST PUT  v0.api.upyun.com  <- upload_handler.rs::server_upload_upyun
#   C GUI 上传   S3   PUT  s3.api.upyun.com  <- s3_compatible.rs::upload_to_s3_compatible
#   D 回读校验   HEAD 公开域名                <- 验 Content-Type 是否落对（issue #4）
#
# A 走 REST、C 走 S3，认证方式完全不同：**A 通过不代表 C 能通过**。
# 设置页那个「测试连接」按钮走的就是 A，所以它亮绿灯不能证明上传可用。
#
# ── 用法 ──────────────────────────────────────────────────────────────
#
#   首次（交互式填凭证，填完存到 scripts\.upyun.local，下次免填）：
#     .\scripts\test-upyun-compat.ps1 -SaveCredentials
#
#   之后：
#     .\scripts\test-upyun-compat.ps1
#
#   带 S3 专用凭证做对照（强烈建议，能直接定位问题 1 的根因）：
#     .\scripts\test-upyun-compat.ps1 -S3AccessKey xxx -S3SecretKey yyy -SaveCredentials
#
# 凭证文件 scripts\.upyun.local 命中 .gitignore 的 *.local，不会进仓库。
# 完整结论写到 scripts\.upyun-result.local，可直接贴给 AI 看。
#
# 审查背景见 docs/audits/upyun-audit-2026-08-19.md

param(
  [string]$Operator,
  [string]$Password,
  [string]$Bucket,
  [string]$PublicDomain,

  # 存储路径前缀，对应设置页「存储路径」。两条链路都认（编辑器侧 2026-08-19 补齐）。
  [string]$UploadPath = "images/",

  # 控制台单独生成的 S3 访问凭证，用作对照组。留空则跳过 C2。
  [string]$S3AccessKey,
  [string]$S3SecretKey,

  # SigV4 签名用的 region。PicNexus 写死 "upyun"（UpyunUploader.ts::getRegion）。
  # 又拍云文档称"不支持配置区域"，所以这个值到底要填什么只能实测。
  [string]$Region = "upyun",

  [string]$CredentialFile = "$PSScriptRoot\.upyun.local",
  [string]$ResultFile     = "$PSScriptRoot\.upyun-result.local",

  # 把本次填的凭证存起来，下次免填
  [switch]$SaveCredentials,

  # 跳过交互式提问（CI / 自检用），缺什么就报什么
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RestHost = "https://v0.api.upyun.com"
$S3Host   = "s3.api.upyun.com"

# ── 输出helper ────────────────────────────────────────────────────────
$script:Transcript = New-Object System.Collections.Generic.List[string]

function Say([string]$Text, [string]$Color = "Gray") {
  Write-Host $Text -ForegroundColor $Color
  $script:Transcript.Add($Text)
}
function Section([string]$Title) {
  Say ""
  Say ("=" * 66) "DarkGray"
  Say $Title "Cyan"
  Say ("=" * 66) "DarkGray"
}
function Pass([string]$Text) { Say "  [通过] $Text" "Green" }
function Fail([string]$Text) { Say "  [失败] $Text" "Red" }
function Warn([string]$Text) { Say "  [注意] $Text" "Yellow" }
function Info([string]$Text) { Say "  [信息] $Text" "Gray" }

# ── 凭证装载 ──────────────────────────────────────────────────────────
function Read-CredentialFile([string]$Path) {
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  foreach ($line in (Get-Content $Path -Encoding UTF8)) {
    if ($line -match '^\s*#') { continue }
    if ($line -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') {
      $map[$Matches[1]] = $Matches[2].Trim()
    }
  }
  return $map
}

$saved = Read-CredentialFile $CredentialFile
if (-not $Operator     -and $saved.ContainsKey("Operator"))     { $Operator     = $saved["Operator"] }
if (-not $Password     -and $saved.ContainsKey("Password"))     { $Password     = $saved["Password"] }
if (-not $Bucket       -and $saved.ContainsKey("Bucket"))       { $Bucket       = $saved["Bucket"] }
if (-not $PublicDomain -and $saved.ContainsKey("PublicDomain")) { $PublicDomain = $saved["PublicDomain"] }
if (-not $S3AccessKey  -and $saved.ContainsKey("S3AccessKey"))  { $S3AccessKey  = $saved["S3AccessKey"] }
if (-not $S3SecretKey  -and $saved.ContainsKey("S3SecretKey"))  { $S3SecretKey  = $saved["S3SecretKey"] }

function Ask([string]$Prompt, [string]$Current, [switch]$Optional) {
  if ($Current) { return $Current }
  if ($NonInteractive) {
    if ($Optional) { return "" }
    throw "缺少参数：$Prompt（-NonInteractive 下不提问）"
  }
  $suffix = if ($Optional) { "（可留空跳过）" } else { "" }
  return (Read-Host "$Prompt$suffix").Trim()
}

Write-Host ""
Write-Host "又拍云兼容性自检 —— 需要 4 项必填 + 2 项可选" -ForegroundColor Cyan
Write-Host "去哪拿：又拍云控制台 -> 云存储 -> 选中服务空间 -> 配置 -> 存储管理 -> 操作员授权" -ForegroundColor DarkGray
Write-Host ""

$Operator     = Ask "操作员账号" $Operator
$Password     = Ask "操作员密码" $Password
$Bucket       = Ask "服务空间名（bucket）" $Bucket
$PublicDomain = Ask "公开访问域名（如 https://xxx.test.upcdn.net，留空则跳过 Content-Type 回读）" $PublicDomain -Optional
$S3AccessKey  = Ask "S3 AccessKey（对照组，同一页面的「S3访问凭证」）" $S3AccessKey -Optional
$S3SecretKey  = Ask "S3 SecretKey（对照组）" $S3SecretKey -Optional

if (-not $Operator -or -not $Password -or -not $Bucket) {
  throw "操作员账号 / 密码 / 服务空间名 三项必填。"
}

if ($SaveCredentials) {
  $lines = @(
    "# PicNexus 又拍云自检凭证 —— 命中 .gitignore 的 *.local，不会进仓库",
    "# 删掉这个文件即可让脚本重新提问",
    "Operator=$Operator",
    "Password=$Password",
    "Bucket=$Bucket",
    "PublicDomain=$PublicDomain",
    "S3AccessKey=$S3AccessKey",
    "S3SecretKey=$S3SecretKey"
  )
  $lines | Out-File -FilePath $CredentialFile -Encoding utf8
  Write-Host "凭证已存到 $CredentialFile（下次直接跑，不用再填）" -ForegroundColor DarkGray
}

# ── 测试素材：1x1 透明 PNG，跟 Rust 单测里的 tiny_png 同款 ────────────
$TinyPngHex = "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489" +
              "0000000A49444154789C63000100000500010D0A2DB40000000049454E44AE426082"

# B3 的第二发用**另一张字节数不同**的合法 PNG（4x2 实色，126 字节 vs 上面的 67 字节）。
# Why 不能重复传同一张：两次传一样的字节，回读结果也一样，分不清"旧的被顶掉了"
# 还是"服务端识别出重复、原样留着"。字节数不同才能证明桶里的内容确实被替换了。
$OverwritePngHex = "89504E470D0A1A0A0000000D49484452000000040000000208060000007FA87D" +
                   "63000000017352474200AECE1CE90000000467414D410000B18F0BFC61050000" +
                   "00097048597300000EC300000EC301C76FA86400000013494441541857633821" +
                   "17F51F19A30944FD07002E2511F96B9358F90000000049454E44AE426082"

function ConvertFrom-HexString([string]$Hex) {
  $bytes = New-Object byte[] ($Hex.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    $bytes[$i] = [Convert]::ToByte($Hex.Substring($i * 2, 2), 16)
  }
  return ,$bytes
}

$TinyPng      = ConvertFrom-HexString $TinyPngHex
$OverwritePng = ConvertFrom-HexString $OverwritePngHex

$Stamp   = Get-Date -Format "HHmmss"
$Prefix  = $UploadPath.Trim('/')
$NameB   = "picnexus-rest-$Stamp.png"
$KeyB2   = if ($Prefix) { "$Prefix/picnexus-rest-sub-$Stamp.png" } else { $null }
$KeyC    = if ($Prefix) { "$Prefix/picnexus-s3-$Stamp.png" }       else { "picnexus-s3-$Stamp.png" }
$KeyC2   = $KeyC -replace 'picnexus-s3-', 'picnexus-s3ak-'

# ── HTTP helper：PS 5.1 遇 4xx/5xx 会抛，统一收敛成对象 ────────────────
function Invoke-Probe([string]$Method, [string]$Uri, $Headers, $Body) {
  try {
    $p = @{ Method = $Method; Uri = $Uri; Headers = $Headers; TimeoutSec = 30; UseBasicParsing = $true }
    if ($null -ne $Body) { $p.Body = $Body }
    $r = Invoke-WebRequest @p
    return [pscustomobject]@{
      Ok = $true; Status = [int]$r.StatusCode
      ContentType = $r.Headers["Content-Type"]; ContentLength = $r.Headers["Content-Length"]
      Body = $r.Content; Error = $null
    }
  } catch [System.Net.WebException] {
    $err  = $_
    $resp = $err.Exception.Response
    if ($null -eq $resp) {
      return [pscustomobject]@{ Ok = $false; Status = 0; ContentType = $null; ContentLength = $null; Body = ""; Error = $err.Exception.Message }
    }
    $status = [int]$resp.StatusCode

    # PS 5.1 的 Invoke-WebRequest 会先把错误响应体读进 ErrorDetails，
    # 此时 GetResponseStream() 已被消费、再读只能拿到空串。判据要靠响应体区分
    # 「桶不存在」和「密码错」（又拍云两者都回 401），所以这里必须优先取 ErrorDetails。
    $text = ""
    if ($err.ErrorDetails -and $err.ErrorDetails.Message) {
      $text = $err.ErrorDetails.Message
    } else {
      try {
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $text = $sr.ReadToEnd(); $sr.Close()
      } catch {}
    }
    return [pscustomobject]@{
      Ok = $false; Status = $status
      ContentType = $resp.Headers["Content-Type"]; ContentLength = $resp.Headers["Content-Length"]
      Body = $text; Error = $null
    }
  } catch {
    return [pscustomobject]@{ Ok = $false; Status = 0; ContentType = $null; ContentLength = $null; Body = ""; Error = $_.Exception.Message }
  }
}

function Show-Probe($r) {
  if ($r.Error) { Fail "网络异常: $($r.Error)"; return }
  Info "HTTP $($r.Status)   Content-Type: $($r.ContentType)"
  if ($r.Body) {
    $b = ($r.Body -replace '\s+', ' ').Trim()
    if ($b.Length -gt 260) { $b = $b.Substring(0, 260) + " ..." }
    Info "响应体: $b"
  }
}

$BasicAuth = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${Operator}:${Password}"))

function Invoke-RestPut([string]$Key, [byte[]]$Payload) {
  if ($null -eq $Payload) { $Payload = $TinyPng }
  return Invoke-Probe "PUT" "$RestHost/$Bucket/$Key" @{
    "Authorization"  = $BasicAuth
    "Content-Type"   = "image/png"
    "Content-Length" = $Payload.Length
  } $Payload
}

# 回读桶里对象的字节数。走 REST + Basic Auth，不依赖公开域名是否绑好，
# 所以哪怕用户没填 PublicDomain，B3 的覆盖判据照样成立。
function Get-RestObjectSize([string]$Key) {
  $r = Invoke-Probe "GET" "$RestHost/$Bucket/$Key" @{ "Authorization" = $BasicAuth } $null
  if (-not $r.Ok) { return $null }
  if ($r.ContentLength) { return [int]$r.ContentLength }
  return $null
}

# ── SigV4（path-style PUT），复刻 aws-sdk 对 s3.api.upyun.com 的签名 ───
function Get-HmacSha256([byte[]]$Key, [string]$Message) {
  $h = New-Object System.Security.Cryptography.HMACSHA256
  $h.Key = $Key
  return $h.ComputeHash([Text.Encoding]::UTF8.GetBytes($Message))
}
function Get-Sha256Hex($Data) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = if ($Data -is [byte[]]) { $Data } else { [Text.Encoding]::UTF8.GetBytes([string]$Data) }
  return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join "")
}

function Invoke-S3Put([string]$AccessKey, [string]$SecretKey, [string]$Key, [string]$UseRegion) {
  if (-not $UseRegion) { $UseRegion = $Region }
  $now       = (Get-Date).ToUniversalTime()
  $amzDate   = $now.ToString("yyyyMMddTHHmmssZ")
  $dateStamp = $now.ToString("yyyyMMdd")
  $payloadHash  = Get-Sha256Hex $TinyPng
  $canonicalUri = "/$Bucket/$Key"          # force_path_style(true)，见 s3_compatible.rs::create_s3_client
  $contentType  = "image/png"

  $canonicalHeaders = "content-type:$contentType`nhost:$S3Host`nx-amz-content-sha256:$payloadHash`nx-amz-date:$amzDate`n"
  $signedHeaders    = "content-type;host;x-amz-content-sha256;x-amz-date"
  $canonicalRequest = "PUT`n$canonicalUri`n`n$canonicalHeaders`n$signedHeaders`n$payloadHash"

  $scope    = "$dateStamp/$UseRegion/s3/aws4_request"
  $toSign   = "AWS4-HMAC-SHA256`n$amzDate`n$scope`n" + (Get-Sha256Hex $canonicalRequest)

  $k = Get-HmacSha256 ([Text.Encoding]::UTF8.GetBytes("AWS4$SecretKey")) $dateStamp
  $k = Get-HmacSha256 $k $UseRegion
  $k = Get-HmacSha256 $k "s3"
  $k = Get-HmacSha256 $k "aws4_request"
  $signature = ((Get-HmacSha256 $k $toSign) | ForEach-Object { $_.ToString("x2") }) -join ""

  return Invoke-Probe "PUT" "https://$S3Host$canonicalUri" @{
    "Content-Type"         = $contentType
    "x-amz-content-sha256" = $payloadHash
    "x-amz-date"           = $amzDate
    "Authorization"        = "AWS4-HMAC-SHA256 Credential=$AccessKey/$scope, SignedHeaders=$signedHeaders, Signature=$signature"
  } $TinyPng
}

# ── A. 连接测试链路 ───────────────────────────────────────────────────
Section "A. 连接测试（REST GET）—— 设置页那个「测试连接」按钮走的就是这条"
Info "GET $RestHost/$Bucket/"
$ra = Invoke-Probe "GET" "$RestHost/$Bucket/" @{ "Authorization" = $BasicAuth } $null
Show-Probe $ra
$okA = $ra.Ok
if ($okA) {
  Pass "操作员账号/密码有效，服务空间存在。"
} elseif ($ra.Body -match 'bucket not exist') {
  # 又拍云对「服务空间不存在」也回 401，只能靠响应体区分
  Fail "服务空间名不存在：$Bucket（注意又拍云这里回的是 401 不是 404）"
} elseif ($ra.Status -eq 401) {
  Fail "401 —— 操作员账号或密码错了，或该操作员没被授权访问这个服务空间。"
} else {
  Fail "未预期状态码。"
}

# ── B. 编辑器链路现状 ─────────────────────────────────────────────────
$okB = $false; $okB2 = $false; $overwritten = $false
if ($okA) {
  Section "B. 编辑器/CLI 上传（REST PUT）—— 裸协议形态：不贴前缀、不唯一化"
  Info "PUT $RestHost/$Bucket/$NameB"
  Info "Content-Type: image/png（工作区刚把写死的 image/* 换成按扩展名推断）"
  $rb = Invoke-RestPut $NameB
  Show-Probe $rb
  $okB = $rb.Ok
  if ($okB) { Pass "编辑器链路可用，对象落在根目录：/$NameB" } else { Fail "上传失败。" }

  # B3. 同名覆盖风险（不依赖 B2，先测）
  if ($okB) {
    Section "B3. 覆盖风险 —— 同一个文件名换一张图再传一次"
    Info "探的是裸协议：又拍云本身允不允许同名覆盖，答案决定代码该不该做唯一化。"
    Info "这里**故意不走** build_upload_key——那是产品代码的防护（2026-08-19 已补），"; Info "要测的是防护之下的协议行为，所以报「确认存在」是预期结果，不是回归。"

    $sizeBefore = Get-RestObjectSize $NameB
    Info "第一发落桶后回读：$(if ($null -ne $sizeBefore) { "$sizeBefore 字节" } else { "读不到" })"

    # 又拍云对同一个 key 有并发锁：PUT 完立刻再 PUT 会回 429 concurrent put or delete。
    # 那是「写得太快」，**不是**「不许覆盖」——2026-08-19 第一轮实测就栽在这，把 429
    # 误判成"又拍云拒绝了同名覆盖"，差点把 P0 降级。真实用户两次插图隔着秒/分钟，
    # 撞不到这个锁，所以这里必须退避重试，测出真实节奏下的行为。
    Info "PUT 同一个 key，但换成另一张 $($OverwritePng.Length) 字节的图"
    $rb3 = $null
    for ($attempt = 1; $attempt -le 4; $attempt++) {
      Start-Sleep -Seconds 3
      $rb3 = Invoke-RestPut $NameB $OverwritePng
      if ($rb3.Ok -or $rb3.Status -ne 429) { break }
      Info "HTTP 429（并发锁，非拒绝覆盖）—— 退避后第 $attempt 次重试"
    }
    Show-Probe $rb3

    if ($rb3.Ok) {
      Start-Sleep -Seconds 3
      $sizeAfter = Get-RestObjectSize $NameB
      Info "第二发落桶后回读：$(if ($null -ne $sizeAfter) { "$sizeAfter 字节" } else { "读不到" })"
      if ($null -ne $sizeAfter -and $sizeAfter -eq $OverwritePng.Length -and $sizeBefore -ne $sizeAfter) {
        $overwritten = $true
        Fail "回读拿到的是第二张（$sizeBefore -> $sizeAfter 字节）= 第一张已被无声覆盖，数据丢失风险坐实（P0）。"
      } elseif ($null -eq $sizeAfter) {
        Warn "PUT 成功但回读不到大小，无法证明内容被替换 —— 结论按「未坐实」记，需人工去控制台看一眼。"
      } else {
        Info "PUT 成功但回读仍是 $sizeAfter 字节，桶里内容没变，覆盖风险比预期小。"
      }
    } elseif ($rb3.Status -eq 429) {
      Warn "退避重试后仍是 429 —— 只能说明写得太密，**不能**据此判定又拍云禁止覆盖，D1 不可降级。"
    } else {
      Info "又拍云拒绝了同名覆盖（HTTP $($rb3.Status)，非 429），风险比预期小。"
    }
  }

  # B2. 修复可行性
  if ($KeyB2) {
    Section "B2. 修复可行性 —— PUT 到不存在的子目录，又拍云会自动建吗"
    Info "官方文档只说创建目录是独立接口，没写 PUT 的行为；而官方 python-sdk 的 put()"
    Info "不带任何建目录的头就直接 PUT /path/to/bar.png，所以裸 PUT 大概率可行 —— 实测确认。"
    Info "PUT $RestHost/$Bucket/$KeyB2"
    $rb2 = Invoke-RestPut $KeyB2
    Show-Probe $rb2
    $okB2 = $rb2.Ok
    if ($okB2) {
      Pass "会自动建父目录 —— 给 server_upload_upyun 加 path 前缀的方案可行，改 3 行即可。"
    } else {
      Warn "裸 PUT 写不进子目录 —— 修复时得先建目录。继续实测「怎么建」。"

      # 文档页说创建目录是 POST + 查询参数 folder=true，官方 python-sdk 用的却是
      # POST + 请求头 Folder: true（rest.py::mkdir）。两者打架，实现前必须知道哪个真管用，
      # 否则这段代码写出来是照着错的那份文档抄的。两种都打一遍。
      $mkdirDir = $KeyB2.Substring(0, $KeyB2.LastIndexOf('/'))
      $mkdirOk  = $null

      Info "试法一（官方 SDK 的写法）：POST $RestHost/$Bucket/$mkdirDir  头 Folder: true"
      $rm1 = Invoke-Probe "POST" "$RestHost/$Bucket/$mkdirDir" @{
        "Authorization" = $BasicAuth; "Folder" = "true"; "Content-Length" = 0
      } $null
      Show-Probe $rm1
      if ($rm1.Ok) { $mkdirOk = "请求头 Folder: true（官方 SDK 写法）" }

      if (-not $mkdirOk) {
        Info "试法二（文档页的写法）：POST $RestHost/$Bucket/$mkdirDir`?folder=true"
        $rm2 = Invoke-Probe "POST" "$RestHost/$Bucket/$mkdirDir`?folder=true" @{
          "Authorization" = $BasicAuth; "Content-Length" = 0
        } $null
        Show-Probe $rm2
        if ($rm2.Ok) { $mkdirOk = "查询参数 ?folder=true（文档页写法）" }
      }

      if ($mkdirOk) {
        Info "建目录成功，用的是：$mkdirOk。再 PUT 一次验证。"
        $rb2b = Invoke-RestPut $KeyB2
        Show-Probe $rb2b
        if ($rb2b.Ok) {
          $script:MkdirRecipe = $mkdirOk
          Warn "建目录后可写 —— 修复方案③需多一步建目录，用「$mkdirOk」这种写法。"
        } else {
          Warn "建目录成功但仍写不进去 —— 需要重新定位，把响应体贴给 AI。"
        }
      } else {
        Warn "两种建目录写法都失败 —— 需要重新定位，把响应体贴给 AI。"
      }
    }
  }
}

# ── C. GUI 链路 ───────────────────────────────────────────────────────
$script:WorkingRegion = $null

function Test-S3Path([string]$AccessKey, [string]$SecretKey, [string]$Key, [string]$Label, [string]$UseRegion) {
  if (-not $UseRegion) { $UseRegion = $Region }
  Section "C. GUI 上传（S3 PUT）—— $Label"
  Info "PUT https://$S3Host/$Bucket/$Key"
  Info "region = '$UseRegion'   AccessKey = $($AccessKey.Substring(0, [Math]::Min(4, $AccessKey.Length)))***"
  $r = Invoke-S3Put $AccessKey $SecretKey $Key $UseRegion
  Show-Probe $r
  $script:LastS3Body = [string]$r.Body
  if ($r.Ok) {
    Pass "S3 链路可用，对象落在：$Key"
    $script:WorkingRegion = $UseRegion
    # region 重试用的是另一个 key，回读校验得跟着走，别去 HEAD 一个没传上去的路径
    $script:LastS3Key = $Key
    return $true
  }
  if ($r.Body -match 'ErrInvalidAccessKeyID') {
    Fail "又拍云不认这个 AccessKeyID —— 这一对凭证不能用于 S3 协议。"
  } elseif ($r.Body -match 'SignatureDoesNotMatch') {
    Fail "AccessKeyID 认得但签名对不上 —— SecretKey 或 region 不对。"
  } elseif ($r.Status -eq 401 -or $r.Status -eq 403) {
    Fail "$($r.Status) —— 签名/凭证被拒。"
  } else {
    Fail "上传失败。"
  }
  return $false
}

# Q2：region 参与 SigV4 签名计算，PicNexus 写死 'upyun'。
# `SignatureDoesNotMatch` = AccessKeyID 服务端认得、只是签名算不对，此时 region 是头号嫌疑
# （`ErrInvalidAccessKeyID` 则是凭证本身不对，换 region 也没用，不重试）。
# 自动把候选 region 试一遍，省掉"再跑一轮"的往返。
$RegionCandidates = @("us-east-1", "cn-east-1", "")

function Test-S3WithRegionFallback([string]$AccessKey, [string]$SecretKey, [string]$Key, [string]$Label) {
  if (Test-S3Path $AccessKey $SecretKey $Key $Label) { return $true }
  if ($script:LastS3Body -notmatch 'SignatureDoesNotMatch') { return $false }

  Warn "AccessKeyID 认得、只是签名对不上 —— 自动换 region 重试，定位 Q2。"
  foreach ($cand in $RegionCandidates) {
    if ($cand -eq $Region) { continue }
    $shown = if ($cand) { $cand } else { "(空)" }
    $retryKey = $Key -replace '\.png$', "-r$($cand -replace '[^A-Za-z0-9]', '').png"
    if (Test-S3Path $AccessKey $SecretKey $retryKey "$Label —— region 重试 '$shown'" $cand) {
      Warn "换成 region '$shown' 就通了 —— Q2 坐实，UpyunUploader.ts::getRegion 要改成这个值。"
      return $true
    }
  }
  Warn "候选 region 都不通 —— 问题不在 region。"
  return $false
}

$okC = Test-S3WithRegionFallback $Operator $Password $KeyC "用【操作员账号/密码】当 AK/SK（2026-08-19 前 UpyunUploader.ts 的做法，保留作阴性对照）"
if ($okC) { $KeyC = $script:LastS3Key }

$okC2 = $null
if ($S3AccessKey -and $S3SecretKey) {
  $okC2 = Test-S3WithRegionFallback $S3AccessKey $S3SecretKey $KeyC2 "对照组：控制台生成的【S3 访问凭证】"
  if ($okC2) { $KeyC2 = $script:LastS3Key }
}

# ── D. 回读校验 ───────────────────────────────────────────────────────
function Test-Readback([string]$Key, [string]$Label) {
  Section "D. 回读校验 —— $Label"
  $url = $PublicDomain.TrimEnd('/') + "/" + $Key
  Info "HEAD $url"
  $r = Invoke-Probe "HEAD" $url @{} $null
  if ($r.Error) { Fail "网络异常: $($r.Error)"; return }
  Info "HTTP $($r.Status)   Content-Type: $($r.ContentType)"
  if (-not $r.Ok) { Fail "取不到对象（域名没绑好 / 对象路径不对 / 需要鉴权）。"; return }
  $ct = [string]$r.ContentType
  if ($ct -like "image/*" -and $ct -notlike "*``**") {
    Pass "Content-Type 合法，浏览器能直接预览。"
  } elseif ($ct -match '\*') {
    Fail "还是带星号的类型 —— issue #4 的修复没生效，浏览器会当成下载。"
  } else {
    Warn "Content-Type 是 $ct，不是标准图片类型。"
  }
}

if ($PublicDomain) {
  if ($okB)  { Test-Readback $NameB "编辑器链路传的那张" }
  if ($okB2) { Test-Readback $KeyB2 "编辑器链路子目录那张" }
  if ($okC)  { Test-Readback $KeyC  "GUI 链路传的那张" }
  if ($okC2) { Test-Readback $KeyC2 "对照组传的那张" }
} else {
  Section "D. 回读校验 —— 跳过"
  Info "没填公开访问域名，Content-Type 是否落对就没法验。"
}

# ── 结论 ──────────────────────────────────────────────────────────────
function Mark($v) { if ($v) { "通过" } else { "失败" } }

Section "结论"
Say ("  A  连接测试（REST）         : " + (Mark $okA))
Say ("  B  编辑器上传（REST）       : " + $(if ($okA) { Mark $okB } else { "跳过（A 没过）" }))
Say ("  B2 子目录可写（修复前提）   : " + $(if ($okA -and $KeyB2) { $(if ($okB2) { "通过（裸 PUT 即可，改 3 行）" } elseif ($script:MkdirRecipe) { "需先建目录：$($script:MkdirRecipe)" } else { "失败" }) } else { "跳过" }))
Say ("  B3 同名无声覆盖             : " + $(if ($overwritten) { "确认存在（P0）" } elseif ($okB) { "未复现" } else { "跳过" }))
Say ("  C  GUI 上传（S3，操作员）   : " + (Mark $okC))
if ($null -ne $okC2) {
  Say ("  C2 对照组（S3，专用凭证）   : " + (Mark $okC2))
}
if ($script:WorkingRegion -and $script:WorkingRegion -ne $Region) {
  Say ("  Q2 region                   : 写死的 '$Region' 不行，'$($script:WorkingRegion)' 才通") "Yellow"
} elseif ($script:WorkingRegion) {
  Say ("  Q2 region                   : 写死的 '$Region' 可用，无需改动")
}
Say ""

if ($okA -and -not $okC) {
  Say "  >> A 通过但 C 失败 = 账号没问题，是 PicNexus 的 GUI 上传链路取错了凭证。" "Yellow"
  if ($null -eq $okC2) {
    Say "     下一步：控制台拿一对 S3 访问凭证，加 -S3AccessKey/-S3SecretKey 重跑，" "Yellow"
    Say "     对照组若通过就石锤 UpyunUploader.ts 的 getAccessKey/getSecretKey 要改。" "Yellow"
  } elseif ($okC2) {
    Say "     对照组通过 = 石锤。UpyunServiceConfig 已于 2026-08-19 加上 s3AccessKey/s3SecretKey。" "Yellow"
  } else {
    Say "     对照组也失败，且候选 region 都试过了 = 问题不在凭证种类、也不在 region。" "Yellow"
    Say "     把上面 C/C2 两段的响应体贴给 AI，需要重新定位。" "Yellow"
  }
} elseif ($okA -and $okC) {
  Say "  >> GUI 与编辑器两条链路都通，又拍云在 PicNexus 里可用。" "Green"
} elseif (-not $okA) {
  Say "  >> A 就没过，先核对账号信息，后面的结论都不作数。" "Red"
}

Say ""
Say "本轮传上去的测试对象（确认完可以在控制台删掉）：" "DarkGray"
if ($okB)  { Say "  /$NameB" "DarkGray" }
if ($okB2) { Say "  /$KeyB2" "DarkGray" }
if ($okC)  { Say "  /$KeyC"  "DarkGray" }
if ($okC2) { Say "  /$KeyC2" "DarkGray" }

$script:Transcript | Out-File -FilePath $ResultFile -Encoding utf8
Write-Host ""
Write-Host "完整结论已存到 $ResultFile —— 直接把这个文件贴给 AI 即可。" -ForegroundColor Cyan
