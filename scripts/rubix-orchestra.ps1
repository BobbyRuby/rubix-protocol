# rubix-orchestra.ps1 — Windows Terminal multi-instance launcher
# Usage: .\rubix-orchestra.ps1 -Action start [-Count N]
#        .\rubix-orchestra.ps1 -Action stop|status|list
#
# NOTE: Windows Terminal cannot inject keystrokes into panes.
# Identity prompts are printed to console — copy-paste into each pane.

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("start", "stop", "status", "list", "help")]
    [string]$Action,

    [int]$Count = 3
)

$Names = @("Forge", "Axis", "Trace", "Loom", "Spark")
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$DataDir = if ($env:RUBIX_DATA_DIR) { $env:RUBIX_DATA_DIR } else { Join-Path $ProjectRoot "data" }
$RegistryFile = Join-Path $DataDir "orchestra-registry.json"

function Get-InstanceName {
    param([int]$Index)
    $cycle = [math]::Floor(($Index - 1) / 5)
    $pos = ($Index - 1) % 5
    $name = $Names[$pos]
    if ($cycle -gt 0) { "${name}$($cycle + 1)" } else { $name }
}

function Get-InstanceRole {
    param([int]$Index)
    if ($Index -eq 1) { "orchestrator" } else { "worker" }
}

function Get-IdentityPrompt {
    param([int]$Index, [string]$Name, [string]$Role)

    if ($Role -eq "orchestrator") {
        return @"
instance_$Index $Name orchestrator
god_comms_heartbeat instanceId:"instance_$Index" name:"$Name" role:"orchestrator"
/recall
Split tasks->god_comms_send workers. Synthesize responses. Escalate only if blocked.
"@
    } else {
        return @"
instance_$Index $Name worker
god_comms_heartbeat instanceId:"instance_$Index" name:"$Name" role:"worker"
/recall
Execute tasks from monitor. god_comms_send(to:"instance_1" type:"response") when done.
"@
    }
}

function Start-Orchestra {
    param([int]$InstanceCount)

    if ($InstanceCount -lt 1) {
        Write-Error "Need at least 1 instance."
        return
    }

    Write-Host "Starting Rubix Orchestra with $InstanceCount instance(s)..." -ForegroundColor Cyan
    Write-Host ""

    # Build wt.exe command for split panes
    $wtArgs = @("wt.exe")

    for ($i = 1; $i -le $InstanceCount; $i++) {
        $name = Get-InstanceName -Index $i
        $role = Get-InstanceRole -Index $i
        $title = "instance_$i ($name)"

        if ($i -eq 1) {
            $wtArgs += "--title `"$title`" cmd /k `"set CLAUDECODE= && claude`""
        } else {
            $wtArgs += "; split-pane --title `"$title`" cmd /k `"set CLAUDECODE= && claude`""
        }
    }

    # Write registry
    $registry = @{
        session = "rubix-wt"
        created = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        instances = @{}
    }

    for ($i = 1; $i -le $InstanceCount; $i++) {
        $name = Get-InstanceName -Index $i
        $role = Get-InstanceRole -Index $i
        $registry.instances["instance_$i"] = @{
            name = $name
            role = $role
            pane = ($i - 1)
        }
    }

    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    $registry | ConvertTo-Json -Depth 5 | Set-Content -Path $RegistryFile

    # Launch Windows Terminal
    $wtCommand = $wtArgs -join " "
    Write-Host "Launching: $wtCommand" -ForegroundColor DarkGray
    Start-Process -FilePath "wt.exe" -ArgumentList ($wtArgs[1..($wtArgs.Length-1)] -join " ")

    Write-Host ""
    Write-Host "Windows Terminal launched with $InstanceCount panes." -ForegroundColor Green
    Write-Host ""
    Write-Host "IMPORTANT: Copy-paste the identity prompts below into each pane:" -ForegroundColor Yellow
    Write-Host ""

    # Print identity prompts for manual entry
    for ($i = 1; $i -le $InstanceCount; $i++) {
        $name = Get-InstanceName -Index $i
        $role = Get-InstanceRole -Index $i
        $prompt = Get-IdentityPrompt -Index $i -Name $name -Role $role

        Write-Host "═══ PANE $($i - 1): instance_$i ($name, $role) ═══" -ForegroundColor Magenta
        Write-Host $prompt -ForegroundColor White
        Write-Host ""
    }

    Write-Host "NOTE: No monitor on Windows — use 'rubix-orchestra.ps1 -Action status' to check." -ForegroundColor Yellow
}

function Stop-Orchestra {
    Write-Host "To stop: close the Windows Terminal window manually." -ForegroundColor Yellow
    Write-Host "Cleaning up registry..."
    if (Test-Path $RegistryFile) {
        Remove-Item $RegistryFile -Force
        Write-Host "Registry removed."
    }
}

function Show-Status {
    $commsDb = Join-Path $DataDir "comms.db"

    Write-Host "═══ RUBIX ORCHESTRA STATUS ═══════════════════════" -ForegroundColor Cyan

    if (-not (Test-Path $commsDb)) {
        Write-Host "  comms.db not found at $commsDb" -ForegroundColor Red
        return
    }

    if (Get-Command sqlite3 -ErrorAction SilentlyContinue) {
        Write-Host ""
        Write-Host "Instances:" -ForegroundColor Yellow
        sqlite3 -header -column $commsDb "
            SELECT instance_id, COALESCE(name,'?') AS name,
                   COALESCE(role,'?') AS role, status
            FROM instances ORDER BY instance_id;
        "

        Write-Host ""
        Write-Host "Messages:" -ForegroundColor Yellow
        sqlite3 -header -column $commsDb "
            SELECT status, COUNT(*) AS count
            FROM messages GROUP BY status;
        "
    } else {
        Write-Host "  sqlite3 not in PATH — cannot query comms.db" -ForegroundColor Red
    }

    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
}

function Show-List {
    if (Test-Path $RegistryFile) {
        $reg = Get-Content $RegistryFile | ConvertFrom-Json
        Write-Host "Registered instances:"
        foreach ($key in $reg.instances.PSObject.Properties) {
            $inst = $key.Value
            Write-Host "  $($key.Name): $($inst.name) ($($inst.role)) pane:$($inst.pane)"
        }
    } else {
        Write-Host "No registry found. Is the orchestra running?"
    }
}

# --- Main ---
switch ($Action) {
    "start"  { Start-Orchestra -InstanceCount $Count }
    "stop"   { Stop-Orchestra }
    "status" { Show-Status }
    "list"   { Show-List }
    "help"   {
        Write-Host "Usage: .\rubix-orchestra.ps1 -Action {start|stop|status|list} [-Count N]"
        Write-Host ""
        Write-Host "  start [-Count N]  Launch N instances in Windows Terminal (default: 3)"
        Write-Host "  stop              Clean up registry (close WT manually)"
        Write-Host "  status            Show heartbeats + message queue"
        Write-Host "  list              List registered instances"
    }
}
