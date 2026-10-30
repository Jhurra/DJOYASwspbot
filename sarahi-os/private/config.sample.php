<?php
/* SARAHI OS — configuración. Copia este archivo como config.php y complétalo. No lo compartas. */
return [
    // Código que se pide una sola vez, al crear el primer administrador
    'setup_code' => 'CAMBIA-ESTE-CODIGO',
    // Nombre del archivo de la base de datos (dentro de private/data). Usa algo difícil de adivinar.
    'db_file' => 'sarahi-CAMBIA-ESTO.sqlite',
    // Clave de la API de Anthropic para los resúmenes con IA (console.anthropic.com). Vacía = IA desactivada.
    'anthropic_api_key' => '',
    'ai_model' => 'claude-opus-5-5',
    'ai_effort' => 'low',
    // Resúmenes con IA por día para quienes no son administradores
    'ai_daily_limit' => 20,
    // Dirección pública, por ejemplo https://os.sarahiagency.com (vacía = se detecta sola)
    'base_url' => '',
    // Sitios cuyos formularios pueden enviar leads
    'form_allowed_hosts' => ['sarahiagency.com', 'www.sarahiagency.com'],
    'timezone' => 'America/Santiago',
];
