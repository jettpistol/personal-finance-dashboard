import { formatMinor } from '../src/domain/money'
import { parseGaliciaFile } from '../src'
import { categorize } from '../src'

// Usage: npm run inspect -- <statement.pdf|extracto.xlsx> [--unclassified]
const [path, ...flags] = process.argv.slice(2)
if (!path) {
  console.error('Usage: npm run inspect -- <statement.pdf|extracto.xlsx> [--unclassified]')
  process.exit(1)
}

const statement = await parseGaliciaFile(path)
console.log(`${statement.kind} ${statement.kind === 'card' ? statement.issuer : 'account'} — ${statement.transactions.length} transactions`)
console.log('Integrity:', statement.integrity.ok ? 'OK' : 'FAILED')
for (const c of statement.integrity.checks) console.log(` ${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : ` expected=${c.expected} actual=${c.actual} ${c.detail ?? ''}`}`)
for (const w of statement.warnings) console.log(' !', w)

const byCategory = new Map<string, number>()
const unclassified = new Map<string, number>()
for (const tx of statement.transactions) {
  const { category } = categorize(tx)
  if (!category) {
    if (tx.merchant) unclassified.set(tx.merchant, (unclassified.get(tx.merchant) ?? 0) + 1)
    continue
  }
  if (tx.currency === 'ARS') byCategory.set(category, (byCategory.get(category) ?? 0) + tx.amountMinor)
}
console.log('\nARS by category:')
for (const [cat, total] of [...byCategory].sort((a, b) => a[1] - b[1])) console.log(`  ${cat.padEnd(18)} ${formatMinor(total)}`)
if (flags.includes('--unclassified')) {
  console.log('\nUnclassified merchants:')
  for (const [m, n] of [...unclassified].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x ${m}`)
}
