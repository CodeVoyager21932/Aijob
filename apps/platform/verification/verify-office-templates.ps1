$ErrorActionPreference = 'Stop'
$fixtureRoot = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path 'docs\evidence\direction-studio-upgrade-2026-09-09\templates')
$wordOutput = Join-Path $fixtureRoot 'word'
New-Item -ItemType Directory -Path $wordOutput -Force | Out-Null
$manifest = Get-Content -LiteralPath (Join-Path $fixtureRoot 'report-all.json') -Raw | ConvertFrom-Json
$checks = [System.Collections.Generic.List[object]]::new()
$word = $null
$keeper = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $version = $word.Version
  $renderer = (Get-ItemProperty -LiteralPath 'Registry::HKEY_CLASSES_ROOT\CLSID\{000209FF-0000-0000-C000-000000000046}\LocalServer32').'(default)'
  $keeper = $word.Documents.Add()
  foreach ($item in $manifest.results) {
    $stem = "$($item.template)-$($item.sample)"
    $docPath = Join-Path $fixtureRoot "$stem.docx"
    $pdfPath = Join-Path $wordOutput "$stem.pdf"
    $document = $null
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    try {
      $document = $word.Documents.Open($docPath, $false, $true, $false)
      if ($null -eq $document) { throw 'OFFICE_DID_NOT_RETURN_DOCUMENT' }
      $document.Repaginate()
      $pages = $document.ComputeStatistics(2)
      $text = $document.Content.Text
      $document.ExportAsFixedFormat($pdfPath, 17)
      $checks.Add([pscustomobject]@{ template=$item.template; sample=$item.sample; passed=($pages -gt 0 -and $text.Length -gt 100); pages=$pages; textLength=$text.Length; milliseconds=$timer.ElapsedMilliseconds; officeVersion=$version; renderer=$renderer })
    } catch {
      $checks.Add([pscustomobject]@{ template=$item.template; sample=$item.sample; passed=$false; error=$_.Exception.Message; milliseconds=$timer.ElapsedMilliseconds; wordVersion=$version })
    } finally {
      if ($null -ne $document) { $document.Close(0) }
    }
    $checks | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $wordOutput 'report.json') -Encoding UTF8
    $checks[$checks.Count-1] | ConvertTo-Json -Compress
  }
} finally {
  if ($null -ne $keeper) { try { $keeper.Close(0) } catch {} }
  if ($null -ne $word) { try { $word.Quit() } catch {} }
}
if (@($checks | Where-Object { -not $_.passed }).Count -gt 0) { exit 1 }

