<?php
/* SARAHI OS — resúmenes con Claude (transcripciones y «La semana» de cada cliente). La clave vive solo en config.php. */
defined('SOS') or exit;

function ai_enabled(): bool
{
    return (string) config('anthropic_api_key', '') !== '' && is_file(__DIR__ . '/../vendor/autoload.php');
}

/** Devuelve el texto de la respuesta. Lanza RuntimeException con un mensaje para el usuario. */
function ai_complete(string $prompt): string
{
    if (!ai_enabled()) throw new RuntimeException('El resumen con IA no está activo: falta la clave de Anthropic en config.php');
    require_once __DIR__ . '/../vendor/autoload.php';
    @set_time_limit(300);
    $client = new Anthropic\Client(apiKey: (string) config('anthropic_api_key'), baseUrl: config('anthropic_base_url') ?: null);
    try {
        $msg = $client->beta->messages->create(
            model: (string) config('ai_model', 'claude-opus-5-5'),
            maxTokens: 16000,
            messages: [['role' => 'user', 'content' => $prompt]],
            outputConfig: ['effort' => (string) config('ai_effort', 'low')],
            // Si el modelo declina por política, la API reintenta sola con el modelo de respaldo
            fallbacks: 'default',
            betas: ['server-side-fallback-2026-07-01'],
        );
    } catch (Anthropic\Core\Exceptions\APIStatusException $e) {
        $type = $e->type?->value ?? '';
        if ($type === 'rate_limit_error' || $type === 'overloaded_error') throw new RuntimeException('La IA está saturada. Espera un minuto y vuelve a intentarlo.');
        if ($type === 'authentication_error') throw new RuntimeException('La clave de Anthropic en config.php no es válida.');
        throw new RuntimeException('La IA respondió con un error: ' . $e->getMessage());
    } catch (Throwable $e) {
        throw new RuntimeException('No se pudo conectar con la IA: ' . $e->getMessage());
    }
    if ($msg->stopReason === 'refusal') throw new RuntimeException('La IA no quiso procesar este contenido.');
    $text = '';
    foreach ($msg->content as $block) if ($block->type === 'text') $text .= $block->text;
    if (trim($text) === '') throw new RuntimeException('La IA no devolvió texto. Vuelve a intentarlo.');
    return $text;
}

/** Extrae el objeto JSON de la respuesta (acepta que venga entre ```json ... ```). */
function ai_parse_json(string $text)
{
    $t = trim($text);
    if (preg_match('/```(?:json)?\s*(.+?)```/s', $t, $m)) $t = trim($m[1]);
    $start = strpos($t, '{');
    $end = strrpos($t, '}');
    if ($start === false || $end === false) throw new RuntimeException('La respuesta de la IA no trajo el formato esperado. Vuelve a intentarlo.');
    $d = json_decode(substr($t, $start, $end - $start + 1));
    if (!is_object($d)) throw new RuntimeException('La respuesta de la IA no trajo el formato esperado. Vuelve a intentarlo.');
    return $d;
}
