<?php
define('SOS', true);
require __DIR__ . '/core.php';
require __DIR__ . '/perms.php';
require __DIR__ . '/inbound.php';
require __DIR__ . '/ai.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('X-Frame-Options: DENY');
