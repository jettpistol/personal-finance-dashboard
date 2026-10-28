import { strToU8, zipSync } from 'fflate'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export type SheetRow = string[]

/**
 * Builds a workbook shaped like Galicia's export: `x:` namespace prefix, absolute part paths,
 * no cell references and every cell typed t="str".
 */
export function galiciaStyleXlsx(rows: SheetRow[]): Uint8Array {
  const sheetRows = rows
    .map((cells, i) => `<x:row r="${i + 1}">${cells.map((c) => `<x:c s="0" t="str"><x:v>${esc(c)}</x:v></x:c>`).join('')}</x:row>`)
    .join('')
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const head = '﻿<?xml version="1.0" encoding="utf-8"?>'
  return zipSync({
    'xl/workbook.xml': strToU8(`${head}<x:workbook xmlns:x="${ns}"><x:sheets><x:sheet name="Cuentas" sheetId="1" r:id="R1" xmlns:r="${rel}" /></x:sheets></x:workbook>`),
    '_rels/.rels': strToU8(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="${rel}/officeDocument" Target="/xl/workbook.xml" Id="R0" /></Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(`${head}<x:worksheet xmlns:x="${ns}"><x:sheetData>${sheetRows}</x:sheetData></x:worksheet>`),
  })
}

/** A conventional workbook: shared strings, inline strings, numbers and cell references. */
export function standardXlsx(): Uint8Array {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  return zipSync({
    'xl/sharedStrings.xml': strToU8(`<?xml version="1.0"?><sst xmlns="${ns}"><si><t>hola</t></si><si><r><t>ra</t></r><r><t>ro</t></r></si></sst>`),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0"?><worksheet xmlns="${ns}"><sheetData>` +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>inline</t></is></c></row>' +
        '<row r="2"><c r="B2"><v>42</v></c><c r="C2" t="s"><v>1</v></c></row>' +
        '</sheetData></worksheet>',
    ),
  })
}

const HEADER: SheetRow = ['Fecha', 'Movimiento', 'Débito', 'Crédito', 'Saldo Parcial', 'Comentarios']

/** Rows newest-first, exactly like the real export. Balance column has no thousands separator. */
export function sampleAccountXlsx(): Uint8Array {
  return galiciaStyleXlsx([
    ['Banco Galicia - Caja Ahorro Pesos'],
    ['Nro. de Cuenta: ...1234567'],
    ['Fecha Actual: 24/10/2026'],
    ['Hora Actual: 13:55'],
    ['Intervalo de Consulta: del 01/09/2026 al 26/10/2026'],
    HEADER,
    ['26/10/2026', ' Compra venta de dolares\n JUAN PEREZ\n 20111111112\n OPERACION 1\n Venta Moneda Extranjera: Dólares\n Cotizacion: 1495.00000000000000\n', '0,00', '300.000,00', '400000,00', ''],
    ['20/10/2026', ' PAGO TARJETA VISA\n OPERACION 6110337483\n', '-50.000,00', '0,00', '100000,00', ''],
    ['14/10/2026', ' COMPRA DEBITO\n MERPAGO*OLLIEFOOD\n 4517XXXXXXXXXX88\n A894', '-8.750,00', '0,00', '150000,00', ''],
    ['14/10/2026', ' TRANSFERENCIA A TERCEROS\n MARIA GOMEZ\n 27222222223\n VARIOS\n', '-30.000,00', '0,00', '158750,00', ''],
    ['05/10/2026', ' ACREDITAMIENTO DE HABERES\n ACME SA\n 30711111111\n ACRED.HABERES\n', '0,00', '1.188.750,00', '188750,00', ''],
    ['01/10/2026', ' REINTEGRO PROMOCION GALICIA\n Uber\n', '0,00', '1.000,00', '-1000000,00', ''],
  ])
}
