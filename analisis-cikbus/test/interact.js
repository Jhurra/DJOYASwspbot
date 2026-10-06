const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  for (const f of ['../analisis-marca-cikbus-elite-2026-10-05.html', 'test-cms-duro.html']) {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto('file://' + path.resolve(__dirname, f)); await p.waitForTimeout(400);
    const res = [];
    for (const dim of ['general', 'personal', 'puntualidad', 'limpieza', 'wifi']) {
      await p.click(`#ck-seg button[data-dim="${dim}"]`); await p.waitForTimeout(80);
      res.push(await p.evaluate(d => ({ d, pressed: document.querySelector('#ck-seg button[aria-pressed="true"]').dataset.dim, bars: [...document.querySelectorAll('#ck-chart-rating text')].map(t => t.textContent).filter(t => /,/.test(t)).join(' '), v: document.querySelector('#ck-verdict').textContent }), dim));
    }
    const ads = await p.evaluate(() => [...document.querySelectorAll('#ck-chart-ads text')].map(t => t.textContent).join('|'));
    console.log(f, 'errores', errs); res.forEach(r => console.log(' ', r.d, r.pressed === r.d, r.bars, '·', r.v)); console.log('  ads:', ads);
    if (f.startsWith('..')) { await p.click('#ck-seg button[data-dim="puntualidad"]'); await p.locator('#ck-explora').scrollIntoViewIfNeeded(); await p.screenshot({ path: 'shot-explora.png' }); await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: 'shot-top.png' }); await p.locator('#ck-s3 .ck-chartcard').scrollIntoViewIfNeeded(); await p.screenshot({ path: 'shot-ads.png' }); }
    await p.close();
  }
  const m = await b.newPage({ viewport: { width: 390, height: 900 } }); await m.goto('file://' + path.resolve(__dirname, '../analisis-marca-cikbus-elite-2026-10-05.html')); await m.waitForTimeout(300); await m.screenshot({ path: 'shot-390.png' });
  await b.close();
})();
