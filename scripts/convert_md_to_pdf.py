import markdown
import weasyprint
from pathlib import Path

# Read the markdown file
input_file = Path('docs/patent-submission/to-be-submitted/UK_Patent_Submission_Formatted.md')
output_file = Path('docs/patent-submission/to-be-submitted/UK_Patent_Submission_Formatted.pdf')

# Read markdown content
with open(input_file, 'r', encoding='utf-8') as f:
    md_content = f.read()

# Convert markdown to HTML
html_content = markdown.markdown(md_content, extensions=['tables', 'fenced_code'])

# Add CSS styling for better PDF formatting
html_document = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
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
        .newpage {{
            page-break-before: always;
        }}
        @page {{
            size: A4;
            margin: 2cm;
        }}
    </style>
</head>
<body>
{html_content}
</body>
</html>
"""

# Convert HTML to PDF
weasyprint.HTML(string=html_document).write_pdf(output_file)

print(f"PDF created successfully: {output_file}") 