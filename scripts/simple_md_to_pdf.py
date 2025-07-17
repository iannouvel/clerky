import markdown
from pathlib import Path
import subprocess
import tempfile
import os

# Read the markdown file
input_file = Path('docs/patent-submission/to-be-submitted/UK_Patent_Submission_Formatted.md')
output_html = Path('docs/patent-submission/to-be-submitted/UK_Patent_Submission_Formatted.html')

# Read markdown content
with open(input_file, 'r', encoding='utf-8') as f:
    md_content = f.read()

# Convert markdown to HTML
html_content = markdown.markdown(md_content, extensions=['tables', 'fenced_code'])

# Add CSS styling for better formatting with proper page break support
html_document = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>UK Patent Application - Clerky</title>
    <style>
        body {{
            font-family: Arial, sans-serif;
            line-height: 1.6;
            margin: 2cm;
            font-size: 12pt;
        }}
        h1, h2, h3, h4, h5, h6 {{
            page-break-after: avoid;
            margin-top: 1em;
            margin-bottom: 0.5em;
        }}
        h1 {{
            font-size: 18pt;
            text-align: center;
            margin-top: 2em;
        }}
        h2 {{
            font-size: 16pt;
            border-bottom: 1px solid #ccc;
            padding-bottom: 0.3em;
        }}
        h3 {{
            font-size: 14pt;
        }}
        p {{
            margin-bottom: 0.8em;
        }}
        code {{
            background-color: #f5f5f5;
            padding: 2px 4px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
        }}
        pre {{
            background-color: #f5f5f5;
            padding: 1em;
            border-radius: 5px;
            overflow-x: auto;
            page-break-inside: avoid;
        }}
        div[style*="page-break-before: always"] {{
            page-break-before: always;
            height: 0;
            margin: 0;
            padding: 0;
        }}
        @page {{
            size: A4;
            margin: 2cm;
        }}
        @media print {{
            div[style*="page-break-before: always"] {{
                page-break-before: always !important;
            }}
        }}
    </style>
</head>
<body>
{html_content}
</body>
</html>
"""

# Write HTML file
with open(output_html, 'w', encoding='utf-8') as f:
    f.write(html_document)

print(f"HTML file created: {output_html}")
print("You can now open this HTML file in a browser and print to PDF manually.")
print("Or use a browser's 'Save as PDF' function to create the PDF file.")
print("The page breaks should now work correctly in the PDF output.") 