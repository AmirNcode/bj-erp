import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { readXlsx, writeXlsx } from '@/lib/sales/xlsx';

describe('xlsx round trip', () => {
  it('keeps text, Persian, XML characters, numbers and gaps', () => {
    const rows = [
      ['Rec', 'شرکت', 'A & B <c> "q"', null, 'last'],
      [8997, 12.5, null, 'x'],
      [],
      [null, null, 'after a blank row'],
    ];
    const [sheet] = readXlsx(writeXlsx('BJ Contract', rows));
    expect(sheet.name).toBe('BJ Contract');
    expect(sheet.rows[0]).toEqual(['Rec', 'شرکت', 'A & B <c> "q"', null, 'last']);
    expect(sheet.rows[1]).toEqual([8997, 12.5, null, 'x']);
    expect(sheet.rows[2]).toEqual([]);
    expect(sheet.rows[3]).toEqual([null, null, 'after a blank row']);
  });

  it('keeps leading and trailing spaces in text', () => {
    const [sheet] = readXlsx(writeXlsx('S', [[' 1403/02/19', 'x ']]));
    expect(sheet.rows[0]).toEqual([' 1403/02/19', 'x ']);
  });
});

describe('reading a workbook written by Excel', () => {
  const head = '<?xml version="1.0" encoding="UTF-8"?>';
  const file = (sheetXml: string, shared: string) =>
    zipSync({
      'xl/workbook.xml': strToU8(
        `${head}<workbook xmlns:r="x"><sheets><sheet name="Data &amp; more" sheetId="4" r:id="rId7"/></sheets></workbook>`
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        `${head}<Relationships><Relationship Id="rId7" Type="t" Target="worksheets/sheet4.xml"/></Relationships>`
      ),
      'xl/sharedStrings.xml': strToU8(`${head}<sst>${shared}</sst>`),
      'xl/worksheets/sheet4.xml': strToU8(`${head}<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`),
    });

  it('reads shared strings (plain and rich), formula text, errors, booleans, sparse cells', () => {
    const bytes = file(
      '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="C2" t="s"><v>1</v></c>' +
        '<c r="D2" t="str"><f>A1&amp;"x"</f><v>joined</v></c><c r="E2" t="e"><v>#VALUE!</v></c>' +
        '<c r="F2" t="b"><v>1</v></c><c r="G2" s="3"/><c r="AB2"><v>17700000000</v></c></row>',
      '<si><t>Rec</t></si><si><r><rPr><b/></rPr><t xml:space="preserve">Order </t></r><r><t>Date</t></r><rPh><t>skip</t></rPh></si>'
    );
    const [sheet] = readXlsx(bytes);
    expect(sheet.name).toBe('Data & more');
    expect(sheet.rows[0]).toEqual([]);
    const row = sheet.rows[1];
    expect(row.slice(0, 7)).toEqual(['Rec', null, 'Order Date', 'joined', '#VALUE!', 'TRUE', null]);
    expect(row[27]).toBe(17700000000);
  });

  it('rejects a file that is not a workbook', () => {
    expect(() => readXlsx(strToU8('Rec,Company\n1,x'))).toThrow('not an xlsx file');
    expect(() => readXlsx(zipSync({ 'a.txt': strToU8('x') }))).toThrow('not an xlsx file');
  });
});
