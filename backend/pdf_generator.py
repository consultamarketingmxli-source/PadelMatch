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
        "Generado con PadelappRetas OS · Round Robin Individual perfecto · Ningún jugador repite pareja.",
        footer_style,
    ))

    doc.build(story)
    return buf.getvalue()



# =====================================================================
# CLASIFICACIÓN FINAL — PDF A4 (top podium + tabla completa).
# =====================================================================

def _podium_row(top3: List[Dict], styles) -> Optional[Table]:
    """Tarjetas top-3 (oro/plata/bronce) si hay al menos 1 jugador."""
    if not top3:
        return None

    cell_style = ParagraphStyle(
        "PodCell",
        parent=styles["Normal"],
        fontSize=10,
        leading=12,
        textColor=colors.white,
        alignment=TA_CENTER,
    )
    name_style = ParagraphStyle(
        "PodName",
        parent=styles["Normal"],
        fontSize=12,
        leading=14,
        textColor=colors.white,
        alignment=TA_CENTER,
    )
    medal_style = ParagraphStyle(
        "Medal",
        parent=styles["Normal"],
        fontSize=22,
        leading=24,
        textColor=colors.white,
        alignment=TA_CENTER,
    )

    medals = ["1°", "2°", "3°"]
    bg = [
        colors.HexColor("#0F172A"),
        colors.HexColor("#1E293B"),
        colors.HexColor("#334155"),
    ]
    accent = [
        colors.HexColor("#FACC15"),  # oro
        colors.HexColor("#CBD5E1"),  # plata
        colors.HexColor("#FB923C"),  # bronce
    ]

    cells = []
    for i in range(3):
        if i < len(top3):
            p = top3[i]
            inner = [
                Paragraph(f"<b>{medals[i]}</b>", medal_style),
                Spacer(1, 2),
                Paragraph(f"<b>{p.get('nombre','—')}</b>", name_style),
                Spacer(1, 2),
                Paragraph(
                    f"PG {p.get('partidos_ganados',0)} · "
                    f"DG {p.get('diferencia',0)} · "
                    f"GF {p.get('juegos_a_favor',0)}",
                    cell_style,
                ),
            ]
            cells.append(inner)
        else:
            cells.append([Paragraph("—", cell_style)])

    tbl = Table([cells], colWidths=[60 * mm, 60 * mm, 60 * mm], rowHeights=[36 * mm])
    style_cmds = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]
    for i in range(min(3, len(top3))):
        style_cmds.append(("BACKGROUND", (i, 0), (i, 0), bg[i]))
        style_cmds.append(("LINEABOVE", (i, 0), (i, 0), 3, accent[i]))
    tbl.setStyle(TableStyle(style_cmds))
    return tbl


def _classif_table(standings: List[Dict], styles, show_ko: bool = False) -> Table:
    """Tabla completa de clasificación.

    Fase 7 — Si `show_ko=True`, agrega columna "KO" con `victorias_ko`.
    """
    head_style = ParagraphStyle(
        "ClsHead",
        parent=styles["Normal"],
        fontSize=9,
        leading=10,
        textColor=colors.white,
        alignment=TA_CENTER,
    )
    cell_style = ParagraphStyle(
        "ClsCell",
        parent=styles["Normal"],
        fontSize=9,
        leading=11,
        alignment=TA_CENTER,
        wordWrap="CJK",
    )
    name_style = ParagraphStyle(
        "ClsName",
        parent=styles["Normal"],
        fontSize=9,
        leading=11,
        alignment=TA_LEFT,
        wordWrap="CJK",
    )

    header_row = [
        Paragraph("<b>#</b>", head_style),
        Paragraph("<b>JUGADOR</b>", head_style),
        Paragraph("<b>PJ</b>", head_style),
        Paragraph("<b>PG</b>", head_style),
        Paragraph("<b>PE</b>", head_style),
        Paragraph("<b>PP</b>", head_style),
        Paragraph("<b>GF</b>", head_style),
        Paragraph("<b>GC</b>", head_style),
        Paragraph("<b>DG</b>", head_style),
        Paragraph("<b>%</b>", head_style),
        Paragraph("<b>PTS</b>", head_style),
    ]
    if show_ko:
        header_row.append(Paragraph("<b>KO</b>", head_style))
    data = [header_row]
    for idx, p in enumerate(standings, start=1):
        row = [
            Paragraph(f"<b>{idx}</b>", cell_style),
            Paragraph(p.get("nombre", "—"), name_style),
            Paragraph(str(p.get("partidos_jugados", 0)), cell_style),
            Paragraph(f"<b>{p.get('partidos_ganados', 0)}</b>", cell_style),
            Paragraph(str(p.get("partidos_empatados", 0)), cell_style),
            Paragraph(str(p.get("partidos_perdidos", 0)), cell_style),
            Paragraph(str(p.get("juegos_a_favor", 0)), cell_style),
            Paragraph(str(p.get("juegos_en_contra", 0)), cell_style),
            Paragraph(f"<b>{p.get('diferencia', 0):+d}</b>", cell_style),
            Paragraph(f"{p.get('efectividad', 0)}%", cell_style),
            Paragraph(f"<b>{p.get('puntos', 0)}</b>", cell_style),
        ]
        if show_ko:
            ko = int(p.get("victorias_ko", 0) or 0)
            badge = f"<b>⚡{ko}</b>" if ko > 0 else "—"
            row.append(Paragraph(badge, cell_style))
        data.append(row)

    col_widths = [
        10 * mm, 56 * mm, 12 * mm, 12 * mm, 12 * mm, 12 * mm,
        14 * mm, 14 * mm, 14 * mm, 14 * mm, 14 * mm,
    ]
    if show_ko:
        col_widths.append(14 * mm)
    tbl = Table(data, colWidths=col_widths, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("ALIGN", (1, 1), (1, -1), "LEFT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F4F5")]),
    ]))
    return tbl


def generar_pdf_clasificacion(
    reta: Dict,
    standings: List[Dict],
    logo_bytes: Optional[bytes] = None,
) -> bytes:
    """
    Genera PDF A4 con la Clasificación Final.

    reta: dict con metadatos (nombre, club, fecha_evento, ...).
    standings: lista de dicts con stats por jugador (ver core.standings).
    logo_bytes: bytes del logo del organizador (opcional).
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
        title=f"Clasificacion - {reta.get('nombre','Reta')}",
    )
    styles = getSampleStyleSheet()
    section_style = ParagraphStyle(
        "SectionCls",
        parent=styles["Heading2"],
        fontSize=14,
        leading=16,
        textColor=DARK_BG,
        spaceAfter=4,
        spaceBefore=10,
    )
    sub_style = ParagraphStyle(
        "SubCls",
        parent=styles["Normal"],
        fontSize=10,
        leading=12,
        textColor=LIGHT_TEXT,
    )
    footer_style = ParagraphStyle(
        "FooterCls",
        parent=styles["Normal"],
        fontSize=8,
        textColor=LIGHT_TEXT,
        alignment=TA_CENTER,
        spaceBefore=8,
    )

    story = []
    story.append(_build_header(reta, logo_bytes))
    story.append(Spacer(1, 4 * mm))

    # Fase 7 — Subtítulo informa el criterio de desempate activo + KO/cap_total.
    criterio = (reta.get("criterio_desempate") or "A")
    criterio_label = {
        "A": "Puntos netos individuales (DG → GF → Nombre)",
        "B": "Puntos netos por pareja (DG → Nombre)",
        "C": "Rendimiento técnico (Ratio GF/GC → DG → Nombre)",
    }.get(criterio, "Puntos netos individuales")
    fs = reta.get("formato_score") or {}
    ko_on = bool(fs.get("ko_enabled"))
    cap = fs.get("cap_total")
    extra = []
    if cap is not None:
        extra.append(f"cap {cap}")
    if ko_on and cap is not None:
        extra.append(f"KO {int(cap)//2 + 1}-0")
    extra_str = (" · " + " · ".join(extra)) if extra else ""
    story.append(Paragraph(
        f"<b>Clasificación Final</b> — Criterio <b>{criterio}</b>: {criterio_label}.{extra_str}",
        sub_style,
    ))
    story.append(Spacer(1, 4 * mm))

    podium = _podium_row(standings[:3], styles)
    if podium:
        story.append(podium)
        story.append(Spacer(1, 6 * mm))

    story.append(Paragraph("Tabla completa", section_style))
    if standings:
        # Mostrar columna KO si algún jugador tiene victorias_ko > 0 o si la reta
        # tenía ko_enabled (aunque nadie haya ganado por KO, así el organizador
        # ve que la columna existe).
        show_ko = ko_on or any((p.get("victorias_ko") or 0) > 0 for p in standings)
        story.append(_classif_table(standings, styles, show_ko=show_ko))
    else:
        empty_style = ParagraphStyle(
            "Empty",
            parent=styles["Normal"],
            fontSize=11,
            textColor=LIGHT_TEXT,
            alignment=TA_CENTER,
            spaceBefore=10,
            spaceAfter=10,
        )
        story.append(Paragraph(
            "Aún no hay resultados capturados para esta reta.",
            empty_style,
        ))

    story.append(Spacer(1, 6 * mm))
    crit_short = {"A": "DG → GF", "B": "DG", "C": "GF/GC"}.get(criterio, "DG → GF")
    story.append(Paragraph(
        f"Generado con PadelappRetas OS · Cascada: PG → {crit_short} → Nombre"
        + (" · ⚡ = victoria por KO." if any((p.get('victorias_ko') or 0) > 0 for p in standings) else ""),
        footer_style,
    ))

    doc.build(story)
    return buf.getvalue()
