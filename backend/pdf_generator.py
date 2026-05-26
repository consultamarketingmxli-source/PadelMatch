"""
Generador de PDF A4 para el Rol Round Robin.
Formateado milimétricamente, con auto-ajuste de línea para nombres largos.
Si no hay logo, inserta un placeholder genérico del sistema.
"""
import io
from typing import List, Dict, Optional

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Table,
    TableStyle,
    Paragraph,
    Spacer,
    Image,
    PageBreak,
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT


PADEL_GREEN = colors.HexColor("#A3E635")
DARK_BG = colors.HexColor("#0A0A0A")
LIGHT_TEXT = colors.HexColor("#27272A")


def _build_header(reta: Dict, logo_bytes: Optional[bytes] = None):
    """Header con logo del club + datos de la reta."""
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "TitleStyle",
        parent=styles["Heading1"],
        fontSize=22,
        leading=24,
        textColor=DARK_BG,
        alignment=TA_LEFT,
        spaceAfter=2,
    )
    subtitle_style = ParagraphStyle(
        "SubtitleStyle",
        parent=styles["Normal"],
        fontSize=10,
        leading=12,
        textColor=LIGHT_TEXT,
        alignment=TA_LEFT,
    )

    if logo_bytes:
        try:
            logo_img = Image(io.BytesIO(logo_bytes), width=22 * mm, height=22 * mm)
        except Exception:
            logo_img = _placeholder_logo()
    else:
        logo_img = _placeholder_logo()

    title = Paragraph(f"<b>{reta.get('nombre','Reta')}</b>", title_style)
    meta = Paragraph(
        f"Club: {reta.get('club','—')}<br/>"
        f"Fecha: {reta.get('fecha_evento','—')}<br/>"
        f"Modalidad: {reta.get('modalidad_juego','—')} · "
        f"Rondas: {reta.get('num_rondas','—')} · "
        f"Canchas: {reta.get('canchas_disponibles','—')}",
        subtitle_style,
    )

    header_table = Table(
        [[logo_img, [title, meta]]],
        colWidths=[28 * mm, 150 * mm],
    )
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
    ]))
    return header_table


def _placeholder_logo():
    """Crea un cuadro con texto P-OS como placeholder."""
    styles = getSampleStyleSheet()
    style = ParagraphStyle(
        "Placeholder",
        parent=styles["Normal"],
        fontSize=14,
        textColor=DARK_BG,
        alignment=TA_CENTER,
    )
    t = Table([[Paragraph("<b>P·OS</b>", style)]], colWidths=[22 * mm], rowHeights=[22 * mm])
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 1.5, PADEL_GREEN),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    return t


def _cancha_table(rondas: List[Dict], styles) -> Table:
    """Tabla de rondas: por cada ronda 2 partidos. Auto-wrap con Paragraph."""
    cell_style = ParagraphStyle(
        "Cell",
        parent=styles["Normal"],
        fontSize=9,
        leading=11,
        alignment=TA_CENTER,
        wordWrap="CJK",
    )
    head_style = ParagraphStyle(
        "Head",
        parent=styles["Normal"],
        fontSize=9,
        leading=10,
        textColor=colors.white,
        alignment=TA_CENTER,
    )

    data = [[
        Paragraph("<b>RONDA</b>", head_style),
        Paragraph("<b>PARTIDO 1 — Pareja A</b>", head_style),
        Paragraph("<b>vs Pareja B</b>", head_style),
        Paragraph("<b>PARTIDO 2 — Pareja A</b>", head_style),
        Paragraph("<b>vs Pareja B</b>", head_style),
    ]]
    for r in rondas:
        p1 = r["partidos"][0]
        p2 = r["partidos"][1]
        data.append([
            Paragraph(f"<b>{r['ronda']}</b>", cell_style),
            Paragraph(" / ".join(p1["pareja_a"]), cell_style),
            Paragraph(" / ".join(p1["pareja_b"]), cell_style),
            Paragraph(" / ".join(p2["pareja_a"]), cell_style),
            Paragraph(" / ".join(p2["pareja_b"]), cell_style),
        ])

    tbl = Table(
        data,
        colWidths=[14 * mm, 40 * mm, 40 * mm, 40 * mm, 40 * mm],
        repeatRows=1,
    )
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#27272A")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F4F5")]),
    ]))
    return tbl


def generar_pdf_rol(
    reta: Dict,
    rol_canchas: List[Dict],
    logo_bytes: Optional[bytes] = None,
) -> bytes:
    """
    Genera el PDF A4 del rol Round Robin.

    reta: dict con metadatos (nombre, club, fecha_evento, modalidad_juego, num_rondas,
        canchas_disponibles, observaciones_publicas)
    rol_canchas: lista [{"cancha": int, "rondas": [...]}]
    logo_bytes: bytes del logo. Si None, se usa placeholder.

    Retorna bytes PDF.
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
        title=f"Rol - {reta.get('nombre','Reta')}",
    )
    styles = getSampleStyleSheet()
    obs_style = ParagraphStyle(
        "Obs",
        parent=styles["Normal"],
        fontSize=10,
        leading=12,
        textColor=DARK_BG,
        backColor=colors.HexColor("#F0FDE7"),
        borderColor=PADEL_GREEN,
        borderWidth=1,
        borderPadding=6,
    )
    section_style = ParagraphStyle(
        "Section",
        parent=styles["Heading2"],
        fontSize=14,
        leading=16,
        textColor=DARK_BG,
        spaceAfter=4,
        spaceBefore=10,
    )

    story = []
    story.append(_build_header(reta, logo_bytes))
    story.append(Spacer(1, 6 * mm))

    if reta.get("observaciones_publicas"):
        story.append(Paragraph(
            f"<b>Observaciones del organizador:</b> {reta['observaciones_publicas']}",
            obs_style,
        ))
        story.append(Spacer(1, 4 * mm))

    for cancha in rol_canchas:
        story.append(Paragraph(f"Cancha {cancha['cancha']}", section_style))
        story.append(_cancha_table(cancha["rondas"], styles))
        story.append(Spacer(1, 4 * mm))

    # Footer informativo
    footer_style = ParagraphStyle(
        "Footer",
        parent=styles["Normal"],
        fontSize=8,
        textColor=LIGHT_TEXT,
        alignment=TA_CENTER,
        spaceBefore=8,
    )
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(
        "Generado con Pixel Padel OS · Round Robin Individual perfecto · Ningún jugador repite pareja.",
        footer_style,
    ))

    doc.build(story)
    return buf.getvalue()
