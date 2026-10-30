import { extractPdfText } from './pdf-text.js';
import type { Statement } from './types.js';
import { readFirstSheet } from './xlsx-reader.js';
import { parseGaliciaAccountText } from './galicia/account-pdf.js';
import { parseGaliciaAccountXlsx } from './galicia/account-xlsx.js';
import { parseGaliciaCardText } from './galicia/card-text.js';
import { isNaranjaXStatement, parseNaranjaXCardText } from './naranjax/card-text.js';

export type FileKind = 'pdf' | 'xlsx';

/** What the screen shows about a reader. Spanish, because it is read by the user. */
export interface ReaderInfo {
  id: string;
  institution: string;
  product: string;
  document: string;
  fileType: FileKind;
  /** Which kind of account the movements belong to in the app. */
  target: 'bank' | 'card';
  currencies: Array<'ARS' | 'USD'>;
  reads: string[];
  howToGet: string;
  checks: string[];
  limits: string[];
}

/** The uploaded file, with its text already extracted when it is a PDF. */
export interface FileContent {
  fileName: string;
  fileType: FileKind;
  data: Uint8Array;
  text: string | null;
}

export interface StatementReader extends ReaderInfo {
  /**
   * Gmail search for the emails that bring this format as an attachment, for formats the bank
   * sends by email. The fetcher (lib/mail-statements.ts) only looks at what these queries find.
   */
  mailQuery?: string;
  detect(file: FileContent): boolean;
  read(file: FileContent): Statement;
}

export class UnrecognisedFile extends Error {}

const CARD_COMMON = {
  institution: 'Banco Galicia',
  fileType: 'pdf' as const,
  target: 'card' as const,
  currencies: ['ARS', 'USD'] as Array<'ARS' | 'USD'>,
  reads: [
    'Cada compra con fecha, comercio, monto y cuota «X de Y».',
    'Consumos en dólares, que quedan en dólares.',
    'Intereses, impuestos y sellos como renglones aparte.',
    'Pagos del resumen, fechas de cierre y vencimiento, total a pagar, pago mínimo, tasas y límites.',
    'Cuotas a vencer: lo que ya está comprometido para los próximos meses.',
  ],
  howToGet: 'Descargar el resumen de la tarjeta en PDF desde el home banking de Galicia.',
  checks: [
    'Saldo anterior + pagos + consumos + cargos = total a pagar, en pesos y en dólares por separado.',
    'La suma de las compras coincide con «Total Consumos».',
  ],
  limits: [
    'Los consumos en dólares solo se importan a una cuenta en dólares; en una cuenta en pesos quedan sin marcar.',
    'Las líneas de pago del resumen quedan sin marcar: el pago ya figura en el extracto de la cuenta bancaria.',
    'Las cuotas se cargan con la fecha de cierre del resumen y el número de cuota en la descripción.',
    'Las marcas «*», «K» y «F» que el banco imprime junto al comercio no se interpretan.',
  ],
};

export const READERS: StatementReader[] = [
  {
    id: 'galicia-account-xlsx',
    institution: 'Banco Galicia',
    product: 'Caja de Ahorro en pesos',
    document: 'Extracto en Excel',
    fileType: 'xlsx',
    target: 'bank',
    currencies: ['ARS'],
    reads: [
      'Fecha, descripción, débito, crédito y saldo de cada movimiento.',
      'Comercio, o nombre y CUIL/CUIT de la contraparte, cuando figuran.',
      'Tipo de operación: compras con débito, transferencias, sueldo, pago de tarjeta, reintegros, compra y venta de dólares, débitos automáticos y extracciones.',
    ],
    howToGet: 'Descargar los movimientos de la caja de ahorro en formato Excel (.xlsx) desde el home banking de Galicia.',
    checks: ['El saldo de cada movimiento coincide con el saldo anterior más el monto del movimiento.'],
    limits: [
      'Solo cajas de ahorro en pesos.',
      'Los movimientos con fecha posterior a la del archivo se avisan, pero se leen.',
      'Las transferencias entre cuentas propias y los pagos de tarjeta se proponen como transferencias: hay que elegir la otra cuenta.',
    ],
    detect: (f) => f.fileType === 'xlsx' && hasGaliciaHeader(f.data),
    read: (f) => parseGaliciaAccountXlsx(f.data),
  },
  {
    id: 'galicia-account-pdf',
    institution: 'Banco Galicia',
    product: 'Caja de Ahorro en pesos',
    document: 'Resumen mensual en PDF',
    fileType: 'pdf',
    target: 'bank',
    currencies: ['ARS'],
    reads: [
      'Los mismos datos que el extracto en Excel: fecha, descripción, monto, saldo, comercio y contraparte.',
      'El período del resumen y los totales impresos.',
    ],
    howToGet: 'Descargar el resumen mensual de la caja de ahorro en PDF desde el home banking de Galicia.',
    checks: [
      'El saldo de cada movimiento coincide con el anterior más el monto.',
      'Los totales de créditos, débitos y el saldo final coinciden con los impresos al pie.',
    ],
    limits: [
      'El PDF debe tener texto (el que entrega el banco); una foto o un escaneo no se puede leer.',
      'Si también se dispone del Excel, conviene usarlo: trae más meses en un solo archivo.',
    ],
    detect: (f) => f.fileType === 'pdf' && /Resumen de Caja de Ahorro/i.test(head(f)),
    read: (f) => parseGaliciaAccountText(f.text ?? ''),
  },
  {
    id: 'galicia-card-visa',
    ...CARD_COMMON,
    product: 'Tarjeta de crédito Visa',
    document: 'Resumen en PDF',
    detect: (f) => f.fileType === 'pdf' && /Tarjeta Cr[eé]dito\s+VISA/i.test(head(f)),
    read: (f) => parseGaliciaCardText(f.text ?? ''),
  },
  {
    id: 'galicia-card-amex',
    ...CARD_COMMON,
    product: 'Tarjeta de crédito American Express',
    document: 'Resumen en PDF',
    detect: (f) => f.fileType === 'pdf' && /Tarjeta Cr[eé]dito\s+AMERICAN EXPRESS/i.test(head(f)),
    read: (f) => parseGaliciaCardText(f.text ?? ''),
  },
  {
    id: 'naranjax-card',
    institution: 'Naranja X',
    product: 'Tarjetas de crédito',
    document: 'Resumen de cuenta en PDF',
    fileType: 'pdf',
    target: 'card',
    currencies: ['ARS', 'USD'],
    reads: [
      'Un solo resumen para todas las tarjetas de la cuenta (físicas y virtual): cada compra indica con qué tarjeta se hizo.',
      'Cada compra con fecha, comercio, monto y cuota «X de Y».',
      'Intereses, mantenimiento, IVA y sellos como renglones aparte.',
      'El pago del resumen anterior, fechas de cierre y vencimiento, total a pagar, pago mínimo, tasas y límites.',
      'Cuotas futuras: lo que ya está comprometido para los próximos meses.',
    ],
    howToGet: 'Llega todos los meses por correo como «ResumenDeCuenta_<fecha>.pdf». Se puede traer solo conectando Gmail en Ajustes → Resúmenes por correo, o descargar desde la app de Naranja X y subirlo acá.',
    checks: [
      'Saldo anterior − pagos + consumos + otros cargos = total a pagar.',
      'La suma de las compras de cada titular coincide con el subtotal impreso.',
      'El total del detalle coincide con el total a pagar de la primera hoja.',
    ],
    limits: [
      'Todas las tarjetas de la cuenta van a una misma cuenta de la app; la tarjeta queda en la nota de cada movimiento.',
      'Los consumos en dólares solo se importan a una cuenta en dólares. Si el resumen no imprime un total en dólares, se avisa para revisarlos a mano.',
      'La línea de pago del resumen anterior queda sin marcar: el pago ya figura en la cuenta desde la que se pagó.',
      'Las compras en un pago («01») no llevan cuota; un plan distinto de «X/Y» se avisa y se importa como compra en un pago.',
    ],
    mailQuery: 'from:naranjax.com has:attachment filename:pdf',
    detect: (f) => f.fileType === 'pdf' && isNaranjaXStatement(f.text ?? ''),
    read: (f) => parseNaranjaXCardText(f.text ?? ''),
  },
];

const head = (f: FileContent) => (f.text ?? '').slice(0, 800);

function hasGaliciaHeader(data: Uint8Array): boolean {
  try {
    return readFirstSheet(data).some((r) => r[0]?.trim() === 'Fecha' && /Movimiento/.test(r[1] ?? ''));
  } catch {
    return false;
  }
}

export function readerInfo(r: StatementReader): ReaderInfo {
  const { detect: _d, read: _r, mailQuery: _m, ...info } = r;
  return info;
}

/** Looks at the bytes, not the file name, and extracts the text of a PDF. */
export async function loadContent(fileName: string, data: Uint8Array): Promise<FileContent> {
  const startsWith = (s: string) => s.split('').every((ch, i) => data[i] === ch.charCodeAt(0));
  if (startsWith('%PDF')) {
    const text = await extractPdfText(data);
    if (!text.trim()) throw new UnrecognisedFile('El PDF no tiene texto: parece una foto o un escaneo. Descargá el resumen original del banco.');
    return { fileName, fileType: 'pdf', data, text };
  }
  if (startsWith('PK')) return { fileName, fileType: 'xlsx', data, text: null };
  throw new UnrecognisedFile('Solo se pueden leer archivos PDF y Excel (.xlsx).');
}

/** Finds the reader that recognises the file and reads it. */
export async function readStatement(fileName: string, data: Uint8Array): Promise<{ reader: ReaderInfo; statement: Statement }> {
  const file = await loadContent(fileName, data);
  const reader = READERS.find((r) => r.detect(file));
  if (!reader) {
    throw new UnrecognisedFile(
      `No se reconoce este ${file.fileType === 'pdf' ? 'PDF' : 'archivo de Excel'}. Los formatos disponibles son: ${READERS.map((r) => `${r.institution}, ${r.product} (${r.document})`).join('; ')}.`,
    );
  }
  return { reader: readerInfo(reader), statement: reader.read(file) };
}
