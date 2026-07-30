$ErrorActionPreference = "Stop"

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }

$gac = Join-Path $env:WINDIR "Microsoft.NET\assembly\GAC_MSIL"

function Find-Asm([string]$name) {
    $dll = Get-ChildItem (Join-Path $gac $name) -Recurse -Filter "$name.dll" |
        Select-Object -First 1
    if ($null -eq $dll) { throw "Assembly $name not found in GAC" }
    return $dll.FullName
}

# System.Windows.Forms comes free via csc's default response file (csc.rsp);
# referencing it again from the GAC trips CS1703 (duplicate identity)
$refs = @("UIAutomationClient", "UIAutomationTypes", "WindowsBase") |
    ForEach-Object { "/r:`"$(Find-Asm $_)`"" }

$src = Join-Path $PSScriptRoot "SelectionHelper.cs"
$out = Join-Path $PSScriptRoot "SelectionHelper.exe"

& $csc /nologo /target:exe /out:"$out" @refs "$src"
if ($LASTEXITCODE -ne 0) { throw "csc failed" }
Write-Host "built $out"
