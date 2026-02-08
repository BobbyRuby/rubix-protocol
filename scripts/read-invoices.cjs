const ExcelJS = require('exceljs');

async function readInvoice(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const name = file.split('\\').pop();
  console.log('=== ' + name + ' (Sheet: ' + ws.name + ') ===');

  // Print column widths
  const colWidths = [];
  ws.columns.forEach((col, i) => {
    if (col.width) colWidths.push(String.fromCharCode(65+i) + '=' + col.width.toFixed(1));
  });
  console.log('ColWidths: ' + colWidths.join(', '));

  // Print merged cells
  const merges = Object.keys(ws._merges || {});
  if (merges.length) console.log('Merges: ' + merges.join(', '));

  ws.eachRow({ includeEmpty: false }, (row, num) => {
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      let v = cell.value;
      let extra = '';

      // Get font info for first few important rows
      if (cell.font && (cell.font.bold || cell.font.size || cell.font.name)) {
        const f = cell.font;
        const parts = [];
        if (f.name) parts.push(f.name);
        if (f.size) parts.push(f.size + 'pt');
        if (f.bold) parts.push('B');
        if (f.color && f.color.argb) parts.push('#' + f.color.argb);
        extra = '[' + parts.join(',') + ']';
      }

      if (v && typeof v === 'object' && v.formula) {
        v = '{=' + v.formula + '}';
      } else if (v && typeof v === 'object' && v.richText) {
        v = v.richText.map(r => r.text).join('');
      } else if (v instanceof Date) {
        v = v.toISOString().split('T')[0];
      }

      const colLetter = String.fromCharCode(64 + col);
      vals.push(colLetter + ':' + (v != null ? String(v) : '') + extra);
    });
    console.log('R' + num + ' | ' + vals.join(' | '));
  });
  console.log('\n');
}

(async () => {
  const files = [
    'D:\\Clients\\DQE\\DQE Invoices\\2025\\MOE25096- 51 DUKE ST.xlsx',
    'D:\\Clients\\DQE\\DQE Invoices\\2025\\MOE25097 - 12 N PRINCE.xlsx',
    'D:\\Clients\\DQE\\DQE Invoices\\2025\\MOE25098 - 42 N WATER.xlsx',
    'D:\\Clients\\DQE\\DQE Invoices\\2025\\MOE25100 - 20 N WATER.xlsx',
    'D:\\Clients\\DQE\\DQE Invoices\\2025\\MOE25100A - 1397 ARCADIA.xlsx',
    'D:\\Clients\\DQE\\DQE Invoices\\2025\\MOE25099 - 227 E CHUSTNUT.xlsx',
  ];
  for (const f of files) {
    try {
      await readInvoice(f);
    } catch (e) {
      console.log('ERROR reading ' + f + ': ' + e.message);
    }
  }
})();
