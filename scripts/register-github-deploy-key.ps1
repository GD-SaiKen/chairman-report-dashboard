# 将本机 chairman-report 专用公钥登记到 GitHub Deploy keys（读写）
# 用法：在 PowerShell 中执行 .\scripts\register-github-deploy-key.ps1

$ErrorActionPreference = "Stop"
$pub = Join-Path $env:USERPROFILE ".ssh\id_ed25519_chairman_report.pub"
$repo = "GD-SaiKen/chairman-report-dashboard"

if (-not (Test-Path $pub)) {
  Write-Error "未找到公钥：$pub。请先按 README 生成 id_ed25519_chairman_report。"
}

$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
  & gh repo deploy-key add $pub --repo $repo --title "local-deploy-chairman-report" --allow-write
  Write-Host "已通过 gh 添加 deploy key（Allow write access）。"
  exit 0
}

Write-Host "未检测到 gh CLI。请手动添加 Deploy key："
Write-Host "  1. 打开 https://github.com/$repo/settings/keys"
Write-Host "  2. Add deploy key，Title 填 local-deploy-chairman-report"
Write-Host "  3. 勾选 Allow write access"
Write-Host "  4. 粘贴以下公钥："
Write-Host ""
Get-Content $pub
Write-Host ""
Write-Host "添加后验证：ssh -T git@github.com-chairman-report"
