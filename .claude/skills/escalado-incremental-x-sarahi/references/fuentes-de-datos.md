# Fuentes de datos: consultas exactas y trampas conocidas

Todo número del plan tiene que venir de una de estas fuentes o de Jorge. Leer este archivo completo antes de la primera consulta: los nombres de campos están verificados contra los MCP en producción y los errores de aquí abajo rompen la query o devuelven vacío sin avisar.

## 0. Orden de consultas (plan de lectura)

| # | Fuente | Qué trae | Ventanas |
|---|---|---|---|
| 1 | Meta `ads_get_ad_accounts` | id de la cuenta consultable | — |
| 2 | Meta `ads_get_ad_entities` nivel `adset` | presupuesto (ABO), ROAS, compras, frecuencia, aprendizaje, atribución | last_7d y last_30d |
| 3 | Meta `ads_get_ad_entities` nivel `campaign` | presupuesto (CBO), objetivo, embudo ATC/IC/compra, valor | last_7d y last_30d |
| 4 | Meta `ads_get_ad_entities` nivel `ad_account` con `time_increment: "7"` | serie semanal de gasto, compras, valor, ROAS (base del ROAS marginal) | last_90d |
| 5 | Meta `ads_account_get_activity_logs` `event_category: budget` | fecha y magnitud de cada cambio de presupuesto | últimos 45 días |
| 6 | Meta `ads_experiment_list_tests` + `ads_experiment_check_eligibility` | estudios de lift previos/activos y elegibilidad para Conversion Lift | — |
| 7 | AgencyAnalytics `search_clients` → `browse_client_data_sources` | clientId, `integration_campaign_id` de Google Ads y GA4 | — |
| 8 | AgencyAnalytics Google Ads por campaña | costo, conversiones, valor, ROAS, IS, Lost IS | 30d y 7d |
| 9 | AgencyAnalytics GA4 por canal | sesiones, compras, ingresos, compradores nuevos | 30d y 7d |
| 10 | AgencyAnalytics GA4 por source/medium | compras de ig/fb/an paid y google/cpc para triangular | 30d |
| 11 | Jorge (backend PrestaShop) | pedidos reales, ingresos, % clientes nuevos, margen, ticket | 30d |

Si una fuente falla, se sigue con las demás y la sección afectada del HTML dice "sin datos: verificación manual". Nunca se rellena con estimaciones.

## 1. Meta MCP

Todas las tools requieren `client_conversation_id` (20 caracteres alfanuméricos, el mismo en toda la conversación) y `client_model` (el id del modelo tal como aparece en el sistema). Pasar también `advertiser_request` con las palabras de Jorge.

### Cuenta

`ads_get_ad_accounts` → elegir la cuenta cuyo nombre coincide con el cliente **y** `is_queryable: true` **y** `account_status: ACTIVE`. Las cuentas "OFF" cerradas tienen nombre parecido y fallan. DJOYAS Ads = `1497045771133996`.

### Entidades y métricas

`ads_get_ad_entities` con `ad_account_id` (numérico, sin `act_`), `level`, `date_preset`, `fields`, `filtering`, `limit`.

Campos verificados por nivel:

| Campo | campaign | adset | ad_account | Nota |
|---|---|---|---|---|
| `id`, `name`, `effective_status` | sí | sí | — | filtrar con `campaign.effective_status` / `adset.effective_status` `IN ["ACTIVE"]` |
| `objective` | sí | — | — | OUTCOME_SALES, OUTCOME_ENGAGEMENT, OUTCOME_TRAFFIC… |
| `daily_budget`, `lifetime_budget`, `budget_remaining` | sí (CBO) | sí (ABO) | — | `{"value":"45000","unit":"CLP"}`; null cuando el presupuesto vive en el otro nivel |
| `optimization_goal` | — | sí | — | OFFSITE_CONVERSIONS, VALUE, LANDING_PAGE_VIEWS, POST_ENGAGEMENT… |
| `attribution_setting` | — | sí | — | `1d_click`, `7d_click`, `1d_view_7d_click`, `1d_view_7d_click_1d_ev`, `incrementality` |
| `learning_stage_info` | — | sí | — | `{status: LEARNING|SUCCESS, conversions, last_sig_edit_ts (epoch), attribution_windows}` |
| `bid_strategy` | sí | sí | — | LOWEST_COST_WITHOUT_CAP, COST_CAP, LOWEST_COST_WITH_MIN_ROAS |
| `amount_spent`, `impressions`, `reach`, `frequency`, `cpm`, `cpc`, `ctr` | sí | sí | sí | moneda como `{value, unit}`; `ctr` entra al JSON como `ctr` en m7/m30 para la regla de fatiga |
| `link_click`, `outbound_clicks`, `omni_landing_page_view` | sí | sí | sí | |
| `omni_add_to_cart`, `omni_initiated_checkout`, `omni_purchase` | sí | sí | sí | `omni_purchase` = compras (alias `purchases`) |
| `offsite_conversion_fb_pixel_purchase_values` | sí | sí | sí | valor de compras web en CLP (alias `website_purchase_value`) |
| `cost_per_omni_purchase`, `purchase_roas`, `website_purchase_roas` | sí | sí | sí | |
| `created_time`, `updated_time`, `start_time` | sí | sí | — | |

No existen vía MCP (no pedirlos): comparación de ventanas de atribución por columna, conversiones incrementales, `new_customer`, `purchase_value` (usar `offsite_conversion_fb_pixel_purchase_values`), `add_to_cart` (usar `omni_add_to_cart`), `campaign_budget_optimization`.

Trampas:

- Las campañas de interacción y tráfico devuelven `omni_purchase: null`: no son "ROAS 0", están fuera del plan de ventas. Reportarlas como gasto sin ROAS.
- `frequency` a 30 días en retargeting llega a 10-12 y no es comparable con la de 7 días; el semáforo usa 7 días y muestra 30 como contexto.
- Un conjunto con `learning_stage_info.status = LEARNING` y `conversions < 10` sigue en aprendizaje aunque lleve semanas: cualquier subida lo reinicia.
- `last_sig_edit_ts` es la última edición significativa (presupuesto, puja, público, anuncios). Convertir a fecha y calcular días hasta hoy.
- `time_increment` va como string (`"7"`), no como número.
- Los números vienen con formato chileno en algunos campos (puntos de miles, comas decimales): usar `parse_num()` del script.

### Historial de presupuesto

`ads_account_get_activity_logs(ad_account_id, event_category: "budget", start_time: ISO, limit: 100)` → lista con `event_type` ("Campaign budget updated" / "Ad set budget updated"), `object_id`, `object_name`, `actor_name`, `datetime` (formato `M/D/YYYY at H:MM AM/PM`), `extra_data` JSON con `old_value.old_value` y `new_value.new_value`.

Con esto el script calcula por entidad: fecha de la última subida, % de cambio, número de subidas en 30 días y si se respetó la ventana de 5 días. Si `actor_name` es "Meta" y los cambios son de +3 % cada hora, es una automatización (regla o presupuesto Advantage) y se declara en el plan.

### Experimentos e incrementalidad nativa

- `ads_experiment_list_tests(ad_account_id: "act_<id>")` → estudios LIFT y SPLIT_TEST con estado, celdas y objetivos. `has_active_study: true` bloquea cambios de presupuesto en las campañas del estudio.
- `ads_experiment_check_eligibility(ad_account_id: "act_<id>")` → `lift.eligible` y `checks`. Requisitos del Conversion Lift self-serve: ≥ USD 5.000 de gasto en 90 días, ≥ 500 conversiones optimizadas en la ventana, EMQ ≥ 5 vía CAPI.
- `ads_experiment_lift_get_test(study_id)` → resultados: conversiones incrementales, costo por conversión incremental, ROAS incremental (o lift de marca en puntos porcentuales).
- `ads_experiment_lift_create_test(ad_account_id, study_name, start_time, end_time)` → crea el estudio. **Solo con confirmación explícita de Jorge.**
- `ads_get_datasets` → id del píxel; `ads_get_dataset_quality(dataset_id)` → EMQ por evento (condición del lift y de la atribución incremental de Meta).

### Lo que se hace en Ads Manager, no en el MCP

- **Comparar configuraciones de atribución**: Columnas → Comparar configuraciones de atribución → marcar 1 día clic, 7 días clic, 1 día vista, 28 días clic → exportar CSV. Da compras y valor por ventana para cada conjunto. Fuente: [Compare attribution settings in Meta Ads Manager](https://www.facebook.com/business/help/854500742637772).
- **Atribución incremental** (configuración de atribución "Incremental" a nivel de conjunto): Meta modela qué conversiones fueron causadas por el anuncio a partir de sus estudios de lift. Se activa al crear o duplicar un conjunto de ventas con optimización a conversiones o valor (el MCP lo admite con `is_incremental_attribution_enabled: true` en `ads_create_ad_set`). Las columnas de resultados de ese conjunto ya son incrementales y se comparan contra la versión estándar.

Cuando Jorge exporta el CSV de comparación de ventanas, las columnas se cargan en el JSON como `ventanas` por entidad (ver esquema en `SKILL.md`).

## 2. AgencyAnalytics

Un cliente por consulta. Flujo: `search_clients(query: "<marca>")` → `clientId` y `providers`. Luego `browse_client_data_sources(clientId, message, requireDateRange: true)` para obtener los `integration_campaign_id` de Google Ads y GA4 (cambian por cliente).

### Google Ads

```
read_client_data_source(
  clientId, provider: "googleadwords", asset: "ad-analytics",
  fields: ["campaign","campaign_type","budget","cost","impressions","clicks","ctr","avg_cpc",
           "conversions","conversion_value","conv_value_per_cost","cost_per_conv","view_through_conv",
           "conversions_by_conv_date","conversion_value_by_conv_date",
           "search_impr_share","search_budget_lost_impression_share","search_rank_lost_impression_share"],
  groupBy: ["campaign"],
  filters: {"integration_campaign_id": <id>, "start_date": "AAAA-MM-DD", "end_date": "AAAA-MM-DD",
            "status": "not_removed", "network": "all", "zero_conversions": true, "date_interval": "automatic"},
  limit: 50)
```

Devuelve CSV más una sección `Totals:`; usar los totales del conector, no sumar filas. `conv_value_per_cost` es el ROAS. `budget` es diario. Se piden **dos ventanas** (30 d y 7 d): el ROAS de 30 d decide la rentabilidad y la cuota de impresiones de 7 d diagnostica la restricción. `conversions_by_conv_date` sirve para distinguir rezago de conversión de una caída real en la ventana de 7 d.

### GA4 por canal (compras, ingresos, sesiones)

```
read_client_data_source(
  clientId, provider: "google-analytics4", asset: "ecommerce-analytics",
  fields: ["channel","sessions","total_users","new_users","transactions","ecommerce_purchases",
           "purchase_revenue","average_purchase_revenue","first_time_purchasers","total_purchasers",
           "add_to_carts","checkouts"],
  groupBy: ["channel"],
  filters: {"integration_campaign_id": <id>, "start_date": ..., "end_date": ...,
            "channel_type": "session_primary", "source_medium_type": "user_acquisition"},
  limit: 30)
```

Canales relevantes: `Paid Social`, `Paid Search`, `Cross-network` (PMax y Demand Gen), `Organic Search`, `Direct`, `Organic Social`, `Email`, `Referral`. `channel_type: session_primary` atribuye la compra a la sesión; `source_medium_type: user_acquisition` reparte usuarios y compradores nuevos por el primer origen del usuario. Se declara cuál se usó: cambia el conteo de nuevos vs recurrentes.

### GA4 por source / medium (triangulación fina)

Mismo provider, asset `conversion-analytics`, `groupBy: ["source_medium"]`, campos `source_medium, sessions, new_users, transactions, purchase_revenue, first_time_purchasers, total_purchasers`, `sort: {"transactions": "desc"}`, `limit: 25`. Sumar `ig / paid` + `fb / paid` + `an / paid` (+ `facebook / paid`, `instagram / paid` si aparecen) para las compras de Meta según GA4, y `google / cpc` para Google Ads.

Con UTMs de campaña bien puestas, el filtro `utm_campaign: ["<nombre>"]` (array) permite bajar a campaña de Meta. Sin UTMs, la triangulación se queda a nivel canal y se declara.

### Gates de calidad en GA4

- `engagement_rate` > 95 % o `session_conversion_rate` > 50 % en todos los canales → hay un evento marcado como conversión que dispara en casi todas las sesiones. Ignorar `conversions`; usar `transactions` y `purchase_revenue`.
- `first_time_purchasers = 0` en el asset por canal pero > 0 por source/medium → el desglose de nuevos existe; tomarlo de source/medium.
- `transactions` > `ecommerce_purchases` en más del 5 % → duplicación del evento purchase; anotar como límite.
- Ingresos GA4 vs backend con diferencia > 15 % → el sitio pierde eventos de compra; pedir cifra de backend y usarla como verdad.

### Meta agregado vía AgencyAnalytics (fallback si el MCP de Meta no responde)

provider `facebook-ads`, asset `ad-analytics`, `groupBy: ["campaign"]` o `["date"]`, campos `amount_spent, impressions, ctr, cpm, frequency, landing_page_views, add_to_cart, checkout_initiated, purchases, purchases_conversion_value, purchases_roas`. No trae presupuestos, aprendizaje ni atribución: el plan se marca como "lectura parcial".

## 3. Persistencia entre corridas

El tablero semanal se acumula. Al terminar, guardar `derivado.atribucion.tablero_semanal.filas` en `tablero-<marca>.json` junto a los JSON de la corrida; al empezar la siguiente, copiar esas filas en `historial_tablero` del JSON de entrada. El script une por semana (`inicio`) y conserva las anteriores; sin historial no hay lectura de "cómo se mueve" más allá de la serie de Meta.

## 4. Lo que hay que pedirle a Jorge

En un solo mensaje, al inicio, con defaults visibles ("ok" los acepta):

1. Ticket promedio y margen bruto (o directamente ROAS de equilibrio y número mágico).
2. Pedidos e ingresos reales del backend en los últimos 30 días, por semana si se puede, y % de clientes nuevos y ciclo de recompra.
3. Fechas de eventos comerciales en las próximas 4 semanas (Cyber, Black, Navidad): cambian la cadencia y protegen las pruebas.
4. Si los anuncios de Meta llevan `utm_campaign`, si PMax tiene exclusiones de marca y si hay CAPI con email y teléfono.
5. Si exportó la comparación de ventanas de atribución o activó atribución incremental en algún conjunto.
6. Si autoriza que el plan proponga pruebas causales (A/B nativo, geo-holdout); ninguna se crea sin confirmación posterior.

La estrategia de puja de Google se pregunta solo cuando el plan propone tocar tROAS.

Si no responde, el plan se genera con lo que las fuentes entregan y cada hueco queda declarado en la sección de límites.
