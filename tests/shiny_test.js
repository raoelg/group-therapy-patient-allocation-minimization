// shiny_test.js -- drives the ORIGINAL Shiny app (Docker image, shiny/) in a headless browser:
// uploads a test case, sets seed / patient ID column / spots, waits for the allocation and compares
// the "Download All" CSV byte-for-byte with reference.R's download.csv (R 3.5.2).
// usage: node shiny_test.js <case> [config=01] [url=http://127.0.0.1:3838/grouptherapy/]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const cs = process.argv[2] || 'c02_two_cov_wait', j = process.argv[3] || '01';
const url = process.argv[4] || 'http://127.0.0.1:3838/grouptherapy/';
const dir = path.join(__dirname, 'cases', cs);
const cfg = JSON.parse(fs.readFileSync(path.join(dir, `config_${j}.json`), 'utf8'));
(async () => {
  const browser = await chromium.launch({ args: ['--no-proxy-server'] });
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  const report = { case: cs, config: j };
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForSelector('#RandomSeed', { timeout: 120000 });
  report.loadSeconds = (Date.now() - t0) / 1000;
  report.title = await page.title();
  report.defaultSeed = await page.inputValue('#RandomSeed');
  report.defaultSpots = await page.inputValue('#spots_k');
  report.randomnessDisabled = await page.evaluate(() => { const e = document.getElementById('randomness'); return !!(e && (e.disabled || e.getAttribute('disabled') !== null)); });
  await page.fill('#RandomSeed', String(cfg.seed));
  await page.setInputFiles('#existing_patients', path.join(dir, 'existing.csv'));
  await page.waitForFunction(() => /= 0/.test(document.getElementById('spots_k').value), null, { timeout: 30000 });
  report.spotsAfterExistingUpload = await page.inputValue('#spots_k');
  await page.setInputFiles('#new_patients', path.join(dir, 'new.csv'));
  await page.waitForTimeout(1500);
  report.pidChoices = await page.evaluate(() => Array.from(document.querySelectorAll('#patient_id option')).map(o => o.value));
  if (cfg.pid) await page.evaluate(v => { const s = $('#patient_id')[0].selectize; if (s) s.setValue(v); else $('#patient_id').val(v).trigger('change'); }, cfg.pid);
  await page.fill('#spots_k', cfg.spots);
  await page.dispatchEvent('#spots_k', 'change');
  await page.waitForTimeout(3000);
  // Generated allocation tab
  await page.click('text=Generated allocation');
  await page.waitForTimeout(1000);
  report.allocationTable = await page.evaluate(() => Array.from(document.querySelectorAll('table')).map(t => t.innerText).filter(s => /arm/.test(s)).pop() || null);
  await page.click('text=Debug');
  await page.waitForTimeout(1000);
  report.debugTail = await page.evaluate(() => { const p = Array.from(document.querySelectorAll('pre')).map(x => x.innerText).pop() || ''; return p.split('\n').slice(-8).join('\n'); });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#downloadFile')]);
  const f = path.join(__dirname, 'shiny_download.csv');
  await dl.saveAs(f);
  report.downloadName = dl.suggestedFilename();
  const rcsv = path.join(dir, `r352_${j}`, 'download.csv');
  report.downloadEqualsReferenceR = fs.existsSync(rcsv) && fs.readFileSync(f).equals(fs.readFileSync(rcsv));
  await page.screenshot({ path: path.join(__dirname, 'shiny_screenshot.png'), fullPage: true });
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
