#!/usr/bin/env python3
"""
render_plan.py — Convierte la salida de calc_escalado.py en el HTML del Plan de Escalado x SARAHI.

Uso:
    python render_plan.py salida-calc.json plan-escalado-<cliente>-AAAA-MM-DD.html [--narrativa narrativa.json]

`narrativa.json` (opcional) trae los textos que escribe el analista: veredicto, decisiones,
lecturas por sección, plan horizontal, límites. Si falta, el HTML se genera igual con textos
neutros derivados de los datos, para que el pipeline nunca se rompa. Esquema en SKILL.md.

Diseño: sistema SARAHI (DM Sans, charcoal #323232, orange #f2692d, periwinkle #8088e6,
lime #e0fb9b, cream #fcf2e3, gray #f5f5f5). Sin emoji. Un solo archivo autocontenido.
Sin dependencias externas. Python 3.9+.
"""
import base64
import datetime as dt
import html
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(HERE, "..", "assets", "logo-sarahi.png")
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


# --------------------------------------------------------------------------------------
# Formato es-CL
# --------------------------------------------------------------------------------------
def esc(s):
    return html.escape("" if s is None else str(s))


def money(v, signo=False, moneda="$"):
    if v is None:
        return "—"
    try:
        v = float(v)
    except (TypeError, ValueError):
        return esc(v)
    s = f"{abs(v):,.0f}".replace(",", ".")
    pre = "−" if v < 0 else ("+" if (signo and v > 0) else "")
    return f"{pre}{moneda}{s}"


def num(v, nd=0):
    if v is None:
        return "—"
    try:
        v = float(v)
    except (TypeError, ValueError):
        return esc(v)
    if nd == 0:
        return f"{v:,.0f}".replace(",", ".")
    return f"{v:,.{nd}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def roas(v):
    if v is None:
        return "—"
    try:
        fv = float(v)
    except (TypeError, ValueError):
        return esc(v)
    return f"{num(fv, 2 if abs(fv) < 10 else 1)}x"


def pct(v, nd=0, signo=False):
    if v is None:
        return "—"
    try:
        v = float(v) * 100
    except (TypeError, ValueError):
        return esc(v)
    s = num(v, nd)
    if signo and v > 0:
        s = "+" + s
    return f"{s} %"


def fecha_larga(iso):
    if not iso:
        return "—"
    try:
        d = dt.date.fromisoformat(str(iso)[:10])
        return f"{d.day} de {MESES[d.month - 1]} de {d.year}"
    except ValueError:
        return esc(iso)


def fecha_corta(iso):
    if not iso:
        return "—"
    try:
        d = dt.date.fromisoformat(str(iso)[:10])
        return f"{d.day} {MESES[d.month - 1][:3]}"
    except ValueError:
        return esc(iso)


def periodo(p):
    return "—" if not p else f"{fecha_corta(p.get('inicio'))} → {fecha_corta(p.get('fin'))}"


# --------------------------------------------------------------------------------------
# Semáforos
# --------------------------------------------------------------------------------------
ESTADOS = {
    "verde_excelente": ("ok", "Verde excelente"), "verde": ("ok", "Verde"), "verde_corto": ("ok", "Verde · paso corto"),
    "verde_justo": ("warn", "Verde justo · mantener"), "verde_mantener": ("warn", "Verde · mantener"),
    "esperar": ("wait", "En espera"), "bloqueado": ("bad", "No subir"), "amarillo": ("warn", "Amarillo"), "rojo": ("bad", "Rojo"),
    "sin_datos": ("muted", "Sin datos"), "sin_objetivo": ("muted", "Sin objetivo"), "fuera": ("muted", "Fuera del plan"),
    "cubrir": ("warn", "Cubrir cuota"), "marca_ok": ("ok", "Marca cubierta"), "verde_sin_techo": ("warn", "Sin techo"), "verde_puja": ("warn", "Puja, no presupuesto"),
}


def pill(estado, etiqueta=None):
    tono, texto = ESTADOS.get(estado, ("muted", estado or "—"))
    return f'<span class="pill {tono}"><i></i>{esc(etiqueta or texto)}</span>'


def pill_nivel(nivel):
    tono = {"rojo": "bad", "amarillo": "warn", "verde": "ok"}.get(nivel, "muted")
    return f'<span class="pill {tono}"><i></i>{esc(str(nivel).capitalize())}</span>'


def pill_conf(conf):
    tono = {"alta": "ok", "media": "warn", "baja": "bad"}.get(conf, "muted")
    return f'<span class="pill {tono}"><i></i>confianza {esc(conf or "—")}</span>'


# --------------------------------------------------------------------------------------
# Bloques HTML
# --------------------------------------------------------------------------------------
def kpi(label, value, sub=None, tone="ink"):
    return (f'<div class="kpi {tone}"><div class="v">{value}</div><div class="l">{esc(label)}</div>'
            f'{f"<div class=s>{esc(sub)}</div>" if sub else ""}</div>')


def table(headers, rows, cls="", aligns=None):
    aligns = aligns or []
    th = "".join(f"<th{' class=num' if (i < len(aligns) and aligns[i] == 'r') else ''}>{h}</th>" for i, h in enumerate(headers))
    body = "".join("<tr>" + "".join(f"<td{' class=num' if (i < len(aligns) and aligns[i] == 'r') else ''}>{c}</td>" for i, c in enumerate(row)) + "</tr>" for row in rows)
    return f'<div class="tscroll"><table class="{cls}"><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table></div>'


def lista(items, cls=""):
    items = [i for i in (items or []) if i]
    return "" if not items else f'<ul class="{cls}">' + "".join(f"<li>{esc(i)}</li>" for i in items) + "</ul>"


def nota(texto, tono="note"):
    return f'<div class="callout {tono}">{texto}</div>' if texto else ""


def section(n, titulo, sub, inner, id_=None):
    return (f'<section{f" id={id_}" if id_ else ""}><div class="sec-head"><span class="num">{n}</span>'
            f'<div><h2>{esc(titulo)}</h2>{f"<p class=sub>{esc(sub)}</p>" if sub else ""}</div></div>{inner}</section>')


# --------------------------------------------------------------------------------------
# Secciones
# --------------------------------------------------------------------------------------
def sec_runbook(D, N, data):
    R = D.get("runbook") or {}
    res = D["resumen"]
    linea = res.get("linea") or ""
    inner = f'<div class="linea">{esc(linea)}</div>'
    rows = []
    for f in R.get("filas") or []:
        cambio = money(f.get("hoy")) if f.get("accion") == "mantener" else f"{money(f.get('hoy'))} → <strong>{money(f.get('nuevo'))}</strong>"
        rows.append([esc(f.get("plataforma")), f"<strong>{esc(f.get('entidad'))}</strong>", esc(f.get("accion")), cambio, fecha_larga(f.get("fecha")) if f.get("accion") != "mantener" else "—", esc(f.get("condicion")), esc(f.get("reversion"))])
    if rows:
        inner += table(["Plataforma", "Entidad", "Acción", "Presupuesto diario", "Fecha", "Condición", "Reversión"], rows, "compact")
    if R.get("omitidas"):
        inner += f'<p class="mut">{R["omitidas"]} entidad(es) más sin cambios; ver secciones 07 y 08.</p>'
    ver = (N.get("resumen") or {}).get("veredicto")
    if ver:
        inner += f'<p class="lead">{esc(ver)}</p>'
    dec = (N.get("resumen") or {}).get("decisiones") or []
    if dec:
        inner += "<h3>Decisiones de esta semana</h3>" + lista(dec, "decisiones")
    return section("01", "Runbook: qué se toca esta semana", "Lo que se ejecuta el lunes, con fecha, condición y punto de reversión", inner, "runbook")


def sec_resumen(D, N, data):
    R, A = D["resumen"], D["atribucion"]
    t, m = A["triangulacion"], A["mer"]
    sem = t.get("semaforo_atribucion")
    kpis = [
        kpi("Presupuesto ventas Meta / día", money(R.get("presupuesto_ventas_meta_hoy")), f"→ {money(R.get('presupuesto_meta_tras_subida_1'))} tras la subida 1", "orange"),
        kpi("Presupuesto Google / día", money(R.get("presupuesto_google_hoy")), f"→ {money(R.get('presupuesto_google_tras_subida_1'))} tras la subida 1", "peri"),
        kpi("MER 30 días", roas(m.get("mer_30d")), f"ingresos totales / pauta total · equilibrio {roas(m.get('mer_equilibrio'))} · objetivo {roas(m.get('mer_objetivo'))}", "lime"),
        kpi("aMER 30 días", roas(m.get("amer_30d")), "ingresos de clientes nuevos / pauta total", "ink"),
        kpi("Atribución de cuenta", (sem or "sin datos").capitalize(), f"ratio Meta/GA4 {num(t.get('ratio_meta_vs_ga4_canal'), 1)}x · sobre-reclamo {num(t.get('indice_sobre_reclamo'), 2)}", {"rojo": "bad", "amarillo": "orange", "verde": "ok"}.get(sem, "ink")),
        kpi("ROAS real de Meta", f"{roas(t.get('roas_meta_pesimista_ga4'))} – {roas(t.get('roas_meta_optimista'))}", f"cota GA4 último clic → Ads Manager · central {roas(((A.get('cotas_etapa') or {}).get('CUENTA') or {}).get('central'))}", "ink"),
    ]
    inner = f'<div class="kpis six">{"".join(kpis)}</div>'
    inner += nota(esc(t.get("semaforo_atribucion_lectura") or ""), {"rojo": "warn", "amarillo": "warn"}.get(sem, "muted"))
    return section("02", "Resumen de la cuenta", "Los tres números que deciden: ROAS contra el número mágico, MER y atribución", inner, "resumen")


def sec_negocio(D, N, data):
    n = D["negocio"]
    neg = data.get("negocio") or {}
    rows = [
        ["Ticket promedio", money(n.get("ticket_promedio")), "cliente / GA4"],
        ["Margen bruto", pct(n.get("margen_bruto")), "cliente"],
        ["ROAS de equilibrio", roas(n.get("roas_equilibrio")), "1 / margen bruto"],
        ["Número mágico (ROAS objetivo)", roas(n.get("numero_magico")), esc(n.get("numero_magico_origen") or "—")],
        ["Colchón del número mágico sobre el equilibrio", pct(n.get("colchon_numero_magico_vs_equilibrio")), "para absorber retornos decrecientes"],
        ["CPA máximo / objetivo", f"{money(n.get('cpa_maximo'))} / {money(n.get('cpa_objetivo'))}", "ticket × margen · × 0,7"],
        ["Ciclo de recompra", f"{num(neg.get('ciclo_recompra_dias'))} días" if neg.get("ciclo_recompra_dias") else "—", "ventana de contaminación del retargeting"],
    ]
    be = neg.get("backend") or {}
    rows.append(["Pedidos e ingresos reales 30 d (backend)", f"{num(be.get('pedidos_30d'))} · {money(be.get('ingresos_30d'))}" if be.get("pedidos_30d") else "pendiente", esc(be.get("nota") or "backend")])
    ev = n.get("evento") or {}
    if ev.get("nombre"):
        rows.append(["Fecha especial", f"{esc(ev.get('nombre'))} · {ev.get('inicio') or 'fechas por confirmar'}{(' → ' + ev['fin']) if ev.get('fin') else ''}" + (" · activo" if ev.get("activo") else ""), "excepción a la cadencia (48 h), no al tope de 35 %"])
    return section("03", "Números del negocio", "Sin estos números no hay semáforo financiero", table(["Dato", "Valor", "Origen"], rows), "negocio")


def sec_meta(D, N, data):
    M = D["meta"]
    rows = []
    for e in M.get("entidades") or []:
        if not e.get("es_ventas"):
            continue
        h = e.get("historial") or {}
        apr = e.get("aprendizaje") or "—"
        if e.get("conversiones_aprendizaje") is not None and apr != "—":
            apr += f" ({num(e['conversiones_aprendizaje'])})"
        ult = "—" if h.get("dias") is None else f"hace {h['dias']} d"
        if h.get("subidas_14d") is not None:
            ult += f" · {h['subidas_14d']} subidas/14 d"
        rows.append([
            f"<strong>{esc(e['nombre'])}</strong><br><span class=mut>{esc(e.get('etapa'))} · presupuesto en {esc(e.get('nivel_presupuesto') or '—')} · {esc(e.get('attribution_setting') or '—')}<br>aprendizaje {esc(apr)} · última subida {ult}</span>",
            money(e.get("presupuesto_diario")),
            f"<strong>{roas(e.get('roas_7d'))}</strong> <span class=mut>/ {roas(e.get('roas_30d'))}</span>",
            f"{num(e.get('compras_7d'))} <span class=mut>/ {num(e.get('compras_30d'))}</span>",
            f"{num(e.get('frecuencia_7d'), 2)} <span class=mut>/ {num(e.get('frecuencia_30d'), 1)}</span><br><span class=mut>aviso {num(e.get('frecuencia_aviso'), 2)} · tope {num(e.get('frecuencia_tope'), 0)}</span>",
            pill(e.get("estado"), e.get("etiqueta")),
        ])
    fuera = [e for e in M.get("entidades") or [] if not e.get("es_ventas")]
    inner = table(["Conjunto / campaña", "Ppto. diario", "ROAS 7 d / 30 d", "Compras 7 d / 30 d", "Frecuencia 7 d / 30 d", "Semáforo"], rows, aligns=["l", "r", "r", "r", "r", "l"])
    if fuera:
        inner += nota("Fuera del plan de ventas (sin ROAS): " + " · ".join(f"{esc(e['nombre'])} ({money(e.get('presupuesto_diario'))}/día)" for e in fuera) + f". Suman {money(M.get('gasto_sin_retorno_30d'))} en 30 días: cuentan en el MER y son la primera fuente de financiamiento de un escalón de adquisición sin subir el gasto total.", "muted")
    sem = M.get("serie_semanal") or []
    if sem:
        def marginal_cell(i, w):
            rm = w.get("roas_marginal")
            if rm is None:
                return "—"
            prev = sem[i - 1] if i > 0 else None
            dg = (w.get("gasto") or 0) - ((prev or {}).get("gasto") or 0)
            dv = (w.get("valor") or 0) - ((prev or {}).get("valor") or 0)
            deltas = f"<br><span class=mut>Δ gasto {money(dg, True)} · Δ valor {money(dv, True)}</span>" if prev else ""
            if rm < 0:
                return f"<strong class=bad>negativo</strong>{deltas}"
            return f"<strong class={'bad' if w.get('marginal_bajo_equilibrio') else 'ok'}>{roas(rm)}</strong>{deltas}"
        srows = [[f"{fecha_corta(w.get('inicio'))} → {fecha_corta(w.get('fin'))}{' <span class=mut>(parcial)</span>' if w.get('parcial') else ''}",
                  money(w.get("gasto")), num(w.get("compras")), money(w.get("valor")), roas(w.get("roas")),
                  marginal_cell(i, w),
                  num(w.get("elasticidad_compras"), 2) if w.get("elasticidad_compras") is not None else "—"] for i, w in enumerate(sem)]
        inner += "<h3>Serie semanal de la cuenta: ROAS marginal</h3>"
        inner += table(["Semana", "Gasto", "Compras", "Valor reportado", "ROAS", "ROAS marginal", "Elasticidad de compras"], srows, aligns=["l", "r", "r", "r", "r", "r", "r"])
        tc = M.get("tendencia_cuenta") or {}
        if tc:
            inner += nota(f"<strong>Lectura:</strong> gasto {pct(tc.get('gasto_var'), 0, True)} y ROAS {pct(tc.get('roas_var'), 0, True)} entre la primera y la última semana completa. {esc(tc.get('lectura'))}. El ROAS marginal es el retorno de cada peso adicional: el número que decide si el siguiente escalón vale la pena, no el ROAS promedio.",
                          "warn" if tc.get("roas_marginal_ultimo") is not None and (tc.get("roas_marginal_ultimo") or 0) < (D["negocio"].get("roas_equilibrio") or 0) else "note")
    if M.get("dependencia_top"):
        d = M["dependencia_top"]
        inner += nota(f"<strong>Concentración:</strong> {esc(d['nombre'])} trae el {pct(d['share_compras_7d'])} de las compras de la semana.", "muted")
    lec = (N.get("meta") or {}).get("lectura")
    if lec:
        inner += nota(f"<strong>Lectura SARAHI:</strong> {esc(lec)}")
    return section("04", "Estado actual en Meta", "Conjuntos y campañas donde vive el presupuesto, en dos ventanas: 7 días (velocidad) y 30 días (tendencia)", inner, "meta")


def sec_google(D, N, data):
    G = D["google"]
    if not G.get("disponible"):
        return section("05", "Estado actual en Google Ads", None, nota("Sin datos de Google Ads en esta lectura: la cuenta no está conectada en AgencyAnalytics o la consulta falló. Verificación manual.", "muted"), "google")
    rows = []
    for e in G.get("entidades") or []:
        is_txt = f"{pct(e.get('is_7d') if e.get('is_7d') is not None else e.get('is_30d'))}<br><span class=mut>perdida ({esc(e.get('ventana_is'))}): ppto. {pct(e.get('lost_is_budget_7d') if e.get('lost_is_budget_7d') is not None else e.get('lost_is_budget_30d'))} · ranking {pct(e.get('lost_is_rank_7d') if e.get('lost_is_rank_7d') is not None else e.get('lost_is_rank_30d'))}</span>"
        gasto = f"{money(e.get('costo_30d'))}<br><span class=mut>{num(e.get('conv_30d'), 1)} conv. · {money(e.get('valor_30d'))}</span>"
        sub7 = f" · gasto 7 d {money(e.get('gasto_dia_7d'))}/día" if e.get("gasto_dia_7d") else ""
        rows.append([f"<strong>{esc(e['nombre'])}</strong><br><span class=mut>{esc(e.get('tipo'))} · {money(e.get('presupuesto_diario'))}/día{sub7}</span>", gasto,
                     f"<strong>{roas(e.get('roas_30d'))}</strong> <span class=mut>/ {roas(e.get('roas_7d'))}</span>", is_txt, pill(e.get("estado"), e.get("etiqueta"))])
    inner = table(["Campaña", "Costo · conv. · valor 30 d", "ROAS 30 d / 7 d", "Cuota de impresiones", "Semáforo"], rows, cls="google", aligns=["l", "r", "r", "r", "l"])
    k1 = kpi("ROAS de ventas 30 d", roas(G.get("roas_ventas_30d")), "todas las campañas de venta", "ink")
    k2 = kpi("ROAS de adquisición 30 d", roas(G.get("roas_adquisicion_30d")), "sin marca: genérica + PMax", "peri")
    k3 = kpi("Gasto 30 d", money(G.get("costo_30d")), "marca " + money(G.get("costo_marca_30d")), "ink")
    inner += '<div class="kpis small">' + k1 + k2 + k3 + "</div>"
    inner += nota("El ROAS de 30 días decide la rentabilidad (rezago de conversión); la cuota de impresiones de 7 días diagnostica la restricción de hoy: presupuesto o ranking. Toda acción de puja lleva verificación manual porque AgencyAnalytics no expone la estrategia de puja; bajar el tROAS 10-15 % da más volumen, subirlo da más eficiencia.", "muted")
    lec = (N.get("google") or {}).get("lectura")
    if lec:
        inner += nota(f"<strong>Lectura SARAHI:</strong> {esc(lec)}")
    return section("05", "Estado actual en Google Ads", "La cuota de impresiones perdida por presupuesto es la palanca; la marca se cubre, no se escala", inner, "google")


def sec_ga4(D, N, data):
    A = D["ga4"]
    if not A.get("disponible"):
        return section("06", "Google Analytics 4 y MER", None, nota("Sin GA4: no hay triangulación ni MER. Verificación manual.", "muted"), "ga4")
    rows = []
    for c in sorted(A.get("canales") or [], key=lambda x: -(x["m30"].get("ingresos") or 0)):
        m, s = c["m30"], c["m7"]
        rows.append([esc(c["canal"]), num(m.get("sesiones")), f"{num(m.get('compras'))} <span class=mut>/ {num(s.get('compras'))}</span>",
                     f"{money(m.get('ingresos'))} <span class=mut>/ {money(s.get('ingresos'))}</span>", money(m.get("aov")), pct(m.get("cvr_compra"), 2)])
    t = A["totales"]["m30"]
    mer = D["atribucion"]["mer"]
    inner = table(["Canal (sesión)", "Sesiones 30 d", "Compras 30 d / 7 d", "Ingresos 30 d / 7 d", "Ticket", "Conv. de sesión"], rows, aligns=["l", "r", "r", "r", "r", "r"])
    k1 = kpi("Pedidos 30 d", num(t.get("compras")), "ingresos " + money(t.get("ingresos")), "ink")
    k2 = kpi("Compradores nuevos", pct(t.get("share_compradores_nuevos")), num(t.get("compradores_nuevos")) + " de " + num(t.get("compradores")), "lime")
    k3 = kpi("Ingresos de canales pagados", pct(t.get("share_ingresos_pagados")), "Paid Social + Paid Search + Cross-network", "peri")
    k4 = kpi("MER / aMER", roas(mer.get("mer_30d")) + " / " + roas(mer.get("amer_30d")), esc(mer.get("lectura") or ""), "orange")
    inner += '<div class="kpis small">' + k1 + k2 + k3 + k4 + "</div>"
    if mer.get("mer_minimo_por_participacion"):
        inner += nota(f"<strong>MER mínimo de cuenta:</strong> con {pct(t.get('share_ingresos_pagados'))} de los ingresos en canales pagados, el MER que equivale al número mágico es {roas(mer.get('mer_minimo_por_participacion'))} (informativo, no gate).", "muted")
    if A.get("alertas_calidad"):
        inner += nota("<strong>Calidad de datos GA4:</strong> " + " ".join(esc(a) + "." for a in A["alertas_calidad"]), "warn")
    lec = (N.get("ga4") or {}).get("lectura")
    if lec:
        inner += nota(f"<strong>Lectura SARAHI:</strong> {esc(lec)}")
    return section("06", "Google Analytics 4 y MER", "La tienda completa: lo que ninguna plataforma puede reclamar dos veces", inner, "ga4")


def sec_atribucion(D, N, data):
    A = D["atribucion"]
    t, nv, lift, C = A["triangulacion"], A["nivel_evidencia"], A["lift"], A.get("cotas_etapa") or {}
    nm, eq = D["negocio"].get("numero_magico"), D["negocio"].get("roas_equilibrio")
    tiles = [
        kpi("Meta reporta", f"{num(t.get('meta_compras_30d'))} compras", f"GA4 atribuye {num(t.get('ga4_compras_paid_social_30d'))} a Paid Social ({num(t.get('ga4_compras_meta_utm_30d'))} por UTM de pauta)", "orange"),
        kpi("Ratio Meta / GA4", f"{num(t.get('ratio_meta_vs_ga4_canal'), 1)}x", f"banda {t.get('banda_ratio_meta') or '—'} · normal ≤ {num(A['supuestos']['ratio_normal'], 1)}x · elevado ≤ {num(A['supuestos']['ratio_elevado'], 1)}x · ventana {A['supuestos']['ventana_ratio_dias']} d", "ink"),
        kpi("Google Ads reporta", f"{num(t.get('google_conv_ventas_30d'), 0)} conv.", f"GA4 atribuye {num(t.get('ga4_compras_google_cpc_30d'))} a google/cpc · ratio {num(t.get('ratio_google_vs_ga4'), 2)}x ({t.get('banda_ratio_google') or '—'})", "peri"),
        kpi("Reclamado vs. real", f"{num(t.get('compras_reclamadas_plataformas'), 0)} vs {num(t.get('pedidos_reales_30d'))}", f"índice {num(t.get('indice_sobre_reclamo'), 2)} en compras · {num(t.get('indice_sobre_reclamo_valor'), 2)} en valor · verdad: {t.get('origen_verdad') or '—'} · deduplicación {num(t.get('factor_deduplicacion_global'), 2)}", "lime"),
    ]
    inner = f'<div class="kpis">{"".join(tiles)}</div>'
    lo, hi = t.get("roas_meta_pesimista_ga4"), t.get("roas_meta_optimista")
    cc = (C.get("CUENTA") or {}).get("central")
    if lo is not None and hi is not None and hi > 0:
        pos = lambda x: max(0, min(100, (x / hi) * 100))
        inner += ('<h3>Dónde está la verdad del ROAS de Meta</h3>'
                  f'<div class="band"><div class="band-bar"><span class="mark eq" style="left:{pos(eq or 0):.1f}%"></span><span class="mark nm" style="left:{pos(nm or 0):.1f}%"></span>'
                  f'<span class="range" style="left:{pos(lo):.1f}%;width:{max(1, pos(hi) - pos(lo)):.1f}%"></span>'
                  + (f'<span class="mark cc" style="left:{pos(cc):.1f}%"></span>' if cc else "") + '</div>'
                  f'<div class="band-labels"><span>Piso: GA4 último clic <strong>{roas(lo)}</strong></span><span>Equilibrio {roas(eq)} · Número mágico {roas(nm)}' + (f' · Central {roas(cc)}' if cc else '') + f'</span><span>Techo: Ads Manager <strong>{roas(hi)}</strong></span></div></div>'
                  f'<p class="mut">Meta reclama el {pct(t.get("share_meta_sobre_ingresos"))} de los ingresos totales de la tienda. La verdad está entre las dos cotas; las pruebas de abajo la acotan.</p>')
    crows = []
    for k in ("TOFU", "CALIENTE", "CUENTA"):
        x = C.get(k)
        if x:
            crows.append([f"<strong>{esc(x.get('nombre'))}</strong>", money(x.get("gasto_30d")), num(x.get("compras_30d")), roas(x.get("roas_reportado")), roas(x.get("piso")), f"<strong>{roas(x.get('central'))}</strong>", roas(x.get("techo")), f"{num(x.get('ia'), 1)}<br>{pill_conf(x.get('confianza'))}"])
    if crows:
        inner += "<h3>Cotas de incrementalidad por etapa (30 días)</h3>"
        inner += table(["Etapa", "Gasto", "Compras Meta", "ROAS reportado", "Piso (GA4)", "Central", "Techo (deduplicado)", "Índice de incertidumbre"], crows, aligns=["l", "r", "r", "r", "r", "r", "r", "l"])
        inner += nota("Piso = ingresos que GA4 atribuye por último clic a Paid Social / gasto. Techo = compras reportadas × factor de deduplicación global × ticket / gasto (lo que cabe en los pedidos reales). Central = media geométrica. Índice de incertidumbre = techo / piso: ≤ 2 confianza alta, ≤ 5 media, más de 5 baja. " + esc(C.get("nota") or ""), "muted")
    rows = []
    for e in D["meta"].get("entidades") or []:
        inc = e.get("incremental") or {}
        if not e.get("es_ventas") or inc.get("central") is None:
            continue
        p1 = pill("verde" if e.get("central_cumple") else "amarillo", "central cumple" if e.get("central_cumple") else "central no cumple") if e.get("central_cumple") is not None else ""
        p2 = pill("verde" if e.get("piso_cumple") else "rojo", "piso cumple" if e.get("piso_cumple") else "piso no cumple") if e.get("piso_cumple") is not None else ""
        rows.append([f"<strong>{esc(e['nombre'])}</strong><br><span class=mut>{esc(e.get('etapa'))} · {esc(inc.get('origen'))}</span>", roas(e.get("roas_7d")), roas(inc.get("piso")), f"<strong>{roas(inc.get('central'))}</strong>", roas(inc.get("techo")), f"{num(inc.get('ia'), 1)} · {esc(inc.get('confianza'))}", f"{p1}<br>{p2}"])
    if rows:
        inner += "<h3>ROAS incremental estimado por conjunto (7 días)</h3>"
        inner += table(["Conjunto", "ROAS reportado", "Piso", "Central", "Techo", "Incertidumbre", "Contra el número mágico"], rows, aligns=["l", "r", "r", "r", "r", "l", "l"])
    inner += f"<h3>Nivel de evidencia: {esc(nv.get('nivel'))} · {esc(nv.get('descripcion'))}</h3>" + lista(nv.get("evidencia"))
    lrows = [["Estudio de lift activo", "Sí: no cambiar presupuestos de las campañas del estudio" if lift.get("estudio_activo") else "No"],
             ["Elegible para Conversion Lift (self-serve)", "Sí" if lift.get("elegible_conversion_lift") else ("No" if lift.get("elegible_conversion_lift") is False else "Sin verificar")]]
    if lift.get("requisitos_faltantes"):
        lrows.append(["Requisitos pendientes (literal de Meta)", " · ".join(esc(x) for x in lift["requisitos_faltantes"])])
    for s in lift.get("estudios") or []:
        lrows.append([f"{esc(s.get('tipo'))} · {esc(s.get('nombre'))} ({esc(s.get('periodo'))})", esc(s.get("resultado"))])
    inner += table(["Pruebas causales en Meta", "Estado"], lrows)
    prows = [[esc(p.get("orden")), f"<strong>{esc(p['tipo'])}</strong>", esc(p.get("cuando")), esc(p.get("que")), f"<span class=mut>{esc(p.get('fuente'))}</span>"] for p in A.get("pruebas") or []]
    inner += "<h3>Plan de pruebas de incrementalidad</h3>" + table(["Orden", "Prueba", "Cuándo", "Qué se hace y qué se lee", "Fuente"], prows, "compact")
    inner += nota(esc(A.get("regla_pruebas") or ""), "muted")
    cm = (N.get("atribucion") or {}).get("como_se_mueve")
    inner += "<h3>Cómo se mueve la atribución al escalar</h3>"
    inner += nota(esc(cm) if cm else ("Al subir presupuesto, el ROAS reportado por Meta suele caer más despacio que el ROAS real: el retargeting captura recompra que ya iba a ocurrir y el view-through crece con el alcance. Por eso el tablero sigue tres números a la vez: el ROAS de plataforma, el ratio Meta/GA4 en 28 días y el MER marginal. Si el ratio sube mientras el MER marginal cae, el escalón está comprando atribución, no ventas."))
    lec = (N.get("atribucion") or {}).get("lectura")
    if lec:
        inner += nota(f"<strong>Lectura SARAHI:</strong> {esc(lec)}")
    return section("07", "Atribución incremental", "Cuánto de lo que reportan las plataformas es venta que no habría ocurrido sin el anuncio", inner, "atribucion")


def escalera_html(e):
    esc_ = e.get("escalera") or []
    if not esc_:
        return ""
    rows = [[f"Subida {s['n']}", fecha_larga(s["fecha"]), f"{money(s['desde'])} → <strong>{money(s['hasta'])}</strong> ({pct(s['paso'])})", f"{fecha_larga(s['checkpoint'])}<br><span class=mut>decisión {fecha_corta(s.get('decision'))}</span>", esc(s.get("condicion")), esc(s.get("reversion"))] for s in esc_]
    return table(["Paso", "Fecha", "Presupuesto diario", "Checkpoint", "Se mantiene si", "Reversión"], rows, "compact")


def card_entidad(e, notas, es_meta=True):
    sub = f"{esc(e.get('etapa'))} · presupuesto en {esc(e.get('nivel_presupuesto') or '—')} · {money(e.get('presupuesto_diario'))}/día" if es_meta else f"{esc(e.get('tipo'))} · {money(e.get('presupuesto_diario'))}/día"
    body = f'<div class="card-head"><div><h3>{esc(e["nombre"])}</h3><span class=mut>{sub}</span></div>{pill(e.get("estado"), e.get("etiqueta"))}</div>'
    body += lista(e.get("motivos"), "motivos")
    if e.get("caps"):
        body += nota("<strong>Por qué no sube más:</strong> " + " · ".join(esc(c) for c in e["caps"]), "muted")
    if e.get("bloqueos"):
        body += nota("<strong>No se sube:</strong> " + " · ".join(esc(b) for b in e["bloqueos"]), "warn")
    if e.get("avisos"):
        body += nota("<strong>Avisos:</strong> " + " · ".join(esc(a) for a in e["avisos"]), "warn")
    if e.get("lectura_incremental"):
        body += nota(esc(e["lectura_incremental"]), "muted")
    if e.get("estado") == "cubrir" and e.get("nuevo_presupuesto"):
        body += nota(f"<strong>Acción:</strong> subir a {money(e['nuevo_presupuesto'])}/día para dejar de perder impresiones de marca por presupuesto. Cobertura, no escalado.")
    if e.get("escalera"):
        body += escalera_html(e)
        if e.get("tope"):
            body += f'<p class="mut">{esc(e["tope"])}</p>'
    elif e.get("estado") in ("verde_justo", "verde_mantener", "verde_sin_techo", "verde_puja"):
        body += nota("Sin subida vertical esta semana: mantener el presupuesto y trabajar el escalado horizontal (sección 10).", "muted")
    n = notas.get(e.get("id")) or notas.get(e.get("nombre"))
    if n:
        body += nota(f"<strong>Nota:</strong> {esc(n)}")
    return f'<div class="card">{body}</div>'


def sec_vertical_meta(D, N, data):
    M = D["meta"]
    notas = N.get("notas_entidades") or {}
    cards = [card_entidad(e, notas, True) for e in M.get("entidades") or [] if e.get("es_ventas")]
    proy = M.get("proyeccion_presupuesto") or []
    if proy and all(not p.get("variacion_vs_hoy") for p in proy):
        resumen = nota(f"<strong>Presupuesto diario de ventas en Meta:</strong> {money(M.get('presupuesto_ventas_dia_hoy'))} hoy y sin subidas programadas: ningún conjunto de venta tiene escalera esta semana. El crecimiento va por horizontal (sección 10) y se reevalúa en el próximo checkpoint.")
    else:
        resumen = nota(f"<strong>Presupuesto diario de ventas en Meta:</strong> {money(M.get('presupuesto_ventas_dia_hoy'))} hoy → " + " → ".join(f"{money(p['presupuesto_ventas_dia'])} ({pct(p['variacion_vs_hoy'], 0, True)})" for p in proy) + " si cada escalón supera su checkpoint. Los conjuntos sin escalera se mantienen.") if proy else ""
    return section("08", "Plan de escalado vertical en Meta", "El colchón fija el tamaño del paso (0,75 × colchón, entre 15 y 35 %), el aprendizaje fija el reloj (5 días, 7 en aprendizaje); la atribución de cuenta pone el tope", "".join(cards) + resumen, "vertical-meta")


def sec_vertical_google(D, N, data):
    G = D["google"]
    if not G.get("disponible"):
        return ""
    notas = N.get("notas_entidades") or {}
    cards = [card_entidad(e, notas, False) for e in G.get("entidades") or [] if e.get("es_ventas")]
    resumen = nota(f"<strong>Presupuesto diario en Google:</strong> {money(G.get('presupuesto_dia_hoy'))} hoy → {money(G.get('presupuesto_dia_tras_subida_1'))} tras la subida 1. Un cambio por campaña por semana, siempre lunes, y nunca presupuesto y tROAS a la vez.")
    return section("09", "Plan de escalado vertical en Google Ads", "Se sube donde hay cuota perdida por presupuesto y ROAS sobre objetivo; donde la cuota perdida es por ranking se ajusta la puja, no el dinero", "".join(cards) + resumen, "vertical-google")


def sec_horizontal(D, N, data):
    H = N.get("horizontal") or {}
    bloques = [("Nuevos anuncios", H.get("anuncios"), "Refrescar antes de apagar; producción por el sistema 50/25/25"),
               ("Nuevos conjuntos", H.get("conjuntos"), "Públicos similares, ventanas más amplias, geografías"),
               ("Nuevas campañas", H.get("campanas"), "Graduar ganadores, catálogo, ascensión"),
               ("Google Ads", H.get("google"), "Grupos de activos, temas de búsqueda, Demand Gen"),
               ("Nuevos canales", H.get("canales"), "Email y WhatsApp a la base, TikTok, orgánico")]
    boxes = [f'<div class="box"><h3>{esc(titulo)}</h3><p class="mut">{esc(sub)}</p>{lista(items or ["Sin recomendaciones específicas en esta lectura."])}</div>' for titulo, items, sub in bloques]
    inner = f'<div class="grid">{"".join(boxes)}</div>'
    if H.get("lectura"):
        inner += nota(esc(H["lectura"]), "warn")
    return section("10", "Plan de escalado horizontal", "Construir más edificios junto a los que funcionan: la salida cuando lo vertical se frena y la única forma de que el crecimiento sea incremental", inner, "horizontal")


def sec_calendario(D, N, data):
    cards = [f'<div class="tl{" evento" if w.get("evento") else ""}"><div class="when">Semana {w["n"]} · {fecha_corta(w["inicio"])} → {fecha_corta(w["fin"])}{" · evento" if w.get("evento") else ""}</div>{lista(w.get("acciones"))}</div>' for w in D.get("calendario") or []]
    inner = f'<div class="timeline">{"".join(cards)}</div>'
    pasos = N.get("proximos_pasos")
    if pasos:
        inner += "<h3>Pendientes que mejoran la próxima corrida</h3>" + lista(pasos)
    return section("11", "Calendario de 4 semanas", "Vertical y horizontal al mismo tiempo, con la medición como tercera pista", inner, "calendario")


def sec_alertas(D, N, data):
    rows = [[pill_nivel(a["nivel"]), f"<strong>{esc(a['senal'])}</strong>", esc(a.get("donde")), esc(a.get("accion"))] for a in (D.get("alertas") or [])[:12]]
    if not rows:
        rows = [["—", "Sin señales de alerta con los datos actuales", "", ""]]
    inner = table(["Nivel", "Señal", "Dónde", "Qué hacer"], rows)
    if len(D.get("alertas") or []) > 12:
        inner += f'<p class="mut">{len(D["alertas"]) - 12} alerta(s) más de menor prioridad en el JSON de cálculo.</p>'
    inner += nota("<strong>Reglas fijas:</strong> si el número mágico baja al subir presupuesto se vuelve al nivel anterior; si la frecuencia supera el tope de la etapa se amplía el público o se baja el presupuesto; si un conjunto deja de funcionar se le agregan anuncios antes de apagarlo; si toda la cuenta depende de un conjunto se escala horizontal ya. Y dos reglas nuevas: si el ratio Meta/GA4 sube con el gasto mientras el MER marginal cae, el escalón compra atribución y se revierte; si las plataformas reclaman más compras que pedidos reales, ninguna sirve de verdad y decide el MER.", "muted")
    return section("12", "Señales de alerta", "Se revisan en cada checkpoint, antes de la siguiente subida", inner, "alertas")


def sec_tablero(D, N, data):
    T = D["atribucion"].get("tablero_semanal") or {}
    rows = []
    for f in T.get("filas") or []:
        ratio = "—" if f.get("ratio_meta_ga4") is None else f"{num(f['ratio_meta_ga4'], 1)}x" + (f"<br><span class=mut>±{num(f.get('ruido_ratio'), 1)}</span>" if f.get("ruido_ratio") else "")
        sem = f.get("semana") or ""
        if "→" in sem:
            a, b = [x.strip() for x in sem.split("→", 1)]
            sem = f"{fecha_corta(a)} → {fecha_corta(b)}"
        rm = f.get("roas_marginal_meta")
        rm_txt = "—" if rm is None else ("<span class=bad>negativo</span>" if rm < 0 else roas(rm))
        mm = f.get("mer_marginal")
        mm_txt = "—" if mm is None else ("<span class=bad>negativo</span>" if mm < 0 else roas(mm))
        rows.append([esc(sem) + (" <span class=mut>(parcial)</span>" if f.get("parcial") else "") + (" <span class=mut>(evento)</span>" if f.get("evento") else ""),
                     f"{money(f.get('gasto_meta'))}<br><span class=mut>Google {money(f.get('gasto_google'))}</span>",
                     f"{num(f.get('compras_meta'))}<br><span class=mut>{roas(f.get('roas_meta'))}</span>",
                     rm_txt,
                     f"{num(f.get('conv_google'), 0)}<br><span class=mut>{roas(f.get('roas_google'))}</span>",
                     f"{num(f.get('pedidos_ga4'))}<br><span class=mut>{money(f.get('ingresos_ga4'))}</span>",
                     f"<strong>{roas(f.get('mer'))}</strong>", ratio, mm_txt])
    rows.append(["<em>Próxima semana</em>"] + ["<span class=mut>—</span>"] * 8)
    cols = ["Semana", "Gasto Meta · Google", "Compras · ROAS Meta", "ROAS marginal Meta", "Conv. · ROAS Google", "Pedidos · ingresos GA4", "MER", "Meta/GA4 (±ruido)", "MER marginal"]
    inner = table(cols, rows, "compact tablero", aligns=["l"] + ["r"] * 8)
    inner += nota(esc(T.get("nota") or "") + " Se lee de izquierda a derecha: si el gasto sube y el MER marginal se mantiene sobre el equilibrio, el escalón fue incremental. Si el ratio Meta/GA4 crece con el gasto más allá de su ruido, el ROAS de plataforma se está inflando.", "muted")
    return section("13", "Tablero de seguimiento semanal", "El instrumento para ver cómo se mueve la atribución mientras se escala; se acumula semana a semana", inner, "tablero")


def sec_limites(D, N, data):
    S = D.get("supuestos") or {}
    A = S.get("atribucion") or {}
    items = list(N.get("limites") or [])
    items += [f"Dato faltante: {x}" for x in (D.get("faltantes") or [])]
    items += [
        "El MCP de Meta no expone la comparación de ventanas de atribución ni las conversiones incrementales: esas lecturas vienen de exportaciones de Ads Manager y se cargan a mano.",
        "GA4 atribuye por último clic no directo a nivel sesión y subestima la publicidad en frío: el piso es la cota inferior, no la verdad. Las cotas por etapa usan una partición supuesta (nuevos → público nuevo, recurrentes → públicos calientes) hasta tener UTM por campaña.",
        f"Supuestos calibrables: bandas del ratio Meta/GA4 (normal ≤ {num(A.get('ratio_normal'), 1)}x, elevado ≤ {num(A.get('ratio_elevado'), 1)}x), índice de incertidumbre (alta ≤ {num(A.get('ia_alta'), 1)}, media ≤ {num(A.get('ia_media'), 1)}), paso = {num(S.get('paso_factor'), 2)} × colchón entre 15 y 35 %, {S.get('dias_entre_subidas')} días entre subidas ({S.get('dias_entre_subidas_aprendizaje')} en aprendizaje). Se reemplazan por resultados de lift, holdout o A/B nativo cuando existan.",
        "Las conversiones de Google Ads y las compras de Meta se cuentan por fecha de conversión con ventanas distintas a las de GA4: los ratios se leen como tendencia en 28 días, no como cifra exacta semanal.",
        "El ROAS marginal de la serie histórica es una alerta preventiva, no un test: está confundido por eventos, subidas diarias y estacionalidad. Solo un escalón limpio (una entidad, sin otros cambios) alimenta la decisión.",
        "La skill propone; las decisiones de presupuesto, las pruebas de lift y cualquier cambio en las plataformas las ejecuta el equipo con criterio humano.",
    ]
    return section("14", "Límites y supuestos", "Lo que este plan no puede saber y lo que asume", lista(items), "limites")


# --------------------------------------------------------------------------------------
# CSS + documento
# --------------------------------------------------------------------------------------
CSS = """
:root{--charcoal:#323232;--orange:#f2692d;--peri:#8088e6;--lime:#e0fb9b;--cream:#fcf2e3;--gray:#f5f5f5;--white:#fff;
--text:#323232;--body:#4a4a4a;--muted:#8a8a8a;--border:#ececec;--ok:#3f9d5a;--bad:#d6453c;--warn:#f2692d;--wait:#8088e6;
--r-lg:24px;--r-xl:32px;--r-md:16px;--shadow-sm:0 2px 8px rgba(50,50,50,.08)}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--cream);color:var(--body);font-family:'DM Sans',ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:1.6}
.wrap{max-width:1200px;margin:0 auto;padding:32px 24px 64px}
header.hero{background:var(--charcoal);color:#fff;border-radius:var(--r-xl);padding:40px 44px;display:flex;justify-content:space-between;gap:32px;align-items:flex-start;margin-bottom:32px}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--orange);margin-bottom:12px}
header.hero h1{margin:0 0 12px;font-size:40px;line-height:1.05;letter-spacing:-.02em;font-weight:700;color:#fff}
header.hero .meta{color:rgba(255,255,255,.72);font-size:14px;line-height:1.7}
header.hero .meta strong{color:#fff;font-weight:500}
header.hero img{height:40px;filter:brightness(0) invert(1);flex:none;margin-top:6px}
section{background:var(--white);border:1px solid var(--border);border-radius:var(--r-lg);padding:32px 36px;margin-bottom:24px;box-shadow:var(--shadow-sm)}
.sec-head{display:flex;gap:16px;align-items:flex-start;margin-bottom:20px}
.sec-head .num{flex:none;width:40px;height:40px;border-radius:12px;background:var(--orange);color:#fff;font-weight:700;display:inline-flex;align-items:center;justify-content:center;font-size:14px;letter-spacing:.04em}
h2{margin:0;font-size:26px;line-height:1.15;letter-spacing:-.02em;font-weight:700;color:var(--text)}
h3{margin:28px 0 10px;font-size:17px;font-weight:700;color:var(--text);letter-spacing:-.01em}
p.sub{margin:6px 0 0;color:var(--muted);font-size:14px}
p.lead{font-size:17px;line-height:1.6;color:var(--text);margin:20px 0 8px;max-width:980px}
.linea{background:var(--charcoal);color:#fff;border-radius:var(--r-md);padding:14px 18px;font-size:15px;font-weight:500;margin-bottom:16px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:8px 0 8px}
.kpis.small{margin-top:20px}
@media (min-width:900px){.kpis.six{grid-template-columns:repeat(3,1fr)}}
.kpi{border-radius:var(--r-md);padding:18px 20px;min-height:112px;display:flex;flex-direction:column;justify-content:flex-end}
.kpi .v{font-size:28px;font-weight:700;letter-spacing:-.03em;line-height:1.05}
.kpi .l{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin-top:8px;opacity:.85}
.kpi .s{font-size:12px;margin-top:6px;opacity:.8;line-height:1.4}
.kpi.orange{background:var(--orange);color:#fff}.kpi.peri{background:var(--peri);color:#fff}.kpi.lime{background:var(--lime);color:var(--charcoal)}.kpi.ink{background:var(--charcoal);color:#fff}
.kpi.bad{background:var(--bad);color:#fff}.kpi.ok{background:var(--ok);color:#fff}
.tscroll{overflow-x:auto;margin:10px 0}
table{width:100%;border-collapse:collapse;font-size:13.5px;background:#fff}
th{background:var(--charcoal);color:#fff;text-align:left;padding:10px 10px;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;line-height:1.3;vertical-align:bottom}
th:first-child{border-radius:12px 0 0 0}th:last-child{border-radius:0 12px 0 0}
td{padding:10px 10px;border-bottom:1px solid var(--border);vertical-align:top;color:var(--body)}
td:first-child{min-width:230px}
table.compact td:first-child{min-width:90px}
tr:last-child td{border-bottom:none}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
td.num{white-space:nowrap}
table.compact td,table.compact th{padding:8px 10px;font-size:13px}
.mut{color:var(--muted);font-size:12.5px}
strong{color:var(--text);font-weight:600}
.ok{color:var(--ok)}.bad{color:var(--bad)}
.pill{display:inline-flex;align-items:center;gap:7px;padding:4px 11px 4px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;background:var(--gray);color:var(--text)}
.pill i{width:8px;height:8px;border-radius:50%;background:var(--muted);display:inline-block;flex:none}
td .pill{white-space:normal;line-height:1.35;align-items:flex-start}td .pill i{margin-top:5px}
table.google td:last-child{min-width:210px}table.google th:last-child{min-width:210px}
table.cotas td:last-child{min-width:150px}
table.tablero td:first-child{min-width:120px}table.tablero td,table.tablero th{padding-left:8px;padding-right:8px}
.pill.ok{background:#e6f4ea;color:#256b3b}.pill.ok i{background:var(--ok)}
.pill.warn{background:#fde9de;color:#9a3d12}.pill.warn i{background:var(--warn)}
.pill.bad{background:#fbe3e1;color:#8e2b25}.pill.bad i{background:var(--bad)}
.pill.wait{background:#e6e8fb;color:#3d45a3}.pill.wait i{background:var(--wait)}
.pill.muted{background:var(--gray);color:#6b6b6b}
.callout{border-radius:var(--r-md);padding:14px 18px;margin:14px 0;font-size:14px;line-height:1.55}
.callout.note{background:#e6e8fb;color:#2e3577}
.callout.warn{background:#fde9de;color:#7a2f0c}
.callout.muted{background:var(--gray);color:var(--body)}
.card{background:var(--gray);border-radius:var(--r-lg);padding:22px 24px;margin:14px 0}
.card .card-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap}
.card h3{margin:0 0 4px}
.card table{background:#fff;border-radius:12px;overflow:hidden}
ul{margin:8px 0 0;padding-left:20px}li{margin:4px 0}
ul.decisiones li{font-size:15.5px;color:var(--text);margin:8px 0}
ul.motivos{margin:10px 0 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.box{background:var(--gray);border-radius:var(--r-lg);padding:20px 22px}
.box h3{margin:0 0 4px}.box p{margin:0 0 6px}
.timeline{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.tl{background:#fff;border:1px solid var(--border);border-radius:var(--r-lg);padding:18px 20px}
.tl:nth-child(1){border-top:6px solid var(--orange)}.tl:nth-child(2){border-top:6px solid var(--peri)}.tl:nth-child(3){border-top:6px solid var(--lime)}.tl:nth-child(4){border-top:6px solid var(--charcoal)}
.tl.evento{background:#fde9de}
.tl .when{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text);margin-bottom:6px}
.tl ul{font-size:13.5px}
.band{margin:8px 0 6px}.band-bar{position:relative;height:14px;border-radius:999px;background:var(--gray)}
.band-bar .range{position:absolute;top:0;height:14px;border-radius:999px;background:linear-gradient(90deg,var(--peri),var(--orange))}
.band-bar .mark{position:absolute;top:-6px;width:3px;height:26px;background:var(--charcoal);border-radius:2px}
.band-bar .mark.eq{background:var(--bad)}.band-bar .mark.nm{background:var(--ok)}.band-bar .mark.cc{background:var(--charcoal);width:5px}
.band-labels{display:flex;justify-content:space-between;font-size:12.5px;color:var(--muted);margin-top:10px;gap:12px;flex-wrap:wrap}
footer{margin-top:32px;background:var(--charcoal);color:rgba(255,255,255,.75);border-radius:var(--r-xl);padding:26px 36px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:center;font-size:13px}
footer strong{color:#fff}footer img{height:24px;filter:brightness(0) invert(1)}
@media (max-width:720px){header.hero{padding:28px 24px;flex-direction:column}header.hero h1{font-size:30px}section{padding:22px 18px}.wrap{padding:16px 16px 40px}}
@media print{body{background:#fff}.wrap{max-width:none;padding:0}section{break-inside:avoid;box-shadow:none;border-color:#ddd;margin-bottom:16px}header.hero{border-radius:16px}.tscroll{overflow:visible}@page{size:A4;margin:14mm}}
"""


def build(data, narrativa=None):
    D = data.get("derivado") or {}
    if not D:
        raise SystemExit("El JSON no tiene bloque `derivado`: corre primero calc_escalado.py")
    N = narrativa or data.get("narrativa") or {}
    cli = data.get("cliente") or {}
    nombre = cli.get("nombre") or "Cliente"
    per = data.get("periodos") or {}
    logo = ""
    if os.path.exists(LOGO):
        with open(LOGO, "rb") as f:
            logo = "data:image/png;base64," + base64.b64encode(f.read()).decode("ascii")
    fuentes = data.get("fuentes") or []
    header = f"""<header class="hero"><div><div class="eyebrow">Plan de escalado · Meta + Google Ads · atribución incremental</div>
<h1>Plan de Escalado de {esc(nombre)} x SARAHI</h1>
<div class="meta"><strong>{fecha_larga(D.get('hoy'))}</strong> · ventanas {periodo(per.get('m30'))} (30 d) y {periodo(per.get('m7'))} (7 d) · {esc(cli.get('pais') or '')} · {esc(cli.get('moneda') or 'CLP')}<br>
Fuentes: {esc(' · '.join(fuentes)) if fuentes else 'Meta MCP · AgencyAnalytics (Google Ads, GA4) · cliente'}</div></div>
{f'<img src="{logo}" alt="SARAHI">' if logo else '<div class="eyebrow">SARAHI</div>'}</header>"""
    body = "".join([
        sec_runbook(D, N, data), sec_resumen(D, N, data), sec_negocio(D, N, data), sec_meta(D, N, data), sec_google(D, N, data), sec_ga4(D, N, data),
        sec_atribucion(D, N, data), sec_vertical_meta(D, N, data), sec_vertical_google(D, N, data), sec_horizontal(D, N, data),
        sec_calendario(D, N, data), sec_alertas(D, N, data), sec_tablero(D, N, data), sec_limites(D, N, data)])
    import hashlib
    h = hashlib.sha256(json.dumps({k: v for k, v in data.items() if k not in ("derivado", "narrativa")}, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:10]
    footer = f"""<footer><div><strong>Plan de Escalado Meta + Google x SARAHI</strong> · Metodología SARAHI x Felipe Vergara · El plan propone; tú decides · www.sarahiagency.com · Madrid · Santiago<br><span class=mut style="color:rgba(255,255,255,.5)">escalado-incremental-x-sarahi v1.0 · datos {h}</span></div>
{f'<img src="{logo}" alt="SARAHI">' if logo else ''}</footer>"""
    return f"""<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Plan de Escalado de {esc(nombre)} x SARAHI</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" rel="stylesheet">
<style>{CSS}</style></head><body><div class="wrap">{header}{body}{footer}</div></body></html>"""


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    narr = None
    for i, a in enumerate(sys.argv):
        if a == "--narrativa" and i + 1 < len(sys.argv):
            with open(sys.argv[i + 1], encoding="utf-8") as f:
                narr = json.load(f)
    if len(args) < 2:
        print(__doc__)
        sys.exit(1)
    with open(args[0], encoding="utf-8") as f:
        data = json.load(f)
    html_out = build(data, narr)
    with open(args[1], "w", encoding="utf-8") as f:
        f.write(html_out)
    print(f"OK → {args[1]} ({len(html_out.encode('utf-8')) // 1024} KB)")


if __name__ == "__main__":
    main()
