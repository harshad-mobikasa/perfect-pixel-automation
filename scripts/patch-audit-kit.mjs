import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const adaSpecPath = join(
  process.cwd(),
  'node_modules',
  '@sahilmobikasa',
  'storefront-audit-kit',
  'dist',
  'tests',
  'ada',
  'ada.spec.js',
)

const originalSnippet = 'await page.goto(pageTargetUrl, { waitUntil: "load" });'
const brokenPatchedSnippet =
  'await page.goto(pageTargetUrl, { waitUntil: constants_1.PAGE_GOTO_OPTIONS.waitUntil, timeout: constants_1.PAGE_GOTO_OPTIONS.timeout });'
const patchedSnippet =
  'await page.goto(pageTargetUrl, { waitUntil: "domcontentloaded", timeout: 90000 });'

try {
  const source = await readFile(adaSpecPath, 'utf8')

  if (source.includes(patchedSnippet)) {
    console.log('audit-kit ADA patch already applied')
    process.exit(0)
  }

  if (source.includes(brokenPatchedSnippet)) {
    await writeFile(adaSpecPath, source.replace(brokenPatchedSnippet, patchedSnippet))
    console.log('Repaired broken audit-kit ADA navigation patch')
    process.exit(0)
  }

  if (!source.includes(originalSnippet)) {
    console.warn('audit-kit ADA patch skipped: expected snippet not found')
    process.exit(0)
  }

  await writeFile(adaSpecPath, source.replace(originalSnippet, patchedSnippet))
  console.log('Applied audit-kit ADA navigation patch')
} catch (error) {
  console.warn(`audit-kit ADA patch skipped: ${error instanceof Error ? error.message : String(error)}`)
}
