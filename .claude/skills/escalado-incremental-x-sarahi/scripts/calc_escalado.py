#!/usr/bin/env python3
"""
calc_escalado.py — Cálculos deterministas del Plan de Escalado Meta + Google x SARAHI.

Uso:
    python calc_escalado.py entrada.json salida.json [--hoy AAAA-MM-DD]

Entrada: JSON con los datos crudos leídos de Meta MCP, AgencyAnalytics (Google Ads, GA4)
y los números del negocio que entrega el cliente. Esquema en SKILL.md; ejemplo completo
en examples/data-djoyas.json.

Salida: el mismo JSON más un bloque `derivado`: números del negocio, semáforo y escalera
por conjunto de Meta, semáforo por campaña de Google, GA4 con MER y aMER, atribución
(triangulación, cotas piso/techo, semáforo de atribución de cuenta, plan de pruebas),
alertas, runbook, calendario, tablero semanal y `faltantes`. Nada se estima: lo que no se
puede calcular queda en null y se lista en `faltantes`.

Sin dependencias externas. Python 3.9+.
"""
import json
import math
import re
import sys
import datetime as dt

# --------------------------------------------------------------------------------------
# Supuestos calibrables. Se sobreescriben desde `supuestos` en el JSON de entrada.
# Cada valor tiene una razón (ver references/umbrales-y-semaforo.md).
# --------------------------------------------------------------------------------------
SUPUESTOS = {
    # Meta · tamaño del paso: "el colchón fija el tamaño, el aprendizaje fija el reloj".
    "colchon_minimo": 0.25,          # bajo 25 % sobre el número mágico no hay subida vertical (FV: "no justo en el número")
    "paso_factor": 0.75,             # paso = 0,75 × colchón
    "paso_notches": [0.35, 0.20, 0.15, 0.0],   # escalones posibles del paso; las degradaciones bajan un escalón
    "compras_paso_maximo": 25,       # ≥ 25 compras en 7 d para pasos ≥ 30 % (ruido Poisson ±20 %)
    "compras_min_7d": 10,            # bajo 10 en 7 d y 20 en 30 d no se lee
    "compras_min_30d": 20,
    # Meta · reloj
    "dias_entre_subidas": 5,
    "dias_entre_subidas_aprendizaje": 7,
    "subidas_14d_max": 2,            # más de 2 subidas en 14 d → congelar 7 días desde hoy
    "checkpoint_factor_nm": 0.9,     # en el checkpoint de 72 h se revierte si ROAS < 0,9 × número mágico o CPA > objetivo
    "checkpoint_dias": 3,            # 72 h: solo para revertir; la decisión de volver a subir espera los 5 días
    # Meta · frecuencia 7 d por etapa: aviso (SARAHI, paso corto) y tope (FV, no subir)
    "frecuencia": {
        "TOFU":   {"aviso": 1.75, "tope": 3.0, "tope_30d": 4.5},
        "MOFU":   {"aviso": 4.0, "tope": 6.0, "tope_30d": 9.0},
        "BOFU":   {"aviso": 5.0, "tope": 10.0, "tope_30d": 15.0},
        "EVENTO": {"aviso": 5.0, "tope": 10.0, "tope_30d": 15.0},
    },
    "caida_roas_tendencia": 0.20,    # ROAS 7 d < 0,8 × ROAS 30 d → tendencia a la baja
    "caida_roas_reversion": 0.25,    # en el nuevo nivel: cae > 25 % vs el anterior → volver
    # Evento (Cyber, Black, Navidad): FV exime la cadencia, no el tope.
    "evento": {"cadencia_dias": 2, "paso_max": 0.35, "compras_min_7d": 20},
    # Atribución de cuenta
    "atribucion": {
        "ratio_normal": 2.0, "ratio_elevado": 4.0,       # compras Meta / compras GA4 Paid Social
        "sobre_reclamo_aviso": 0.9,                      # (compras Meta + Google) / pedidos reales
        "ia_alta": 2.0, "ia_media": 5.0,                 # índice de incertidumbre = techo / piso
        "factor_vigencia_dias": 90,      # un factor medido (lift, holdout, A/B) vale 90 días
        "cap_amarillo": 0.20, "cap_rojo": 0.15,          # tope del paso según semáforo de atribución
        "ventana_ratio_dias": 28,                        # los ratios se leen en 28 d; la semana es ruido
    },
    # Google Ads
    "google": {
        "paso_limitada_presupuesto": 0.20,   # cuota perdida por presupuesto ≥ 20 % y ROAS sobre objetivo (opti-google-ads-x-sarahi)
        "paso_parcial": 0.10,                # cuota perdida entre 10 y 20 %
        "dias_entre_cambios": 7,             # un cambio por campaña por semana, lunes
        "lost_is_budget_min": 0.10,
        "lost_is_budget_fuerte": 0.20,
        "lost_is_rank_alto": 0.30,
        "clics_min_30d": 30,
        "is_marca_min": 0.80,
        "subgasto": 0.80,                    # gasto medio diario < 80 % del presupuesto → no está limitada por presupuesto
        "caida_7d_vs_30d": 0.25,
        "ratio_normal": 1.5, "ratio_elevado": 2.0,
        "canibalizacion_ratio": 2.0, "canibalizacion_cpc": 0.7,
        "cubrir_extra": 0.05,
    },
    "ga4": {"engagement_rate_max": 95.0, "session_cvr_max": 50.0, "cobertura_utm_min": 0.7, "dif_ingresos_backend_max": 0.15},
    "redondeo_presupuesto": 100,
    "tope_multiplo_escalera": 2.0,       # la escalera no pasa de ×2 del presupuesto inicial (umbrales §2)
    "runbook_max_filas": 8,
}

MEDIOS_META_GA4 = {"ig / paid", "fb / paid", "an / paid", "facebook / paid", "instagram / paid", "meta / paid",
                   "facebook / cpc", "instagram / cpc", "ig / cpc", "fb / cpc", "msg / paid",
                   "facebook / paid_social", "instagram / paid_social", "facebook / paidsocial", "ig / paidsocial"}
MEDIOS_GOOGLE_GA4 = {"google / cpc", "google / paid", "google / ppc"}
ETAPAS_CALIENTES = ("MOFU", "BOFU", "EVENTO")


# --------------------------------------------------------------------------------------
# Utilidades
# --------------------------------------------------------------------------------------
MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def clp(v):
    """Pesos sin decimales con punto de miles, para meter en frases sin tocar las comas del texto."""
    try:
        return "$" + f"{float(v):,.0f}".replace(",", ".")
    except (TypeError, ValueError):
        return "—"


def fx(v, nd=2):
    """ROAS/ratio como texto; None → '—' (nunca 'Nonex')."""
    return "—" if v is None else f"{float(v):.{nd}f}x"


def parse_num(v):
    """Convierte a float valores con formato chileno, moneda MCP o vacíos.
    Acepta: 12000, "12.000", "1.234,5", "$ 12.000", "12,3%", {"value":"45000","unit":"CLP"},
    None, "", "Not available", "—". Devuelve None si no hay número."""
    if v is None:
        return None
    if isinstance(v, bool):
        return float(v)
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, dict):
        return parse_num(v.get("value"))
    s = str(v).strip()
    if not s or s.lower() in {"not available", "n/a", "na", "—", "-", "null", "none", "sin datos"}:
        return None
    s = re.sub(r"[^\d,.\-]", "", s)
    if not s or s in {"-", ".", ","}:
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    elif s.count(".") > 1:
        s = s.replace(".", "")
    elif "." in s:
        ent, dec = s.split(".")
        if len(dec) == 3 and ent.lstrip("-").isdigit():
            s = ent + dec
    try:
        return float(s)
    except ValueError:
        return None


def pct_trio(m):
    """Cuota de impresiones y cuotas perdidas (presupuesto, ranking) de una ventana, como fracción 0-1.
    El esquema las pide en 0-100 (así las entrega AgencyAnalytics). La escala se decide por ventana, no por valor:
    solo si las tres vienen presentes y suman ≈ 1 se leen como fracciones; así 0,9 significa 0,9 % y no 90 %."""
    vals = [parse_num(m.get(k)) for k in ("is", "lost_is_budget", "lost_is_rank")]
    presentes = [v for v in vals if v is not None]
    if not presentes:
        return None, None, None
    total = sum(presentes)
    escala = 1.0 if (len(presentes) == 3 and 0.85 <= total <= 1.15 and max(presentes) <= 1.0) else 100.0
    is_, lb, lr = [None if v is None else v / escala for v in vals]
    return lb, lr, is_


def div(a, b):
    a, b = parse_num(a), parse_num(b)
    if a is None or b in (None, 0):
        return None
    return a / b


def r(x, nd=2):
    return None if x is None else round(x, nd)


def rd_budget(x, paso):
    if x is None:
        return None
    return int(round(x / paso) * paso)


def parse_date(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return dt.datetime.utcfromtimestamp(float(s)).date()
    s = str(s).strip()
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)  # activity logs de Meta: M/D/YYYY at H:MM
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return dt.date(y, a, b)
        except ValueError:
            try:
                return dt.date(y, b, a)  # venía como D/M/YYYY
            except ValueError:
                return None
    return None


def proximo_lunes(d):
    return d + dt.timedelta(days=(7 - d.weekday()) % 7)


def etapa_de(nombre, etapa=None):
    if etapa:
        e = etapa.upper()
        return e if e in ("TOFU", "MOFU", "BOFU", "EVENTO") else "MOFU"
    n = (nombre or "").upper()
    if any(k in n for k in ("CYBER", "BLACK", "NAVIDAD", "HOT SALE", "EVENTO")):
        return "EVENTO"
    if "TOFU" in n or "NUEVOS" in n or "PRESENTA" in n or "FRIO" in n or "FRÍO" in n:
        return "TOFU"
    if "BOFU" in n or "RETARGET" in n or "REMARKET" in n or "CONVERSI" in n:
        return "BOFU"
    return "MOFU"


def notch_paso(valor, notches):
    """Mayor escalón ≤ valor."""
    for n in notches:
        if valor >= n - 1e-9:
            return n
    return 0.0


def notch_baja(paso, notches):
    """Escalón siguiente hacia abajo."""
    for i, n in enumerate(notches):
        if abs(n - paso) < 1e-9:
            return notches[i + 1] if i + 1 < len(notches) else 0.0
    return notch_paso(paso, notches)


def deep_merge(base, extra):
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            deep_merge(base[k], v)
        else:
            base[k] = v
    return base


# --------------------------------------------------------------------------------------
# Negocio
# --------------------------------------------------------------------------------------
def calc_negocio(neg, S, faltantes, hoy):
    out = {}
    margen = parse_num(neg.get("margen_bruto"))
    if margen is not None and margen > 1:
        margen = margen / 100.0
    ticket = parse_num(neg.get("ticket_promedio"))
    eq = parse_num(neg.get("roas_equilibrio"))
    if eq is None and margen:
        eq = 1.0 / margen
    nm = parse_num(neg.get("numero_magico"))
    if nm is None and eq is not None:
        nm = eq * (1 + S["colchon_minimo"])
        out["numero_magico_origen"] = "calculado = equilibrio × 1,25 (colchón mínimo SARAHI)"
    else:
        out["numero_magico_origen"] = "entregado por el cliente / plan vigente"
    if eq is None and nm is not None:
        eq = nm / (1 + S["colchon_minimo"])
        out["roas_equilibrio_origen"] = "estimado = número mágico / 1,25 (falta margen bruto o ROAS de equilibrio)"
        faltantes.append("negocio.margen_bruto o roas_equilibrio: el equilibrio se estima como número mágico / 1,25; pedir el margen real")
    elif eq is None:
        faltantes.append("negocio.margen_bruto o roas_equilibrio: sin equilibrio no hay semáforo financiero")
    else:
        out["roas_equilibrio_origen"] = "1 / margen bruto" if parse_num(neg.get("roas_equilibrio")) is None else "entregado por el cliente"
    if nm is None:
        faltantes.append("negocio.numero_magico: sin ROAS objetivo no se puede escalar con criterio")
    fe = neg.get("fecha_especial") or {}
    fi, ff = parse_date(fe.get("inicio")), parse_date(fe.get("fin") or fe.get("inicio"))
    evento_activo = bool(fi and ff and fi <= hoy <= ff)
    evento_proximo = bool(fi and hoy < fi <= hoy + dt.timedelta(days=28))
    out.update({
        "ticket_promedio": ticket, "margen_bruto": r(margen, 4), "roas_equilibrio": r(eq, 2), "numero_magico": r(nm, 2),
        "cpa_maximo": r(ticket * margen, 0) if (ticket and margen) else None,
        "cpa_objetivo": r(ticket * margen * 0.7, 0) if (ticket and margen) else None,
        "colchon_numero_magico_vs_equilibrio": r(nm / eq - 1, 3) if (nm and eq) else None,
        "evento": {"nombre": fe.get("nombre"), "inicio": fe.get("inicio"), "fin": fe.get("fin"), "activo": evento_activo,
                   "proximo": evento_proximo, "fechas_confirmadas": bool(fi)},
    })
    if fe.get("nombre") and not fi:
        faltantes.append(f"fecha_especial.inicio/fin ({fe.get('nombre')}): sin fechas no se puede aplicar la excepción de cadencia ni proteger las pruebas")
    return out


# --------------------------------------------------------------------------------------
# Meta
# --------------------------------------------------------------------------------------
def historial_presupuesto(ent, hoy):
    cambios = ent.get("cambios_presupuesto") or []
    fechas = []
    for c in cambios:
        f = parse_date(c.get("fecha"))
        if f:
            fechas.append((f, c))
    if fechas:
        fechas.sort(key=lambda x: x[0])
        f, c = fechas[-1]
        de, a = parse_num(c.get("de")), parse_num(c.get("a"))
        sub = lambda ff, cc, d: (hoy - ff).days <= d and (parse_num(cc.get("a")) or 0) > (parse_num(cc.get("de")) or 0)
        return {"dias": (hoy - f).days, "fecha": f.isoformat(), "ultimo_cambio_pct": r(a / de - 1, 3) if (de and a) else None,
                "subidas_30d": sum(1 for ff, cc in fechas if sub(ff, cc, 30)), "subidas_14d": sum(1 for ff, cc in fechas if sub(ff, cc, 14)),
                "cambios_automaticos_meta": sum(1 for ff, cc in fechas if str(cc.get("actor", "")).strip().lower() == "meta"),
                "fuente": "activity_logs"}
    f = parse_date((ent.get("learning") or {}).get("last_sig_edit_ts"))
    if f:
        return {"dias": (hoy - f).days, "fecha": f.isoformat(), "subidas_30d": None, "subidas_14d": None, "cambios_automaticos_meta": 0, "fuente": "learning_stage_info.last_sig_edit_ts"}
    return {"dias": None, "fecha": None, "subidas_30d": None, "subidas_14d": None, "cambios_automaticos_meta": 0, "fuente": "sin datos"}


def semaforo_meta(ent, neg, S, hoy, ctx):
    """ctx: semáforo de atribución de cuenta, cotas por etapa, estudio activo, alerta marginal."""
    m7, m30 = ent.get("m7") or {}, ent.get("m30") or {}
    etapa = etapa_de(ent.get("nombre"), ent.get("etapa"))
    nm, eq = neg.get("numero_magico"), neg.get("roas_equilibrio")
    roas7 = parse_num(m7.get("roas")) if m7.get("roas") is not None else div(m7.get("valor"), m7.get("gasto"))
    roas30 = parse_num(m30.get("roas")) if m30.get("roas") is not None else div(m30.get("valor"), m30.get("gasto"))
    compras7, compras30 = parse_num(m7.get("compras")), parse_num(m30.get("compras"))
    gasto7, gasto30 = parse_num(m7.get("gasto")), parse_num(m30.get("gasto"))
    freq7, freq30 = parse_num(m7.get("frecuencia")), parse_num(m30.get("frecuencia"))
    ctr7, ctr30 = parse_num(m7.get("ctr")), parse_num(m30.get("ctr"))
    presupuesto = parse_num(ent.get("presupuesto_diario"))
    learning = ent.get("learning") or {}
    l_status = str(learning.get("status") or "").upper()
    l_status = {"FAIL": "LEARNING_LIMITED", "LEARNING_LIMITED": "LEARNING_LIMITED", "WAIVING": "SIN_APRENDIZAJE"}.get(l_status, l_status)
    compras_faltantes = [w for w, m in (("m7", m7), ("m30", m30)) if m.get("compras") is None and (m.get("roas") is not None or m.get("valor") is not None)]
    compras7 = 0.0 if compras7 is None else compras7
    compras30 = 0.0 if compras30 is None else compras30
    hist = historial_presupuesto(ent, hoy)
    fr = S["frecuencia"].get(etapa, S["frecuencia"]["MOFU"])
    notches = S["paso_notches"]
    evento = neg.get("evento") or {}

    d = {"id": ent.get("id"), "nombre": ent.get("nombre"), "campana": ent.get("campana"), "etapa": etapa,
         "nivel_presupuesto": ent.get("nivel_presupuesto"), "presupuesto_diario": presupuesto,
         "roas_7d": r(roas7), "roas_30d": r(roas30), "compras_7d": compras7, "compras_30d": compras30,
         "gasto_7d": gasto7, "gasto_30d": gasto30, "cpa_7d": r(div(gasto7, compras7), 0), "ctr_7d": ctr7, "ctr_30d": ctr30,
         "presupuesto_pre_ultima_subida": next((parse_num(c.get("de")) for c in sorted(ent.get("cambios_presupuesto") or [], key=lambda c: str(c.get("fecha")), reverse=True) if (parse_num(c.get("a")) or 0) > (parse_num(c.get("de")) or 0)), None),
         "frecuencia_7d": r(freq7), "frecuencia_30d": r(freq30), "frecuencia_aviso": fr["aviso"], "frecuencia_tope": fr["tope"],
         "aprendizaje": l_status or None, "conversiones_aprendizaje": parse_num(learning.get("conversions")),
         "historial": hist, "dias_desde_ultimo_cambio": hist.get("dias"),
         "attribution_setting": ent.get("attribution_setting"), "optimization_goal": ent.get("optimization_goal"),
         "es_ventas": bool(ent.get("es_ventas", True)) and (roas7 is not None or roas30 is not None),
         "motivos": [], "avisos": [], "bloqueos": [], "caps": []}

    if not d["es_ventas"]:
        d.update({"estado": "fuera", "etiqueta": "Sin ROAS · fuera del escalado de ventas", "paso": 0.0, "escalera": []})
        return d
    if nm is None:
        d.update({"estado": "sin_objetivo", "etiqueta": "Sin número mágico", "paso": 0.0, "escalera": []})
        return d

    # ---- Cotas de incrementalidad de la entidad (heredadas de su etapa, o medidas)
    cot = (ctx.get("cotas_etapa") or {}).get("CALIENTE" if etapa in ETAPAS_CALIENTES else "TOFU") or {}
    inc_in = ent.get("incremental") or {}
    f_med = parse_num(inc_in.get("factor_medido"))
    f_fecha = parse_date(inc_in.get("fecha"))
    if f_med is not None and f_fecha and (hoy - f_fecha).days > S["atribucion"].get("factor_vigencia_dias", 90):
        d["avisos"].append(f"factor medido del {f_fecha.isoformat()} vencido (más de {S['atribucion'].get('factor_vigencia_dias', 90)} días): se vuelve a las cotas de la etapa hasta medir de nuevo")
        f_med = None
    elif f_med is not None and not f_fecha:
        d["avisos"].append("factor medido sin fecha en el JSON: se asume vigente; cargar `incremental.fecha`")
    vent = ent.get("ventanas") or {}
    _c = lambda k: parse_num(((vent.get(k) or {}).get("compras")))
    c1, c7 = _c("1d_click"), (_c("7d_click") or _c("7d_click_1d_view"))
    fraccion_1d = (c1 / c7) if (c1 is not None and c7) else None
    inc = {"origen": None, "piso": None, "central": None, "techo": None, "ia": None, "confianza": None, "fraccion_1d_click": r(fraccion_1d, 2)}
    if roas7 is not None:
        if f_med is not None:
            inc.update({"origen": "medido: " + str((ent.get("incremental") or {}).get("fuente") or "prueba causal"),
                        "piso": r(roas7 * f_med), "central": r(roas7 * f_med), "techo": r(roas7), "ia": 1.0, "confianza": "alta"})
        elif cot.get("ratio_piso") is not None:
            piso = roas7 * cot["ratio_piso"]
            techo = roas7 * cot["ratio_techo"]
            central = math.sqrt(max(piso, 1e-9) * max(techo, 1e-9))
            inc.update({"origen": f"cotas de la etapa ({cot.get('nombre')}): piso GA4 último clic, techo compras deduplicadas",
                        "piso": r(piso), "central": r(central), "techo": r(techo), "ia": cot.get("ia"), "confianza": cot.get("confianza")})
        elif fraccion_1d is not None:
            # sin GA4: la fracción 1 d clic / 7 d clic de las ventanas de atribución hace de piso alternativo
            piso, techo = roas7 * fraccion_1d, roas7
            central = math.sqrt(max(piso, 1e-9) * max(techo, 1e-9))
            ia = techo / piso if piso > 0 else None
            A_ = S["atribucion"]
            inc.update({"origen": f"ventanas de atribución: piso = ROAS 7 d × fracción 1 d clic / 7 d clic ({fraccion_1d:.2f})",
                        "piso": r(piso), "central": r(central), "techo": r(techo), "ia": r(ia, 1),
                        "confianza": None if ia is None else ("alta" if ia <= A_["ia_alta"] else "media" if ia <= A_["ia_media"] else "baja")})
    d["incremental"] = inc
    d["central_cumple"] = None if inc["central"] is None else inc["central"] >= nm
    d["piso_cumple"] = None if inc["piso"] is None else inc["piso"] >= nm

    # ---- Lectura
    if compras_faltantes:
        d["avisos"].append(f"{' y '.join(compras_faltantes)} sin `compras` en el JSON: se asume 0; pedir omni_purchase en la consulta")
    if not gasto7:
        d.update({"estado": "sin_datos", "etiqueta": "Sin entrega en 7 d", "paso": 0.0, "escalera": []})
        d["motivos"].append("gasto 7 d en cero: sin entrega reciente no hay lectura (¿pausado o recién lanzado?)")
        return d
    if roas7 is None:
        d.update({"estado": "sin_datos", "etiqueta": "Muestra insuficiente para decidir", "paso": 0.0, "escalera": []})
        d["motivos"].append("sin ROAS 7 d (falta `roas` o `valor` en m7): no se puede leer")
        return d
    if compras7 < S["compras_min_7d"] and compras30 < S["compras_min_30d"]:
        d.update({"estado": "sin_datos", "etiqueta": "Muestra insuficiente para decidir", "paso": 0.0, "escalera": []})
        d["motivos"].append(f"{int(compras7)} compras en 7 d y {int(compras30)} en 30 d: bajo el mínimo de lectura ({S['compras_min_7d']} / {S['compras_min_30d']})")
        return d
    if eq is not None and roas7 < eq:
        d.update({"estado": "rojo", "etiqueta": "Pierde plata · bajo el equilibrio", "paso": 0.0, "escalera": []})
        d["motivos"].append(f"ROAS 7 d {roas7:.2f}x bajo el equilibrio {eq:.2f}x")
        pre = d.get("presupuesto_pre_ultima_subida")
        d["presupuesto_sugerido"] = int(pre) if pre and presupuesto and pre < presupuesto else (rd_budget(presupuesto * 0.8, S["redondeo_presupuesto"]) if presupuesto else None)
        d["motivos"].append(f"Volver al presupuesto previo a la última subida ({clp(d['presupuesto_sugerido'])}) o bajar 20 %; dos semanas bajo el equilibrio → pausar" if d["presupuesto_sugerido"] else "Bajar 20 %; dos semanas bajo el equilibrio → pausar")
        return d
    if roas7 < nm or (roas30 is not None and roas30 < nm):
        d.update({"estado": "amarillo", "etiqueta": "Bajo el número mágico · optimizar, no escalar", "paso": 0.0, "escalera": []})
        d["motivos"].append(f"ROAS 7 d {roas7:.2f}x / 30 d {fx(roas30)} contra un número mágico de {nm:.2f}x")
        return d

    colchon = roas7 / nm - 1
    d["colchon_7d"] = r(colchon, 3)
    d["colchon_30d"] = r(roas30 / nm - 1, 3) if roas30 else None
    tendencia = (roas7 / roas30 - 1) if roas30 else None
    d["tendencia_7d_vs_30d"] = r(tendencia, 3)

    # ---- Tamaño del paso: 0,75 × colchón, en escalones
    if colchon < S["colchon_minimo"]:
        paso = 0.0
        d["motivos"].append(f"ROAS 7 d {roas7:.2f}x, colchón de {colchon*100:.0f} % sobre el número mágico ({nm:.2f}x): verde justo, sin margen para retornos decrecientes")
    else:
        paso = notch_paso(min(S["paso_factor"] * colchon, notches[0]), notches)
        d["motivos"].append(f"ROAS 7 d {roas7:.2f}x = {roas7/nm:.1f} veces el número mágico ({nm:.2f}x); colchón {colchon*100:,.0f} % → paso base {paso*100:.0f} %".replace(",", "."))
    paso_base = paso

    # ---- Caps (cada uno baja un escalón)
    def cap(motivo):
        nonlocal paso
        if paso > 0:
            paso = notch_baja(paso, notches)
        d["caps"].append(motivo)

    cpa7 = div(gasto7, compras7)
    if cpa7 is not None and neg.get("cpa_maximo") and cpa7 > neg["cpa_maximo"]:
        cap(f"CPA 7 d {clp(cpa7)} sobre el CPA máximo {clp(neg['cpa_maximo'])}")
    elif cpa7 is not None and neg.get("cpa_objetivo") and cpa7 > neg["cpa_objetivo"]:
        d["avisos"].append(f"CPA 7 d {clp(cpa7)} sobre el CPA objetivo {clp(neg['cpa_objetivo'])} (bajo el máximo)")
    if paso >= 0.30 and (compras7 or 0) < S["compras_paso_maximo"]:
        cap(f"{int(compras7)} compras en 7 d (< {S['compras_paso_maximo']}): paso máximo 20 %")
    if tendencia is not None and tendencia <= -S["caida_roas_tendencia"]:
        cap(f"ROAS 7 d cae {abs(tendencia)*100:.0f} % frente a 30 d")
    if freq7 is not None and fr["aviso"] <= freq7 < fr["tope"]:
        cap(f"frecuencia 7 d {freq7:.2f} sobre el aviso temprano {fr['aviso']} (tope {fr['tope']})")
    if freq30 is not None and freq30 >= fr.get("tope_30d", fr["tope"] * 1.5):
        cap(f"frecuencia 30 d {freq30:.1f} sobre el tope de 30 d de la etapa ({fr.get('tope_30d', fr['tope'] * 1.5):g}): público chico")
    if l_status == "LEARNING":
        cap("conjunto en fase de aprendizaje: una subida grande la reinicia")
    if ctx.get("marginal_bajo_equilibrio"):
        cap("ROAS marginal de la cuenta bajo el equilibrio en la última semana completa (alerta preventiva)")
    # cap por semáforo de atribución de la cuenta
    sem_atr = ctx.get("semaforo_atribucion")
    A = S["atribucion"]
    if f_med is None:
        if sem_atr == "amarillo" and paso > A["cap_amarillo"]:
            paso = A["cap_amarillo"]; d["caps"].append("atribución de cuenta en amarillo: paso máximo 20 %")
        elif sem_atr == "rojo":
            if etapa in ETAPAS_CALIENTES:
                if d["piso_cumple"]:
                    if paso > A["cap_rojo"]:
                        paso = A["cap_rojo"]
                    d["caps"].append("atribución de cuenta en rojo: el piso pesimista aún supera el número mágico, paso máximo 15 %")
                else:
                    paso = 0.0
                    d["caps"].append("atribución de cuenta en rojo y piso pesimista bajo el número mágico: sin subida vertical hasta tener un factor medido")
            elif paso > A["cap_rojo"]:
                paso = A["cap_rojo"]; d["caps"].append("atribución de cuenta en rojo: paso máximo 15 % en público nuevo")
        elif sem_atr is None and paso > A["cap_rojo"]:
            paso = A["cap_rojo"]; d["caps"].append("sin semáforo de atribución (falta GA4 o pedidos reales): paso máximo 15 % hasta poder triangular")
    if d["central_cumple"] is False and paso > 0:
        cap(f"ROAS incremental central {inc['central']}x bajo el número mágico")

    # ---- Reloj
    dias_req = S["dias_entre_subidas_aprendizaje"] if l_status == "LEARNING" else S["dias_entre_subidas"]
    congelar_hasta = None
    if (hist.get("subidas_14d") or 0) > S["subidas_14d_max"]:
        congelar_hasta = hoy + dt.timedelta(days=S["dias_entre_subidas_aprendizaje"])
        d["avisos"].append(f"{hist['subidas_14d']} subidas en 14 días: congelar 7 días para que el ROAS por nivel sea legible")
        dias_req = max(dias_req, S["dias_entre_subidas_aprendizaje"])
    if evento.get("activo"):
        if paso >= 0.35 and (compras7 or 0) >= S["evento"]["compras_min_7d"]:
            dias_req = S["evento"]["cadencia_dias"]
            d["avisos"].append(f"evento {evento.get('nombre')} activo: cadencia de {dias_req} días, tope 35 %, reversión al cierre")
        else:
            d["bloqueos"].append(f"evento {evento.get('nombre')} activo: solo lo excelente con volumen se mueve durante el evento")
    d["dias_requeridos_entre_subidas"] = dias_req

    # ---- Bloqueos duros
    if freq7 is not None and freq7 >= fr["tope"]:
        d["bloqueos"].append(f"frecuencia 7 d {freq7:.2f} supera el tope {fr['tope']} de la etapa: ampliar público antes de subir")
    fatiga = (freq7 is not None and freq7 >= fr["aviso"] and tendencia is not None and tendencia <= -S["caida_roas_tendencia"]
              and ctr7 is not None and ctr30 and ctr7 < 0.8 * ctr30)
    d["fatiga"] = bool(fatiga)
    if (ctr7 is None or not ctr30) and freq7 is not None and freq7 >= fr["aviso"] and tendencia is not None and tendencia <= -S["caida_roas_tendencia"]:
        d["fatiga"] = None
        d["ctr_faltante"] = True
        d["avisos"].append("fatiga creativa no verificable: frecuencia en aviso y ROAS 7 d cayendo, pero falta el CTR 7 d / 30 d (pedir `ctr` en la consulta)")
    if fatiga:
        d["bloqueos"].append(f"fatiga creativa: frecuencia {freq7:.2f}, ROAS 7 d cae {abs(tendencia)*100:.0f} % y CTR 7 d cae {(1 - ctr7/ctr30)*100:.0f} % frente a 30 d: renovar anuncios antes de subir")
    if l_status == "LEARNING_LIMITED":
        d["bloqueos"].append("aprendizaje limitado (status FAIL): el conjunto no consigue volumen de conversiones; consolidar antes de escalar")
    if hist.get("cambios_automaticos_meta"):
        d["bloqueos"].append("una automatización de Meta está moviendo el presupuesto: desactivarla y fijar un presupuesto manual antes de escalar")
    if ctx.get("estudio_activo"):
        d["bloqueos"].append("hay un estudio de lift activo: no cambiar presupuestos hasta que termine")

    # ---- Estado
    estados = {0.35: ("verde_excelente", "Verde excelente · subir 35 %"), 0.20: ("verde", "Verde · subir 20 %"),
               0.15: ("verde_corto", "Verde · paso corto 15 %")}
    if paso > 0:
        estado, etiqueta = estados.get(paso, ("verde", f"Verde · subir {paso*100:.0f} %"))
    elif paso_base == 0:
        estado, etiqueta = "verde_justo", "Verde justo · mantener y escalar horizontal"
    else:
        estado, etiqueta = "verde_mantener", "Verde con avisos · mantener y escalar horizontal"
    d["estado_base"] = estado
    if d["bloqueos"]:
        estado, etiqueta = "bloqueado", "No subir · " + d["bloqueos"][0].split(":")[0]
        paso_efectivo = 0.0
    else:
        paso_efectivo = paso
    inicio = None
    if paso_efectivo > 0 and presupuesto:
        inicio = hoy
        if hist.get("dias") is not None and hist["dias"] < dias_req:
            inicio = hoy + dt.timedelta(days=dias_req - hist["dias"])
        if congelar_hasta and congelar_hasta > inicio:
            inicio = congelar_hasta
        if inicio > hoy:
            estado = "esperar"
            etiqueta = f"{etiqueta.split(' · ')[0]} · primera subida el {inicio.isoformat()}"
    d.update({"estado": estado, "etiqueta": etiqueta, "paso": paso_efectivo, "paso_base": paso_base})

    # ---- Escalera
    esc = []
    if inicio and paso_efectivo > 0:
        p = presupuesto
        p_max = rd_budget(presupuesto * S["tope_multiplo_escalera"], S["redondeo_presupuesto"])
        chk_dias = S["checkpoint_dias"] if dias_req > S["checkpoint_dias"] else max(1, dias_req - 1)
        for i in range(3):
            fecha = inicio + dt.timedelta(days=dias_req * i)
            p_new = rd_budget(p * (1 + paso_efectivo), S["redondeo_presupuesto"])
            if p_new <= p:
                p_new = int(p + S["redondeo_presupuesto"])
            tope_alcanzado = p_new >= p_max
            if tope_alcanzado:
                p_new = int(p_max)
                if p_new <= p:
                    break
            esc.append({"n": i + 1, "fecha": fecha.isoformat(), "desde": int(p), "hasta": p_new, "paso": paso_efectivo,
                        "checkpoint": (fecha + dt.timedelta(days=chk_dias)).isoformat(),
                        "decision": (fecha + dt.timedelta(days=dias_req)).isoformat(),
                        "condicion": f"a los {dias_req} d: ROAS 7 d ≥ {nm:.2f}x, no cae más de {int(S['caida_roas_reversion']*100)} % frente al nivel anterior y frecuencia 7 d < {fr['tope']}",
                        "tope_alcanzado": tope_alcanzado,
                        "reversion": f"checkpoint {chk_dias * 24} h: si ROAS < {nm*S['checkpoint_factor_nm']:.2f}x" + (f" o CPA > {clp(neg['cpa_maximo'])}" if neg.get("cpa_maximo") else "") + f", volver a {clp(p)}"})
            p = p_new
            if tope_alcanzado:
                d["avisos"].append(f"la escalera llega al tope ×{S['tope_multiplo_escalera']:g} del presupuesto inicial en la subida {i + 1}: después, crecimiento horizontal")
                break
    d["escalera"] = esc
    d["tope"] = (f"Tope de la escalera: ×2 del presupuesto inicial en 28 días, frecuencia 7 d ≥ {fr['tope']}, ROAS 7 d bajo {nm:.2f}x "
                 + (f"o MER marginal bajo {eq:.2f}x " if eq is not None else "") + "→ pasar a horizontal") if esc else None
    return d


def calc_meta(meta, neg, S, hoy, ctx, faltantes):
    ents = meta.get("entidades") or []
    if not ents:
        faltantes.append("meta.entidades: sin conjuntos/campañas no hay plan vertical de Meta")
    out = {"entidades": [semaforo_meta(e, neg, S, hoy, ctx) for e in ents]}
    ventas = [e for e in out["entidades"] if e.get("es_ventas")]
    no_ventas = [e for e in out["entidades"] if not e.get("es_ventas")]
    ppto_hoy = sum((e.get("presupuesto_diario") or 0) for e in ventas)
    proy = []
    for n in (1, 2, 3):
        total = 0.0
        for e in ventas:
            esc = e.get("escalera") or []
            total += esc[n - 1]["hasta"] if len(esc) >= n else (esc[-1]["hasta"] if esc else (e.get("presupuesto_diario") or 0))
        proy.append({"subida": n, "presupuesto_ventas_dia": int(total), "variacion_vs_hoy": r(total / ppto_hoy - 1, 3) if ppto_hoy else None})
    out.update({
        "presupuesto_ventas_dia_hoy": int(ppto_hoy), "proyeccion_presupuesto": proy,
        "gasto_ventas_7d": sum((e.get("gasto_7d") or 0) for e in ventas), "gasto_ventas_30d": sum((e.get("gasto_30d") or 0) for e in ventas),
        "compras_ventas_7d": sum((e.get("compras_7d") or 0) for e in ventas), "compras_ventas_30d": sum((e.get("compras_30d") or 0) for e in ventas),
        "gasto_sin_retorno_30d": sum((e.get("gasto_30d") or 0) for e in no_ventas),
        "presupuesto_sin_retorno_dia": int(sum((e.get("presupuesto_diario") or 0) for e in no_ventas)),
    })
    top = max(ventas, key=lambda e: e.get("compras_7d") or 0) if ventas else None
    if top and out["compras_ventas_7d"]:
        out["dependencia_top"] = {"nombre": top["nombre"], "share_compras_7d": r((top.get("compras_7d") or 0) / out["compras_ventas_7d"], 3)}
    # Serie semanal: ROAS marginal
    sem = meta.get("cuenta", {}).get("semanas") or []
    serie, prev = [], None
    eq = neg.get("roas_equilibrio")
    for w in sem:
        g, v, c = parse_num(w.get("gasto")), parse_num(w.get("valor")), parse_num(w.get("compras"))
        row = {"inicio": w.get("inicio"), "fin": w.get("fin"), "dias": w.get("dias"), "parcial": bool(w.get("parcial")), "evento": bool(w.get("evento")),
               "gasto": g, "compras": c, "valor": v, "roas": r(div(v, g)), "roas_marginal": None, "elasticidad_compras": None, "marginal_bajo_equilibrio": None}
        if prev and not row["parcial"] and g and prev["gasto"] and abs(g / prev["gasto"] - 1) >= 0.05:
            dg, dv = g - prev["gasto"], (v or 0) - (prev["valor"] or 0)
            row["roas_marginal"] = r(dv / dg)
            if prev["compras"] and c is not None:
                row["elasticidad_compras"] = r((c / prev["compras"] - 1) / (g / prev["gasto"] - 1), 2)
            row["marginal_bajo_equilibrio"] = (eq is not None and row["roas_marginal"] < eq)
        serie.append(row)
        if not row["parcial"]:
            prev = row
    out["serie_semanal"] = serie
    completas = [s for s in serie if not s["parcial"] and s["gasto"]]
    if len(completas) >= 2:
        first, last = completas[0], completas[-1]
        out["tendencia_cuenta"] = {
            "gasto_var": r(last["gasto"] / first["gasto"] - 1, 3),
            "roas_var": r((last["roas"] or 0) / first["roas"] - 1, 3) if first["roas"] else None,
            "roas_marginal_ultimo": last.get("roas_marginal"),
            "semanas_marginal_negativo": next((i for i, s in enumerate(reversed(completas)) if not s.get("marginal_bajo_equilibrio")), len(completas)),
            "semanas_marginal_negativo_total": sum(1 for s in completas if s.get("marginal_bajo_equilibrio")),
            "lectura": ("Retornos decrecientes: el gasto sube y el valor de cada peso adicional está bajo el equilibrio (alerta preventiva: la serie mezcla eventos y cambios diarios, no es un test de escalón limpio)"
                        if last.get("marginal_bajo_equilibrio") else
                        "El ROAS marginal de la última semana completa sigue sobre el equilibrio" if last.get("roas_marginal") is not None else
                        "Sin variación de gasto suficiente entre semanas para leer ROAS marginal")}
    return out


# --------------------------------------------------------------------------------------
# Google Ads
# --------------------------------------------------------------------------------------
def tipo_google(c):
    t = str(c.get("tipo") or "").lower()
    n = str(c.get("nombre") or "").lower()
    em = c.get("es_marca")
    if em is True or (em is None and re.search(r"(?<!sin )(?<!no )\b(marca|brand)\b", n)):
        return "marca"
    if "performance" in t or "pmax" in t or "pmax" in n:
        return "pmax"
    if "shopping" in t:
        return "shopping"
    if "search" in t or "búsqueda" in n or "busqueda" in n or "search" in n:
        return "generica"
    if "demand" in t or "display" in t or "video" in t:
        return t
    return "otro"


def semaforo_google(c, neg, S, hoy):
    G = S["google"]
    m30, m7 = c.get("m30") or {}, c.get("m7") or {}
    nm, eq = neg.get("numero_magico"), neg.get("roas_equilibrio")
    tipo = tipo_google(c)
    costo30, conv30, valor30 = parse_num(m30.get("costo")), parse_num(m30.get("conv")), parse_num(m30.get("valor"))
    costo7 = parse_num(m7.get("costo"))
    roas30 = parse_num(m30.get("roas")) if m30.get("roas") is not None else div(valor30, costo30)
    roas7 = parse_num(m7.get("roas")) if m7.get("roas") is not None else div(m7.get("valor"), m7.get("costo"))
    clics30 = parse_num(m30.get("clics"))
    lb30, lr30, is30 = pct_trio(m30)
    lb7, lr7, is7 = pct_trio(m7)
    lb, lr, is_ = (lb7 if lb7 is not None else lb30), (lr7 if lr7 is not None else lr30), (is7 if is7 is not None else is30)
    ventana_is = "7 d" if lb7 is not None else "30 d"
    presupuesto = parse_num(c.get("presupuesto_diario"))
    ticket = neg.get("ticket_promedio")
    valor_por_conv = div(valor30, conv30)
    es_ventas = c.get("es_ventas")
    if es_ventas is None:
        es_ventas = not (valor_por_conv is not None and ticket and valor_por_conv < 0.1 * ticket)
    gasto_dia_7d = div(costo7, 7)
    subgasto = bool(presupuesto and gasto_dia_7d is not None and gasto_dia_7d < G["subgasto"] * presupuesto)
    d = {"nombre": c.get("nombre"), "tipo": tipo, "presupuesto_diario": presupuesto, "es_ventas": es_ventas,
         "costo_30d": costo30, "conv_30d": conv30, "valor_30d": valor30, "roas_30d": r(roas30), "roas_7d": r(roas7),
         "costo_7d": costo7, "conv_7d": parse_num(m7.get("conv")), "gasto_dia_7d": r(gasto_dia_7d, 0), "subgasto": subgasto,
         "cpa_30d": r(div(costo30, conv30), 0), "is_30d": r(is30, 3), "lost_is_budget_30d": r(lb30, 3), "lost_is_rank_30d": r(lr30, 3),
         "is_7d": r(is7, 3), "lost_is_budget_7d": r(lb7, 3), "lost_is_rank_7d": r(lr7, 3), "ventana_is": ventana_is,
         "cpc_30d": r(div(costo30, clics30), 0), "motivos": [], "avisos": [], "bloqueos": [], "escalera": []}
    if not es_ventas:
        d.update({"estado": "fuera", "etiqueta": "La conversión no es una venta · fuera del ROAS", "paso": 0.0})
        return d
    if nm is None:
        d.update({"estado": "sin_objetivo", "etiqueta": "Sin número mágico", "paso": 0.0})
        return d
    if (clics30 or 0) < G["clics_min_30d"] or roas30 is None:
        d.update({"estado": "sin_datos", "etiqueta": "Muestra insuficiente (menos de 30 clics o sin ROAS)", "paso": 0.0})
        return d
    colchon = roas30 / nm - 1
    d["colchon_30d"] = r(colchon, 3)
    if tipo == "marca":
        pierde = (lb is not None and lb >= G["lost_is_budget_min"]) or (is_ is not None and is_ < G["is_marca_min"])
        if pierde and presupuesto:
            nuevo = rd_budget(presupuesto * (1 + (lb or 0) + G["cubrir_extra"]), S["redondeo_presupuesto"])
            nuevo = min(nuevo, rd_budget(presupuesto * 1.3, S["redondeo_presupuesto"]))
            d.update({"estado": "cubrir", "etiqueta": "Marca · cubrir cuota perdida por presupuesto", "paso": r(nuevo / presupuesto - 1, 3), "nuevo_presupuesto": nuevo})
            d["motivos"].append(f"Marca pierde {(lb or 0)*100:.0f} % de impresiones por presupuesto ({ventana_is}) o su cuota {(is_ or 0)*100:.0f} % está bajo 80 %: cobertura, no escalado")
        else:
            d.update({"estado": "marca_ok", "etiqueta": "Marca · cubierta, no es palanca de crecimiento", "paso": 0.0})
            d["motivos"].append(f"Cuota de impresiones {(is_ or 0)*100:.0f} %, perdida por presupuesto {(lb or 0)*100:.0f} % ({ventana_is}); se revisa cada semana porque al subir TOFU en Meta la demanda de marca crece")
        d["lectura_incremental"] = "La marca captura demanda creada en otros canales: su ROAS no entra al promedio de escalado. Sus impresiones semanales sirven de termómetro de Meta."
        return d
    # rentabilidad: 30 d gobierna, 7 d confirma
    roas_ok = roas30 >= nm and (roas7 is None or roas7 >= roas30 * (1 - G["caida_7d_vs_30d"]) or roas7 >= nm)
    if not roas_ok:
        if lr is not None and lr >= G["lost_is_rank_alto"]:
            d.update({"estado": "rojo" if (eq and roas30 < eq) else "amarillo", "etiqueta": "Bajo objetivo con cuota perdida por ranking · ajustar puja, no presupuesto", "paso": 0.0})
            d["motivos"].append(f"ROAS 30 d {roas30:.2f}x / 7 d {fx(roas7)} vs objetivo {nm:.2f}x; cuota perdida por ranking {lr*100:.0f} %. Acción de puja: bajar el tROAS 10-15 % da más volumen; subirlo, más eficiencia [verificación manual: la estrategia de puja no es visible en AgencyAnalytics]")
        else:
            d.update({"estado": "rojo" if (eq and roas30 < eq) else "amarillo", "etiqueta": "Bajo el número mágico · optimizar antes de escalar", "paso": 0.0})
            d["motivos"].append(f"ROAS 30 d {roas30:.2f}x / 7 d {fx(roas7)} vs objetivo {nm:.2f}x")
        return d
    # verde: la palanca es la cuota perdida por presupuesto (7 d), no el colchón
    if lb is None:
        d["avisos"].append("Sin cuota de impresiones perdida por presupuesto (PMax reporta parcial): decidir por ROAS, tendencia y gasto contra presupuesto")
    limitada_presupuesto = (lb is not None and lb >= G["lost_is_budget_fuerte"]) and not subgasto
    parcial = (lb is not None and G["lost_is_budget_min"] <= lb < G["lost_is_budget_fuerte"]) and not subgasto
    if lr is not None and lr >= G["lost_is_rank_alto"] and not limitada_presupuesto:
        d.update({"estado": "verde_puja", "etiqueta": "Sobre objetivo pero limitada por ranking · puja, no presupuesto", "paso": 0.0})
        d["motivos"].append(f"ROAS 30 d {roas30:.2f}x sobre objetivo; cuota perdida por ranking {lr*100:.0f} % y por presupuesto {(lb or 0)*100:.0f} % ({ventana_is}){' · gasto medio ' + clp(gasto_dia_7d) + '/día bajo el presupuesto' if subgasto else ''}. Más presupuesto no compra más subastas: bajar el tROAS 10-15 % (= más volumen) [verificación manual: estrategia de puja]")
        return d
    if lb is not None and lb < G["lost_is_budget_min"] or subgasto and not limitada_presupuesto:
        d.update({"estado": "verde_sin_techo", "etiqueta": "Sobre objetivo pero sin cuota que comprar · escalar horizontal o relajar tROAS", "paso": 0.0})
        d["motivos"].append(f"Cuota perdida por presupuesto {(lb or 0)*100:.0f} % ({ventana_is}){' y gasto medio bajo el presupuesto' if subgasto else ''}: más presupuesto no compra más demanda")
        return d
    paso = G["paso_limitada_presupuesto"] if limitada_presupuesto else (G["paso_parcial"] if parcial else 0.0)
    if paso == 0:
        d.update({"estado": "verde_sin_techo", "etiqueta": "Sobre objetivo sin restricción de presupuesto clara", "paso": 0.0})
        return d
    if roas7 is not None and roas30 and roas7 < roas30 * (1 - G["caida_7d_vs_30d"]):
        paso = min(paso, G["paso_parcial"]); d["avisos"].append(f"ROAS 7 d {roas7:.2f}x cae más de 25 % frente a 30 d: paso corto")
    d["motivos"].append(f"ROAS 30 d {roas30:.2f}x (colchón {colchon*100:.0f} %); cuota perdida por presupuesto {lb*100:.0f} % ({ventana_is}): hay demanda que no se está comprando")
    d.update({"estado": "verde_excelente" if paso >= 0.2 else "verde", "etiqueta": f"Verde · subir {paso*100:.0f} % (limitada por presupuesto)", "paso": paso})
    return d


def escalera_google(e, S, hoy, nm):
    G = S["google"]
    p = e.get("presupuesto_diario")
    if not p or (e.get("paso") or 0) <= 0 or e.get("estado") == "cubrir":
        return []
    inicio = proximo_lunes(hoy)
    esc = []
    for i in range(3):
        fecha = inicio + dt.timedelta(days=G["dias_entre_cambios"] * i)
        p_new = rd_budget(p * (1 + e["paso"]), S["redondeo_presupuesto"])
        if p_new <= p:
            p_new = int(p + S["redondeo_presupuesto"])
        esc.append({"n": i + 1, "fecha": fecha.isoformat(), "desde": int(p), "hasta": p_new, "paso": e["paso"],
                    "checkpoint": (fecha + dt.timedelta(days=G["dias_entre_cambios"] - 1)).isoformat(), "decision": (fecha + dt.timedelta(days=G["dias_entre_cambios"])).isoformat(),
                    "condicion": f"ROAS 30 d ≥ {nm:.2f}x, ROAS 7 d no cae > 25 % y la cuota perdida por presupuesto sigue > 10 %",
                    "reversion": f"si el ROAS cae > 20 % y queda bajo objetivo, volver a {clp(p)}"})
        p = p_new
    return esc


def calc_google(google, neg, S, hoy, faltantes):
    camps = google.get("campanas") or []
    if not camps:
        faltantes.append("google.campanas: sin Google Ads no hay plan de escalado en Google (declararlo en el HTML)")
        return {"entidades": [], "disponible": False}
    G = S["google"]
    ents = [semaforo_google(c, neg, S, hoy) for c in camps]
    ventas = [e for e in ents if e.get("es_ventas")]
    gen = [e for e in ventas if e["tipo"] == "generica" and e.get("roas_30d")]
    for e in ventas:
        if e["tipo"] == "pmax" and gen and e.get("roas_30d") and e.get("cpc_30d"):
            g = max(gen, key=lambda x: x.get("costo_30d") or 0)
            if g.get("cpc_30d") and e["roas_30d"] >= G["canibalizacion_ratio"] * g["roas_30d"] and e["cpc_30d"] < G["canibalizacion_cpc"] * g["cpc_30d"]:
                e["avisos"].append(f"PMax rinde {e['roas_30d']}x con CPC {clp(e['cpc_30d'])} frente a {g['roas_30d']}x y {clp(g['cpc_30d'])} en genérica: posible captura de búsquedas de marca. Confirmar exclusiones de marca antes de cualquier subida [verificación manual]")
                if (e.get("paso") or 0) > G["paso_parcial"]:
                    e["paso"] = G["paso_parcial"]; e["estado"] = "verde"; e["etiqueta"] = "Verde · paso corto hasta confirmar exclusiones de marca"
    for e in ents:
        e["escalera"] = escalera_google(e, S, hoy, neg.get("numero_magico") or 0)
    adq = [e for e in ventas if e["tipo"] != "marca"]
    out = {"disponible": True, "entidades": ents,
           "costo_30d": sum((e.get("costo_30d") or 0) for e in ents), "costo_7d": sum((e.get("costo_7d") or 0) for e in ents),
           "conv_ventas_30d": sum((e.get("conv_30d") or 0) for e in ventas), "valor_ventas_30d": sum((e.get("valor_30d") or 0) for e in ventas),
           "costo_ventas_30d": sum((e.get("costo_30d") or 0) for e in ventas), "costo_marca_30d": sum((e.get("costo_30d") or 0) for e in ventas if e["tipo"] == "marca"),
           "presupuesto_dia_hoy": int(sum((e.get("presupuesto_diario") or 0) for e in ents))}
    out["roas_ventas_30d"] = r(div(out["valor_ventas_30d"], out["costo_ventas_30d"]))
    out["roas_adquisicion_30d"] = r(div(sum((e.get("valor_30d") or 0) for e in adq), sum((e.get("costo_30d") or 0) for e in adq)))
    proy = 0.0
    for e in ents:
        esc = e.get("escalera") or []
        proy += esc[0]["hasta"] if esc else (e.get("nuevo_presupuesto") or e.get("presupuesto_diario") or 0)
    out["presupuesto_dia_tras_subida_1"] = int(proy)
    return out


# --------------------------------------------------------------------------------------
# GA4
# --------------------------------------------------------------------------------------
def calc_ga4(ga4, S, faltantes):
    if not ga4 or not (ga4.get("canales") or ga4.get("totales")):
        faltantes.append("ga4: sin GA4 no hay triangulación ni MER (declararlo)")
        return {"disponible": False}
    G = S["ga4"]
    alertas = list(ga4.get("alertas_calidad") or [])

    def bloque(m):
        m = m or {}
        return {"sesiones": parse_num(m.get("sesiones")), "usuarios": parse_num(m.get("usuarios")), "nuevos": parse_num(m.get("nuevos")),
                "compras": parse_num(m.get("compras")), "ingresos": parse_num(m.get("ingresos")),
                "compradores_nuevos": parse_num(m.get("compradores_nuevos")), "compradores": parse_num(m.get("compradores")),
                "engagement_rate": parse_num(m.get("engagement_rate")), "session_cvr": parse_num(m.get("session_cvr")),
                "atc": parse_num(m.get("atc")), "checkouts": parse_num(m.get("checkouts"))}

    out = {"disponible": True, "canales": [], "totales": {"m30": bloque((ga4.get("totales") or {}).get("m30")), "m7": bloque((ga4.get("totales") or {}).get("m7"))}}
    for c in ga4.get("canales") or []:
        row = {"canal": c.get("canal"), "m30": bloque(c.get("m30")), "m7": bloque(c.get("m7"))}
        for k in ("m30", "m7"):
            b = row[k]
            b["cvr_compra"] = r(div(b["compras"], b["sesiones"]), 4)
            b["aov"] = r(div(b["ingresos"], b["compras"]), 0)
        out["canales"].append(row)
    er = [c["m30"]["engagement_rate"] for c in out["canales"] if c["m30"]["engagement_rate"] is not None]
    if er and min(er) > G["engagement_rate_max"]:
        alertas.append("engagement_rate sobre 95 % en todos los canales: la instrumentación marca casi toda sesión como interactiva")
    scv = [c["m30"]["session_cvr"] for c in out["canales"] if c["m30"]["session_cvr"] is not None]
    if scv and min(scv) > G["session_cvr_max"]:
        alertas.append("session_conversion_rate sobre 50 %: hay un evento marcado como conversión que dispara en casi todas las sesiones; no usar 'conversions' de GA4, solo transacciones e ingresos")

    def canal(nombre, k="m30"):
        for c in out["canales"]:
            if str(c["canal"]).strip().lower() == nombre.lower():
                return c[k]
        return None

    for k in ("m30", "m7"):
        t = out["totales"][k]
        ps, pse, cn = canal("Paid Social", k), canal("Paid Search", k), canal("Cross-network", k)
        t["compras_paid_social"] = ps["compras"] if ps else None
        t["ingresos_paid_social"] = ps["ingresos"] if ps else None
        t["aov_paid_social"] = ps["aov"] if ps else None
        t["compras_paid_search"] = pse["compras"] if pse else None
        t["ingresos_paid_search"] = pse["ingresos"] if pse else None
        t["compras_cross_network"] = cn["compras"] if cn else None
        t["ingresos_cross_network"] = cn["ingresos"] if cn else None
        pagado = sum((x["ingresos"] or 0) for x in (ps, pse, cn) if x)
        t["ingresos_pagados"] = pagado if (ps or pse or cn) else None
        t["share_ingresos_pagados"] = r(div(pagado, t["ingresos"]), 3) if t["ingresos"] else None
        t["share_compradores_nuevos"] = r(div(t["compradores_nuevos"], t["compradores"]), 3)
        t["aov"] = r(div(t["ingresos"], t["compras"]), 0)
    # source / medium
    sm = ga4.get("source_medium") or []
    acc = {"meta_tx": 0.0, "meta_rev": 0.0, "meta_new": 0.0, "meta_buyers": 0.0, "google_tx": 0.0, "google_rev": 0.0}
    hay_sm = False
    for s in sm:
        key = str(s.get("sm") or "").strip().lower()
        m = s.get("m30") or {}
        hay_sm = True
        if key in MEDIOS_META_GA4:
            acc["meta_tx"] += parse_num(m.get("compras")) or 0; acc["meta_rev"] += parse_num(m.get("ingresos")) or 0
            acc["meta_new"] += parse_num(m.get("compradores_nuevos")) or 0; acc["meta_buyers"] += parse_num(m.get("compradores")) or 0
        if key in MEDIOS_GOOGLE_GA4:
            acc["google_tx"] += parse_num(m.get("compras")) or 0; acc["google_rev"] += parse_num(m.get("ingresos")) or 0
    t30 = out["totales"]["m30"]
    cobertura = div(acc["meta_tx"], t30.get("compras_paid_social")) if hay_sm else None
    if hay_sm and cobertura is not None and cobertura < G["cobertura_utm_min"]:
        alertas.append(f"las UTM de pauta de Meta solo cubren el {cobertura*100:.0f} % de las compras del canal Paid Social: parte del tráfico de Meta cae en social orgánico o referral; el ratio por UTM es más duro que el real")
    out["source_medium_30d"] = {"disponible": hay_sm, "compras_meta_utm": acc["meta_tx"] if hay_sm else None, "ingresos_meta_utm": acc["meta_rev"] if hay_sm else None,
                                "compradores_nuevos_meta_utm": acc["meta_new"] if hay_sm else None, "compradores_meta_utm": acc["meta_buyers"] if hay_sm else None,
                                "share_nuevos_meta_utm": r(div(acc["meta_new"], acc["meta_buyers"]), 3) if hay_sm else None,
                                "compras_google_cpc": acc["google_tx"] if hay_sm else None, "ingresos_google_cpc": acc["google_rev"] if hay_sm else None,
                                "cobertura_utm_paid_social": r(cobertura, 3)}
    out["alertas_calidad"] = alertas
    return out


# --------------------------------------------------------------------------------------
# Atribución: triangulación, cotas, semáforo de atribución, pruebas, tablero
# --------------------------------------------------------------------------------------
def calc_atribucion(data, d_meta_pre, d_google, d_ga4, neg, S, faltantes):
    A = S["atribucion"]
    backend = (data.get("negocio") or {}).get("backend") or {}
    exp = (data.get("meta") or {}).get("experimentos") or {}
    cuenta30 = (data.get("meta") or {}).get("cuenta", {}).get("m30") or {}
    out = {"supuestos": {"ratio_normal": A["ratio_normal"], "ratio_elevado": A["ratio_elevado"], "ia_alta": A["ia_alta"], "ia_media": A["ia_media"], "ventana_ratio_dias": A["ventana_ratio_dias"]}}

    # Meta reportado
    meta_c30 = parse_num(cuenta30.get("compras")) or d_meta_pre.get("compras_ventas_30d")
    meta_g30 = parse_num(cuenta30.get("gasto")) or d_meta_pre.get("gasto_ventas_30d")
    meta_v30 = parse_num(cuenta30.get("valor"))
    if meta_v30 is None:
        meta_v30 = sum((e.get("gasto_30d") or 0) * (e.get("roas_30d") or 0) for e in d_meta_pre.get("entidades", []) if e.get("es_ventas"))
    # GA4
    ga4_t30 = (d_ga4.get("totales") or {}).get("m30") or {}
    sm = d_ga4.get("source_medium_30d") or {}
    ga4_ps, ga4_ps_rev = ga4_t30.get("compras_paid_social"), ga4_t30.get("ingresos_paid_social")
    ga4_meta_utm = sm.get("compras_meta_utm")
    ga4_google = sm.get("compras_google_cpc") if sm.get("compras_google_cpc") is not None else ga4_t30.get("compras_paid_search")
    ga4_google_rev = sm.get("ingresos_google_cpc") if sm.get("ingresos_google_cpc") is not None else ga4_t30.get("ingresos_paid_search")
    google_c30, google_v30, google_g30 = d_google.get("conv_ventas_30d"), d_google.get("valor_ventas_30d"), d_google.get("costo_30d")
    pedidos = parse_num(backend.get("pedidos_30d")) or ga4_t30.get("compras")
    ingresos = parse_num(backend.get("ingresos_30d")) or ga4_t30.get("ingresos")
    origen_verdad = "backend del cliente" if backend.get("pedidos_30d") else ("GA4" if ga4_t30.get("compras") else None)
    if origen_verdad is None:
        faltantes.append("pedidos reales del período (backend o GA4): sin ellos no hay MER ni índice de sobre-reclamo")
    elif origen_verdad == "GA4":
        faltantes.append("negocio.backend.pedidos_30d / ingresos_30d: GA4 hace de verdad provisional")
    dif_backend = None
    if backend.get("ingresos_30d") and ga4_t30.get("ingresos"):
        dif_backend = r(abs(parse_num(backend["ingresos_30d"]) - ga4_t30["ingresos"]) / parse_num(backend["ingresos_30d"]), 3)
        if dif_backend is not None and dif_backend > S["ga4"]["dif_ingresos_backend_max"]:
            d_ga4.setdefault("alertas_calidad", []).append(f"GA4 difiere {dif_backend*100:.0f} % de los ingresos del backend (umbral {S['ga4']['dif_ingresos_backend_max']*100:.0f} %): el sitio pierde eventos de compra; el piso GA4 es más pesimista de lo real")

    reclamado = (meta_c30 or 0) + (google_c30 or 0)
    t = {"meta_compras_30d": meta_c30, "meta_valor_30d": r(meta_v30, 0), "meta_gasto_30d": meta_g30,
         "ga4_compras_paid_social_30d": ga4_ps, "ga4_ingresos_paid_social_30d": ga4_ps_rev, "ga4_compras_meta_utm_30d": ga4_meta_utm,
         "google_conv_ventas_30d": r(google_c30, 1), "google_valor_ventas_30d": r(google_v30, 0), "ga4_compras_google_cpc_30d": ga4_google,
         "pedidos_reales_30d": pedidos, "ingresos_reales_30d": ingresos, "origen_verdad": origen_verdad, "dif_ingresos_ga4_vs_backend": dif_backend,
         "ratio_meta_vs_ga4_canal": r(div(meta_c30, ga4_ps)), "ratio_meta_vs_ga4_utm": r(div(meta_c30, ga4_meta_utm)), "ratio_google_vs_ga4": r(div(google_c30, ga4_google)),
         "compras_reclamadas_plataformas": r(reclamado, 1), "indice_sobre_reclamo": r(div(reclamado, pedidos)),
         "valor_reclamado_plataformas": r((meta_v30 or 0) + (google_v30 or 0), 0),
         "share_meta_sobre_ingresos": r(div(meta_v30, ingresos), 3),
         "roas_meta_optimista": r(div(meta_v30, meta_g30)), "roas_meta_pesimista_ga4": r(div(ga4_ps_rev, meta_g30)),
         "roas_google_optimista": r(div(google_v30, google_g30)), "roas_google_pesimista_ga4": r(div(ga4_google_rev, google_g30))}
    t["indice_sobre_reclamo_valor"] = r(div(t["valor_reclamado_plataformas"], ingresos))
    # Factor de deduplicación global: qué fracción de lo reclamado cabe en los pedidos reales
    fdg = min(1.0, div(pedidos, reclamado) or 1.0) if reclamado else None
    t["factor_deduplicacion_global"] = r(fdg, 3)
    ratio = t["ratio_meta_vs_ga4_canal"]
    t["banda_ratio_meta"] = None if ratio is None else ("normal" if ratio <= A["ratio_normal"] else "elevado" if ratio <= A["ratio_elevado"] else "alto")
    rg = t["ratio_google_vs_ga4"]
    t["banda_ratio_google"] = None if rg is None else ("normal" if rg <= S["google"]["ratio_normal"] else "elevado" if rg <= S["google"]["ratio_elevado"] else "alto")
    # Semáforo de atribución de cuenta
    sr = t["indice_sobre_reclamo"]
    if ratio is None and sr is None:
        sem = None
    elif (ratio is not None and ratio > A["ratio_elevado"]) or (sr is not None and sr > 1.0):
        sem = "rojo"
    elif (ratio is not None and ratio > A["ratio_normal"]) or (sr is not None and sr > A["sobre_reclamo_aviso"]):
        sem = "amarillo"
    else:
        sem = "verde"
    t["semaforo_atribucion"] = sem
    t["semaforo_atribucion_lectura"] = {
        "rojo": "Rojo: Meta reporta más de 4 veces lo que GA4 le atribuye o las plataformas reclaman más compras que pedidos hay. Decide el MER; público nuevo con paso máximo 15 %; públicos calientes sin subida vertical hasta medir.",
        "amarillo": "Amarillo: atribución elevada. Paso máximo 20 % y plan de pruebas en marcha.",
        "verde": "Verde: la atribución de plataforma es coherente con GA4 y con los pedidos reales.",
        None: "Sin datos suficientes para el semáforo de atribución: no se puede dar verde excelente."}[sem]
    out["triangulacion"] = t

    # ---- Cotas piso / techo por etapa (partición supuesta: nuevos → TOFU, recurrentes → calientes)
    cotas = {}
    ents = [e for e in d_meta_pre.get("entidades", []) if e.get("es_ventas")]
    gasto_tofu = sum((e.get("gasto_30d") or 0) for e in ents if e.get("etapa") == "TOFU")
    gasto_cal = sum((e.get("gasto_30d") or 0) for e in ents if e.get("etapa") in ETAPAS_CALIENTES)
    comp_tofu = sum((e.get("compras_30d") or 0) for e in ents if e.get("etapa") == "TOFU")
    comp_cal = sum((e.get("compras_30d") or 0) for e in ents if e.get("etapa") in ETAPAS_CALIENTES)
    val_tofu = sum((e.get("gasto_30d") or 0) * (e.get("roas_30d") or 0) for e in ents if e.get("etapa") == "TOFU")
    val_cal = sum((e.get("gasto_30d") or 0) * (e.get("roas_30d") or 0) for e in ents if e.get("etapa") in ETAPAS_CALIENTES)
    share_new = sm.get("share_nuevos_meta_utm") if sm.get("share_nuevos_meta_utm") is not None else ga4_t30.get("share_compradores_nuevos")
    aov_ref = ga4_t30.get("aov_paid_social") or ga4_t30.get("aov") or neg.get("ticket_promedio")
    if ga4_ps_rev is not None and share_new is not None and fdg is not None and aov_ref:
        def cota(nombre, gasto, compras, valor, rev_ps_parte):
            if not gasto or not compras:
                return None
            roas_rep = valor / gasto
            piso_ga4 = rev_ps_parte / gasto
            techo = min(roas_rep, compras * fdg * aov_ref / gasto)
            inconsistente = bool(techo) and piso_ga4 > techo
            piso = min(piso_ga4, techo) if techo else piso_ga4
            central = math.sqrt(max(piso, 1e-9) * max(techo, 1e-9))
            if inconsistente:
                # GA4 último clic asigna a esta etapa más ingresos que los que Meta reporta deduplicados: la partición
                # supuesta sobreasigna y la cota no se puede verificar. Se usa el techo como estimación y se declara.
                ia, conf = None, "no verificable"
            else:
                ia = (techo / piso) if piso > 0 else None
                conf = None if ia is None else ("alta" if ia <= A["ia_alta"] else "media" if ia <= A["ia_media"] else "baja")
            return {"nombre": nombre, "gasto_30d": r(gasto, 0), "compras_30d": compras, "roas_reportado": r(roas_rep), "piso": r(piso), "central": r(central), "techo": r(techo),
                    "piso_ga4_sin_recorte": r(piso_ga4), "particion_inconsistente": inconsistente,
                    "ia": r(ia, 1), "confianza": conf, "ratio_piso": r(piso / roas_rep, 4) if roas_rep else None, "ratio_techo": r(techo / roas_rep, 4) if roas_rep else None,
                    "ratio_central": r(central / roas_rep, 4) if roas_rep else None}
        cotas["TOFU"] = cota("público nuevo", gasto_tofu, comp_tofu, val_tofu, ga4_ps_rev * share_new)
        cotas["CALIENTE"] = cota("públicos activos y clientes (MOFU, BOFU, evento)", gasto_cal, comp_cal, val_cal, ga4_ps_rev * (1 - share_new))
        cotas["CUENTA"] = cota("cuenta Meta", meta_g30 or 0, meta_c30 or 0, meta_v30 or 0, ga4_ps_rev)
        for k in ("TOFU", "CALIENTE"):
            if cotas.get(k) and cotas[k].get("particion_inconsistente"):
                faltantes.append(f"cotas {k}: GA4 asigna a esta etapa más ingresos ({cotas[k]['piso_ga4_sin_recorte']}x) que el techo deduplicado ({cotas[k]['techo']}x): la partición nuevos→TOFU / recurrentes→calientes sobreasigna; pedir utm_campaign por campaña de Meta")
        cotas["nota"] = ("Partición supuesta: los ingresos de compradores nuevos del canal Paid Social en GA4 se asignan a público nuevo y los de recurrentes a públicos calientes, "
                         f"con share de nuevos {share_new*100:.0f} % ({'UTM de pauta' if sm.get('share_nuevos_meta_utm') is not None else 'cuenta'}). Se reemplaza por UTM por campaña cuando existan.")
    else:
        faltantes.append("cotas de incrementalidad: faltan ingresos de Paid Social en GA4, share de compradores nuevos o pedidos reales")
    out["cotas_etapa"] = cotas

    # ---- MER
    gasto_total = (meta_g30 or 0) + (google_g30 or 0)
    mer = div(ingresos, gasto_total)
    share_nuevos_cuenta = ga4_t30.get("share_compradores_nuevos")
    if backend.get("ingresos_nuevos_30d") is not None:
        ingresos_nuevos, origen_nuevos = parse_num(backend.get("ingresos_nuevos_30d")), "backend"
    elif ingresos and share_nuevos_cuenta is not None:
        ingresos_nuevos, origen_nuevos = ingresos * share_nuevos_cuenta, "estimado: ingresos × share de compradores nuevos (GA4)"
    else:
        ingresos_nuevos, origen_nuevos = None, None
    amer = div(ingresos_nuevos, gasto_total)
    eq, nm = neg.get("roas_equilibrio"), neg.get("numero_magico")
    share_pagado = ga4_t30.get("share_ingresos_pagados")
    out["mer"] = {"gasto_total_30d": r(gasto_total, 0), "gasto_meta_30d": meta_g30, "gasto_google_30d": google_g30, "ingresos_30d": ingresos, "mer_30d": r(mer),
                  "ingresos_nuevos_30d": r(ingresos_nuevos, 0), "origen_ingresos_nuevos": origen_nuevos, "amer_30d": r(amer), "share_compradores_nuevos": share_nuevos_cuenta,
                  "mer_objetivo": r(nm), "mer_equilibrio": r(eq), "mer_minimo_por_participacion": r(nm / share_pagado) if (nm and share_pagado) else None,
                  "ingresos_pagados_ga4_30d": ga4_t30.get("ingresos_pagados"), "roas_pagado_ga4_30d": r(div(ga4_t30.get("ingresos_pagados"), gasto_total)),
                  "lectura": None}
    if mer is not None and eq is not None:
        if mer < eq:
            out["mer"]["lectura"] = "El negocio completo no cubre la pauta: frenar, no escalar"
        elif amer is not None and nm is not None and amer < nm:
            out["mer"]["lectura"] = "El negocio cubre la pauta, pero los ingresos de clientes nuevos por peso invertido están bajo el número mágico: el crecimiento viene de recompra"
        else:
            out["mer"]["lectura"] = "El negocio cubre la pauta con holgura"

    # ---- Evidencia y pruebas
    nivel, evidencia = 1, ["Triangulación plataforma vs GA4 vs pedidos reales (30 d)"]
    if (data.get("meta") or {}).get("ventanas_disponibles"):
        nivel = 2; evidencia.append("Comparación de ventanas de atribución exportada de Ads Manager")
    if any(e.get("attribution_setting") == "incrementality" for e in d_meta_pre.get("entidades", [])):
        nivel = 2; evidencia.append("Conjuntos con atribución incremental nativa de Meta")
    if exp.get("estudios_finalizados_conversion_lift") or any(parse_num((e.get("incremental") or {}).get("factor_medido")) is not None for e in (data.get("meta") or {}).get("entidades", [])):
        nivel = 3; evidencia.append("Conversion Lift / holdout medido")
    out["nivel_evidencia"] = {"nivel": nivel, "descripcion": {1: "Triangulación (correlacional)", 2: "Atribución nativa comparada", 3: "Prueba causal"}[nivel], "evidencia": evidencia}
    out["lift"] = {"estudio_activo": bool(exp.get("activos")), "elegible_conversion_lift": exp.get("lift_elegible"),
                   "requisitos_faltantes": exp.get("requisitos_faltantes") or [], "estudios": exp.get("estudios") or []}
    if exp.get("lift_elegible") is None:
        faltantes.append("meta.experimentos.lift_elegible: correr ads_experiment_check_eligibility")

    evento = neg.get("evento") or {}
    despues_evento = f"después del cierre de {evento.get('nombre')}" if (evento.get("activo") or evento.get("proximo")) else "semana 1"
    sd_sem = math.sqrt(pedidos / 4.3) if pedidos else None   # ruido Poisson semanal de la tienda
    comp_cal_sem = comp_cal / 4.3 if comp_cal else None
    cc = cotas.get("CALIENTE") or {}
    potencia_apagado = potencia_piso = None
    if sd_sem and comp_cal_sem and cc.get("ratio_central") is not None:
        # efecto esperado al pausar = compras reclamadas × fracción incremental (central); el piso da el caso pesimista
        potencia_apagado = comp_cal_sem * cc["ratio_central"] / sd_sem
        potencia_piso = comp_cal_sem * (cc.get("ratio_piso") or 0) / sd_sem
    pruebas = []
    if exp.get("lift_elegible"):
        pruebas.append({"orden": 1, "tipo": "Conversion Lift (Meta)", "cuando": despues_evento, "que": "estudio a nivel cuenta con holdout 10 %, 30 días; leer conversiones incrementales y ROAS incremental. Durante el estudio no se tocan presupuestos ni públicos", "fuente": "ads_experiment_lift_create_test (con confirmación de Jorge)"})
    else:
        pruebas.append({"orden": 9, "tipo": "Conversion Lift (Meta)", "cuando": "cuando la cuenta cumpla requisitos", "que": "resultado literal de elegibilidad: " + "; ".join(exp.get("requisitos_faltantes") or ["ver ads_experiment_check_eligibility"]), "fuente": "ads_experiment_check_eligibility"})
    pruebas.append({"orden": 1, "tipo": "A/B nativo con atribución incremental de Meta", "cuando": despues_evento,
                    "que": "duplicar el conjunto caliente de mayor volumen con configuración de atribución incremental (mismo presupuesto por brazo, 14 días o ≥ 50 compras por brazo); factor = ROAS incremental / ROAS estándar corregido por gasto; se invalida con desbalance de gasto > 20 %. Es un estimador de Meta, no una verdad",
                    "fuente": "ads_create_ad_set is_incremental_attribution_enabled (con confirmación)"})
    pruebas.append({"orden": 2, "tipo": "Comparar ventanas de atribución", "cuando": "semana 1 y luego mensual",
                    "que": "exportar 1 d clic / 7 d clic / 1 d vista / 28 d clic por conjunto; la fracción 1 d clic / 7 d clic 1 d vista es el piso alternativo del factor; vista y 28 d son la parte menos incremental", "fuente": "Ads Manager → Comparar configuraciones de atribución"})
    pruebas.append({"orden": 3, "tipo": "Geo-holdout de públicos calientes", "cuando": ("al cerrar el A/B nativo (14 días después de su arranque, semana 4)" if despues_evento == "semana 1" else despues_evento + " y al cerrar el A/B nativo"),
                    "que": "elegir desde GA4 (traffic-analytics por región) 1-2 regiones con 15-20 % de los pedidos; excluirlas de MOFU + BOFU juntos 4 semanas; diferencia en diferencias contra el resto. Declarar el efecto mínimo detectable con la varianza semanal regional observada; extender a 28 d si efecto esperado / desviación < 2", "fuente": "GA4 traffic-analytics group_by region (transactions, purchase_revenue, first_time_purchasers) + exclusión geográfica"})
    pruebas.append({"orden": 4, "tipo": "Escalón de presupuesto (ROAS y MER marginal)", "cuando": "en cada subida",
                    "que": "una entidad por vez, sin otros cambios de presupuesto en la ventana (activity logs); comparar dos semanas completas antes y después: MER marginal = Δingresos reales / Δgasto total. Sobre el equilibrio se sigue; bajo el equilibrio dos semanas seguidas se revierte", "fuente": "serie semanal Meta + GA4 + backend"})
    pruebas.append({"orden": 5, "tipo": "Apagado controlado (último recurso)", "cuando": "solo si el geo-holdout no es viable",
                    "que": (f"pausar MOFU + BOFU juntos ≥ 14 días fuera de eventos y leer la recompra total en backend y GA4 contra un control sintético (Google + orgánico). Potencia estimada hoy: {potencia_apagado:.1f} desviaciones semanales con la cota central, {potencia_piso:.1f} con el piso" + (" (concluyente)" if potencia_apagado >= 2 else " (no concluyente: no usar como estimador)") if potencia_apagado else "pausar MOFU + BOFU juntos ≥ 14 días y leer la recompra total en backend contra un control sintético"),
                    "fuente": "backend + GA4 Direct / Organic / Email"})
    pruebas.sort(key=lambda p: p["orden"])
    for i, p in enumerate(pruebas, 1):
        p["pendiente_requisitos"] = p["orden"] >= 9
        p["orden"] = i
    out["pruebas"] = pruebas
    out["regla_pruebas"] = "Una sola prueba causal a la vez por plataforma; ninguna arranca durante un evento comercial activo; el A/B nativo puede correr en evento porque ambos brazos comparten calendario."

    # ---- Tablero semanal (se acumula con `historial_tablero` de corridas anteriores)
    filas = []
    sem_meta = d_meta_pre.get("serie_semanal") or []
    previas = {f.get("inicio"): f for f in (data.get("historial_tablero") or []) if f.get("inicio")}
    sem_google = {w.get("inicio"): w for w in ((data.get("google") or {}).get("semanas") or [])}
    sem_ga4 = {w.get("inicio"): w for w in ((data.get("ga4") or {}).get("semanas") or [])}
    prev = None
    for w in sem_meta:
        g = sem_google.get(w.get("inicio")) or {}
        a = sem_ga4.get(w.get("inicio")) or {}
        gasto_g, ing, ped, ps = parse_num(g.get("gasto")), parse_num(a.get("ingresos")), parse_num(a.get("compras")), parse_num(a.get("compras_paid_social"))
        total = (w.get("gasto") or 0) + (gasto_g or 0)
        fila = {"semana": f"{w.get('inicio')} → {w.get('fin')}", "inicio": w.get("inicio"), "parcial": w.get("parcial"), "evento": w.get("evento"),
                "gasto_meta": w.get("gasto"), "gasto_google": gasto_g, "gasto_total": r(total, 0) if (w.get("gasto") or gasto_g) else None,
                "compras_meta": w.get("compras"), "roas_meta": w.get("roas"), "roas_marginal_meta": w.get("roas_marginal"),
                "conv_google": parse_num(g.get("conv")), "roas_google": r(div(g.get("valor"), g.get("gasto"))),
                "pedidos_ga4": ped, "ingresos_ga4": ing, "mer": r(div(ing, total)) if total else None,
                "compras_paid_social_ga4": ps, "ratio_meta_ga4": r(div(w.get("compras"), ps)), "ruido_ratio": r(div(w.get("compras"), ps) * 2 / math.sqrt(ps), 1) if (ps and div(w.get("compras"), ps) is not None) else None, "mer_marginal": None}
        if prev and ing is not None and prev.get("ingresos_ga4") is not None and fila["gasto_total"] and prev.get("gasto_total") and abs(fila["gasto_total"] / prev["gasto_total"] - 1) >= 0.05:
            fila["mer_marginal"] = r((ing - prev["ingresos_ga4"]) / (fila["gasto_total"] - prev["gasto_total"]))
        filas.append(fila)
        if not w.get("parcial"):
            prev = fila
    inicios = {f.get("inicio") for f in filas}
    filas = sorted([f for k, f in previas.items() if k not in inicios] + filas, key=lambda f: str(f.get("inicio")))
    out["tablero_semanal"] = {"filas": filas,
                              "columnas": ["Semana", "Gasto Meta", "Gasto Google", "Gasto total", "Compras Meta", "ROAS Meta", "ROAS marginal Meta", "Conv. Google", "ROAS Google", "Pedidos GA4", "Ingresos GA4", "MER", "Ratio Meta/GA4 (±ruido)", "MER marginal"],
                              "nota": "El ratio Meta/GA4 semanal tiene el ruido de un denominador chico (±2/√n); se decide con la ventana de 28 días y solo se reacciona a cambios mayores que el ruido. Las columnas de Google y GA4 se llenan con google.semanas y ga4.semanas."}
    return out


# --------------------------------------------------------------------------------------
# Alertas, runbook, calendario
# --------------------------------------------------------------------------------------
def calc_alertas(d_meta, d_google, d_atr, neg, S):
    al = []
    t, m = d_atr.get("triangulacion", {}), d_atr.get("mer", {})
    for e in d_meta.get("entidades", []):
        if not e.get("es_ventas"):
            continue
        if e.get("estado") == "rojo":
            al.append({"nivel": "rojo", "senal": "Conjunto bajo el equilibrio", "donde": e["nombre"], "accion": "No escalar; optimizar creativo/público o pausar"})
        f7, fa, ft = e.get("frecuencia_7d"), e.get("frecuencia_aviso"), e.get("frecuencia_tope")
        if f7 is not None and ft and f7 >= ft:
            al.append({"nivel": "rojo", "senal": "Frecuencia sobre el tope de la etapa", "donde": f"{e['nombre']} ({f7} vs {ft})", "accion": "Ampliar público o bajar presupuesto"})
        elif f7 is not None and fa and f7 >= fa:
            al.append({"nivel": "amarillo", "senal": "Frecuencia sobre el aviso temprano", "donde": f"{e['nombre']} ({f7} vs {fa})", "accion": "Refrescar anuncios; subir solo con paso corto"})
        if e.get("tendencia_7d_vs_30d") is not None and e["tendencia_7d_vs_30d"] <= -S["caida_roas_tendencia"]:
            al.append({"nivel": "amarillo", "senal": "ROAS 7 d cae frente a 30 d", "donde": f"{e['nombre']} ({e['roas_30d']}x → {e['roas_7d']}x)", "accion": "No subir; si venía de una subida, volver al nivel anterior"})
        h = e.get("historial") or {}
        if (h.get("subidas_14d") or 0) > S["subidas_14d_max"]:
            al.append({"nivel": "amarillo", "senal": "Subidas de presupuesto demasiado frecuentes", "donde": f"{e['nombre']} ({h['subidas_14d']} subidas en 14 días)", "accion": "Congelar 7 días y pasar a subidas cada 5 días con checkpoint"})
        if h.get("cambios_automaticos_meta"):
            al.append({"nivel": "amarillo", "senal": "Presupuesto movido por una automatización de Meta", "donde": e["nombre"], "accion": "Revisar reglas o presupuesto Advantage: el escalado es una decisión, no un automatismo"})
    dep = d_meta.get("dependencia_top")
    if dep and (dep.get("share_compras_7d") or 0) >= 0.5:
        al.append({"nivel": "amarillo", "senal": "Toda la cuenta depende de un conjunto", "donde": f"{dep['nombre']} trae el {dep['share_compras_7d']*100:.0f} % de las compras de 7 d", "accion": "Escalar horizontal ya: graduar ganadores a una campaña de escalado y abrir públicos"})
    if d_meta.get("gasto_sin_retorno_30d"):
        al.append({"nivel": "amarillo", "senal": "Gasto sin retorno medible", "donde": f"campañas de tráfico e interacción: {clp(d_meta['gasto_sin_retorno_30d'])} en 30 d ({clp(d_meta.get('presupuesto_sin_retorno_dia'))}/día)", "accion": "Primera fuente de financiamiento del escalón de adquisición sin subir el gasto total (decisión de Jorge)"})
    sem = t.get("semaforo_atribucion")
    if sem == "rojo":
        al.append({"nivel": "rojo", "senal": "Atribución de cuenta en rojo", "donde": f"Meta reporta {fx(t.get('ratio_meta_vs_ga4_canal'), 1)} las compras que GA4 atribuye a Paid Social; {int(round(t.get('compras_reclamadas_plataformas') or 0))} reclamadas vs {int(round(t.get('pedidos_reales_30d') or 0))} pedidos", "accion": "Decidir por MER; público nuevo con paso máximo 15 %; públicos calientes sin subida vertical hasta medir (A/B nativo, geo-holdout)"})
    elif sem == "amarillo":
        al.append({"nivel": "amarillo", "senal": "Atribución de cuenta elevada", "donde": f"ratio Meta/GA4 {t.get('ratio_meta_vs_ga4_canal')}x · sobre-reclamo {t.get('indice_sobre_reclamo')}", "accion": "Paso máximo 20 %; vigilar el ratio en ventana de 28 días"})
    if t.get("banda_ratio_google") == "alto":
        al.append({"nivel": "amarillo", "senal": "Google Ads sobre-reporta frente a GA4", "donde": f"ratio {t.get('ratio_google_vs_ga4')}x", "accion": "Revisar acciones de conversión duplicadas y view-through; decidir con GA4"})
    tc = d_meta.get("tendencia_cuenta") or {}
    if tc.get("roas_marginal_ultimo") is not None and neg.get("roas_equilibrio") and tc["roas_marginal_ultimo"] < neg["roas_equilibrio"]:
        rm = tc["roas_marginal_ultimo"]
        al.append({"nivel": "amarillo", "senal": "ROAS marginal de la cuenta bajo el equilibrio (preventiva)", "donde": ("el valor reportado cayó mientras el gasto subía" if rm < 0 else f"último escalón: {rm}x por peso adicional") + f" · {tc.get('semanas_marginal_negativo')} semana(s) seguidas",
                   "accion": "La serie mezcla eventos y cambios diarios: no es un test limpio, pero justifica que el crecimiento de esta semana vaya a Google y a horizontal, no a vertical en Meta"})
    if m.get("mer_30d") is not None and m.get("mer_equilibrio") and m["mer_30d"] < m["mer_equilibrio"]:
        al.append({"nivel": "rojo", "senal": "MER bajo el equilibrio", "donde": f"MER {m['mer_30d']}x", "accion": "Frenar todo escalado"})
    if m.get("amer_30d") is not None and m.get("mer_objetivo") and m["amer_30d"] < m["mer_objetivo"]:
        al.append({"nivel": "amarillo", "senal": "aMER (clientes nuevos) bajo el número mágico", "donde": f"aMER {m['amer_30d']}x", "accion": "El crecimiento viene de recompra: priorizar público nuevo y adquisición en Google"})
    for e in d_google.get("entidades", []):
        if e.get("estado") == "cubrir":
            al.append({"nivel": "amarillo", "senal": "Marca pierde cuota por presupuesto", "donde": e["nombre"], "accion": f"Subir a {clp(e.get('nuevo_presupuesto'))}/día (cobertura, no escalado)"})
        if e.get("estado") in ("rojo", "amarillo", "verde_puja") and (e.get("lost_is_rank_7d") or e.get("lost_is_rank_30d") or 0) >= S["google"]["lost_is_rank_alto"]:
            al.append({"nivel": "amarillo", "senal": "Campaña limitada por ranking", "donde": e["nombre"], "accion": "Ajustar puja (bajar tROAS 10-15 % = más volumen) o calidad; no subir presupuesto [verificación manual: estrategia de puja]"})
        for a in e.get("avisos", []):
            if "marca" in a.lower() and "PMax" in a:
                al.append({"nivel": "amarillo", "senal": "PMax puede estar capturando búsquedas de marca", "donde": e["nombre"], "accion": "Confirmar exclusiones de marca antes de subir; leer el informe de términos de búsqueda de PMax"})
    if (neg.get("evento") or {}).get("activo"):
        al.append({"nivel": "amarillo", "senal": "Evento comercial activo", "donde": neg["evento"].get("nombre"), "accion": "Solo lo excelente con volumen se mueve (cadencia 48 h, tope 35 %); pruebas causales pospuestas; la semana se marca como evento en el tablero"})
    orden = {"rojo": 0, "amarillo": 1}
    al.sort(key=lambda x: orden.get(x["nivel"], 2))
    return al


def _correcciones(e):
    """Acciones que el lunes hay que ejecutar aunque no haya subida: son las que el semáforo señala como bloqueo o alerta roja."""
    out = []
    f7, ft = e.get("frecuencia_7d"), e.get("frecuencia_tope")
    if f7 is not None and ft and f7 >= ft:
        out.append(f"frecuencia 7 d {f7:.1f} sobre el tope {ft:g}: ampliar público o bajar presupuesto")
    if (e.get("historial") or {}).get("cambios_automaticos_meta"):
        out.append("una automatización de Meta mueve el presupuesto: desactivarla y fijar presupuesto manual")
    if e.get("fatiga"):
        out.append("fatiga creativa: renovar anuncios antes de subir")
    if e.get("aprendizaje") == "LEARNING_LIMITED":
        out.append("aprendizaje limitado: consolidar antes de escalar")
    return out


def calc_runbook(d_meta, d_google, neg, S, hoy):
    filas = []
    for e in d_meta.get("entidades", []):
        if not e.get("es_ventas"):
            continue
        esc = e.get("escalera") or []
        if esc:
            s = esc[0]
            filas.append({"plataforma": "Meta", "entidad": e["nombre"], "hoy": e.get("presupuesto_diario"), "nuevo": s["hasta"], "fecha": s["fecha"], "orden": s["fecha"],
                          "condicion": s["condicion"], "reversion": s["reversion"], "accion": f"subir {s['paso']*100:.0f} %"})
        elif e.get("estado") == "rojo" and e.get("presupuesto_sugerido") and e.get("presupuesto_diario") and e["presupuesto_sugerido"] < e["presupuesto_diario"]:
            filas.append({"plataforma": "Meta", "entidad": e["nombre"], "hoy": e.get("presupuesto_diario"), "nuevo": e["presupuesto_sugerido"], "fecha": hoy.isoformat(), "orden": hoy.isoformat(),
                          "condicion": (e.get("motivos") or ["bajo el equilibrio"])[-1], "reversion": "si sigue bajo el equilibrio dos semanas: pausar", "accion": "bajar"})
        elif _correcciones(e):
            filas.append({"plataforma": "Meta", "entidad": e["nombre"], "hoy": e.get("presupuesto_diario"), "nuevo": e.get("presupuesto_diario"), "fecha": hoy.isoformat(), "orden": hoy.isoformat(),
                          "condicion": " · ".join(_correcciones(e)), "reversion": "—", "accion": "corregir"})
        elif e.get("estado") in ("bloqueado", "verde_justo", "verde_mantener", "amarillo", "rojo"):
            filas.append({"plataforma": "Meta", "entidad": e["nombre"], "hoy": e.get("presupuesto_diario"), "nuevo": e.get("presupuesto_diario"), "fecha": hoy.isoformat(), "orden": "9999",
                          "condicion": e.get("etiqueta"), "reversion": "—", "accion": "mantener"})
    sin_retorno = [e for e in d_meta.get("entidades", []) if not e.get("es_ventas") and (e.get("presupuesto_diario") or 0) > 0]
    if sin_retorno:
        filas.append({"plataforma": "Meta", "entidad": f"{len(sin_retorno)} campañas de tráfico e interacción", "hoy": d_meta.get("presupuesto_sin_retorno_dia"), "nuevo": None, "fecha": hoy.isoformat(), "orden": hoy.isoformat(),
                      "condicion": f"gasto sin retorno medible ({clp(d_meta.get('gasto_sin_retorno_30d'))} en 30 d): decidir si financian el escalón de adquisición", "reversion": "—", "accion": "decidir"})
    for e in d_google.get("entidades", []):
        if not e.get("es_ventas"):
            continue
        esc = e.get("escalera") or []
        if e.get("estado") == "cubrir" and e.get("nuevo_presupuesto"):
            filas.append({"plataforma": "Google", "entidad": e["nombre"], "hoy": e.get("presupuesto_diario"), "nuevo": e["nuevo_presupuesto"], "fecha": proximo_lunes(hoy).isoformat(), "orden": proximo_lunes(hoy).isoformat(),
                          "condicion": "cobertura de cuota de marca", "reversion": "—", "accion": "cubrir"})
        elif esc:
            s = esc[0]
            filas.append({"plataforma": "Google", "entidad": e["nombre"], "hoy": e.get("presupuesto_diario"), "nuevo": s["hasta"], "fecha": s["fecha"], "orden": s["fecha"],
                          "condicion": s["condicion"], "reversion": s["reversion"], "accion": f"subir {s['paso']*100:.0f} %"})
        elif e.get("estado") in ("verde_puja", "verde_sin_techo", "amarillo", "rojo", "marca_ok"):
            filas.append({"plataforma": "Google", "entidad": e["nombre"], "hoy": e.get("presupuesto_diario"), "nuevo": e.get("presupuesto_diario"), "fecha": hoy.isoformat(), "orden": "9999",
                          "condicion": e.get("etiqueta"), "reversion": "—", "accion": "mantener"})
    filas.sort(key=lambda f: (f["orden"], f["plataforma"]))
    activas = [f for f in filas if f["accion"] != "mantener"]
    mantener = [f for f in filas if f["accion"] == "mantener"]
    out = {"filas": (activas + mantener)[:S["runbook_max_filas"]], "omitidas": max(0, len(filas) - S["runbook_max_filas"])}
    # semáforo de cuenta en una línea
    def fcorta(iso):
        d = parse_date(iso)
        return f"{d.day} {MESES_CORTOS[d.month - 1]}" if d else str(iso)
    subidas_meta = [f for f in activas if f["plataforma"] == "Meta" and f["accion"].startswith("subir")]
    corr_meta = [f for f in activas if f["plataforma"] == "Meta" and f["accion"] in ("corregir", "bajar")]
    meta_txt = ("sin subidas" if not subidas_meta else "primera subida el " + fcorta(min(f["fecha"] for f in subidas_meta))) + (f", {len(corr_meta)} corrección(es) el lunes" if corr_meta else "")
    g_act = [f for f in activas if f["plataforma"] == "Google"]
    google_txt = "sin cambios" if not g_act else "; ".join(f"{f['entidad'].split(' x ')[0]} {f['accion']} el {fcorta(f['fecha'])}" for f in g_act[:2])
    out["linea_meta"] = meta_txt
    out["linea_google"] = google_txt
    return out


def _fcorta(iso):
    d = parse_date(iso)
    return f"{d.day} {MESES_CORTOS[d.month - 1]}" if d else str(iso)


def _breve(txt, n=110):
    """Primera cláusula de un texto largo, para el calendario (el detalle completo vive en el plan de pruebas)."""
    t = (txt or "").split(";")[0].strip()
    return t if len(t) <= n else t[:n].rsplit(" ", 1)[0] + "…"


def calc_calendario(d_meta, d_google, d_atr, neg, hoy):
    semanas = []
    evento = neg.get("evento") or {}
    fi, ff = parse_date(evento.get("inicio")), parse_date(evento.get("fin") or evento.get("inicio"))
    for i in range(4):
        ini, fin = hoy + dt.timedelta(days=7 * i), hoy + dt.timedelta(days=7 * i + 6)
        acciones = []
        en_evento = bool(fi and ff and not (ff < ini or fi > fin))
        if en_evento:
            acciones.append(f"Evento {evento.get('nombre')} ({_fcorta(evento.get('inicio'))} → {_fcorta(evento.get('fin') or evento.get('inicio'))}): solo lo excelente con volumen sube (cadencia 48 h, tope 35 %); pruebas causales en pausa; semana marcada como evento")
        for e in d_meta.get("entidades", []):
            for s in e.get("escalera") or []:
                f = parse_date(s["fecha"])
                if f and ini <= f <= fin:
                    acciones.append(f"Meta · {e['nombre']}: subida {s['n']} a {clp(s['hasta'])}/día el {_fcorta(s['fecha'])}; checkpoint {_fcorta(s['checkpoint'])}, decisión {_fcorta(s['decision'])}")
        for e in d_google.get("entidades", []):
            if e.get("estado") == "cubrir" and i == 0 and e.get("nuevo_presupuesto"):
                acciones.append(f"Google · {e['nombre']}: cubrir cuota de marca, presupuesto a {clp(e['nuevo_presupuesto'])}/día el lunes")
            for s in e.get("escalera") or []:
                f = parse_date(s["fecha"])
                if f and ini <= f <= fin:
                    acciones.append(f"Google · {e['nombre']}: subida {s['n']} a {clp(s['hasta'])}/día el lunes {_fcorta(s['fecha'])}")
        for p in d_atr.get("pruebas", []):
            c = (p.get("cuando") or "").lower()
            if p.get("pendiente_requisitos"):
                continue
            if i == 0 and ("semana 1" in c or "cada subida" in c) and "geo" not in p["tipo"].lower():
                acciones.append(f"Medición · {p['tipo']}: {_breve(p['que'])}")
            elif i == 1 and "después del cierre" in c and "a/b" in p["tipo"].lower():
                acciones.append(f"Medición · {p['tipo']} (si el evento ya cerró): {_breve(p['que'])}")
            elif i == 3 and "geo" in p["tipo"].lower() and "semana 4" in c:
                acciones.append(f"Medición · {p['tipo']} (arranca al cerrar el A/B): {_breve(p['que'])}")
        acciones.append("Medición · actualizar el tablero semanal: gasto, compras, pedidos, MER, ratio Meta/GA4 (28 d), impresiones de marca en Google")
        semanas.append({"n": i + 1, "inicio": ini.isoformat(), "fin": fin.isoformat(), "evento": en_evento, "acciones": acciones})
    return semanas


# --------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------
def calcular(data, hoy=None):
    S = json.loads(json.dumps(SUPUESTOS))
    deep_merge(S, data.get("supuestos") or {})
    hoy = parse_date(hoy or data.get("fecha_corte")) or dt.date.today()
    faltantes = []
    neg = calc_negocio(data.get("negocio") or {}, S, faltantes, hoy)
    d_ga4 = calc_ga4(data.get("ga4") or {}, S, faltantes)
    d_meta_pre = calc_meta(data.get("meta") or {}, neg, S, hoy, {}, [])
    d_google = calc_google(data.get("google") or {}, neg, S, hoy, faltantes)
    d_atr = calc_atribucion(data, d_meta_pre, d_google, d_ga4, neg, S, faltantes)
    tc = d_meta_pre.get("tendencia_cuenta") or {}
    ctx = {"semaforo_atribucion": d_atr["triangulacion"].get("semaforo_atribucion"), "cotas_etapa": d_atr.get("cotas_etapa") or {},
           "estudio_activo": d_atr["lift"].get("estudio_activo"),
           "marginal_bajo_equilibrio": bool(tc.get("roas_marginal_ultimo") is not None and neg.get("roas_equilibrio") and tc["roas_marginal_ultimo"] < neg["roas_equilibrio"])}
    d_meta = calc_meta(data.get("meta") or {}, neg, S, hoy, ctx, faltantes)
    d_atr = calc_atribucion(data, d_meta, d_google, d_ga4, neg, S, [])
    alertas = calc_alertas(d_meta, d_google, d_atr, neg, S)
    runbook = calc_runbook(d_meta, d_google, neg, S, hoy)
    calendario = calc_calendario(d_meta, d_google, d_atr, neg, hoy)
    t = d_atr["triangulacion"]
    resumen = {
        "presupuesto_ventas_meta_hoy": d_meta.get("presupuesto_ventas_dia_hoy"),
        "presupuesto_meta_tras_subida_1": (d_meta.get("proyeccion_presupuesto") or [{}])[0].get("presupuesto_ventas_dia"),
        "presupuesto_google_hoy": d_google.get("presupuesto_dia_hoy"), "presupuesto_google_tras_subida_1": d_google.get("presupuesto_dia_tras_subida_1"),
        "mer_30d": d_atr["mer"].get("mer_30d"), "amer_30d": d_atr["mer"].get("amer_30d"),
        "ratio_meta_ga4": t.get("ratio_meta_vs_ga4_canal"), "indice_sobre_reclamo": t.get("indice_sobre_reclamo"), "semaforo_atribucion": t.get("semaforo_atribucion"),
        "entidades_meta_por_estado": {}, "alertas_rojas": sum(1 for a in alertas if a["nivel"] == "rojo"),
        "linea": f"Meta: {runbook['linea_meta']} · Google: {runbook['linea_google']} · Atribución: {t.get('semaforo_atribucion') or 'sin datos'}" + (f" (ratio {fx(t.get('ratio_meta_vs_ga4_canal'))}, sobre-reclamo {t.get('indice_sobre_reclamo')})" if t.get('ratio_meta_vs_ga4_canal') is not None else "") + (f" · MER {fx(d_atr['mer'].get('mer_30d'))}" if d_atr['mer'].get('mer_30d') is not None else " · MER sin datos"),
    }
    for e in d_meta.get("entidades", []):
        resumen["entidades_meta_por_estado"][e.get("estado")] = resumen["entidades_meta_por_estado"].get(e.get("estado"), 0) + 1
    out = dict(data)
    out["derivado"] = {"hoy": hoy.isoformat(), "supuestos": S, "negocio": neg, "meta": d_meta, "google": d_google, "ga4": d_ga4, "atribucion": d_atr,
                       "alertas": alertas, "runbook": runbook, "calendario": calendario, "resumen": resumen, "faltantes": sorted(set(faltantes))}
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    hoy = None
    for i, a in enumerate(sys.argv):
        if a == "--hoy" and i + 1 < len(sys.argv):
            hoy = sys.argv[i + 1]
    if len(args) < 2:
        print(__doc__)
        sys.exit(1)
    with open(args[0], encoding="utf-8") as f:
        data = json.load(f)
    if hoy and parse_date(hoy) is None:
        print(f"--hoy '{hoy}' no es una fecha válida: usar AAAA-MM-DD")
        sys.exit(2)
    out = calcular(data, hoy)
    with open(args[1], "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    d = out["derivado"]
    print(f"OK → {args[1]}")
    print(d["resumen"]["linea"])
    for e in d["meta"].get("entidades", []):
        print(f"  Meta   {e['estado']:<16} paso {e.get('paso', 0) or 0:>4.0%}  {e['nombre']}")
    for e in d["google"].get("entidades", []):
        print(f"  Google {e['estado']:<16} paso {e.get('paso', 0) or 0:>4.0%}  {e['nombre']}")
    c = d["atribucion"].get("cotas_etapa") or {}
    for k in ("TOFU", "CALIENTE", "CUENTA"):
        if c.get(k):
            x = c[k]; print(f"  Cotas {k:<9} reportado {x['roas_reportado']}x · piso {x['piso']}x · central {x['central']}x · techo {x['techo']}x · IA {x['ia']} ({x['confianza']})")
    print(f"Alertas: {len(d['alertas'])} · runbook: {len(d['runbook']['filas'])} filas · faltantes: {len(d['faltantes'])}")
    for x in d["faltantes"]:
        print("  -", x)


if __name__ == "__main__":
    main()
