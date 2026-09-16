$files = Get-ChildItem -Path "src/data/posts/*.ts"
$utf8NoBOM = New-Object System.Text.UTF8Encoding($false)
foreach ($file in $files) {
    try {
        $content = [System.IO.File]::ReadAllText($file.FullName, $utf8NoBOM)
        # We target the literal mojibake strings
        $content = $content.Replace("€”", "")
        $content = $content.Replace("€“", "")
        [System.IO.File]::WriteAllText($file.FullName, $content, $utf8NoBOM)
    } catch {
        Write-Error "Failed to process $($file.FullName): $($_.Exception.Message)"
    }
}
