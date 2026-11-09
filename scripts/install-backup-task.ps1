<#
.SYNOPSIS
  Instala (ou remove) a tarefa semanal de backup do JobPilot no Windows.

.DESCRIPTION
  - Cria um backup validado do banco em data/backups/ uma vez por semana
    (padrão: domingo às 12:00), conforme a decisão D8 da especificação.
  - Usa o build compilado (backend/dist/cli/backup.js): rode `npm run build`
    antes de instalar.
  - Não exige administrador: roda no contexto do usuário atual, somente
    quando ele está logado.
  - StartWhenAvailable: se o PC estiver desligado no horário, o backup roda
    na próxima vez que o PC estiver ligado e o usuário logado.
  - A retenção existente (últimos 14 backups) continua valendo.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/install-backup-task.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/install-backup-task.ps1 -Day Saturday -At "09:00"

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/install-backup-task.ps1 -Uninstall
#>

param(
  [ValidateSet("Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday")]
  [string]$Day = "Sunday",
  [string]$At = "12:00",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$taskName = "JobPilot Backup"
$repo = Split-Path -Parent $PSScriptRoot

if ($Uninstall) {
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -eq $existing) {
    Write-Host "A tarefa '$taskName' não existe - nada a remover."
    exit 0
  }
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Tarefa '$taskName' removida."
  exit 0
}

$script = Join-Path $repo "backend\dist\cli\backup.js"
if (-not (Test-Path $script)) {
  throw "Build não encontrado em '$script'. Rode 'npm run build' na raiz do repositório antes de instalar a tarefa."
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  throw "Node.js não encontrado no PATH. Instale o Node >= 22.5 e abra um novo terminal."
}

$action = New-ScheduledTaskAction `
  -Execute $node `
  -Argument "`"$script`"" `
  -WorkingDirectory $repo

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Day -At $At

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Backup semanal validado do JobPilot. O PC precisa estar ligado e o usuário logado." `
  -Force | Out-Null

Write-Host "Tarefa '$taskName' instalada: toda semana ($Day) às $At (horário local)."
Write-Host "  Ação:   `"$node`" `"$script`""
Write-Host "  Pasta:  $repo"
Write-Host ""
Write-Host "O PC precisa estar ligado (e o usuário logado) no horário. Se estiver desligado,"
Write-Host "a tarefa roda na próxima vez que o PC estiver disponível (StartWhenAvailable)."
Write-Host ""
Write-Host "Conferir:  Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo"
Write-Host "Remover:   powershell -ExecutionPolicy Bypass -File scripts/install-backup-task.ps1 -Uninstall"
