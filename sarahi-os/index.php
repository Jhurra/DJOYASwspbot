<?php
/* SARAHI OS — página de entrada: instalación (la primera vez), inicio de sesión o la aplicación. */
require __DIR__ . '/private/lib/bootstrap.php';

$v = '1';
$setup = users_count() === 0;
$user = $setup ? null : current_user();
$hasSeed = is_file(__DIR__ . '/private/data/seed.json');
header('Content-Security-Policy: default-src \'self\'; script-src \'self\' https://cdnjs.cloudflare.com; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src \'self\' data: https:; connect-src \'self\'; frame-ancestors \'none\'');
?><!doctype html>
<html lang="es" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>SARAHI OS</title>
<link rel="icon" href="assets/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Poppins:wght@500;600&display=swap">
<link rel="stylesheet" href="assets/app.css?v=<?= $v ?>">
<?php if (!$user): ?><link rel="stylesheet" href="assets/login.css?v=<?= $v ?>"><?php endif; ?>
</head>
<body>
<?php if ($user): ?>
<div id="app"></div>
<script src="assets/adapter.js?v=<?= $v ?>"></script>
<script src="assets/app.js?v=<?= $v ?>"></script>
<?php else: ?>
<main class="auth">
  <form class="auth-card" id="auth-form" novalidate>
    <div class="auth-brand"><div class="logo">S</div><div><b>SARAHI</b> <span>OS</span></div></div>
    <?php if ($setup): ?>
      <h1>Instalación</h1>
      <p class="muted">Crea tu usuario de administrador. Solo se hace una vez.</p>
      <label class="fld"><span>Código de instalación</span><input name="code" autocomplete="off" required></label>
      <label class="fld"><span>Tu nombre</span><input name="name" autocomplete="name" required></label>
      <label class="fld"><span>Email</span><input name="email" type="email" autocomplete="username" required></label>
      <label class="fld"><span>Contraseña (mínimo 10 caracteres)</span><input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
      <?php if ($hasSeed): ?><label class="chk"><input type="checkbox" name="import" checked> Cargar mis tableros, clientes y reuniones (copia incluida)</label><?php endif; ?>
      <button class="btn primary" type="submit">Instalar y entrar</button>
    <?php else: ?>
      <h1>Hola de nuevo</h1>
      <p class="muted">Entra con tu email y tu contraseña.</p>
      <label class="fld"><span>Email</span><input name="email" type="email" autocomplete="username" required autofocus></label>
      <label class="fld"><span>Contraseña</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary" type="submit">Entrar</button>
    <?php endif; ?>
    <p class="auth-err" id="auth-err" role="alert"></p>
  </form>
</main>
<script src="assets/login.js?v=<?= $v ?>" data-mode="<?= $setup ? 'setup' : 'login' ?>"></script>
<?php endif; ?>
</body>
</html>
