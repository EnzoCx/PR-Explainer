# PR Explainer installer for Windows (current user only, no admin rights needed).
# Started by Install.cmd; Uninstall.cmd runs it with -Uninstall.
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$Fr = (Get-UICulture).TwoLetterISOLanguageName -eq 'fr'
function L([string]$en, [string]$fr) { if ($Fr) { $fr } else { $en } }

$HostName = 'com.pr_explainer.host'
$LegacyHostNames = @()
$BrowserKeys = @('Google\Chrome', 'Microsoft\Edge', 'BraveSoftware\Brave-Browser', 'Chromium')
$Root = $PSScriptRoot
$ExtensionDir = Join-Path $Root 'extension'
$HostJs = Join-Path $Root 'host\host.js'
$DataDir = Join-Path $env:LOCALAPPDATA 'PR Explainer'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Title($text) {
  Write-Host ''
  Write-Host ' ==============================================' -ForegroundColor DarkCyan
  Write-Host "   $text" -ForegroundColor White
  Write-Host ' ==============================================' -ForegroundColor DarkCyan
}
function Step($n, $text) { Write-Host ''; Write-Host " $n. $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    [OK] $text" -ForegroundColor Green }
function Info($text) { Write-Host "    $text" }
function Warn($text) { Write-Host "    [!]  $text" -ForegroundColor Yellow }
function Confirm($text) { (Read-Host "    $text $(L '[Y/n]' '[O/n]')") -notmatch '^[nN]' }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Done($code) {
  Write-Host ''
  Read-Host (L ' Press Enter to close' ' Appuie sur Entrée pour fermer') | Out-Null
  exit $code
}
function Fail($text) { Write-Host ''; Write-Host " $text" -ForegroundColor Red; Done 1 }
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User') + ";$HOME\.local\bin"
}
function Unregister {
  foreach ($name in @($HostName) + $LegacyHostNames) {
    foreach ($browser in $BrowserKeys) {
      Remove-Item -Path "HKCU:\Software\$browser\NativeMessagingHosts\$name" -ErrorAction SilentlyContinue
    }
  }
}

# ------------------------------------------------------------------ Uninstall
if ($Uninstall) {
  Title (L 'PR Explainer - uninstall' 'PR Explainer - désinstallation')
  Unregister
  Ok (L 'Browser link removed' 'Liaison avec le navigateur supprimée')
  if ((Test-Path $DataDir) -and (Confirm (L 'Also delete saved analyses and logs?' 'Supprimer aussi les analyses enregistrées et les journaux ?'))) {
    Remove-Item -Recurse -Force $DataDir
    Ok (L 'Data deleted' 'Données supprimées')
  }
  Info (L 'Last step: remove the extension in chrome://extensions.' 'Dernière étape : retire l''extension dans chrome://extensions.')
  Done 0
}

# ------------------------------------------------------------------ Install
Title (L 'PR Explainer - installation' 'PR Explainer - installation')

# 0. Where are we running from?
if (-not (Test-Path $HostJs) -or -not (Test-Path (Join-Path $ExtensionDir 'manifest.json'))) {
  Fail (L 'Some files are missing. Extract the WHOLE zip into a folder, then run Install.cmd again.' 'Des fichiers manquent. Extrais TOUT le zip dans un dossier, puis relance Install.cmd.')
}
if ($Root -like "$env:TEMP*" -or $Root -match '\\AppData\\Local\\Temp\\') {
  Fail (L 'You are running from inside the zip. Extract it to a permanent folder (e.g. C:\Tools\pr-explainer) and run Install.cmd from there.' 'Tu lances depuis l''intérieur du zip. Extrais-le dans un dossier permanent (ex. C:\Outils\pr-explainer) et relance Install.cmd depuis là.')
}
if ($Root -match '["%]') {
  Fail (L 'The folder path contains " or %. Move the folder elsewhere and run Install.cmd again.' 'Le chemin du dossier contient " ou %. Déplace le dossier ailleurs et relance Install.cmd.')
}
if ($Root -match '\\Downloads(\\|$)') {
  Warn (L 'This folder is in Downloads. The browser keeps using it: if it is deleted or moved, PR Explainer stops working.' 'Ce dossier est dans Téléchargements. Le navigateur continue de l''utiliser : s''il est supprimé ou déplacé, PR Explainer ne marche plus.')
  if (-not (Confirm (L 'Continue anyway?' 'Continuer quand même ?'))) { Done 1 }
}
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Warn (L 'No need to run as administrator: PR Explainer installs for your user only.' 'Pas besoin d''être administrateur : PR Explainer s''installe pour ton utilisateur seulement.')
}
# Files from a downloaded zip carry a "from the Internet" mark; clear it for this folder only.
Get-ChildItem -Path $Root -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

# 1. Node.js
Step 1 'Node.js'
RefreshPath
if (-not (Has node)) {
  if ((Has winget) -and (Confirm (L 'Node.js is missing. Install it with winget (OpenJS.NodeJS.LTS)?' 'Node.js est absent. L''installer avec winget (OpenJS.NodeJS.LTS) ?'))) {
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    RefreshPath
  }
  if (-not (Has node)) { Fail (L 'Node.js is required: install it from https://nodejs.org, then run Install.cmd again.' 'Node.js est nécessaire : installe-le depuis https://nodejs.org puis relance Install.cmd.') }
}
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 18) { Fail (L "Node.js 18 or newer is required (found $(node --version))." "Node.js 18 ou plus récent est nécessaire (trouvé $(node --version)).") }
Ok "Node.js $(node --version)"

# 2. GitHub
Step 2 'GitHub'
if (-not (Has gh)) {
  if ((Has winget) -and (Confirm (L 'GitHub CLI is missing. Install it with winget (GitHub.cli)?' 'GitHub CLI est absent. L''installer avec winget (GitHub.cli) ?'))) {
    winget install -e --id GitHub.cli --accept-source-agreements --accept-package-agreements
    RefreshPath
  }
  if (-not (Has gh)) { Fail (L 'GitHub CLI is required: https://cli.github.com, then run Install.cmd again.' 'GitHub CLI est nécessaire : https://cli.github.com puis relance Install.cmd.') }
}
gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
  Info (L 'Sign in to GitHub: a page will open in your browser.' 'Connexion à GitHub : une page va s''ouvrir dans ton navigateur.')
  gh auth login --web --git-protocol https --hostname github.com
  gh auth status *> $null
  if ($LASTEXITCODE -ne 0) { Fail (L 'GitHub sign-in was not completed. Run Install.cmd again.' 'Connexion GitHub non terminée. Relance Install.cmd.') }
}
Ok (L 'GitHub connected' 'GitHub connecté')

# 3. AI subscription
Step 3 (L 'AI subscription (Claude or ChatGPT)' 'Abonnement IA (Claude ou ChatGPT)')
function FindClaude {
  $cmd = Get-Command claude -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $local = "$HOME\.local\bin\claude.exe"
  if (Test-Path $local) { return $local }
  return $null
}
# Codex may come from npm, from the Codex desktop app or from the ChatGPT extension of VS Code-like editors.
function FindCodex {
  $cmd = Get-Command codex -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @("$env:APPDATA\npm\codex.cmd")
  $app = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($app) { $candidates += Join-Path $app.InstallLocation 'app\resources\codex.exe' }
  $candidates += "$HOME\.codex\plugins\.plugin-appserver\codex.exe"
  foreach ($editor in '.vscode', '.vscode-insiders', '.cursor', '.windsurf') {
    $candidates += Get-ChildItem "$HOME\$editor\extensions\openai.chatgpt-*\bin\windows-x86_64\codex.exe" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | ForEach-Object { $_.FullName }
  }
  foreach ($path in $candidates) { if ($path -and (Test-Path $path)) { return $path } }
  return $null
}
# Native tools write to stderr; keep that from stopping the script.
function ClaudeLoggedIn {
  $exe = FindClaude
  if (-not $exe) { return $false }
  $ErrorActionPreference = 'Continue'
  try { return ((& $exe auth status 2>$null | Out-String) | ConvertFrom-Json).loggedIn -eq $true } catch { return $false }
}
function CodexLoggedIn {
  $exe = FindCodex
  if (-not $exe) { return $false }
  $ErrorActionPreference = 'Continue'
  $out = & $exe login status 2>&1 | Out-String
  return ($LASTEXITCODE -eq 0) -and ($out -notmatch 'Not logged in')
}
function SetupClaude {
  if (-not (FindClaude)) {
    Info (L 'Claude Code (official Anthropic CLI) will be installed with its official script:' 'Claude Code (outil officiel d''Anthropic) va être installé avec son script officiel :')
    Info '  irm https://claude.ai/install.ps1 | iex'
    if (-not (Confirm (L 'Install it?' 'L''installer ?'))) { return $false }
    Invoke-RestMethod -Uri 'https://claude.ai/install.ps1' | Invoke-Expression | Out-Host
    RefreshPath
  }
  Info (L 'Sign in to Claude: a page will open in your browser.' 'Connexion à Claude : une page va s''ouvrir dans ton navigateur.')
  & (FindClaude) auth login | Out-Host
  return (ClaudeLoggedIn)
}
function SetupCodex {
  if (-not (FindCodex)) {
    Info (L 'Codex (official OpenAI CLI) will be installed with npm:' 'Codex (outil officiel d''OpenAI) va être installé avec npm :')
    Info '  npm install -g @openai/codex'
    if (-not (Confirm (L 'Install it?' 'L''installer ?'))) { return $false }
    npm install -g @openai/codex | Out-Host
    RefreshPath
  }
  Info (L 'Sign in to ChatGPT: a page will open in your browser.' 'Connexion à ChatGPT : une page va s''ouvrir dans ton navigateur.')
  & (FindCodex) login | Out-Host
  return (CodexLoggedIn)
}

$claudeOk = ClaudeLoggedIn
$codexOk = CodexLoggedIn
if ($claudeOk) { Ok (L 'Claude connected' 'Claude connecté') }
if ($codexOk) { Ok (L 'ChatGPT connected' 'ChatGPT connecté') }
if (-not $claudeOk -and -not $codexOk) {
  Info (L 'Which subscription do you want to use?' 'Quel abonnement veux-tu utiliser ?')
  Info '  [1] Claude  (Pro, Max, Team, Enterprise)'
  Info '  [2] ChatGPT (Plus, Pro, Team, Enterprise)'
  $choice = Read-Host (L '    Your choice' '    Ton choix')
  $connected = if ($choice -eq '2') { SetupCodex } else { SetupClaude }
  if (-not $connected) { Fail (L 'No AI subscription connected. Run Install.cmd again when ready.' 'Aucun abonnement IA connecté. Relance Install.cmd quand tu es prêt.') }
  Ok (L 'AI connected' 'IA connectée')
}

# 4. Link with the browsers
Step 4 (L 'Link with Chrome, Edge and Brave' 'Liaison avec Chrome, Edge et Brave')
# The extension ID comes from the public key in manifest.json.
$key = (Get-Content (Join-Path $ExtensionDir 'manifest.json') -Raw | ConvertFrom-Json).key
$hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Convert]::FromBase64String($key))
$extensionId = -join ($hash[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
# Tell the helper where the tools are, since the browser starts it with a minimal environment.
$tools = [ordered]@{ gh = (Get-Command gh).Source; claude = FindClaude; codex = FindCodex }
[IO.File]::WriteAllText((Join-Path $DataDir 'tools.json'), ($tools | ConvertTo-Json), $Utf8)
$node = (Get-Command node).Source
$launcher = Join-Path $DataDir 'host.cmd'
[IO.File]::WriteAllText($launcher, "@echo off`r`n`"$node`" `"$HostJs`" %*`r`n", $Utf8)
$manifestPath = Join-Path $DataDir "$HostName.json"
$manifest = [ordered]@{
  name            = $HostName
  description     = 'PR Explainer local helper'
  path            = $launcher
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$extensionId/")
}
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), $Utf8)
Unregister
foreach ($browser in $BrowserKeys) {
  $regKey = "HKCU:\Software\$browser\NativeMessagingHosts\$HostName"
  New-Item -Path $regKey -Force | Out-Null
  Set-Item -Path $regKey -Value $manifestPath
}
Ok (L 'Browser link installed' 'Liaison installée')

# 5. Self-test
Step 5 (L 'Check' 'Vérification')
$report = & node $HostJs --self-test 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) { Ok (L 'Everything works' 'Tout fonctionne') }
else { Warn (L 'Something is not ready:' 'Quelque chose n''est pas prêt :'); Info $report }

# 6. Extension
Step 6 (L 'Add the extension to your browser' 'Ajout de l''extension dans le navigateur')
$copied = $true
try { Set-Clipboard -Value $ExtensionDir } catch { $copied = $false }
Info (L 'Your browser opens on its extensions page. Three clicks left:' 'Le navigateur s''ouvre sur la page des extensions. Il reste 3 clics :')
Info (L '  a) Turn on "Developer mode" (switch at the top right)' '  a) Active « Mode développeur » (interrupteur en haut à droite)')
Info (L '  b) Click "Load unpacked"' '  b) Clique « Charger l''extension non empaquetée »')
if ($copied) {
  Info (L '  c) Paste the path (Ctrl+V, already copied) in the address bar of the window, then "Select folder"' '  c) Colle le chemin (Ctrl+V, déjà copié) dans la barre d''adresse de la fenêtre, puis « Sélectionner un dossier »')
} else {
  Info (L '  c) Select this folder:' '  c) Choisis ce dossier :')
}
Write-Host "    $ExtensionDir" -ForegroundColor DarkGray
$opened = $false
foreach ($browser in @(@('chrome', 'chrome://extensions'), @('msedge', 'edge://extensions'), @('brave', 'brave://extensions'))) {
  try { Start-Process $browser[0] $browser[1]; $opened = $true; break } catch { }
}
if (-not $opened) { Warn (L 'Open chrome://extensions yourself.' 'Ouvre toi-même chrome://extensions.') }

Write-Host ''
Write-Host (L ' Done! Open a pull request on GitHub, "Files changed" tab: notes show up by themselves.' ' Terminé ! Ouvre une PR sur GitHub, onglet « Files changed » : les notes apparaissent toutes seules.') -ForegroundColor Green
Done 0
