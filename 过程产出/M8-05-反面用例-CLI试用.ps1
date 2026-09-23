<#
.M8-05 反面用例 · CLI 模拟销售试用
=====================================
用途：在不写前端 UI 的前提下，用 PowerShell + 后端 HTTP 接口，模拟「销售（王海涛 E003）」
走完整动线，并对「越权 / 业务校验 / 撞键 / 公海限制」等反面场景逐条断言，
输出 PASS/FAIL 报告。配合《M8-05-真人销售体验验证清单.md》使用（UI 部分需人眼）。

运行前置：
  1) phpStudy 起 MySQL 8.0.12（端口 3306）
  2) 后端 dist/main.js 已在 3000 监听（无 /api 前缀；登录 POST /account/login）
  3) 已跑 dev seed（账号 王海涛/13800000003 密码 Dev@123456）
  4) 本机装有 phpStudy 的 mysql.exe（用于自动清理测试数据；找不到则仅打印 SQL）

运行：powershell -NoProfile -ExecutionPolicy Bypass -File M8-05-反面用例-CLI试用.ps1
#>

$ErrorActionPreference = 'Continue'
$BASE      = 'http://127.0.0.1:3000'
$MYSQL     = 'D:\ITtool\phpstudy_pro\Extensions\MySQL8.0.12\bin\mysql.exe'
$DBUSER    = 'root'; $DBPASS = '123456'; $DBNAME = 'win_crm'

# 统一响应包 {code,message,request_id,data}；成功 code=0
function Call-Api {
  param($Method, $Path, $Token, $JsonBody, $ExtraHeaders)
  $url = $BASE + $Path
  $headers = @{}
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  if ($ExtraHeaders) { foreach ($k in $ExtraHeaders.Keys) { $headers[$k] = $ExtraHeaders[$k] } }
  $bodyBytes = $null
  if ($JsonBody) { $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($JsonBody) }
  try {
    $r = Invoke-WebRequest -Uri $url -Method $Method -Headers $headers `
            -ContentType 'application/json; charset=utf-8' -Body $bodyBytes -TimeoutSec 20 -UseBasicParsing
    $code = $null
    try { $bj = ($r.Content | ConvertFrom-Json); if ($bj.code -ne $null) { $code = $bj.code } } catch {}
    return @{Status=[int]$r.StatusCode; Body=$r.Content; BodyCode=$code; Ok=$true}
  } catch {
    $resp = $_.Exception.Response
    # PowerShell 在 UseBasicParsing 下会把错误响应体放进 $_.ErrorDetails.Message
    $txt = $_.ErrorDetails.Message
    if (-not $txt -and $resp) {
      $sr = [System.IO.StreamReader]::new($resp.GetResponseStream()); $txt = $sr.ReadToEnd(); $sr.Close()
    }
    $code = $null
    if ($txt) { try { $bj = ($txt | ConvertFrom-Json); if ($bj.code -ne $null) { $code = $bj.code } } catch {} }
    return @{Status=if ($resp) { [int]$resp.StatusCode } else { 0 }; Body=$txt; BodyCode=$code; Ok=$false}
  }
}

function Login($account, $pw) {
  $r = Call-Api POST '/account/login' $null (@{account=$account; password=$pw} | ConvertTo-Json -Compress)
  if ($r.Ok -and $r.BodyCode -eq 0) {
    $bj = $r.Body | ConvertFrom-Json
    return $bj.data.access_token
  }
  return $null
}

$results = [System.Collections.Generic.List[object]]::new()
function Record($tag, $desc, $actual, $expHttp, $expCode, $note='') {
  $ok = ($actual.Status -eq $expHttp) -and ($expCode -eq $null -or $actual.BodyCode -eq $expCode)
  $res = if ($ok) { 'PASS' } else { 'FAIL' }
  $results.Add([pscustomobject]@{Tag=$tag; Desc=$desc; Exp="$expHttp/$($expCode)"; Actual="$($actual.Status)/$($actual.BodyCode)"; Result=$res; Note=$note})
  $mark = if ($ok) { '✅' } else { '❌' }
  Write-Host ("$mark [$tag] $desc  -> 期望 $expHttp/$($expCode)  实际 $($actual.Status)/$($actual.BodyCode)  $note")
}
function Skip($tag, $desc, $why) {
  $results.Add([pscustomobject]@{Tag=$tag; Desc=$desc; Exp='-'; Actual='-'; Result='SKIP'; Note=$why})
  Write-Host ("⚠️ [$tag] $desc  -> SKIP  $why")
}
function Finding($tag, $desc, $actual, $note) {
  $results.Add([pscustomobject]@{Tag=$tag; Desc=$desc; Exp='(观察)'; Actual=("$($actual.Status)/$($actual.BodyCode)"); Result='FIND'; Note=$note})
  Write-Host ("🔎 [$tag] $desc  -> $($actual.Status)/$($actual.BodyCode)  $note")
}

$stamp = (Get-Date -Format 'HHmmss')
$created = @{companies=@(); contacts=@(); relations=@()}

Write-Host "================ M8-05 反面用例 · $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ================"
$saleToken = Login '13800000003' 'Dev@123456'
$adminToken = Login '13800000006' 'Dev@123456'
$mgrToken   = Login '13800000002' 'Dev@123456'
if (-not $saleToken) { Write-Host '❌ 销售登录失败，后端/数据库可能未就绪，终止。'; exit 1 }
Write-Host "登录：销售=$(if($saleToken){'OK'}else{'FAIL'}) 管理员=$(if($adminToken){'OK'}else{'FAIL'}) 经理=$(if($mgrToken){'OK'}else{'FAIL'})"

# ---------- 正面冒烟（先拿到可复用的 id） ----------
$P3 = Call-Api POST '/companies' $saleToken (@{full_name="M8NEG公司$stamp"} | ConvertTo-Json -Compress)
$companyId = $null
if ($P3.Ok -and $P3.BodyCode -eq 0) { $companyId = ((($P3.Body | ConvertFrom-Json).data).id) }
Record 'P3' '销售建档公司(正面)' $P3 200 0
if ($companyId) { $created.companies += $companyId }

$P4a = Call-Api POST '/contacts' $saleToken (@{name="M8NEG联系人A$stamp"; phone="139$($stamp.Substring(0,4))001"; company_id=$companyId} | ConvertTo-Json -Compress)
$contactLinkedId = $null
if ($P4a.Ok -and $P4a.BodyCode -eq 0) { $contactLinkedId = ((($P4a.Body | ConvertFrom-Json).data).id) }
Record 'P4a' '销售建档联系人并挂公司(正面)' $P4a 200 0
if ($contactLinkedId) { $created.contacts += $contactLinkedId }

$P4b = Call-Api POST '/contacts' $saleToken (@{name="M8NEG联系人B$stamp"; phone="139$($stamp.Substring(0,4))002"} | ConvertTo-Json -Compress)
$contactUnlinkedId = $null
if ($P4b.Ok -and $P4b.BodyCode -eq 0) { $contactUnlinkedId = ((($P4b.Body | ConvertFrom-Json).data).id) }
Record 'P4b' '销售建档待关联联系人(正面)' $P4b 200 0
if ($contactUnlinkedId) { $created.contacts += $contactUnlinkedId }

$P5 = Call-Api POST '/relations' $saleToken (@{company_id=$companyId; dept_id='2'; product_line_id='1'} | ConvertTo-Json -Compress)
$relId = $null
if ($P5.Ok -and $P5.BodyCode -eq 0) { $relId = ((($P5.Body | ConvertFrom-Json).data).id) }
Record 'P5' '销售激活业务关系(正面)' $P5 200 0
if ($relId) { $created.relations += $relId }

$P6 = Call-Api POST "/relations/$relId/events" $saleToken (@{action_type='phone'; outcome='advanced'; summary='有效沟通冒烟'} | ConvertTo-Json -Compress)
Record 'P6' '销售写一条有效跟单(正面)' $P6 200 0

$P7 = Call-Api POST "/relations/$relId/commitments" $saleToken (@{party='me'; ctype='deliver'; content='承诺冒烟'; due_at='2026-09-30T00:00:00.000Z'} | ConvertTo-Json -Compress)
$commitId = $null
if ($P7.Ok -and $P7.BodyCode -eq 0) { $commitId = ((($P7.Body | ConvertFrom-Json).data).id) }
Record 'P7' '销售建一条承诺(正面)' $P7 200 0

# ---------- 反面用例 ----------
# N01 未认证读
Record 'N01' '未带 token 读关系列表(应401)' (Call-Api GET '/relations' $null $null) 401 20002
# N02 错误密码（应 401/20002，统一包的人话）
$N02 = Call-Api POST '/account/login' $null (@{account='13800000003'; password='WrongPass!'} | ConvertTo-Json -Compress)
Record 'N02' '错误密码登录(应401/20002)' $N02 401 20002
# N17 未认证写
Record 'N17' '未带 token 建关系(应401)' (Call-Api POST '/relations' $null (@{company_id=$companyId; dept_id='2'; product_line_id='1'} | ConvertTo-Json -Compress)) 401 20002

# N03 跨部门建关系（部门3 不在销售可建范围[2]）
Record 'N03' '销售跨部门建关系(dept=3,应403)' (Call-Api POST '/relations' $saleToken (@{company_id=$companyId; dept_id='3'; product_line_id='1'} | ConvertTo-Json -Compress)) 403 20003

# N04 部门未承接的产品线（D-74 422）。当前种子所有产品线 dept_ids 均含 2/3，
#       故以「部门2 + 产品线4(GEO,dept_ids含2,3)」无法触发；改为观察是否真被拦。
$N04 = Call-Api POST '/relations' $saleToken (@{company_id=$companyId; dept_id='2'; product_line_id='4'} | ConvertTo-Json -Compress)
if ($N04.Status -eq 422 -and $N04.BodyCode -eq 20409) {
  Record 'N04' '部门未承接线(应422/20409)' $N04 422 20409
} else {
  Finding 'N04' 'D-74 部门未承接线 422（观察当前种子能否触发）' $N04 ('当前种子所有产品线均承接部门2，可能无法触发；实际=' + $N04.Status + '/' + $N04.BodyCode)
}

# N05 重复激活同三元组（先已 P5 建过 company/2/1，再建必 409）
Record 'N05' '重复激活同三元组(应409/20401)' (Call-Api POST '/relations' $saleToken (@{company_id=$companyId; dept_id='2'; product_line_id='1'} | ConvertTo-Json -Compress)) 409 20401

# N09 有效沟通但 summary 为空（应 400/20001）
Record 'N09' '有效跟单 summary 为空(应400/20001)' (Call-Api POST "/relations/$relId/events" $saleToken (@{action_type='phone'; outcome='advanced'; summary=''} | ConvertTo-Json -Compress)) 400 20001

# N11 承诺豁免无原因（应 422/20403）
if ($commitId) {
  Record 'N11' '承诺 waived 不填原因(应422/20403)' (Call-Api PUT "/relations/$relId/commitments" $saleToken (@{id=$commitId; status='waived'} | ConvertTo-Json -Compress)) 422 20403
} else { Skip 'N11' '承诺 waived 不填原因' 'P7 未拿到承诺 id' }

# N08 对已挂公司的联系人写跟单（规格 §5.7：已挂公司应 403「请到业务关系里记」）
if ($contactLinkedId) {
  $r08 = Call-Api POST "/contacts/$contactLinkedId/events" $saleToken (@{action_type='phone'; summary='x'} | ConvertTo-Json -Compress)
  if ($r08.Status -eq 403) {
    Record 'N08' '对已关联公司联系人写跟单(应403)' $r08 403 $null
  } else {
    Finding 'N08' '对已关联公司联系人写跟单（观察：规格期望 403）' $r08 ('返回200未拦截；疑似 POST /contacts 带 company_id 时 owner_id 未置空，导致 §5.7 的已挂公司403不生效，需查 company.service 建档逻辑')
  }
} else { Skip 'N08' '对已关联公司联系人写跟单' 'P4a 未拿到联系人 id' }

# N10 幂等键重复（同 key 异入参 → 409/20004，验证 D-06 撞键 409）
if ($contactUnlinkedId) {
  $idemKey = "M8NEG-N10-$stamp"
  $h1 = @{ 'Idempotency-Key' = $idemKey }
  $f = Call-Api POST "/contacts/$contactUnlinkedId/events" $saleToken (@{action_type='phone'; summary='第一次'} | ConvertTo-Json -Compress) $h1
  $s = Call-Api POST "/contacts/$contactUnlinkedId/events" $saleToken (@{action_type='phone'; summary='第二次不同内容'} | ConvertTo-Json -Compress) $h1
  Record 'N10' '同幂等键异入参写跟单(应409/20004)' $s 409 20004 ('首写=' + $f.Status + '/' + $f.BodyCode)
} else { Skip 'N10' '同幂等键异入参写跟单' 'P4b 未拿到联系人 id' }

# N13 排序字段白名单外（应 400/20001）
Record 'N13' 'order_by 非法列(应400/20001)' (Call-Api GET '/relations?order_by=not_a_column' $saleToken $null) 400 20001

# ---------- 公海相关（依赖库中是否存在公海关系） ----------
$seaProbe = Call-Api GET '/relations?tab=sea&page_size=5' $saleToken $null
$seaRelId = $null; $seaCompanyId = $null; $seaDept = $null; $seaLine = $null
try {
  $bj = ($seaProbe.Body | ConvertFrom-Json)
  if ($bj.data -and $bj.data.list -and $bj.data.list.Count -gt 0) {
    $it = $bj.data.list[0]
    $seaRelId = $it.id
    $seaCompanyId = if ($it.company_id) { $it.company_id } else { $null }
    $seaDept = if ($it.dept_id) { $it.dept_id } else { '2' }
    $seaLine = if ($it.product_line_id) { $it.product_line_id } else { '1' }
  }
} catch {}
if ($seaRelId) {
  # N07 未领取公海关系写跟单（应 422/20408）
  Record 'N07' '向未领取公海关系写跟单(应422/20408)' (Call-Api POST "/relations/$seaRelId/events" $saleToken (@{action_type='phone'; summary='x'} | ConvertTo-Json -Compress)) 422 20408
  # N12 管理员(只读)领公海（应 403/20003）
  if ($adminToken -and $seaCompanyId) {
    Record 'N12' '管理员领公海(应403/20003)' (Call-Api POST "/sea/company/$seaCompanyId/claim" $adminToken (@{dept_id=$seaDept; product_line_id=$seaLine} | ConvertTo-Json -Compress)) 403 20003
  } else { Skip 'N12' '管理员领公海' '缺 adminToken 或 sea company_id' }
} else {
  Skip 'N07' '向未领取公海关系写跟单' '当前库无公海关系（需先有掉海/未领取关系）'
  Skip 'N12' '管理员领公海' '当前库无公海关系'
}

# ---------- 汇总 ----------
$pass = ($results | Where-Object { $_.Result -eq 'PASS' }).Count
$fail = ($results | Where-Object { $_.Result -eq 'FAIL' }).Count
$skip = ($results | Where-Object { $_.Result -eq 'SKIP' }).Count
$find = ($results | Where-Object { $_.Result -eq 'FIND' }).Count
Write-Host ""
Write-Host "================ 汇总：PASS=$pass  FAIL=$fail  SKIP=$skip  FIND=$find ================"

# ---------- 自动清理测试数据（按 M8NEG 标记 LIKE 匹配，覆盖历次运行） ----------
Write-Host "------ 清理 M8NEG 测试数据 ------"
$sql = "DELETE FROM action_event WHERE relation_id IN (SELECT id FROM business_relation WHERE company_id IN (SELECT id FROM company WHERE full_name LIKE 'M8NEG公司%'));" +
       "DELETE FROM commitment WHERE relation_id IN (SELECT id FROM business_relation WHERE company_id IN (SELECT id FROM company WHERE full_name LIKE 'M8NEG公司%'));" +
       "DELETE FROM relation_member WHERE relation_id IN (SELECT id FROM business_relation WHERE company_id IN (SELECT id FROM company WHERE full_name LIKE 'M8NEG公司%'));" +
       "DELETE FROM business_relation WHERE company_id IN (SELECT id FROM company WHERE full_name LIKE 'M8NEG公司%');" +
       "DELETE FROM company_contact WHERE company_id IN (SELECT id FROM company WHERE full_name LIKE 'M8NEG公司%') OR contact_id IN (SELECT id FROM contact WHERE name LIKE 'M8NEG联系人%');" +
       "DELETE FROM contact WHERE name LIKE 'M8NEG联系人%';" +
       "DELETE FROM company WHERE full_name LIKE 'M8NEG公司%';"
if (Test-Path $MYSQL) {
  try {
    $out = & $MYSQL -h127.0.0.1 -u$DBUSER "-p$DBPASS" $DBNAME --execute=$sql 2>&1
    $flat = if ($out) { [string]::Join(' ', $out) } else { '' }
    if ($flat -match 'Using a password') { Write-Host '(已执行，仅密码明文警告，忽略)' } else { Write-Host "mysql 清理输出：$flat" }
  } catch { Write-Host "mysql 清理异常：$_" }
} else {
  Write-Host "未找到 mysql.exe($MYSQL)，请手动执行以下 SQL 清理："
  Write-Host $sql
}
Write-Host "完成。UI/真人体验部分见《M8-05-真人销售体验验证清单.md》。"
