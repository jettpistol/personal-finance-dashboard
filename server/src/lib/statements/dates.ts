const MONTHS_ES: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

const fullYear = (yy: number) => (yy < 100 ? 2000 + yy : yy)

/** "26/10/2026" or "29/09/25" -> "2026-10-26" */
export function parseSlashDate(text: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(text.trim())
  if (!m) throw new Error(`Invalid date: "${text}"`)
  return iso(fullYear(Number(m[3])), Number(m[2]), Number(m[1]))
}

/** "17-01-26" -> "2026-01-17" */
export function parseDashDate(text: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(text.trim())
  if (!m) throw new Error(`Invalid date: "${text}"`)
  return iso(fullYear(Number(m[3])), Number(m[2]), Number(m[1]))
}

/** "27-Ago-26" -> "2026-08-27" */
export function parseDashMonthDate(text: string): string {
  const m = /^(\d{2})-([A-Za-zñÑ]{3})-(\d{2})$/.exec(text.trim())
  const month = m ? MONTHS_ES[m[2]!.toLowerCase()] : undefined
  if (!m || !month) throw new Error(`Invalid date: "${text}"`)
  return iso(fullYear(Number(m[3])), month, Number(m[1]))
}

/** "Octubre/26" -> "2026-10" */
export function parseMonthYear(text: string): string {
  const m = /^([A-Za-zñÑ]+)\/(\d{2})$/.exec(text.trim())
  const month = m ? MONTHS_ES[m[1]!.toLowerCase()] : undefined
  if (!m || !month) throw new Error(`Invalid month: "${text}"`)
  return `${fullYear(Number(m[2]))}-${String(month).padStart(2, '0')}`
}
