import os
from pathlib import Path
from shared.config import Config
from shared.pdf_processor import PDFProcessor

# Input and output directories
input_dir = Path('docs/patent-submission/UK IPO Generic Patent Docs')
output_dir = Path('docs/patent-submission/PDF to text')
output_dir.mkdir(parents=True, exist_ok=True)

# Set up PDF processor
config = Config()
pdf_processor = PDFProcessor(config)

# Process each PDF in the input directory
for pdf_file in input_dir.glob('*.pdf'):
    print(f'Extracting text from: {pdf_file.name}')
    text = pdf_processor.extract_text(pdf_file)
    if text and text.strip():
        txt_file = output_dir / (pdf_file.stem + '.txt')
        with open(txt_file, 'w', encoding='utf-8') as f:
            f.write(text)
        print(f'Saved extracted text to: {txt_file}')
    else:
        print(f'No text extracted from: {pdf_file.name}') 