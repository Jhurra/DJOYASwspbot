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
