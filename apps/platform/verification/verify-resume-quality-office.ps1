param([string[]]$TemplateIds=@())
$ErrorActionPreference='Stop'
$repoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$matrix=Join-Path $repoRoot 'docs\evidence\resume-studio-quality-2026-09-10\matrix'
$output=Join-Path $matrix 'office-v3'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$report=Get-Content -LiteralPath (Join-Path $matrix 'report-all.json') -Raw | ConvertFrom-Json
if(-not $report.complete -or $report.results.Count -ne 120){throw 'The current 120-case matrix must pass before Office verification.'}
$checks=[System.Collections.Generic.List[object]]::new()
$office=$null;$keeper=$null;$existingCount=0;$originalVisible=$false
try{
 $office=New-Object -ComObject Word.Application
 $existingCount=$office.Documents.Count;$originalVisible=$office.Visible;$originalAlerts=$office.DisplayAlerts
 if($existingCount -eq 0){$office.Visible=$false};$office.DisplayAlerts=0
 $renderer=(Get-ItemProperty -LiteralPath 'Registry::HKEY_CLASSES_ROOT\CLSID\{000209FF-0000-0000-C000-000000000046}\LocalServer32').'(default)'
 $keeper=$office.Documents.Add()
 foreach($item in $report.results | Where-Object {$TemplateIds.Count -eq 0 -or $_.template -in $TemplateIds}){
  $stem="$($item.template)-$($item.sample)";$document=$null;$timer=[System.Diagnostics.Stopwatch]::StartNew()
  try{
   $document=$office.Documents.Open((Join-Path $matrix "$stem.docx"),$false,$true,$false)
   if($null -eq $document){throw 'OFFICE_DID_NOT_OPEN_DOCUMENT'}
   $document.Repaginate();$pages=$document.ComputeStatistics(2)
   $text=($document.Content.Text.Normalize() -replace '\s|\u200b|\u00ad','')
   $manifest=Get-Content -LiteralPath (Join-Path $matrix "$stem.manifest.json") -Raw | ConvertFrom-Json
   # Word reads separate table rows in row order. Validate every original body
   # paragraph independently; the adjacent column can occur between paragraphs.
   $missing=@($manifest.fields | Where-Object {$field=$_;$segments=if($field.id.EndsWith('.body')){$field.value -split "`n"}else{@($field.value)};@($segments | Where-Object {$value=$_.Normalize() -replace '\s|\u200b|\u00ad','';$value -and -not $text.Contains($value)}).Count -gt 0} | ForEach-Object {$_.id})
   $document.ExportAsFixedFormat((Join-Path $output "$stem.pdf"),17)
   $checks.Add([pscustomobject]@{template=$item.template;sample=$item.sample;passed=($pages -gt 0 -and $missing.Count -eq 0);pages=$pages;missingFieldIds=$missing;officeVersion=$office.Version;renderer=$renderer;milliseconds=$timer.ElapsedMilliseconds})
  }catch{$checks.Add([pscustomobject]@{template=$item.template;sample=$item.sample;passed=$false;error=$_.Exception.Message})}
  finally{if($null -ne $document){$document.Close(0)}}
  [pscustomobject]@{matrixSignature=$report.signature;results=@($checks)} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $output 'report.json') -Encoding utf8NoBOM
  $checks[$checks.Count-1] | Select-Object template,sample,passed,pages,missingFieldIds | ConvertTo-Json -Compress
 }
}finally{
 if($null -ne $keeper){try{$keeper.Close(0)}catch{}}
 if($null -ne $office){try{$office.DisplayAlerts=$originalAlerts;if($existingCount -eq 0 -and $office.Documents.Count -eq 0){$office.Quit()}else{$office.Visible=$originalVisible}}catch{if($existingCount -gt 0){Write-Warning 'Office disconnected; original UI settings could not be restored.'}}}
}
if(@($checks | Where-Object {-not $_.passed}).Count -gt 0){exit 1}
