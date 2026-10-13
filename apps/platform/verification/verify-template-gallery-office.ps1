param([string[]]$TemplateIds = @())
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$fixtureRoot = Join-Path $repoRoot 'docs\evidence\resume-template-ux-2026-09-10\templates'
$outputRoot = Join-Path $fixtureRoot 'office'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$manifest = Get-Content -LiteralPath (Join-Path $fixtureRoot 'report.json') -Raw | ConvertFrom-Json
$checks = [System.Collections.Generic.List[object]]::new()
$office = $null
$keeper = $null
$existingCount = 0
$originalVisible = $false
try {
    $office = New-Object -ComObject Word.Application
    $existingCount = $office.Documents.Count
    $originalVisible = $office.Visible
    $originalAlerts = $office.DisplayAlerts
    if ($existingCount -eq 0) { $office.Visible = $false }
    $office.DisplayAlerts = 0
    $renderer = (Get-ItemProperty -LiteralPath 'Registry::HKEY_CLASSES_ROOT\CLSID\{000209FF-0000-0000-C000-000000000046}\LocalServer32').'(default)'
    $keeper = $office.Documents.Add()
    foreach ($item in @($manifest.results | Where-Object { $TemplateIds.Count -eq 0 -or $_.id -in $TemplateIds })) {
        $document = $null
        try {
            $document = $office.Documents.Open((Join-Path $fixtureRoot "$($item.id).docx"), $false, $true, $false)
            $document.Repaginate()
            $pages = $document.ComputeStatistics(2)
            $body = $document.Content.Text
            $document.ExportAsFixedFormat((Join-Path $outputRoot "$($item.id).pdf"), 17)
            $checks.Add([pscustomobject]@{ template=$item.id; passed=($pages -gt 0 -and $body.Contains('校园学习空间调研') -and $body.Contains('lin.zhixia@example.com')); pages=$pages; renderer=$renderer; officeVersion=$office.Version })
        } catch {
            $checks.Add([pscustomobject]@{ template=$item.id; passed=$false; error=$_.Exception.Message })
        } finally {
            if ($null -ne $document) { $document.Close(0) }
        }
        $reportName = if($TemplateIds.Count -gt 0) { 'report-cleanup-check.json' } else { 'report.json' }
        $checks | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputRoot $reportName) -Encoding utf8
        $checks[$checks.Count-1] | Select-Object template,passed,pages | ConvertTo-Json -Compress
    }
} finally {
    if ($null -ne $keeper) { try { $keeper.Close(0) } catch {} }
    if ($null -ne $office) {
        # WPS may disconnect COM when its last owned document closes.
        try {
            $office.DisplayAlerts = $originalAlerts
            if ($existingCount -eq 0 -and $office.Documents.Count -eq 0) { $office.Quit() }
            else { $office.Visible = $originalVisible }
        } catch {
            if ($existingCount -gt 0) { Write-Warning 'Office disconnected before its original UI settings could be restored.' }
        }
    }
}
if (@($checks | Where-Object { -not $_.passed }).Count -gt 0) { exit 1 }
