# Reglas de escalado en Google Ads x SARAHI

Google Ads entra al plan de escalado con sus propias palancas: en Search y PMax el presupuesto no compra impresiones a un público, compra cuota de una demanda que ya existe. Por eso las señales de escalado son distintas a las de Meta: **cuota de impresiones perdida por presupuesto**, **cuota perdida por ranking** y **ROAS contra objetivo**. Esta referencia es coherente con `opti-google-ads-x-sarahi` y con el brief matutino. Cargar cuando la cuenta tenga Google Ads conectado en AgencyAnalytics.

## Qué se lee (AgencyAnalytics · provider `googleadwords` · asset `ad-analytics` · groupBy `["campaign"]`)

Dos ventanas: **30 días** (tendencia) y **7 días** (velocidad). Campos por campaña:

`campaign, campaign_type, budget, cost, impressions, clicks, ctr, avg_cpc, conversions, conversion_value, conv_value_per_cost, cost_per_conv, view_through_conv, search_impr_share, search_budget_lost_impression_share, search_rank_lost_impression_share`

- `conv_value_per_cost` **es el ROAS**.
- `budget` es el presupuesto diario de la campaña.
- `search_impr_share` (IS) solo tiene sentido en Search y en la parte de búsqueda de PMax; en PMax la cuota reportada es parcial.
- `campaign_type`: `search`, `performance_max`, `shopping`, `display`, `video`, `demand_gen`.

## Gates de calidad antes de decidir

1. **Campañas cuyo "conversión" no es una venta** (visitas a tienda, llamadas, clics a WhatsApp) se separan del ROAS: si `cost_per_conv` es ínfimo y `conversion_value` casi cero, la acción de conversión no es compra. Se reportan aparte y no entran al semáforo de ventas.
2. **Marca vs genérica**: la campaña de marca (nombre contiene "Marca", "Brand" o CTR > 30 %) se evalúa con reglas propias (abajo). Su ROAS no se mezcla con el de adquisición.
3. **Mínimo de datos**: no se decide sobre una campaña con < 30 clics o < 1 conversión en 30 días; no se toca la estrategia de puja con < 30 conversiones en 30 días.
4. **Contaminación de PMax con marca**: si PMax tiene ROAS muy superior a Search genérica con CPC muy bajo, sospechar que está capturando búsquedas de marca. Confirmar con el informe de términos de búsqueda de PMax y aplicar exclusiones de marca a nivel cuenta antes de escalarla.

## Semáforo de escalado por campaña

Dos ventanas con roles distintos: el **ROAS de 30 días** decide la rentabilidad (rezago de conversión); la **cuota de impresiones de 7 días** diagnostica la restricción de hoy, presupuesto o ranking. El gasto medio diario de los últimos 7 días contra el presupuesto dice si el presupuesto es siquiera la restricción (bajo 80 % no lo es).

| Estado | Condición | Acción |
|---|---|---|
| Verde excelente | ROAS 30 d ≥ número mágico (y ROAS 7 d no cae > 25 %) **y** cuota perdida por presupuesto 7 d ≥ 20 % | subir +20 % el lunes |
| Verde | ROAS ok **y** cuota perdida por presupuesto 10-20 % | subir +10 % |
| Verde · puja | ROAS ok, cuota perdida por ranking ≥ 30 % y por presupuesto < 20 % | más presupuesto no compra subastas: bajar el tROAS 10-15 % (= más volumen) [verificación manual: la estrategia de puja no es visible en AgencyAnalytics] |
| Verde sin techo | ROAS ok, cuota perdida por presupuesto < 10 % o gasto medio < 80 % del presupuesto | no hay demanda que comprar con presupuesto: horizontal (nuevos temas, grupos de activos, Demand Gen) o relajar tROAS |
| Amarillo | ROAS 30 d bajo el número mágico, o ROAS 7 d cae > 25 % y queda bajo objetivo | mantener; optimizar (negativos, activos) antes de subir; con ranking ≥ 30 %, ajustar puja |
| Rojo | ROAS 30 d bajo el equilibrio | no subir; si la cuota perdida es por ranking, bajar puja o tROAS, no presupuesto |

Reglas de lectura combinadas (de `opti-google-ads-x-sarahi`):

- **Cuota perdida por presupuesto ≥ 20 % + ROAS sobre objetivo** → subir presupuesto. Es dinero sobre la mesa. Aquí el colchón no manda: la señal es de otra naturaleza que en Meta.
- **Cuota perdida por ranking alta + ROAS bajo objetivo** → bajar puja o tROAS, no subir presupuesto.
- **Cuota perdida por ranking alta + ROAS sobre objetivo** → bajar el tROAS 10-15 % (= más volumen) para ganar subastas.
- **Cuota cayendo semana a semana con presupuesto perdido bajo** → problema de puja o calidad, no de dinero.
- **Conversiones 7 d muy por debajo del promedio semanal** → puede ser rezago de conversión: releer con `conversions_by_conv_date` antes de decidir.

## Escalado vertical en Google: cómo se sube

- **Paso**: +20 % con cuota perdida por presupuesto ≥ 20 %; +10 % entre 10 y 20 %. Subidas mayores al 20 % desestabilizan la puja inteligente.
- **Reloj**: un cambio por campaña por semana, **siempre lunes**, 7 días o el ciclo de conversión si es más largo. Presupuesto y tROAS nunca la misma semana: no se sabría cuál movió el resultado.
- **Dirección de la puja, explícita**: bajar el tROAS 10-15 % = más volumen; subirlo = más eficiencia. Toda acción de puja lleva [verificación manual] porque AgencyAnalytics no expone la estrategia ni el objetivo vigente.
- **Campañas nuevas o con cambio de puja reciente**: no subir hasta salir del período de aprendizaje (7 días o ~50 conversiones).
- **Checkpoint**: a los 7 días comparar ROAS y CPA del nuevo nivel contra el anterior; si el ROAS cae más de 20 % y queda bajo objetivo, volver al presupuesto anterior.
- **Marca**: se "cubre" cuando pierde ≥ 10 % de impresiones por presupuesto o su cuota baja de 80 %: `presupuesto × (1 + cuota perdida + 5 %)`, máximo +30 %. No es escalado.

## Reglas por tipo de campaña

### Search de marca

No es escalado de adquisición: captura demanda que se creó en otro lado (Meta, orgánico, boca a boca). Reglas:

- Mantener IS ≥ 80-90 % y Lost IS (budget) < 10 %. Si pierde cuota por presupuesto, subirlo de inmediato: es la conversión más barata de la cuenta.
- Su crecimiento se lee como **termómetro de Meta**: si las impresiones y los clics de marca suben 2-3 semanas después de subir TOFU en Meta, Meta está creando demanda (señal de incrementalidad cruzada). Si TOFU sube y marca no se mueve, la incrementalidad de TOFU es dudosa.
- Excluir el ROAS de marca del "ROAS de escalado" de Google: el número que justifica subir presupuesto es el de genérica + PMax.

### Search genérica

- Escalar por presupuesto cuando Lost IS (budget) > 20 % y ROAS sobre objetivo (con colchón 25 %).
- Si el ROAS está bajo objetivo con Lost IS (rank) alto, el problema es la puja o la calidad: negativizar, mejorar anuncios, ajustar tROAS. Más presupuesto empeora el ROAS.
- Horizontal: nuevos grupos de anuncios por intención (producto, uso, "al por mayor", "mayorista"), términos de búsqueda ganadores a exact match.

### Performance Max

- Escalar por presupuesto +20 % semanal cuando ROAS ≥ objetivo y Lost IS (budget) > 20 %.
- Antes de escalar, verificar exclusiones de marca y que el feed (Merchant Center) esté sano: precios en $0 o productos desaprobados hacen que la campaña escale sobre un catálogo roto.
- Horizontal: nuevos grupos de activos por categoría o intención (no por audiencia), señales de audiencia con lista de clientes ≥ 1.000 y customer match, objetivo de **adquisición de clientes nuevos** para que el escalado sea incremental y no recompra.
- Si PMax y Shopping coexisten, consolidar en PMax antes de escalar.

### Shopping estándar, Display, YouTube, Demand Gen

- Shopping: solo si hay razón estratégica para no estar en PMax. No se escala en paralelo a PMax con el mismo feed.
- Display y YouTube standalone: solo remarketing puro o awareness con KPI propio. No se escalan por ROAS de última interacción; se evalúan con MER y brand search.
- Demand Gen: el canal horizontal natural cuando Search y PMax quedan sin techo. Se lanza con presupuesto de prueba y se juzga con MER, no con ROAS de plataforma.

## Cómo entra Google en la atribución incremental

- Google Ads reporta conversiones por clic y por visualización (`view_through_conv`) con su propio modelo (data-driven en cuenta). GA4 atribuye por último clic no directo o data-driven según la propiedad. La skill compara `conversions` de Google Ads (sin visitas a tienda) contra `transactions` de `google / cpc` en GA4: un ratio 1,0-1,5 es normal; > 2 sugiere sobre-reporte (view-through, ventanas largas, conversiones duplicadas).
- La marca se descuenta del cálculo incremental: sus compras existirían en gran parte sin la pauta. Se estima el ROAS incremental de marca con una prueba de apagado parcial o con un holdout geográfico, nunca se asume 100 %.
- PMax en modo "todos los clientes" mezcla recompra y adquisición; con el objetivo de clientes nuevos activo, el reporte de "nuevos" es la mejor aproximación a incrementalidad nativa en Google.

## Señales de alerta específicas de Google

| Señal | Lectura | Acción |
|---|---|---|
| Lost IS (budget) sube mientras el ROAS cae | la campaña gasta más rápido en tráfico peor | mantener presupuesto, revisar términos y activos |
| IS de marca cae con presupuesto perdido bajo | competidores pujando por la marca | subir puja en marca, revisar copy |
| PMax ROAS ≫ Search genérica y CPC de PMax muy bajo | PMax canibaliza marca | exclusiones de marca, reevaluar ROAS de PMax |
| Conversiones de Google Ads ≫ transacciones GA4 google/cpc | sobre-reporte | usar GA4 y MER para decidir |
| Brand search plano tras subir TOFU en Meta 3 semanas | Meta no crea demanda medible | revisar creativos TOFU, no seguir subiendo TOFU |
