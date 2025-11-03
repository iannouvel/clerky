# Find PDFs containing "guideline" in their text content

$folderPath = "C:\Users\ianno\OneDrive - NHS\UHSx Document Library - UHSx - Document Library"

# Check if folder exists
if (-not (Test-Path -Path $folderPath)) {
    Write-Host "Error: Folder not found at path: $folderPath" -ForegroundColor Red
    exit 1
}

# Check if iTextSharp is available, if not, attempt to download it
$iTextSharpPath = "$PSScriptRoot\itextsharp.dll"

if (-not (Test-Path $iTextSharpPath)) {
    Write-Host "Downloading iTextSharp library for PDF text extraction..." -ForegroundColor Yellow
    
    # Download iTextSharp 5.5.13.3 (older version, free to use)
    $nugetUrl = "https://www.nuget.org/api/v2/package/iTextSharp/5.5.13.3"
    $zipPath = "$PSScriptRoot\itextsharp.zip"
    $extractPath = "$PSScriptRoot\itextsharp_temp"
    
    try {
        Invoke-WebRequest -Uri $nugetUrl -OutFile $zipPath
        Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
        Copy-Item "$extractPath\lib\itextsharp.dll" -Destination $iTextSharpPath
        Remove-Item $zipPath -Force
        Remove-Item $extractPath -Recurse -Force
        Write-Host "iTextSharp downloaded successfully!" -ForegroundColor Green
    } catch {
        Write-Host "Error downloading iTextSharp: $_" -ForegroundColor Red
        exit 1
    }
}

# Load the iTextSharp assembly
Add-Type -Path $iTextSharpPath

# Function to extract text from PDF
function Get-PdfText {
    param([string]$pdfPath)
    
    try {
        $reader = New-Object iTextSharp.text.pdf.PdfReader($pdfPath)
        $text = ""
        
        for ($page = 1; $page -le $reader.NumberOfPages; $page++) {
            $text += [iTextSharp.text.pdf.parser.PdfTextExtractor]::GetTextFromPage($reader, $page)
        }
        
        $reader.Close()
        return $text
    } catch {
        return $null
    }
}

# Get all PDF files
Write-Host "Scanning for PDF files..." -ForegroundColor Cyan
$pdfFiles = Get-ChildItem -Path $folderPath -Filter "*.pdf" -File -Recurse -ErrorAction SilentlyContinue

Write-Host "Found $($pdfFiles.Count) PDF files. Now checking content..." -ForegroundColor Yellow
Write-Host ""

$guidelineCount = 0
$processedCount = 0
$errorCount = 0
$guidelineFiles = @()

foreach ($pdf in $pdfFiles) {
    $processedCount++
    Write-Progress -Activity "Scanning PDFs for 'guideline'" -Status "Processing $processedCount of $($pdfFiles.Count)" -PercentComplete (($processedCount / $pdfFiles.Count) * 100)
    
    try {
        $text = Get-PdfText -pdfPath $pdf.FullName
        
        if ($text -and $text -match "guideline") {
            $guidelineCount++
            $guidelineFiles += $pdf.FullName
            Write-Host "[GUIDELINE FOUND] $($pdf.Name)" -ForegroundColor Green
        }
    } catch {
        $errorCount++
        Write-Host "[ERROR] Could not process: $($pdf.Name)" -ForegroundColor Red
    }
}

Write-Progress -Activity "Scanning PDFs" -Completed

# Display results
Write-Host "`n================================" -ForegroundColor Cyan
Write-Host "Results Summary" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Total PDFs scanned: $processedCount" -ForegroundColor Yellow
Write-Host "PDFs containing 'guideline': $guidelineCount" -ForegroundColor Green
Write-Host "Errors encountered: $errorCount" -ForegroundColor Red
Write-Host ""

# Save list of guidelines to a file
$outputFile = "$PSScriptRoot\guidelines-list.txt"
$guidelineFiles | Out-File -FilePath $outputFile -Encoding UTF8
Write-Host "Full list of guidelines saved to: $outputFile" -ForegroundColor Cyan

