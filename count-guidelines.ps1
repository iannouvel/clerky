# Count PDF files in UHSx Document Library

$folderPath = "C:\Users\ianno\OneDrive - NHS\UHSx Document Library - UHSx - Document Library"

# Check if folder exists
if (-not (Test-Path -Path $folderPath)) {
    Write-Host "Error: Folder not found at path: $folderPath" -ForegroundColor Red
    exit 1
}

# Count PDF files recursively
$pdfFiles = Get-ChildItem -Path $folderPath -Filter "*.pdf" -File -Recurse -ErrorAction SilentlyContinue

$count = $pdfFiles.Count

# Display results
Write-Host "`nPDF Guidelines Count" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host "Folder: $folderPath" -ForegroundColor Yellow
Write-Host "Total PDF files found: $count" -ForegroundColor Green

# Optional: List all PDF files if you want to see them
# Uncomment the lines below to see the full list
# Write-Host "`nList of PDF files:" -ForegroundColor Cyan
# $pdfFiles | ForEach-Object { Write-Host $_.FullName }

