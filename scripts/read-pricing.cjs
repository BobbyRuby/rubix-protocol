const ExcelJS = require('exceljs');

async function readFile(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  wb.worksheets.forEach(ws => {
    console.log('=== ' + file.split('\\').pop() + ' / Sheet: ' + ws.name + ' ===');
    ws.eachRow({ includeEmpty: false }, (row, num) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        let v = cell.value;
        if (v && typeof v === 'object' && v.richText) v = v.richText.map(r => r.text).join('');
        if (v && typeof v === 'object' && v.formula) v = '{=' + v.formula + '}';
        if (v instanceof Date) v = v.toISOString().split('T')[0];
        const c = String.fromCharCode(64 + col);
        vals.push(c + ':' + (v != null ? String(v) : ''));
      });
      console.log('R' + num + ' | ' + vals.join(' | '));
    });
    console.log('');
  });
}

(async () => {
  await readFile('D:\\Clients\\DQE\\Pricing-as-of-04-03-2025.xlsx');
  await readFile('D:\\Clients\\DQE\\ContractorPricing-04-03-2025.xlsx');
})().catch(e => console.error(e.message));
