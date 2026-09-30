# Reglas de escalado en Meta — marco Felipe Vergara x SARAHI

Este archivo conserva la metodología original de Felipe Vergara para escalar campañas de Meta Ads y la concilia con las reglas que SARAHI ya aplica en `optimizacion-meta-sarahi`. Es la base sobre la que la skill añade la capa de atribución incremental (ver `atribucion-incremental.md`) y Google Ads (ver `reglas-escalado-google.md`). Cargar en el paso de decisión, antes de proponer cualquier subida.

## Cuándo se escala

Solo se escala lo que está en **semáforo verde**: alcanza o supera el **número mágico** (ROAS objetivo, o costo máximo por resultado en cuentas de leads o mensajes). Un anuncio rentable es una máquina de hacer dinero; escalar es invertirle más. Lo que está por debajo del número mágico no se escala: se optimiza.

Antes de escalar, Felipe recomienda tener sitio web propio (las campañas de conversiones aprovechan mejor la IA de Meta). En SARAHI esto se traduce en un requisito de medición: píxel sano y, si el escalado es serio, Conversions API. Sin medición confiable no se puede escalar con criterio.

## Método 1 · Escalado vertical

**Qué es:** subir el presupuesto de la campaña o conjunto que ya es rentable.

### La regla de oro: máximo +35 % por subida

Con saltos mayores al 35 % Meta reinicia la fase de aprendizaje y los resultados caen. Ejemplo canónico:

| Día | Presupuesto | Nota |
|---|---|---|
| 1 | $10 / día | rentable |
| 6 | $13,50 / día (+35 %) | monitorear |
| 12 | $18,20 / día (+35 %) | monitorear |
| 18 | $24,60 / día (+35 %) | monitorear |

### Frecuencia de cambios: mínimo 5 días

Entre subida y subida deben pasar al menos 5 días, para que el conjunto salga de aprendizaje y el ROAS del nuevo nivel sea legible. Excepciones: Black Friday, Cyber, fechas especiales, o cumplir un presupuesto comprometido con el cliente.

### No cambiar de nivel

Se sigue con lo que ya es rentable: si el presupuesto está en la campaña (CBO), se sube en la campaña; si está en el conjunto (ABO), se sube en el conjunto. Cambiar de nivel puede romper el aprendizaje.

### Cuándo dejar de subir

Si al subir el presupuesto el número mágico empieza a bajar, se vuelve al presupuesto anterior y se busca el punto óptimo. No se escala vertical al infinito por dos razones:

**Razón 1 · Ley de retornos decrecientes.** A más presupuesto, el algoritmo llega a segmentos más fríos del mercado y el costo por resultado sube:

| Segmento | Temperatura | CPA |
|---|---|---|
| Innovadores | muy caliente | muy bajo |
| Visionarios | caliente | bajo |
| Pragmáticos | tibio | medio |
| Conservadores | frío | alto |
| Escépticos | muy frío | muy alto |

Por eso se escala vertical solo cuando los resultados son **excelentes**, no cuando están justo en el número mágico: hace falta colchón para absorber el aumento del CPA.

**Razón 2 · Fatiga de anuncios.** Las personas que ven el anuncio demasiadas veces dejan de responder. Se monitorea la **frecuencia de los últimos 7 días** con un límite por fase del embudo:

| Fase (nomenclatura FV) | Equivalente SARAHI | Frecuencia 7d máxima | Si se supera |
|---|---|---|---|
| Presentación | TOFU / público nuevo | < 3 | revisar tamaño de público o exclusiones |
| Evaluación + Ascensión | MOFU / público activo y clientes | < 6 | bajar presupuesto o ampliar públicos |
| Conversión | BOFU / retargeting caliente | < 10 | bajar presupuesto o ampliar públicos |

`evaluacion-ads-meta-sarahi` usa umbrales más estrictos para diagnosticar fatiga (TOFU ~1,5-2 · MOFU ~4-5 · BOFU ~5-6) combinados con ROAS 7d cayendo y hook rate bajo. Para **decidir si se puede escalar**, esta skill usa los límites de Felipe como tope duro y los de SARAHI como aviso temprano: entre el aviso y el tope se sube con paso reducido; sobre el tope no se sube.

## Método 2 · Escalado horizontal

**Qué es:** agregar variables nuevas para que Meta tenga más opciones de entregar resultados. No se agranda lo que hay: se construyen más edificios junto al que ya funciona. Es el método más sostenible porque diversifica el riesgo.

### Forma 1 · Nuevos anuncios

Cuando un conjunto funciona pero empieza a bajar, se refresca el contenido antes de apagarlo. Un conjunto ganador es una mina de oro. Qué agregar:

- **Nueva oferta:** producto, servicio o promoción.
- **Nuevo tipo de creativo:** si había testimonios, probar producto, humano, beneficios.
- **Nuevo nivel de consciencia:** si el copy era de Problema, probar Solución o Decisión.
- **Nuevo formato:** imagen ↔ video, carrusel, UGC.
- **Nuevo copy:** corto vs largo, otro gancho, otro CTA.

**Truco:** cargar 4-6 anuncios por conjunto desde el inicio y apagar la mitad. Cuando los activos se cansan, se prenden los pausados. Prender no reinicia la fase de aprendizaje; agregar anuncios nuevos sí (pero no importa si el público ya está comprobado: el triángulo oferta + audiencia + mensaje se mantiene y los resultados se recuperan rápido).

En SARAHI, la producción de esos anuncios sale del sistema **50/25/25** de `evaluacion-ads-meta-sarahi`: 50 % más de lo que funciona, 25 % variar el ángulo, 25 % renovar sobre el mismo dolor.

### Forma 2 · Nuevos conjuntos de anuncios

Duplicar o crear conjuntos con variaciones de público: intereses similares al que funcionó, ampliar edad o geografía, públicos similares (LAL) con otras fuentes (compradores 180 días, clientes de mayor valor), otras ventanas de retargeting (14 → 30 → 60 días). Cuidado: duplicar el conjunto exacto en la misma campaña hace que los anuncios compitan entre ellos; mejor campaña nueva o audiencia base distinta.

### Forma 3 · Nuevas campañas

Replicar la estructura ganadora en una campaña nueva: otro objetivo (por ejemplo mensajes para retargeting), campaña de catálogo si ya hay conversiones funcionando (con el feed sano), campaña de Ascensión si no existe, campaña de escalado CBO con los anuncios graduados del testeo (≥ 10 conversiones y ROAS sobre el número mágico).

### Forma 4 · Nuevos canales

Cuando Meta está consolidado: Google Ads (búsqueda + PMax), TikTok Ads, email y WhatsApp a la base, SEO y contenido. En esta skill Google Ads deja de ser "canal nuevo" y entra al plan con sus propias reglas (`reglas-escalado-google.md`).

## Estrategia combinada

No se elige entre vertical y horizontal: se usan los dos.

1. Lo rentable se escala vertical (paso según semáforo, cada 5 o más días).
2. En paralelo se escala horizontal (anuncios, conjuntos, campañas, canales).
3. Se monitorea siempre el número mágico y la frecuencia, y en esta skill también la atribución (MER, ratio Meta vs GA4).
4. Si lo vertical se frena, lo horizontal ya está construido como respaldo.

## Señales de alerta originales

| Señal | Qué hacer |
|---|---|
| El número mágico baja al subir presupuesto | Volver al presupuesto anterior |
| La frecuencia supera el límite de la fase | Bajar presupuesto o ampliar público |
| Un conjunto deja de funcionar | Agregar anuncios nuevos antes de apagarlo |
| Toda la cuenta depende de un conjunto | Escalar horizontal ya |

La skill suma a esta tabla las señales de atribución (ver `umbrales-y-semaforo.md`).

## Conciliación con las reglas SARAHI

| Tema | Felipe Vergara | SARAHI (optimizacion-meta-sarahi) | Regla de esta skill |
|---|---|---|---|
| Paso de subida | ≤ 35 % | 20-30 % | **El colchón fija el tamaño**: paso = 0,75 × colchón sobre el número mágico, en escalones 15 / 20 / 35 %. Colchón < 25 % → 0 % vertical (FV: "no justo en el número"; SARAHI: colchón 25-30 %). Con 47 % o más → 35 % |
| Espera entre subidas | ≥ 5 días | 48-72 h | **El aprendizaje fija el reloj**: 5 días; 7 si el conjunto está en aprendizaje; más de 2 subidas en 14 días → congelar 7. Las 72 h de SARAHI son el checkpoint para revertir (ROAS < 0,9 × número mágico o CPA > objetivo), no la ventana para volver a subir |
| Requisito de volumen | número mágico cumplido | ≥ 10 conversiones estables, colchón 25-30 % | ≥ 10 compras en 7 d (o ≥ 20 en 30 d) para leer; ≥ 25 en 7 d para pasos ≥ 30 % (ruido Poisson ±20 %) |
| Retornos decrecientes | advertir siempre | colchón 25-30 % sobre equilibrio | se mide: ROAS marginal y MER marginal entre escalones (ver `atribucion-incremental.md`); tope ×2 del presupuesto inicial en 28 días hasta tener marginal limpio |
| Nivel del presupuesto | no cambiar | — | no cambiar; CBO admite presupuesto + anuncios nuevos el mismo día, ABO solo presupuesto |
| Frecuencia | tope por fase | aviso por etapa | aviso SARAHI = un escalón menos; tope FV = no subir; fatiga (frecuencia + ROAS 7 d < 0,8 × 30 d + CTR 7 d < 0,8 × 30 d) = renovar anuncios antes de subir |
| Fechas especiales | excepción a la cadencia | — | cadencia 48 h y **tope 35 % se mantiene**; solo lo excelente con ≥ 20 compras en 7 d; el resto congelado; reversión al cierre |
| Atribución | — | mentalidad escéptica ante ROAS altos | semáforo de atribución de cuenta: amarillo ≤ 20 %; rojo ≤ 15 % en público nuevo y 0 % en públicos calientes (≤ 15 % solo si su piso GA4 supera el número mágico) hasta tener factor medido; sin GA4 ni pedidos ≤ 15 % |
