<#
.SYNOPSIS
  Instala (ou remove) a tarefa do Windows que executa a coleta de vagas do
  JobPilot todos os dias às 18:00 (Seção 7.1 da especificação).

.DESCRIPTION
  - Não exige administrador: a tarefa roda no contexto do usuário atual,
    somente quando ele está logado.
  - Usa o build compilado (backend/dist/cli/run-job.js): rode `npm run build`
    antes de instalar.
  - StartWhenAvailable: se o PC estiver desligado às 18:00, a tarefa roda na
    próxima vez que o PC estiver ligado e o usuário logado.
  - RunOnlyIfNetworkAvailable: sem rede, a execução é adiada.
  - MultipleInstances IgnoreNew + lock em data/.lock: nunca empilha execuções.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/install-task.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/install-task.ps1 -At "19:30"

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/install-task.ps1 -Uninstall
#>

param(
  [string]$At = "18:00",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$taskName = "JobPilot Coleta"
$repo = Split-Path -Parent $PSScriptRoot

if ($Uninstall) {
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -eq $existing) {
    Write-Host "A tarefa '$taskName' não existe — nada a remover."
    exit 0
  }
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Tarefa '$taskName' removida."
  exit 0
}

$script = Join-Path $repo "backend\dist\cli\run-job.js"
if (-not (Test-Path $script)) {
  throw "Build não encontrado em '$script'. Rode 'npm run build' na raiz do repositório antes de instalar a tarefa."
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  throw "Node.js não encontrado no PATH. Instale o Node >= 22.5 e abra um novo terminal."
}

$action = New-ScheduledTaskAction `
  -Execute $node `
  -Argument "`"$script`" --job collect --trigger scheduled" `
  -WorkingDirectory $repo

$trigger = New-ScheduledTaskTrigger -Daily -At $At

# DisallowStartIfOnBatteries=$false e StopIfGoingOnBatteries=$false (notebooks).
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
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
  -Description "Coleta diária de vagas do JobPilot. O PC precisa estar ligado e o usuário logado." `
  -Force | Out-Null

Write-Host "Tarefa '$taskName' instalada: todos os dias às $At (horário local)."
Write-Host "  Ação:   `"$node`" `"$script`" --job collect --trigger scheduled"
Write-Host "  Pasta:  $repo"
Write-Host ""
Write-Host "O PC precisa estar ligado (e o usuário logado) no horário. Se estiver desligado,"
Write-Host "a tarefa roda na próxima vez que o PC estiver disponível (StartWhenAvailable)."
Write-Host ""
Write-Host "Conferir:  Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo"
Write-Host "Remover:   powershell -ExecutionPolicy Bypass -File scripts/install-task.ps1 -Uninstall"
