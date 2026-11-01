import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { READERS } from '../../src/lib/statements/registry.js'

// Every template the app can read is documented in docs/templates (see its README): notes for the
// next coding session, a row in the index and a sample image that the app shows under Ejemplo.
const docs = new URL('../../../docs/templates/', import.meta.url)
const index = readFileSync(new URL('README.md', docs), 'utf8')

describe('template catalogue', () => {
  for (const r of READERS) {
    it(`documents ${r.id}`, () => {
      expect(existsSync(new URL(`${r.id}.md`, docs)), `docs/templates/${r.id}.md`).toBe(true)
      expect(existsSync(new URL(`samples/${r.id}.png`, docs)), `docs/templates/samples/${r.id}.png (npm run template-samples)`).toBe(true)
      expect(index, `a row in docs/templates/README.md linking ${r.id}.md`).toContain(`(${r.id}.md)`)
    })
  }

  it('lists nothing the app cannot read', () => {
    const linked = [...index.matchAll(/\]\(([\w-]+)\.md\)/g)].map((m) => m[1])
    expect(linked.filter((id) => !READERS.some((r) => r.id === id))).toEqual([])
  })
})
