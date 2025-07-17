import os
from pathlib import Path
from PyPDF2 import PdfReader
from pdfminer.high_level import extract_text as pdfminer_extract

input_file = Path('docs/business/Launch Plan for Clerky – AI-Driven Clinical Consultation Platform.pdf')
output_file = Path('docs/business/Launch Plan for Clerky – AI-Driven Clinical Consultation Platform.txt')

def extract_text_pypdf2(pdf_path):
    try:
        reader = PdfReader(pdf_path)
        text = ''
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + '\n'
        return text
    except Exception as e:
        print(f"PyPDF2 failed for {pdf_path}: {e}")
        return ''

def extract_text_pdfminer(pdf_path):
    try:
        text = pdfminer_extract(str(pdf_path))
        return text
    except Exception as e:
        print(f"pdfminer failed for {pdf_path}: {e}")
        return ''

print(f'Extracting text from: {input_file.name}')
text = extract_text_pypdf2(input_file)
if not text.strip():
    print('PyPDF2 extraction empty, trying pdfminer...')
    text = extract_text_pdfminer(input_file)
if text and text.strip():
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(text)
    print(f'Saved extracted text to: {output_file}')
else:
    print(f'No text extracted from: {input_file.name}') 