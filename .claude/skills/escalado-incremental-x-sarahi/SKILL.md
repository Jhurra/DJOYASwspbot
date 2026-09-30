---
name: escalado-incremental-x-sarahi
description: "Plan de Escalado de UN cliente (Meta Ads + Google Ads) con metodología SARAHI x Felipe Vergara y atribución incremental: cuánto subir el presupuesto, cuándo, con qué checkpoint y reversión, y cuánto de lo que reportan las plataformas es venta real. Lee en vivo el MCP de Meta y AgencyAnalytics (Google Ads con cuota de impresiones perdida; GA4 por canal), triangula Meta vs Google vs GA4 vs pedidos (MER, sobreatribución, cotas piso/techo del ROAS incremental, ROAS marginal) y entrega un HTML SARAHI con runbook del lunes, semáforo por conjunto, escalera de subidas, plan horizontal, calendario, pruebas de incrementalidad y tablero semanal. Úsalo SIEMPRE que Jorge diga escalar, plan de escalado, subir presupuesto, cuánto subo, escalado vertical u horizontal, atribución incremental, ROAS inflado, MER, ROAS marginal, retornos decrecientes, escalar Google Ads o cuota de impresiones perdida. NO es la optimización semanal (optimizacion-meta / opti-google-ads), ni evaluacion-ads, ni auditoria-pixel, ni el brief."
---

# Plan de Escalado con atribución incremental x SARAHI

Versión SARAHI de la skill "Escalar Campañas" de Felipe Vergara, con tres capas que la original no tiene: **Google Ads** entra al plan con sus propias reglas, **GA4 y los pedidos reales** cierran el semáforo financiero, y la **atribución incremental** decide cuánto del ROAS reportado se puede escalar de verdad. El flujo sigue siendo el que a Jorge le gusta: pide un plan, la skill lee las fuentes, calcula, y entrega un HTML listo para el cliente.

La skill trabaja como un media buyer senior que además sabe medición: no escala sobre el ROAS de la plataforma a secas, porque en cuentas con recompra (DJOYAS, por ejemplo) Meta reclama más compras que las que GA4 y la tienda pueden confirmar. Escala sobre tres números a la vez: el ROAS de plataforma contra el número mágico, el MER de la cuenta, y el ratio entre lo que Meta reporta y lo que GA4 atribuye. Y mide, semana a semana, cómo se mueven esos tres números al subir presupuesto.

---

## Identidad SARAHI

- **Título del HTML**: `Plan de Escalado de [Marca] x SARAHI`
- **Firma al pie**: `Plan de Escalado Meta + Google x SARAHI · Metodología SARAHI x Felipe Vergara · El plan propone; tú decides · www.sarahiagency.com · Madrid · Santiago`
- **Archivo**: `plan-escalado-[marca]-AAAA-MM-DD.html`, en el directorio de trabajo (o `/mnt/user-data/outputs/` cuando exista)
- **Diseño**: DM Sans; charcoal `#323232`, orange `#f2692d`, periwinkle `#8088e6`, lime `#e0fb9b`, cream `#fcf2e3`, gray `#f5f5f5`; éxito `#3f9d5a`, peligro `#d6453c`. Números primero, etiqueta después. Sin emoji: el semáforo es un punto de color con texto. Cards con radio 24, tiles de color plano.
- **Voz**: español neutro, "nosotros / te", sin humo. Las recomendaciones se proponen; Jorge y el cliente deciden.

Todo eso ya está en `scripts/render_plan.py`: la skill no escribe HTML a mano.

---

## Principio rector: tres números, no uno

> "Un ROAS de 45x en retargeting a clientes que igual iban a recomprar no es una máquina de hacer dinero: es una máquina de reportar dinero."

1. **ROAS de plataforma vs número mágico** (Felipe Vergara): sin colchón sobre el objetivo no se escala, y la frecuencia por fase marca el tope.
2. **MER y aMER** (ingresos totales e ingresos de clientes nuevos sobre la inversión total): el negocio completo tiene que cubrir la pauta, y el crecimiento tiene que venir de clientes nuevos.
3. **Atribución** (compras que Meta reporta / compras que GA4 atribuye a Paid Social, índice de sobre-reclamo contra los pedidos reales, cotas piso/techo del ROAS incremental): cuando el ratio sube al escalar, el escalón compra atribución, no ventas.

Regla única de subida: **el colchón fija el tamaño del paso, el aprendizaje fija el reloj, y la atribución de cuenta pone el tope.** El semáforo de cada conjunto sale de `scripts/calc_escalado.py`; la skill no estima a ojo ni redondea a favor. Si un dato falta, la sección lo dice.

---

## Flujo de trabajo

Cinco etapas. Si Jorge ya entregó los números del negocio y las fuentes responden, se corre de punta a punta sin detenerse; solo se pregunta cuando falta algo que ninguna fuente puede saber, y solo se pide confirmación para acciones de escritura.

### Etapa 0 · Cliente, cuenta y lo que solo Jorge sabe

1. Identificar la marca. Cargar `references/fuentes-de-datos.md` (obligatorio antes de la primera consulta: nombres exactos de campos y trampas conocidas).
2. `Meta:ads_get_ad_accounts` → cuenta con `is_queryable: true` y `account_status: ACTIVE` cuyo nombre coincida (las cuentas "OFF" cerradas fallan). `AgencyAnalytics:search_clients` → `clientId` y providers.
3. Un solo mensaje a Jorge, con defaults visibles cuando existan en el proyecto; "ok" acepta los defaults:

> Para el plan de escalado de **[Marca]** necesito seis cosas que no salen de las plataformas (responde "ok" para usar los valores que ya tengo):
> 1. **Margen bruto** y **ticket promedio** (o directamente el ROAS de equilibrio y el número mágico que usan hoy). Default: [valor del proyecto].
> 2. **Pedidos e ingresos reales de los últimos 30 días** según el backend, si se puede por semana y con % de clientes nuevos. Sin esto, GA4 hace de verdad provisional.
> 3. **Fechas de eventos comerciales** en las próximas 4 semanas (Cyber, Black, Navidad): cambian la cadencia y protegen las pruebas.
> 4. ¿Los anuncios de Meta llevan **utm_campaign** con el nombre de campaña? ¿PMax tiene **exclusiones de marca**? ¿Hay **CAPI** con email y teléfono?
> 5. ¿Exportaron la **comparación de ventanas de atribución** o tienen un conjunto con **atribución incremental** activa?
> 6. ¿Autorizas que el plan **proponga pruebas causales** (A/B nativo, geo-holdout)? Ninguna se crea sin tu confirmación posterior.

Si Jorge no responde, continuar con GA4 como verdad de pedidos y con el número mágico del plan vigente; cada hueco va a la sección de límites del HTML. La estrategia de puja de Google solo se pregunta cuando el plan propone tocar tROAS.

### Etapa 1 · Lectura de Meta (MCP)

Todas las llamadas llevan `client_conversation_id` (20 caracteres, el mismo toda la conversación), `client_model` y `advertiser_request` con las palabras de Jorge. Ventanas: `last_7d` y `last_30d` (la serie semanal de cuenta usa `last_90d`).

1. `ads_get_ad_entities` nivel **adset**, 7 d y 30 d, filtro `adset.effective_status IN ["ACTIVE"]`, campos: `id, name, effective_status, daily_budget, optimization_goal, attribution_setting, learning_stage_info, amount_spent, impressions, reach, frequency, cpm, ctr, omni_landing_page_view, omni_add_to_cart, omni_initiated_checkout, omni_purchase, offsite_conversion_fb_pixel_purchase_values, cost_per_omni_purchase, purchase_roas`.
2. `ads_get_ad_entities` nivel **campaign**, 7 d y 30 d, campos `id, name, effective_status, objective, daily_budget, lifetime_budget, bid_strategy, amount_spent, impressions, reach, frequency, cpm, ctr, omni_landing_page_view, omni_add_to_cart, omni_initiated_checkout, omni_purchase, offsite_conversion_fb_pixel_purchase_values, cost_per_omni_purchase, purchase_roas` (aquí vive el presupuesto de las CBO; `optimization_goal`, `attribution_setting` y `learning_stage_info` solo existen a nivel adset y el tool los rechaza).
3. `ads_get_ad_entities` nivel **ad_account**, `date_preset: last_90d`, `time_increment: "7"` → serie semanal de `amount_spent, reach, frequency, link_click, omni_purchase, offsite_conversion_fb_pixel_purchase_values, purchase_roas`. Base del ROAS marginal.
4. `ads_account_get_activity_logs` con `event_category: "budget"`, `start_time` = hoy − 45 días → cada cambio de presupuesto con fecha, valor anterior y nuevo, y actor. De aquí salen "días desde la última subida", el ritmo real de subidas (más de 2 en 14 días congela) y si una automatización mueve el presupuesto.
5. `ads_experiment_list_tests` y `ads_experiment_check_eligibility` con `ad_account_id: "act_<id>"` → estudios de lift previos o activos y elegibilidad para Conversion Lift (se cita literal). Si el plan va a proponer un A/B nativo, repetir `ads_experiment_check_eligibility` con `ad_entity_ids: ["<adset estándar>", "<adset incremental>"]`: sin dos entidades el tool salta la elegibilidad del split test.
6. Opcional: `ads_get_datasets` + `ads_get_dataset_quality` (EMQ) cuando se vaya a recomendar lift o atribución incremental.

Si `ads_get_ad_entities` devuelve `next_actions`, agotar las acciones de solo lectura antes de seguir. Si el MCP de Meta no responde, usar el fallback de AgencyAnalytics (`facebook-ads / ad-analytics`) y declarar que aprendizaje, atribución en uso e historial de presupuesto quedan en verificación manual; sin esas fuentes el semáforo no puede dar verde excelente.

**Qué entidad entra al plan:** la que tiene el presupuesto. En campañas CBO es la campaña; en ABO es cada conjunto. Las campañas de interacción, tráfico o mensajes sin valor de compra van con `es_ventas: false`: su gasto cuenta en el MER y aparece como "gasto sin retorno medible", primera fuente de financiamiento de un escalón sin subir el gasto total.

### Etapa 2 · Lectura de Google Ads y GA4 (AgencyAnalytics)

1. `browse_client_data_sources(clientId, message, requireDateRange: true)` → `integration_campaign_id` de Google Ads y de GA4.
2. **Google Ads** por campaña, 30 d y 7 d: `read_client_data_source` con provider `googleadwords`, asset `ad-analytics`, `groupBy: ["campaign"]`, campos `campaign, campaign_type, budget, cost, impressions, clicks, ctr, avg_cpc, conversions, conversion_value, conv_value_per_cost, cost_per_conv, view_through_conv, conversions_by_conv_date, search_impr_share, search_budget_lost_impression_share, search_rank_lost_impression_share`. Opcional: `groupBy: ["date"]` para la serie semanal.
3. **GA4** por canal, 30 d y 7 d: provider `google-analytics4`, asset `ecommerce-analytics`, `groupBy: ["channel"]`, campos `channel, sessions, total_users, new_users, engagement_rate, session_conversion_rate, transactions, ecommerce_purchases, purchase_revenue, average_purchase_revenue, first_time_purchasers, total_purchasers, add_to_carts, checkouts`.
4. **GA4** por source/medium, 30 d: asset `conversion-analytics`, `groupBy: ["source_medium"]`, campos `source_medium, sessions, new_users, transactions, purchase_revenue, first_time_purchasers, total_purchasers`. De aquí salen las compras y compradores nuevos de `ig / paid`, `fb / paid`, `an / paid` (Meta según GA4) y `google / cpc`.
5. Recomendado para el tablero: GA4 por canal en cada una de las últimas 4 semanas (una llamada por semana, mismas fechas que la serie de Meta).

Gates de calidad (el script también los detecta): `engagement_rate` > 95 % o `session_conversion_rate` > 50 % en todos los canales → GA4 tiene un evento de conversión mal marcado; se usan transacciones e ingresos, nunca `conversions`. Campañas de Google cuya conversión no es una venta (visitas a tienda, llamadas) se marcan `es_ventas: false`.


Serie semanal de Google (`google.semanas`): una consulta por semana con `groupBy: ["campaign"]` y `start_date`/`end_date` de lunes a domingo, sumando solo las campañas de venta (las de visitas a tienda, llamadas o WhatsApp quedan fuera, como en el ROAS). Así el tablero compara conversiones de venta con conversiones de venta.

### Etapa 3 · Cálculo determinista

1. Escribir `data-[marca]-AAAA-MM-DD.json` con el esquema de abajo. Usar los nombres de campo tal cual; lo que no exista queda en `null`, no se inventa. Si existe `tablero-[marca].json` de corridas anteriores, copiar sus filas en `historial_tablero`.
2. Ejecutar:

```
python scripts/calc_escalado.py data-[marca]-AAAA-MM-DD.json calc-[marca]-AAAA-MM-DD.json --hoy AAAA-MM-DD
```

3. Leer `derivado` en la salida: `runbook` (qué se toca esta semana y la línea de cuenta), `meta.entidades` (semáforo, caps, bloqueos y escalera por conjunto), `google.entidades`, `ga4`, `atribucion` (triangulación, semáforo de atribución, cotas por etapa, plan de pruebas, tablero), `alertas`, `calendario`, `faltantes`.
4. Guardar `derivado.atribucion.tablero_semanal.filas` en `tablero-[marca].json` para la próxima corrida.

Las reglas están en `references/umbrales-y-semaforo.md` (umbrales y estados), `references/reglas-escalado-meta.md` y `references/reglas-escalado-google.md` (el porqué). Si un umbral no aplica al cliente, se ajusta en el bloque `supuestos` del JSON y se declara.

### Etapa 4 · Narrativa

Con la salida del cálculo a la vista, escribir `narrativa-[marca]-AAAA-MM-DD.json` (esquema abajo). Es la parte que un script no puede hacer: el veredicto, las decisiones de la semana, la lectura de cada sección, el plan horizontal y el "cómo se mueve" de la atribución. Reglas de redacción:

- Cada afirmación lleva su número y su fuente ("Meta reporta 352 compras en 30 días; GA4 atribuye 63 a Paid Social").
- Diagnóstico sólido con seguridad; hipótesis marcada como hipótesis. Nunca atribuir causa sin evidencia.
- Las decisiones son verificables: "genérica de $18.000 a $21.600 el lunes 5; checkpoint el 11", no "considerar subir".
- El plan horizontal se apoya en lo que la cuenta ya probó (ángulos ganadores, públicos que rinden, campañas de Google con cuota perdida) y en las cuatro formas de Felipe (`references/reglas-escalado-meta.md`) más las palancas de Google (`references/reglas-escalado-google.md`). Producción creativa: derivar al 50/25/25 de `evaluacion-ads-meta-sarahi`.
- "Cómo se mueve": qué se espera del ratio Meta/GA4 y del MER marginal en cada escalón y qué lectura dispara la reversión. Cargar `references/atribucion-incremental.md`.
- Límites: lo que no se pudo leer, los supuestos calibrables y lo que requiere verificación manual.

### Etapa 5 · HTML, chat y confirmación

```
python scripts/render_plan.py calc-[marca]-AAAA-MM-DD.json plan-escalado-[marca]-AAAA-MM-DD.html --narrativa narrativa-[marca]-AAAA-MM-DD.json
```

Si hay Chromium disponible, capturar el HTML para verificar que las tablas caben y que no hay secciones vacías. En el chat, corto: la línea de cuenta del runbook, las decisiones de la semana, las alertas rojas y lo que quedó pendiente de Jorge. Cualquier acción de escritura se lista como propuesta con casilla, nunca se ejecuta:

> Propuesta que requiere tu confirmación (no ejecuto nada sin tu ok):
> - [ ] Subir presupuesto de <entidad> de <P0> a <P1> (+<p> %) el <fecha>; checkpoint <fecha + 72 h>; reversión a <P0> si <condición>.
> - [ ] Crear A/B en <campaña>: <conjunto> estándar vs <conjunto>b con atribución incremental, <presupuesto> por brazo, <n> días desde <fecha>.
> - [ ] Excluir regiones <lista> de <conjuntos MOFU + BOFU> por 28 días (geo-holdout, efecto mínimo detectable <x> %, costo peor caso <CLP>).
> - [ ] Desactivar aumentos automáticos de presupuesto en <campaña> y fijar <CLP>/día.
> - [ ] Pausar <entidades sin retorno medible> (<CLP>/30 d, <n> compras).

Cerrar con: "¿Quieres también la versión PDF y un resumen corto para el cliente (WhatsApp o email)?" PDF: `chromium --headless --print-to-pdf` sobre el HTML, o Playwright; si no hay ninguno, indicar Imprimir → Guardar como PDF.

---

## Módulo de atribución incremental (resumen operativo)

El detalle está en `references/atribucion-incremental.md`. Lo que la skill hace en cada corrida:

**Nivel 1 · Triangulación y cotas (siempre).** Compras y valor que reporta Meta vs lo que GA4 atribuye a Paid Social (canal y UTM) vs pedidos reales; lo mismo para Google contra `google / cpc`. Índice de sobre-reclamo = (compras Meta + conversiones Google) / pedidos reales: sobre 1, ninguna plataforma es verdad y decide el MER. Semáforo de atribución de cuenta (ratio > 4 o sobre-reclamo > 1 = rojo). ROAS de Meta acotado: piso (ingresos Paid Social GA4 / gasto), techo (compras × factor de deduplicación × ticket / gasto), central (media geométrica) e índice de incertidumbre; por etapa con una partición supuesta (compradores nuevos → público nuevo, recurrentes → públicos calientes) hasta tener UTM por campaña.

**Nivel 2 · Atribución nativa comparada.** Comparación de ventanas (1 d clic / 7 d clic / 1 d vista / 28 d clic) exportada de Ads Manager. A/B nativo: duplicar el conjunto caliente de mayor volumen con la configuración de atribución "incremental" de Meta, mismo presupuesto por brazo, 14-28 días; `factor = ROAS incremental / ROAS estándar`. El MCP no expone ninguna de las dos lecturas: se cargan a mano en el JSON.

**Nivel 3 · Prueba causal.** Conversion Lift vía `ads_experiment_lift_create_test` si `check_eligibility` lo permite (se cita literal) y Jorge lo confirma; si no, geo-holdout de MOFU + BOFU juntos 4 semanas con regiones elegidas desde GA4 y efecto mínimo detectable declarado. El apagado controlado de un solo conjunto no mide nada (ruido semanal ≈ √pedidos): solo MOFU + BOFU juntos, 14 días, como último recurso. Una prueba causal a la vez; ninguna durante un evento.

**Cómo se mueve.** En cada escalón: ROAS marginal de Meta, MER marginal (Δingresos reales / Δgasto total, dos semanas completas) y ratio Meta/GA4 en 28 días. Se sigue mientras el MER marginal supere el equilibrio y el ratio no crezca con el gasto más allá de su ruido; si el ROAS de plataforma sigue verde pero el MER marginal cae bajo el equilibrio dos semanas seguidas, el escalón se revierte. La serie histórica solo genera alerta preventiva.

---

## Semáforo y paso de subida (Meta)

| Estado | Condición resumida | Paso |
|---|---|---|
| Verde excelente | colchón ≥ 47 % sobre el número mágico, ≥ 25 compras en 7 d, sin caps | +35 % cada 5 días |
| Verde | paso base 20 % o un cap desde excelente | +20 % |
| Verde · paso corto | colchón 25-27 % o dos caps | +15 % |
| Verde · mantener | colchón < 25 % (verde justo), o los caps y el tope de atribución dejan 0 % | 0 %: horizontal |
| Esperar | verde con reloj pendiente (5 días, 7 en aprendizaje, congelamiento por ritmo) | escalera programada |
| No subir | frecuencia en el tope, fatiga, aprendizaje limitado, automatización, lift activo, evento | ampliar público / esperar |
| Amarillo | bajo el número mágico en 7 d o 30 d | optimizar |
| Rojo | bajo el equilibrio | volver al presupuesto previo o bajar 20 % |

Caps (un escalón menos cada uno): CPA sobre el máximo, < 25 compras con paso ≥ 30 %, ROAS 7 d cae > 20 % vs 30 d, frecuencia en aviso, frecuencia 30 d en el tope, aprendizaje, ROAS marginal de cuenta bajo el equilibrio, central de la etapa bajo el número mágico. Tope por atribución de cuenta: amarillo ≤ 20 %; rojo ≤ 15 % en público nuevo y 0 % en públicos calientes (≤ 15 % solo si su piso pesimista, GA4 último clic, supera el número mágico) hasta tener factor medido; sin GA4 ni pedidos, ≤ 15 % para todos. Google: +20 % con cuota perdida por presupuesto ≥ 20 % y ROAS 30 d sobre objetivo, un cambio por semana los lunes; limitada por ranking → puja, no presupuesto; marca se cubre, no se escala. Umbrales completos en `references/umbrales-y-semaforo.md`.

---

## Esquema del JSON de entrada

Campos monetarios en la moneda de la cuenta (número, sin formato). Porcentajes de Google como vienen (0-100). Cualquier campo puede ser `null`.

```json
{
  "fecha_corte": "AAAA-MM-DD",
  "cliente": {"nombre": "", "sitio": "", "plataforma": "", "pais": "", "moneda": "CLP"},
  "periodos": {"m30": {"inicio": "", "fin": ""}, "m7": {"inicio": "", "fin": ""}},
  "fuentes": ["Meta MCP (cuenta …)", "AgencyAnalytics · Google Ads (integración …)", "AgencyAnalytics · GA4 (integración …)"],
  "negocio": {
    "ticket_promedio": 0, "margen_bruto": 0.45, "roas_equilibrio": null, "numero_magico": null, "ciclo_recompra_dias": null,
    "backend": {"pedidos_30d": null, "ingresos_30d": null, "ingresos_nuevos_30d": null, "nota": ""},
    "fecha_especial": {"nombre": "", "inicio": null, "fin": null}
  },
  "supuestos": {},
  "meta": {
    "ad_account_id": "",
    "entidades": [{
      "id": "", "nombre": "", "campana": "", "etapa": "TOFU|MOFU|BOFU|EVENTO", "nivel_presupuesto": "campaign|adset",
      "presupuesto_diario": 0, "es_ventas": true, "optimization_goal": "", "attribution_setting": "",
      "learning": {"status": "LEARNING|SUCCESS|FAIL (= aprendizaje limitado)|WAIVING|null", "conversions": null, "last_sig_edit_ts": null},
      "m7":  {"gasto": 0, "impresiones": 0, "alcance": 0, "frecuencia": 0, "cpm": 0, "ctr": null, "lpv": 0, "atc": 0, "ic": 0, "compras": 0, "valor": 0, "cpa": 0, "roas": 0},
      "m30": {"…": "mismos campos"},
      "cambios_presupuesto": [{"fecha": "AAAA-MM-DD", "de": 0, "a": 0, "actor": ""}],
      "ventanas": {"1d_click": {"compras": null, "valor": null}, "7d_click": {}, "1d_view": {}, "28d_click": {}},
      "incremental": {"factor_medido": null, "fuente": "", "fecha": "AAAA-MM-DD"}
    }],
    "cuenta": {"m30": {"gasto": 0, "compras": 0, "valor": 0, "roas": 0}, "m7": {}, "semanas": [{"inicio": "", "fin": "", "dias": 7, "parcial": false, "evento": false, "gasto": 0, "alcance": 0, "frecuencia": 0, "compras": 0, "valor": 0}]},
    "experimentos": {"activos": 0, "lift_elegible": null, "requisitos_faltantes": [], "estudios": [{"nombre": "", "tipo": "", "periodo": "", "holdout": "", "resultado": ""}], "estudios_finalizados_conversion_lift": []},
    "datasets": [{"id": "", "nombre": "", "web_ultimo_evento": "", "servidor_ultimo_evento": ""}],
    "ventanas_disponibles": false
  },
  "google": {
    "integration_campaign_id": 0,
    "campanas": [{"nombre": "", "tipo": "search|performance_max|shopping|display|video|demand_gen", "es_marca": null, "es_ventas": null, "presupuesto_diario": 0,
                  "m30": {"costo": 0, "impresiones": 0, "clics": 0, "ctr": 0, "cpc": 0, "conv": 0, "valor": 0, "roas": 0, "cpa": 0, "is": 0, "lost_is_budget": 0, "lost_is_rank": 0, "view_through": 0},
                  "m7": {"…": "mismos campos"}}],
    "totales": {"m30": {}, "m7": {}},
    "semanas": [{"inicio": "", "fin": "", "gasto": 0, "conv": 0, "valor": 0}]
  },
  "ga4": {
    "integration_campaign_id": 0,
    "canales": [{"canal": "Paid Social", "m30": {"sesiones": 0, "usuarios": 0, "nuevos": 0, "engagement_rate": 0, "session_cvr": 0, "compras": 0, "ingresos": 0, "compradores_nuevos": null, "compradores": null, "atc": 0, "checkouts": 0}, "m7": {}}],
    "totales": {"m30": {"sesiones": 0, "usuarios": 0, "nuevos": 0, "compras": 0, "ingresos": 0, "compradores_nuevos": 0, "compradores": 0}, "m7": {}},
    "source_medium": [{"sm": "ig / paid", "m30": {"sesiones": 0, "nuevos": 0, "compras": 0, "ingresos": 0, "compradores_nuevos": 0, "compradores": 0}, "m7": {}}],
    "semanas": [{"inicio": "", "fin": "", "sesiones": 0, "compras": 0, "ingresos": 0, "compras_paid_social": 0, "ingresos_paid_social": 0, "compras_paid_search": 0}],
    "alertas_calidad": []
  },
  "historial_tablero": []
}
```

Campos de diagnóstico que se guardan para la narrativa pero no entran al cálculo: `impresiones, alcance, cpm, lpv, atc, ic, cpa` de Meta, `view_through` de Google, `datasets` y `cliente.sitio/plataforma`. `ventanas` sí entra: la fracción 1 d clic / 7 d clic hace de piso alternativo del ROAS incremental cuando no hay GA4. `incremental.factor_medido` vale 90 días desde `fecha`; vencido, el script vuelve a las cotas y lo avisa.

Ejemplo completo con datos reales: `examples/data-djoyas.json`.

## Esquema de `narrativa.json`

```json
{
  "resumen": {"veredicto": "3-5 frases", "decisiones": ["4 a 8 decisiones verificables con cifra y fecha"]},
  "meta": {"lectura": ""}, "google": {"lectura": ""}, "ga4": {"lectura": ""},
  "atribucion": {"lectura": "", "como_se_mueve": ""},
  "notas_entidades": {"<id o nombre del conjunto>": "nota específica"},
  "horizontal": {"anuncios": [], "conjuntos": [], "campanas": [], "google": [], "canales": [], "lectura": ""},
  "proximos_pasos": [], "limites": []
}
```

Ejemplo: `examples/narrativa-djoyas.json`.

---

## Reglas críticas

1. **Cero invención.** Si una fuente no responde, la sección dice "sin datos" y el hueco va a límites. La elegibilidad de lift se cita literal. Este plan mueve presupuesto real.
2. **La escalera respeta el historial.** Los días desde la última subida se leen del activity log, no se preguntan. Más de 2 subidas en 14 días congela 7 días: con cambios diarios no hay ROAS legible por nivel.
3. **No cambiar de nivel** (CBO sigue CBO, ABO sigue ABO) ni subir dos palancas a la vez en Google (presupuesto y tROAS). Un cambio por campaña por semana en Google, siempre lunes.
4. **El ROAS de plataforma no decide solo.** Con atribución de cuenta en rojo, los públicos calientes no reciben subida vertical hasta tener un factor medido, salvo que su piso pesimista (GA4 último clic) ya supere el número mágico: entonces, paso corto de 15 % como máximo. Un índice de sobre-reclamo sobre 1 se decide con MER.
5. **Los supuestos no mueven presupuesto.** Las cotas salen de datos (GA4, pedidos, deduplicación); las bandas y umbrales son calibrables y se declaran. Nunca un prior sin fuente en el gate principal.
6. **La marca en Google se cubre, no se escala.** Su ROAS no justifica adquisición; su tendencia es termómetro de Meta, informativo, nunca gate.
7. **Lo que escala de verdad es horizontal.** Todo plan vertical lleva su plan horizontal al lado; si lo vertical se frena, lo horizontal ya está construido.
8. **Evento comercial confirmado** = cadencia de 48 h y tope 35 % solo para lo excelente con volumen; el resto congelado; pruebas causales pospuestas; la semana se marca como evento en el tablero.
9. **Human in the loop.** La skill no crea, pausa ni edita campañas, presupuestos ni estudios. Cada escritura es una casilla que Jorge confirma. Con lift activo no se toca nada del estudio.
10. **Español, moneda del cliente en formato local, sin emoji.** En el chat, respuestas cortas: el análisis vive en el HTML.

---

## Cuándo cargar las referencias

- `references/fuentes-de-datos.md` — SIEMPRE antes de la primera consulta (campos exactos, trampas, fallbacks, persistencia del tablero).
- `references/umbrales-y-semaforo.md` — al leer la salida del cálculo o cuando Jorge pregunte por qué un conjunto quedó en un estado.
- `references/reglas-escalado-meta.md` — al escribir el plan vertical y horizontal de Meta (metodología FV conciliada con SARAHI).
- `references/reglas-escalado-google.md` — cuando la cuenta tiene Google Ads (semáforo por tipo de campaña, canibalización, puja, brand search como termómetro).
- `references/atribucion-incremental.md` — al escribir la sección de atribución, el plan de pruebas y "cómo se mueve".

## Estructura de archivos

```
escalado-incremental-x-sarahi/
├── SKILL.md
├── references/
│   ├── fuentes-de-datos.md          — consultas exactas Meta MCP / AgencyAnalytics, trampas, fallbacks
│   ├── umbrales-y-semaforo.md       — todos los umbrales del script, estados, caps y bloqueos
│   ├── reglas-escalado-meta.md      — marco Felipe Vergara conciliado con SARAHI
│   ├── reglas-escalado-google.md    — reglas por tipo de campaña de Google
│   └── atribucion-incremental.md    — triangulación, cotas, pruebas y "cómo se mueve"
├── scripts/
│   ├── calc_escalado.py             — JSON de datos → JSON con runbook, semáforos, escaleras, cotas, MER, alertas
│   └── render_plan.py               — JSON calculado (+ narrativa) → HTML SARAHI
├── assets/
│   └── logo-sarahi.png
└── examples/
    ├── data-djoyas.json             — entrada real (DJOYAS, 30/09/2026)
    ├── narrativa-djoyas.json        — narrativa de ese plan
    ├── calc-djoyas.json             — salida del cálculo (para leer la estructura sin correr nada)
    └── plan-escalado-djoyas-2026-09-30.html — salida de ejemplo
```

## Cómo se conecta con el resto del sistema

- **Antes**: `auditoria-pixel-meta-x-sarahi` (sin medición sana no hay escalado serio; también es el camino a la elegibilidad de lift) y `optimizacion-meta-sarahi` / `opti-google-ads-x-sarahi` (la cuenta se optimiza antes de escalarse).
- **Al lado**: `evaluacion-ads-meta-sarahi` produce los anuncios del plan horizontal (50/25/25).
- **Después**: el brief matutino vigila los checkpoints; cada semana se actualiza el tablero y se vuelve a correr esta skill sobre la ventana nueva.
