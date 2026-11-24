// browser_test.js -- headless-browser test of docs/index.html (the static JS version):
// uploads a test case, sets seed / patient ID column / spots, and compares the generated allocation,
// the Debug text and the downloaded CSV byte-for-byte with reference.R (R 3.5.2).
// usage: node browser_test.js [case=c02_two_cov_wait] [config=01]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const cs = process.argv[2] || 'c02_two_cov_wait', j = process.argv[3] || '01';
const dir = path.join(__dirname, 'cases', cs);
const cfg = JSON.parse(fs.readFileSync(path.join(dir, `config_${j}.json`), 'utf8'));
const rdir = path.join(dir, (cfg.samplekind === 'Rounding' ? 'r352_' : 'r363_') + j);
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  const problems = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await page.goto('file://' + path.join(__dirname, '..', 'docs', 'index.html'));
  await page.waitForFunction(() => window.GTA);
  const report = { case: cs, config: j, samplekind: cfg.samplekind };
  const now = new Date();
  report.defaultSeed = await page.inputValue('#RandomSeed');
  report.defaultSeedIsToday = report.defaultSeed === String(now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate());
  report.defaultSampleKind = await page.inputValue('#samplekind');
  await page.fill('#RandomSeed', String(cfg.seed));
  await page.click('details.adv summary');
  await page.selectOption('#samplekind', cfg.samplekind);
  await page.setInputFiles('#existing_patients', path.join(dir, 'existing.csv'));
  await page.waitForSelector('#tblExisting table', { state: 'attached' });
  report.spotsAfterExistingUpload = await page.inputValue('#spots_k');
  await page.setInputFiles('#new_patients', path.join(dir, 'new.csv'));
  await page.waitForSelector('#tblNew table', { state: 'attached' });
  report.pidChoices = await page.$$eval('#patient_id option', o => o.map(x => x.value));
  await page.selectOption('#patient_id', cfg.pid === '' ? '\u0000none' : cfg.pid);
  await page.fill('#spots_k', cfg.spots);
  const t0 = Date.now();
  await page.waitForFunction(() => document.querySelector('#tblAlloc table, #tblAlloc .err'));
  report.computeMs = Date.now() - t0;
  await page.click('button[data-tab="tab-alloc"]');
  const shown = await page.$$eval('#tblAlloc tbody tr', trs => trs.map(tr => Array.from(tr.cells).map(td => td.textContent)));
  const r = JSON.parse(fs.readFileSync(path.join(rdir, 'result.json'), 'utf8'));
  report.allocationEqualsR = r.alloc ? JSON.stringify(shown) === JSON.stringify(r.alloc.rows.map(row => [].concat(row).map(v => v === null ? 'NA' : v))) : null;
  await page.click('button[data-tab="tab-debug"]');
  const dbg = (await page.textContent('#debug')).replace(/[ ]+$/gm, '');
  report.debugEqualsR = dbg === fs.readFileSync(path.join(rdir, 'debug.txt'), 'utf8').replace(/\n$/, '').replace(/[ ]+$/gm, '');
  if (!(await page.isDisabled('#downloadFile'))) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadFile')]);
    const f = path.join(__dirname, 'browser_download.csv'); await dl.saveAs(f);
    report.downloadName = dl.suggestedFilename();
    report.downloadEqualsR = fs.readFileSync(f).equals(fs.readFileSync(path.join(rdir, 'download.csv')));
  } else report.downloadDisabled = true;
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.click('button[data-tab="tab-alloc"]');
  await page.screenshot({ path: path.join(__dirname, 'browser_screenshot.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 800 });
  report.horizontalScrollAtPhoneWidth = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  report.consoleProblems = problems;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
