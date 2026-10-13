# One-time setup for Windows: creates a private GitHub repo, uploads everything, stores your API key, runs a test.
# Usage: right-click this folder > Open in Terminal, then run:
#   powershell -ExecutionPolicy Bypass -File setup.ps1
$ErrorActionPreference = "Continue"
$Repo = if ($args[0]) { $args[0] } else { "itweb-posters" }
Set-Location $PSScriptRoot

foreach ($t in @(@("git","https://git-scm.com/downloads"), @("gh","https://cli.github.com  (or: winget install GitHub.cli)"))) {
  if (-not (Get-Command $t[0] -ErrorAction SilentlyContinue)) { Write-Host "Please install $($t[0]) first: $($t[1])"; exit 1 }
}

gh auth status 2>$null; if ($LASTEXITCODE -ne 0) { gh auth login --web --git-protocol https --scopes "repo,workflow" }

if (-not (Test-Path .git)) { git init -q -b main }
git add -A
git -c user.name="poster-setup" -c user.email="poster-setup@users.noreply.github.com" commit -qm "Poster automation" 2>$null

gh repo view $Repo 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  $url = gh repo view $Repo --json url -q .url
  git remote get-url origin 2>$null | Out-Null; if ($LASTEXITCODE -ne 0) { git remote add origin "$url.git" }
  git push -u origin main --force
} else {
  gh repo create $Repo --private --source . --push
}
$Full = gh repo view $Repo --json nameWithOwner -q .nameWithOwner

$Key = Read-Host "Paste your Anthropic API key (starts sk-ant-), or press Enter to skip"
if ($Key) { $Key | gh secret set ANTHROPIC_API_KEY --repo $Full }

Start-Sleep 3
gh workflow run daily-posters.yml --repo $Full
Write-Host ""
Write-Host "Done. Test run started. Watch it here:"
Write-Host "$(gh repo view $Repo --json url -q .url)/actions"
Write-Host "From now on it runs by itself every weekday at 13:05 SA time."
