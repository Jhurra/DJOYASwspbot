# Umbrales y semáforo de escalado

Todo lo que `scripts/calc_escalado.py` decide, con el porqué. Los valores viven en el diccionario `SUPUESTOS` del script y se pueden sobreescribir por cliente desde el bloque `supuestos` del JSON de entrada. Cambiar un umbral es una decisión de metodología: si se ajusta para un cliente, queda escrito en el JSON y en la sección de límites del HTML.

Regla única que resume todo: **el colchón fija el tamaño del paso, el aprendizaje fija el reloj, y la atribución de cuenta pone el tope.**

## 1. Números del negocio

| Cálculo | Fórmula | Nota |
|---|---|---|
| ROAS de equilibrio | 1 / margen bruto | la pauta ni gana ni pierde |
| Número mágico (ROAS objetivo) | el del cliente; si no lo tiene, equilibrio × 1,25 | colchón mínimo SARAHI |
| CPA máximo | ticket × margen bruto | |
| CPA objetivo | CPA máximo × 0,7 | 30 % de colchón para escalar |
| Colchón | ROAS 7 d / número mágico − 1 | la variable que fija el paso |

## 2. Semáforo de un conjunto o campaña de Meta

Ventana de **7 días** para decidir (velocidad), **30 días** para confirmar (tendencia). El orden importa: cada paso puede cerrar la evaluación.

| Paso | Condición | Resultado |
|---|---|---|
| 0 | Sin ROAS (interacción, tráfico, mensajes sin valor de compra) | `fuera` · el gasto cuenta en el MER y se lista como "gasto sin retorno medible" |
| 1 | < 10 compras en 7 d **y** < 20 en 30 d | `sin_datos` |
| 2 | ROAS 7 d < equilibrio | `rojo` · volver al presupuesto previo a la última subida o bajar 20 %; dos semanas así → pausar |
| 3 | ROAS 7 d < número mágico **o** ROAS 30 d < número mágico | `amarillo` · optimizar, no escalar |
| 4 | Colchón < 25 % | `verde_justo` · 0 % vertical (FV: "no justo en el número"); horizontal obligatorio |
| 5 | Paso base = 0,75 × colchón, en escalones 35 / 20 / 15 % | con colchón 25 % → 15 %; 27 % → 20 %; ≥ 47 % → 35 % |
| 6 | Caps (cada uno baja un escalón) | ver tabla |
| 7 | Cap por atribución de cuenta | ver §4 |
| 8 | Bloqueos duros | `bloqueado` (sin escalera) |
| 9 | Reloj | `esperar` si la ventana de días no se cumple (la escalera arranca cuando se cumpla) |

Estados finales:

| Estado | Paso | Lectura |
|---|---|---|
| `verde_excelente` | 35 % | lo excelente, con volumen y sin avisos |
| `verde` | 20 % | verde con colchón medio |
| `verde_corto` | 15 % | verde con un aviso, paso corto |
| `verde_mantener` | 0 % | verde cuya suma de avisos o el cap de atribución lo deja sin subida |
| `verde_justo` | 0 % | sobre el número mágico con menos de 25 % de colchón |
| `esperar` | el del estado base | verde con escalera programada cuando se cumplan los días |
| `bloqueado` | 0 % | frecuencia en el tope, fatiga, aprendizaje limitado, automatización, estudio activo o evento |
| `amarillo` / `rojo` / `sin_datos` / `fuera` | 0 % | ver arriba |

### Caps (cada uno baja un escalón: 35 → 20 → 15 → 0)

| Señal | Umbral | Por qué |
|---|---|---|
| CPA sobre el máximo | CPA 7 d > ticket × margen | rentable en ROAS pero no en CPA: algo no cuadra en el valor por compra |
| Volumen para paso grande | < 25 compras en 7 d con paso ≥ 30 % | ruido Poisson ±20 %: un 35 % con 12 compras es apostar |
| Tendencia a la baja | ROAS 7 d ≤ 0,8 × ROAS 30 d | se está degradando antes de subir |
| Frecuencia en aviso | frecuencia 7 d ≥ aviso de la etapa (y < tope) | fatiga temprana; subir acelera la saturación |
| Público chico | frecuencia 30 d ≥ tope de la etapa | más presupuesto sube la frecuencia antes que las ventas |
| Aprendizaje | `learning_stage_info.status = LEARNING` | una subida grande lo reinicia; el reloj pasa a 7 días |
| Marginal preventivo | ROAS marginal de la cuenta bajo el equilibrio en la última semana completa | la serie histórica no es un test limpio, pero pide prudencia |
| Incremental central | ROAS 7 d × ratio central de la etapa < número mágico | ni el punto medio de las cotas justifica el objetivo |

### Cap por atribución de cuenta (§4)

| Semáforo de atribución | Público nuevo (TOFU) | Públicos calientes (MOFU, BOFU, evento) |
|---|---|---|
| verde | sin cap | sin cap |
| amarillo | ≤ 20 % | ≤ 20 % |
| rojo | ≤ 15 % | 0 % hasta tener factor medido; ≤ 15 % si su piso pesimista aún supera el número mágico |
| sin datos | ≤ 15 % | ≤ 15 % |

Una entidad con `incremental.factor_medido` (lift, holdout, A/B nativo) usa su factor y no recibe cap de cuenta.

### Bloqueos duros (sin subida)

| Señal | Umbral |
|---|---|
| Frecuencia sobre el tope | frecuencia 7 d ≥ tope de la etapa |
| Fatiga creativa | frecuencia ≥ aviso **y** ROAS 7 d < 0,8 × 30 d **y** CTR 7 d < 0,8 × CTR 30 d → renovar anuncios |
| Aprendizaje limitado | `LEARNING_LIMITED` |
| Automatización | actor "Meta" moviendo el presupuesto en el activity log |
| Estudio de lift activo | `has_active_study = true` |
| Evento activo | solo lo excelente con ≥ 20 compras en 7 d se mueve; el resto queda congelado |

### Reloj

| Situación | Días entre subidas |
|---|---|
| Normal | 5 (FV): la ventana de 7 d clic madura en una semana |
| Conjunto en aprendizaje | 7 |
| Más de 2 subidas en 14 días | congelar 7 días desde hoy (con cambios diarios el ROAS por nivel no se lee) |
| Evento confirmado | 2 días para lo excelente con volumen; tope 35 % se mantiene; reversión al cierre |

La fecha de la última subida sale de `ads_account_get_activity_logs` (fallback: `last_sig_edit_ts`). Checkpoint a las 72 h **solo para revertir** (ROAS < 0,9 × número mágico o CPA > objetivo → volver al nivel anterior); la decisión de volver a subir espera los días del reloj.

### Frecuencia 7 d por etapa

| Etapa | Aviso (SARAHI, paso corto) | Tope (FV, no subir) |
|---|---|---|
| TOFU · público nuevo | 1,75 | 3 |
| MOFU · público activo y clientes | 4,0 | 6 |
| BOFU · retargeting caliente | 5,0 | 10 |
| EVENTO · Cyber, Black, Navidad | 5,0 | 10 |

La etapa se deduce del nombre (TOFU / NUEVOS / MOFU / BOFU / RETARGETING / CYBER…) o se declara en el JSON con `etapa`.

### Escalera y reversión

- Tres subidas, `presupuesto × (1 + paso)`, redondeadas a $100 en CLP.
- Subida 1 = hoy si el reloj está cumplido; si no, el día en que se cumpla (o el fin del congelamiento).
- Checkpoint a 72 h (solo revertir); decisión a los días del reloj: ROAS 7 d ≥ número mágico, no cae más de 25 % frente al nivel anterior, frecuencia 7 d bajo el tope.
- Tope de la escalera: ×2 del presupuesto inicial en 28 días, frecuencia en el tope, ROAS 7 d bajo el número mágico o MER marginal bajo el equilibrio → pasar a horizontal.
- Nivel: CBO sigue CBO, ABO sigue ABO. CBO admite presupuesto + anuncios nuevos el mismo día; ABO solo presupuesto.

## 3. Semáforo de una campaña de Google Ads

El ROAS de **30 días** decide la rentabilidad (rezago de conversión); la cuota de impresiones de **7 días** diagnostica la restricción de hoy (presupuesto o ranking).

| Paso | Condición | Resultado |
|---|---|---|
| 0 | La conversión no es venta (valor por conversión < 10 % del ticket) | `fuera` |
| 1 | < 30 clics en 30 d o sin ROAS | `sin_datos` |
| 2 | Marca | `cubrir` si cuota perdida por presupuesto ≥ 10 % o cuota < 80 % (presupuesto × (1 + perdida + 5 %), máximo +30 %); si no, `marca_ok` |
| 3 | ROAS 30 d < número mágico, o ROAS 7 d cae > 25 % y queda bajo objetivo | `rojo` si bajo el equilibrio, si no `amarillo`; con cuota perdida por ranking ≥ 30 %: ajustar puja, no presupuesto |
| 4 | Sobre objetivo, cuota perdida por ranking ≥ 30 % y por presupuesto < 20 % | `verde_puja`: más presupuesto no compra subastas; bajar tROAS 10-15 % (= más volumen) [verificación manual] |
| 5 | Cuota perdida por presupuesto < 10 % o gasto medio 7 d < 80 % del presupuesto | `verde_sin_techo`: horizontal o relajar tROAS |
| 6 | Cuota perdida por presupuesto ≥ 20 % | `verde_excelente` · +20 % (regla vigente de opti-google-ads-x-sarahi) |
| 7 | Cuota perdida por presupuesto 10-20 % | `verde` · +10 % |

Ajustes: ROAS 7 d cae > 25 % frente a 30 d → paso 10 %. PMax con ROAS ≥ 2 × genérica y CPC < 70 % del de genérica → aviso de canibalización de marca y paso 10 % hasta confirmar exclusiones. Un cambio por campaña por semana, siempre lunes; presupuesto y tROAS nunca la misma semana. Reversión: si el ROAS cae > 20 % y queda bajo objetivo, volver.

## 4. Atribución: bandas, cotas y semáforo de cuenta

| Métrica | Fórmula | Normal | Elevado | Alto |
|---|---|---|---|---|
| Ratio Meta / GA4 (canal) | compras Meta 30 d / compras GA4 Paid Social 30 d | ≤ 2,0 | 2,0-4,0 | > 4,0 |
| Ratio Google / GA4 | conversiones de venta Google Ads / transacciones google/cpc | ≤ 1,5 | 1,5-2,0 | > 2,0 |
| Índice de sobre-reclamo | (compras Meta + conversiones Google) / pedidos reales | ≤ 0,9 | 0,9-1,0 | > 1,0 |
| MER | ingresos totales / (gasto Meta + Google) | ≥ número mágico | entre equilibrio y objetivo | < equilibrio (frenar todo) |
| aMER | ingresos de clientes nuevos / gasto total | ≥ número mágico | — | < número mágico (el crecimiento es recompra) |

**Semáforo de atribución de cuenta:** rojo si ratio Meta/GA4 > 4 o sobre-reclamo > 1,0; amarillo si ratio > 2 o sobre-reclamo > 0,9; verde en el resto. Se lee en ventana de 28 días: la semana tiene ruido de ±2/√n con n compras de Paid Social.

**Cotas del ROAS incremental** (por etapa y por cuenta, 30 días):

- Piso = ingresos GA4 último clic asignados a la etapa / gasto de la etapa. Partición supuesta: los compradores nuevos de Paid Social van a público nuevo, los recurrentes a públicos calientes (share de nuevos desde source/medium de pauta).
- Techo = compras reportadas × factor de deduplicación global × ticket de Paid Social / gasto, acotado al ROAS reportado. Factor de deduplicación global = pedidos reales / compras reclamadas por las plataformas.
- Central = √(piso × techo). Índice de incertidumbre = techo / piso: ≤ 2 confianza alta, ≤ 5 media, > 5 baja.
- Cada conjunto hereda los ratios piso / central / techo de su etapa sobre su ROAS de 7 días. Un factor medido reemplaza las cotas.

## 5. Alertas automáticas (el HTML muestra hasta 12, por severidad)

| Nivel | Señal | Umbral |
|---|---|---|
| Rojo | Conjunto bajo el equilibrio | ROAS 7 d < equilibrio |
| Rojo | Frecuencia sobre el tope | tabla de etapa |
| Rojo | Atribución de cuenta en rojo | ratio > 4 o sobre-reclamo > 1 |
| Rojo | MER bajo el equilibrio | |
| Amarillo | Atribución elevada | ratio 2-4 o sobre-reclamo 0,9-1 |
| Amarillo | ROAS marginal de la cuenta bajo el equilibrio (preventiva) | serie semanal |
| Amarillo | Frecuencia en aviso · ROAS 7 d cae > 20 % vs 30 d | |
| Amarillo | Subidas demasiado frecuentes | > 2 en 14 d |
| Amarillo | Automatización moviendo el presupuesto | actor "Meta" |
| Amarillo | Concentración | un conjunto ≥ 50 % de las compras de 7 d |
| Amarillo | Gasto sin retorno medible | campañas sin objetivo de venta |
| Amarillo | Google sobre-reporta · limitada por ranking · PMax canibaliza marca · marca pierde cuota | ver §3 |
| Amarillo | aMER bajo el número mágico · evento activo | |
