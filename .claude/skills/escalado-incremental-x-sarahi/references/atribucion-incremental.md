# Atribución incremental: cómo se mide y cómo se mueve al escalar

Cargar al escribir la sección de atribución del plan, el plan de pruebas y el texto "cómo se mueve". Todo lo que hay aquí se ejecuta con las fuentes del inventario (Meta MCP, AgencyAnalytics, backend vía Jorge) o queda marcado como exportación manual. Ninguna cifra de esta referencia es un dato del cliente: los datos salen del JSON de la corrida.

## 1. El problema

Las plataformas atribuyen con reglas generosas: Meta cuenta una compra si hubo un clic en 7 días o una vista en 1 día; Google cuenta por clic con atribución basada en datos y suma conversiones por visualización. Ninguna sabe lo que la otra reclamó, y ninguna sabe si la persona iba a comprar de todas formas. En un e-commerce con recompra frecuente, el retargeting a clientes y las audiencias calientes reportan ROAS de 20-50x porque capturan compras que el cliente ya tenía decididas. Escalar sobre ese número es pagar más por la misma venta.

**Incrementalidad** es la fracción de las compras reportadas que no habrían ocurrido sin el anuncio. Es lo único que justifica subir presupuesto. Como casi nunca se puede medir con exactitud, la skill trabaja con tres niveles de evidencia y una regla operativa: **acotar con datos, decidir por la cota que la evidencia permita, y mejorar la evidencia cada semana.** Prioridad de evidencia: lift > geo-holdout > A/B nativo > cotas > cualquier supuesto.

## 2. Nivel 1 · Triangulación y cotas (siempre disponible)

### 2.1 Términos

| Símbolo | Definición | Fuente |
|---|---|---|
| `S_meta`, `S_google`, `S_total` | Gasto 30 d | Meta `amount_spent` de cuenta; Google `cost` de todas las campañas (es plata gastada, incluidas visitas a tienda) |
| `P_meta`, `V_meta` | Compras y valor reportados por Meta | `omni_purchase`, `offsite_conversion_fb_pixel_purchase_values` |
| `P_google`, `V_google` | Conversiones y valor de Google Ads, solo campañas de venta | `conversions`, `conversion_value` sin visitas a tienda ni llamadas (gate de valor por conversión) |
| `T_real`, `R_real` | Pedidos e ingresos reales | backend; si no hay, GA4 `transactions`, `purchase_revenue` con flag |
| `T_ps`, `R_ps` | Compras e ingresos GA4 canal Paid Social | `ecommerce-analytics` por canal |
| `T_utm`, `N_new_utm` | Compras y compradores nuevos GA4 de source/medium pagados de Meta | suma de `ig / paid`, `fb / paid`, `an / paid`… en `conversion-analytics` |
| `T_gcpc`, `R_gcpc` | Compras e ingresos GA4 `google / cpc` | idem |
| `N_new`, `N_tot` | Compradores nuevos y totales 30 d | GA4 `first_time_purchasers`, `total_purchasers` (por source/medium; el asset por canal los devuelve en 0) |

### 2.2 Métricas de triangulación

| Métrica | Fórmula | Qué dice |
|---|---|---|
| Ratio Meta / GA4 (canal) | `P_meta / T_ps` | cuántas veces más compras reporta Meta que las que GA4 le da por último clic. Gobierna el semáforo |
| Ratio Meta / GA4 (UTM) | `P_meta / T_utm` | lo mismo solo con tráfico etiquetado; más duro porque parte del tráfico de Meta cae en `ig / social` o referral |
| Ratio Google / GA4 | `P_google / T_gcpc` | Google contra su último clic; normal cerca de 1-1,5 |
| Índice de sobre-reclamo | `(P_meta + P_google) / T_real` | si supera 1, las plataformas reclaman más compras que pedidos hay |
| Índice de sobre-reclamo en valor | `(V_meta + V_google) / R_real` | lo mismo en dinero |
| Factor de deduplicación global (FDG) | `min(1, T_real / (P_meta + P_google))` | fracción de lo reclamado que cabe en los pedidos reales |
| Share de Meta | `V_meta / R_real` | qué fracción de los ingresos totales Meta dice haber generado |
| ROAS optimista de Meta | `V_meta / S_meta` | lo que dice Ads Manager |
| ROAS pesimista de Meta | `R_ps / S_meta` | GA4 último clic; cota inferior, no la verdad |
| MER | `R_real / S_total` | ingresos totales por peso invertido; no depende de atribución |
| aMER | `R_new / S_total` (backend) o `R_real × N_new / N_tot` (estimado) | el MER que no cuenta recompra |
| MER mínimo por participación | `número mágico / share de ingresos pagados` | MER de cuenta que equivale al objetivo (informativo) |

### 2.3 Bandas (supuestos calibrables)

| Métrica | Normal | Elevado | Alto | Por qué |
|---|---|---|---|---|
| Ratio Meta / GA4 (canal) | ≤ 2,0 | 2,0-4,0 | > 4,0 | view-through, cross-device y clics tardíos explican 1,5-3x en e-commerce; sobre 4x la mayor parte del reporte es vista o recompra |
| Ratio Google / GA4 | ≤ 1,5 | 1,5-2,0 | > 2,0 | Google y GA4 comparten el clic; la diferencia viene de view-through y de conversiones por fecha de clic |
| Índice de sobre-reclamo | ≤ 0,9 | 0,9-1,0 | > 1,0 | doble conteo seguro |

Semáforo de atribución de cuenta: **rojo** si ratio > 4 o sobre-reclamo > 1; **amarillo** si ratio > 2 o sobre-reclamo > 0,9; **verde** en el resto. Los ratios se calculan con las ventanas de 30 días de la corrida y se siguen en el tablero en ventana móvil de 28 días (4 semanas); solo se reacciona a cambios mayores que el ruido (±2/√n del denominador). Con el primer factor medido se propone recalibrar a mano las bandas del cliente (`supuestos.atribucion.ratio_normal` / `ratio_elevado`) al ratio en que el factor cae bajo 0,4; el script no lo hace solo.

### 2.4 Cotas del ROAS incremental (piso, central, techo)

Sin prueba causal no hay factor: hay un **rango** que se calcula solo con datos.

- **Piso** = ingresos que GA4 atribuye por último clic a Paid Social, repartidos por etapa / gasto de la etapa. Es la lectura más dura posible.
- **Techo** = compras reportadas por la etapa × FDG × ticket de Paid Social / gasto de la etapa, acotado al ROAS reportado. Es lo máximo que cabe en los pedidos reales.
- **Central** = √(piso × techo). **Índice de incertidumbre** = techo / piso: ≤ 2 confianza alta, ≤ 5 media, > 5 baja. Si el piso GA4 supera el techo deduplicado, la partición supuesta sobreasigna ingresos a esa etapa: el script toma el techo como estimación, marca la cota como **no verificable** (sin índice) y pide `utm_campaign` por campaña; nunca la declara "alta".
- **Partición por etapa (supuesta):** los ingresos de compradores nuevos de Paid Social van a público nuevo (TOFU); los de recurrentes, a públicos calientes (MOFU, BOFU, evento). El share de nuevos sale de los source/medium de pauta. Se reemplaza por UTM por campaña cuando existan (`utm_campaign` con el nombre de la campaña).
- Cada conjunto hereda los ratios piso / central / techo de su etapa aplicados a su ROAS de 7 días. El semáforo exige que el central supere el número mágico (cap de un escalón si no) y, con atribución en rojo, que el piso lo supere para que un público caliente reciba siquiera un paso corto.
- En cuanto exista un dato medido (lift, holdout, A/B nativo), se carga en `incremental.factor_medido` del conjunto con `fuente` y `fecha`, reemplaza las cotas y libera el cap de cuenta para ese conjunto. Un factor vale 90 días desde `fecha`: vencido, el script vuelve a las cotas y lo avisa.

### 2.5 Lo que se declara siempre

- GA4 último clic subestima la publicidad en frío: el piso es cota inferior, no verdad.
- Las plataformas y GA4 cuentan en fechas distintas (fecha de conversión vs fecha de clic, ventanas de 7 días): los ratios se leen como tendencia.
- Sin backend, GA4 hace de verdad de pedidos; si GA4 pierde compras (diferencia > 15 % contra el backend), el MER está subestimado y el índice de sobre-reclamo sobrestimado.
- La partición por etapa es un supuesto hasta tener UTM por campaña.

## 3. Nivel 2 · Atribución nativa comparada

### 3.1 Comparación de ventanas de atribución

Ads Manager: Columnas → Comparar configuraciones de atribución → 1 día clic, 7 días clic, 1 día vista, 28 días clic → exportar. Por conjunto se leen compras y valor bajo cada ventana:

- `compras 1d_click / compras 7d_click_1d_view`: la parte del reporte que se sostiene con la lectura más estricta. En prospecting sano suele estar sobre 50 %; en retargeting a clientes cae bajo 30 %. Es un piso alternativo del factor.
- `1d_view` alto con `1d_click` bajo: el conjunto vive de la vista; incrementalidad dudosa.
- `28d_click` muy por encima de `7d_click`: compras tardías que probablemente eran recompra.

Se cargan en el JSON como `ventanas` por entidad (`{"1d_click": {"compras": n, "valor": v}, "7d_click": {…}, "1d_view": {…}, "28d_click": {…}}`) y `meta.ventanas_disponibles: true`. El script calcula la fracción 1 d clic / 7 d clic y la expone en `incremental.fraccion_1d_click`; cuando no hay GA4, esa fracción hace de piso del ROAS incremental del conjunto.

### 3.2 A/B nativo con atribución incremental de Meta

Meta ofrece la configuración de atribución "incremental" a nivel de conjunto para campañas de ventas optimizadas a conversiones o valor: un modelo entrenado con sus estudios de lift estima qué conversiones fueron causadas por el anuncio, y las columnas de resultados de ese conjunto pasan a ser incrementales. En el MCP el campo es `attribution_setting = incrementality` (lectura) e `is_incremental_attribution_enabled: true` en `ads_create_ad_set` (creación, solo con confirmación de Jorge).

Diseño de la prueba:

1. Elegir el conjunto caliente de mayor volumen que esté fuera de aprendizaje (idealmente ≥ 25 compras en 7 d).
2. Duplicarlo con atribución incremental y **el mismo presupuesto por brazo** (partir el presupuesto actual o sumar; costo declarado). No tocar públicos ni anuncios durante la prueba: si el plan horizontal pide anuncios nuevos en ese conjunto, entran antes de duplicar (el duplicado los hereda) y el conjunto queda congelado los 14 días.
3. Correr 14 días o hasta ≥ 50 compras por brazo (máximo 28 días). Se invalida si el gasto entre brazos se desbalancea más de 20 %.
4. `factor = ROAS incremental del brazo B / ROAS estándar del brazo A`, corregido por gasto. Reemplaza las cotas de la etapa para todos los conjuntos calientes.
5. Es un estimador de Meta, no una verdad; se declara así en el HTML. Puede correr durante un evento porque ambos brazos comparten calendario.

Requisito: EMQ razonable (≥ 5) y volumen; con señal pobre el modelo devuelve poco.

## 4. Nivel 3 · Pruebas causales

### 4.1 Conversion Lift (Meta)

`ads_experiment_check_eligibility(ad_account_id: "act_<id>")` → el resultado se cita **literal** en el HTML (no se extrapola gasto ni conversiones). Requisitos del self-serve: gasto y conversiones optimizadas mínimos en 90 días y EMQ ≥ 5 vía CAPI con email y teléfono hasheados. Si es elegible y Jorge confirma, `ads_experiment_lift_create_test` crea un estudio a nivel cuenta con holdout (10 % por defecto) por 30 días. Resultados en `ads_experiment_lift_get_test`: conversiones incrementales, costo por conversión incremental, ROAS incremental. `ROAS incremental / ROAS reportado` es el factor de la cuenta (o de la etapa si el estudio es por campaña).

Durante el estudio no se cambian presupuestos ni públicos de las campañas incluidas.

### 4.2 Geo-holdout

Cuando no hay elegibilidad para lift:

1. Elegir desde GA4 por región: `read_client_data_source(provider: "google-analytics4", asset: "traffic-analytics", groupBy: ["region"], fields: ["region", "sessions", "transactions", "purchase_revenue", "first_time_purchasers"])` con línea base de 4-8 semanas (`conversion-analytics` no se agrupa por región). Tomar 1-2 regiones que sumen 15-20 % de los pedidos y no sean atípicas. Nunca fijar regiones a priori.
2. Excluirlas de **MOFU + BOFU juntos** (no de Google) durante 4 semanas; un solo brazo caliente no tiene potencia.
3. Diferencia en diferencias: variación de ventas GA4 y backend en las regiones excluidas contra el resto, antes y durante. La caída relativa es la incrementalidad de esos conjuntos.
4. Declarar el efecto mínimo detectable con la varianza semanal regional observada (`MDE ≈ 2,8 × desviación / media`); el Poisson simple (`2√n / n`) es solo cota inferior. Extender a 28 días más si efecto esperado / desviación < 2.
5. Costo declarado: peor caso = share de pedidos del holdout × valor reclamado por los conjuntos; caso piso = share × ingresos GA4 Paid Social.

### 4.3 Apagado controlado (último recurso)

Pausar un conjunto chico y "ver si baja la venta" no mide nada: el ruido semanal de una tienda es ≈ √(pedidos semanales). El script calcula la potencia con la **caída esperada**, no con lo reclamado: `compras semanales reclamadas por los calientes × fracción incremental central de la etapa / desviación semanal de la tienda` (y la misma cuenta con el piso como caso pesimista); marca la prueba como no concluyente si es < 2. Solo se usa MOFU + BOFU juntos, ≥ 14 días, fuera de eventos, con control sintético (Google + orgánico + directo) y aprobación explícita.

### 4.4 Escalón de presupuesto (ROAS y MER marginal)

Cada subida es una prueba si se mide bien:

- Una entidad por vez y sin otros cambios de presupuesto en la ventana (verificado en el activity log).
- Dos semanas completas antes y dos después, sin evento.
- `ROAS marginal Meta = ΔV_meta / ΔS_meta`; `MER marginal = ΔR_real / ΔS_total`.
- Sobre el equilibrio se sigue; entre equilibrio y número mágico se mantiene; bajo el equilibrio dos semanas seguidas se revierte. La serie histórica (con eventos y cambios diarios) solo genera alerta preventiva; no es gate.

Regla general: **una sola prueba causal a la vez por plataforma; ninguna arranca durante un evento comercial activo.**

## 5. Cómo se mueve la atribución al escalar

| Al subir presupuesto en… | ROAS de plataforma | Ratio Meta/GA4 (28 d) | MER marginal | Lectura |
|---|---|---|---|---|
| TOFU con compradores excluidos | cae despacio | estable o baja | sobre equilibrio | escalón incremental: seguir |
| TOFU cuando el creativo se cansa | cae rápido, frecuencia sube | estable | cae | fatiga: horizontal (anuncios), no más presupuesto |
| MOFU a públicos activos | se mantiene alto | sube | se mantiene o cae | captura más recompra: subir corto y medir (A/B nativo) |
| BOFU a clientes recurrentes | se mantiene muy alto | sube fuerte | no se mueve | el escalón compra atribución: revertir |
| Google genérica limitada por presupuesto | estable | estable (ratio Google) | sube | demanda real que no se compraba: seguir |
| Google marca | sube | — | no se mueve | cubrir la cuota, no escalar |
| Meta TOFU (efecto cruzado) | — | — | impresiones de marca en Google suben 2-3 semanas después | Meta crea demanda: señal informativa, nunca gate (confundida por orgánico, PR y estacionalidad) |

Señales de reversión: ratio Meta/GA4 subiendo con el gasto más allá de su ruido; índice de sobre-reclamo cruzando 1; MER marginal bajo el equilibrio dos semanas seguidas; share de compradores nuevos cayendo 5 puntos con gasto en alza; brand search plano tras tres semanas de subir TOFU.

## 6. Tablero semanal

Columnas: Semana · Gasto Meta · Gasto Google · Gasto total · Compras Meta · ROAS Meta · ROAS marginal Meta · Conv. Google · ROAS Google · Pedidos GA4 · Ingresos GA4 · MER · Ratio Meta/GA4 (±ruido) · MER marginal. Una fila por semana; las semanas de evento y las parciales se marcan y no calculan marginal.

El script lo llena con `meta.cuenta.semanas`, `google.semanas` y `ga4.semanas`, y lo acumula con `historial_tablero` (las filas de corridas anteriores, guardadas en `tablero-<marca>.json`). Se lee de izquierda a derecha: gasto → compras reportadas → pedidos reales → MER. Si las dos primeras columnas suben y las dos últimas no, el crecimiento es de reporte.

## 7. Cómo entra al semáforo

- Central de la etapa bajo el número mágico → un escalón menos.
- Atribución de cuenta amarilla → paso máximo 20 %.
- Atribución de cuenta roja → público nuevo con paso máximo 15 %; públicos calientes sin subida vertical hasta tener factor medido (15 % solo si su piso ya supera el número mágico).
- Índice de sobre-reclamo > 1 → alerta roja: decide el MER.
- MER bajo el equilibrio → alerta roja: frenar todo escalado.
- aMER bajo el número mágico → alerta amarilla: priorizar público nuevo y adquisición en Google.
- Estudio de lift activo → bloqueo de subidas en las campañas del estudio.
