"""Compare every DOCX paragraph and hyperlink with actual LibreOffice PDF bytes."""
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
import json, re, unicodedata, argparse
from pypdf import PdfReader

root = Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('--matrix',default='.data/resume-native-k1-20260912/matrix')
parser.add_argument('--output',default='.data/resume-native-k1-20260912/office')
args=parser.parse_args()
matrix=root/args.matrix
output=root/args.output
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
normalize = lambda value: re.sub(r'\s+', '', unicodedata.normalize('NFKC', value))
results = []
for source in sorted(matrix.glob('*.docx')):
    with ZipFile(source) as archive:
        document = ET.fromstring(archive.read('word/document.xml'))
        paragraphs = [normalize(''.join(t.text or '' for t in p.findall('.//w:t', ns)))
                      for p in document.findall('.//w:p', ns)]
        paragraphs = [p for p in paragraphs if p]
        relations = ET.fromstring(archive.read('word/_rels/document.xml.rels'))
        links = {r.attrib['Target'].rstrip('/') for r in relations
                 if r.attrib.get('Type', '').endswith('/hyperlink')}
    reader = PdfReader(output / (source.stem + '.pdf'))
    text = normalize(''.join(page.extract_text() or '' for page in reader.pages))
    actual_links = set()
    for page in reader.pages:
        for annotation in page.get('/Annots', []):
            uri = annotation.get_object().get('/A', {}).get('/URI')
            if uri: actual_links.add(str(uri).rstrip('/'))
    missing = [index for index, paragraph in enumerate(paragraphs) if paragraph not in text]
    row = {'name': source.stem, 'pages': len(reader.pages), 'paragraphs': len(paragraphs),
           'missingParagraphIndexes': missing, 'missingLinks': sorted(links - actual_links),
           'office': 'LibreOffice 7.4.7.2', 'visualReview': 'pending'}
    results.append(row)
    print(json.dumps(row, ensure_ascii=False))
(output / 'readback.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
if any(row['missingParagraphIndexes'] or row['missingLinks'] for row in results):
    raise SystemExit('Office output lost content or links')
