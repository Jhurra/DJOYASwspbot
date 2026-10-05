const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto('file://' + path.resolve(__dirname, '../analisis-marca-cikbus-elite-2026-10-05.html'));
  await page.waitForTimeout(500);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log('height', h);
  const ys = [1700, 3400, 5600, 7800, 10500, 13500];
  for (const y of ys) {
    await page.evaluate(v => window.scrollTo(0, v), y);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.resolve(__dirname, `slice-${y}.png`) });
  }
  await browser.close();
})();
