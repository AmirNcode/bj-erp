import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const SKIP = [
  join('app', '[locale]', '(print)'),
  join('components', 'CredentialsDownload.tsx'),
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const rel = relative(ROOT, p)
    if (SKIP.some((s) => rel === s || rel.startsWith(s + sep))) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

describe('font sizes use scaled tokens', () => {
  it('has no arbitrary px/rem/em text sizes or literal inline fontSize', () => {
    const arbitrary = /text-\[\d[^\]]*(px|rem|em)\]/
    const inline = /fontSize\s*:\s*['"`]?\d/
    const hits: string[] = []
    for (const dir of ['app', 'components']) {
      for (const file of walk(join(ROOT, dir))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (arbitrary.test(line) || inline.test(line)) {
              hits.push(`${relative(ROOT, file)}:${i + 1}`)
            }
          })
      }
    }
    expect(hits).toEqual([])
  })
})
