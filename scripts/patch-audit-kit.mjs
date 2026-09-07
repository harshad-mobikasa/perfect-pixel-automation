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
const playwrightConfigPath = join(
  process.cwd(),
  'node_modules',
  '@sahilmobikasa',
  'storefront-audit-kit',
  'dist',
  'playwright.config.js',
)

const originalSnippet = 'await page.goto(pageTargetUrl, { waitUntil: "load" });'
const brokenPatchedSnippet =
  'await page.goto(pageTargetUrl, { waitUntil: constants_1.PAGE_GOTO_OPTIONS.waitUntil, timeout: constants_1.PAGE_GOTO_OPTIONS.timeout });'
const patchedSnippet =
  'await page.goto(pageTargetUrl, { waitUntil: "domcontentloaded", timeout: 90000 });'
const originalWorkersSnippet = 'workers: process.env.CI ? 1 : undefined,'
const patchedWorkersSnippet =
  'workers: process.env.PLAYWRIGHT_WORKERS ? Number.parseInt(process.env.PLAYWRIGHT_WORKERS, 10) || 1 : process.env.CI ? 1 : undefined,'

async function patchAdaSpec() {
  const source = await readFile(adaSpecPath, 'utf8')

  if (source.includes(patchedSnippet)) {
    console.log('audit-kit ADA patch already applied')
    return
  }

  if (source.includes(brokenPatchedSnippet)) {
    await writeFile(adaSpecPath, source.replace(brokenPatchedSnippet, patchedSnippet))
    console.log('Repaired broken audit-kit ADA navigation patch')
    return
  }

  if (!source.includes(originalSnippet)) {
    console.warn('audit-kit ADA patch skipped: expected snippet not found')
    return
  }

  await writeFile(adaSpecPath, source.replace(originalSnippet, patchedSnippet))
  console.log('Applied audit-kit ADA navigation patch')
}

async function patchPlaywrightConfig() {
  const source = await readFile(playwrightConfigPath, 'utf8')

  if (source.includes(patchedWorkersSnippet)) {
    console.log('audit-kit Playwright worker patch already applied')
    return
  }

  if (!source.includes(originalWorkersSnippet)) {
    console.warn('audit-kit Playwright worker patch skipped: expected snippet not found')
    return
  }

  await writeFile(
    playwrightConfigPath,
    source.replace(originalWorkersSnippet, patchedWorkersSnippet),
  )
  console.log('Applied audit-kit Playwright worker patch')
}

try {
  await patchAdaSpec()
  await patchPlaywrightConfig()
} catch (error) {
  console.warn(`audit-kit patch skipped: ${error instanceof Error ? error.message : String(error)}`)
}
