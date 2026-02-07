$src = 'D:\rubix-protocol\god-agent'
$dst = 'C:\Users\rruby\PhpstormProjects\polepluginforrvms\god-agent'
$exclude = @('data','node_modules','.claude','.git')

if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
New-Item -ItemType Directory -Path $dst -Force | Out-Null

Get-ChildItem $src -Force | Where-Object {
    $exclude -notcontains $_.Name -and $_.Name -notlike 'tmpclaude-*'
} | ForEach-Object {
    if ($_.PSIsContainer) {
        Copy-Item $_.FullName (Join-Path $dst $_.Name) -Recurse -Force
    } else {
        Copy-Item $_.FullName (Join-Path $dst $_.Name) -Force
    }
}

Write-Host "Copy complete. Contents:"
Get-ChildItem $dst | Format-Table Name, Length -AutoSize
