import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Extracts text keeping the column layout, which the statement parsers rely on.
 * Requires poppler-utils (`pdftotext`).
 */
export async function extractPdfText(path: string): Promise<string> {
  try {
    const { stdout } = await run('pdftotext', ['-layout', path, '-'], { maxBuffer: 32 * 1024 * 1024 })
    return stdout
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('pdftotext not found. Install poppler-utils (apt install poppler-utils / brew install poppler).')
    }
    throw err
  }
}
