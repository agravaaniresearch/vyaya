/*
 * Builds dist/vyaya-standalone.html: one self-contained file with the styles,
 * scripts and current data inlined, for offline use or e-mailing. The repository
 * page (index.html) remains the source of truth and reads the data files live.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const data = {
  assumptions: JSON.parse(read('data/assumptions.json')),
  tariffs: JSON.parse(read('data/electricity_tariffs.json')),
  compute: JSON.parse(read('data/compute_prices.json')),
  sources: JSON.parse(read('data/sources.json')),
  formulas: JSON.parse(read('data/formulas.json')),
  openItems: JSON.parse(read('data/open_items.json'))
};
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="css/vyaya.css">', () => '<style>\n' + read('css/vyaya.css') + '\n</style>');
const inline = (src) => '<script>\n' + safe(read(src)) + '\n</script>';
html = html.replace('<script src="vendor/chart.umd.min.js"></script>', () => inline('vendor/chart.umd.min.js'));
html = html.replace('<script src="vendor/pptxgen.bundle.js"></script>', () => inline('vendor/pptxgen.bundle.js'));
html = html.replace('<script src="js/engine.js"></script>', () => '<script>window.VYAYA_DATA = ' + safe(JSON.stringify(data)) + ';</script>\n' + inline('js/engine.js'));
html = html.replace('<script src="js/app.js"></script>', () => inline('js/app.js'));
if (/src="(vendor|js)\//.test(html) || /href="css\//.test(html)) throw new Error('An asset was not inlined');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'vyaya-standalone.html'), html);
console.log('Wrote dist/vyaya-standalone.html (' + Math.round(html.length / 1024) + ' KB)');
