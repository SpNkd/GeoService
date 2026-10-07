"""Deterministic, original vector/scan/mixed PDFs. Run with reportlab + Pillow."""
from pathlib import Path
from io import BytesIO
from PIL import Image, ImageDraw
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os
font = os.environ.get("PDF_FIXTURE_FONT", "/System/Library/Fonts/Supplemental/Arial.ttf")
pdfmetrics.registerFont(TTFont("FixtureSans", font))
root = Path(__file__).resolve().parents[1] / 'e2e' / 'fixtures' / 'pdf'
root.mkdir(parents=True, exist_ok=True)
image = Image.new('RGB', (800, 500), 'white')
draw = ImageDraw.Draw(image)
draw.line([(80, 180), (720, 208)], fill='black', width=5)
draw.line([(250, 100), (250, 380)], fill='black', width=5)
draw.ellipse((510, 260, 650, 400), outline='black', width=4)
for name in ('vector', 'scan', 'mixed'):
    pdf = canvas.Canvas(str(root / (name + '.pdf')), pagesize=(600, 420), invariant=1, pageCompression=1)
    if name != 'scan':
        pdf.setLineWidth(2)
        pdf.line(50, 340, 510, 340)
        pdf.rect(70, 170, 100, 90, fill=0)
        pdf.circle(430, 200, 40, fill=0)
        pdf.setFont('FixtureSans', 18)
        pdf.drawString(60, 290, 'ГАЗ V-101 H=28.40')
    if name != 'vector':
        pdf.drawImage(ImageReader(image), 40, 30, width=520, height=110 if name == 'mixed' else 160)
    if name == 'vector':
        pdf.showPage()
        pdf.saveState()
        pdf.translate(150, 100)
        pdf.rotate(25)
        pdf.setLineWidth(2)
        pdf.line(0, 0, 300, 0)
        pdf.setFont('FixtureSans', 18)
        pdf.drawString(0, 20, 'SECOND PAGE')
        pdf.restoreState()
    pdf.save()
