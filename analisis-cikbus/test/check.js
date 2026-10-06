const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium/chrome-linux/chrome' }).catch(async () => chromium.launch());
  const results = {};
  for (const [name, file] of [['single', '../analisis-marca-cikbus-2026-10-05.html'], ['cms', 'test-cms.html'], ['duro', 'test-cms-duro.html']]) {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      await page.goto('file://' + path.resolve(__dirname, file));
      await page.waitForTimeout(600);
      const data = await page.evaluate(() => {
        const r = {};
        r.scrollOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        r.sections = document.querySelectorAll('.sarcik .ck-section').length;
        r.tables = document.querySelectorAll('.sarcik table').length;
        r.tocLinks = document.querySelectorAll('.sarcik .ck-toc a').length;
        r.bodyBg = getComputedStyle(document.body).backgroundColor;
        const h1 = document.querySelector('header h1');
        r.themeH1Font = h1 ? getComputedStyle(h1).fontFamily : null;
        const card = document.querySelector('footer .card');
        r.themeCardBg = card ? getComputedStyle(card).backgroundColor : null;
        const ourH2 = document.querySelector('.sarcik .ck-title');
        r.ourH2Font = ourH2 ? getComputedStyle(ourH2).fontFamily : null;
        r.ourH2Color = ourH2 ? getComputedStyle(ourH2).color : null;
        r.metricOverflow = Array.from(document.querySelectorAll('.sarcik .ck-metric-value')).some(el => el.scrollWidth > el.clientWidth + 1);
        r.listaFlag = document.querySelector('.sarcik').getAttribute('data-ck-lista');
        r.printBtn = !!document.getElementById('ck-print');
        return r;
      });
      data.cmp = await page.evaluate(() => {
        const c = document.querySelector('.sarcik #ck-cmp'); if (!c) return null;
        const vis = Array.from(c.querySelectorAll('.ck-panel')).filter(p => getComputedStyle(p).display !== 'none').map(p => p.getAttribute('data-ck-panel'));
        const widths = Array.from(c.querySelectorAll('[data-ck-panel="ig"] .ck-bar-fill')).map(f => f.style.width);
        const pend = c.querySelectorAll('.ck-bar-pend').length;
        const over = Array.from(c.querySelectorAll('.ck-bar-v,.ck-bar-n')).some(e => e.scrollWidth > e.clientWidth + 1);
        return { vis, widths, pend, over };
      });
      await page.click('.sarcik #ck-cmp [data-ck-tab="meta"]');
      data.cmpMeta = await page.evaluate(() => {
        const c = document.querySelector('.sarcik #ck-cmp');
        const vis = Array.from(c.querySelectorAll('.ck-panel')).filter(p => getComputedStyle(p).display !== 'none').map(p => p.getAttribute('data-ck-panel'));
        const widths = Array.from(c.querySelectorAll('[data-ck-panel="meta"] .ck-bar-fill')).map(f => f.style.width);
        return { vis, widths, pressed: c.querySelector('[aria-pressed="true"]').getAttribute('data-ck-tab') };
      });
      if (name === 'single' || name === 'duro') {
        await page.click('.sarcik #ck-cmp [data-ck-tab="ig"]');
        const el = await page.$('.sarcik #ck-cmp');
        await el.screenshot({ path: path.resolve(__dirname, 'shot-cmp-' + name + '-' + width + '.png') });
      }
      // click a toc link and check active class
      await page.click('.sarcik .ck-toc a[href="#ck-s3"]');
      await page.waitForTimeout(900);
      data.activeAfterClick = await page.evaluate(() => { const a = document.querySelector('.sarcik .ck-toc a.ck-on'); return a ? a.getAttribute('href') : null; });
      data.errors = errors;
      results[name + '@' + width] = data;
      if (name === 'single' && width === 1280) {
        await page.goto('file://' + path.resolve(__dirname, file));
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.resolve(__dirname, 'shot-1280-top.png'), fullPage: false });
        await page.screenshot({ path: path.resolve(__dirname, 'shot-1280-full.png'), fullPage: true });
      }
      if (name === 'single' && width === 390) {
        await page.goto('file://' + path.resolve(__dirname, file));
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.resolve(__dirname, 'shot-390-top.png'), fullPage: false });
      }
      if (name === 'cms' && width === 1280) {
        await page.goto('file://' + path.resolve(__dirname, file));
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.resolve(__dirname, 'shot-cms-1280.png'), fullPage: false });
      }
      await page.close();
    }
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
