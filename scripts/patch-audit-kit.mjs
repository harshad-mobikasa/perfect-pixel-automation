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
const pageHelpersPath = join(
  process.cwd(),
  'node_modules',
  '@sahilmobikasa',
  'storefront-audit-kit',
  'dist',
  'utils',
  'page-helpers.js',
)
const pixelmatchSpecPath = join(
  process.cwd(),
  'node_modules',
  '@sahilmobikasa',
  'storefront-audit-kit',
  'dist',
  'tests',
  'pixelmatch',
  'pixelmatch.spec.js',
)

const originalSnippet = 'await page.goto(pageTargetUrl, { waitUntil: "load" });'
const brokenPatchedSnippet =
  'await page.goto(pageTargetUrl, { waitUntil: constants_1.PAGE_GOTO_OPTIONS.waitUntil, timeout: constants_1.PAGE_GOTO_OPTIONS.timeout });'
const patchedSnippet =
  'await page.goto(pageTargetUrl, { waitUntil: "domcontentloaded", timeout: 90000 });'
const originalWorkersSnippet = 'workers: process.env.CI ? 1 : undefined,'
const patchedWorkersSnippet =
  'workers: process.env.PLAYWRIGHT_WORKERS ? Number.parseInt(process.env.PLAYWRIGHT_WORKERS, 10) || 1 : process.env.CI ? 1 : undefined,'
const originalDeviceBucketSnippet =
  'function getDeviceBucket(projectName) {\n    return projectName.toLowerCase().includes("mobile") ? "mobile" : "desktop";\n}'
const patchedDeviceBucketSnippet = `function getDeviceBucket(projectName) {
    const normalized = projectName.toLowerCase();
    return normalized.includes("mobile") ||
        normalized.includes("iphone") ||
        normalized.includes("android") ||
        normalized.includes("pixel") ||
        normalized.includes("galaxy")
        ? "mobile"
        : "desktop";
}`
const originalPixelmatchScreenshotSnippet = 'await section.screenshot({ path: actualImagePath });'
const patchedPixelmatchScreenshotSnippet =
  'await section.screenshot({ path: actualImagePath, scale: "css" });'

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

async function patchHideElementsForScreenshot() {
  const source = await readFile(pageHelpersPath, 'utf8')
  const marker = 'HIDE_MATCHED_FIXED_ANCESTORS_PATCH'

  if (source.includes(marker)) {
    console.log('audit-kit hide-elements patch already applied')
    return
  }

  const originalFn = `async function hideElementsForScreenshot(page, options = {}) {
    const selectors = options.selectors ?? [];
    const hideFixed = options.hideFixed ?? false;
    const hideSticky = options.hideSticky ?? false;
    if (selectors.length === 0 && !hideFixed && !hideSticky) {
        return;
    }
    await page.evaluate(({ selectorList, shouldHideFixed, shouldHideSticky }) => {
        const hidden = new Map();
        const hideElement = (element) => {
            if (hidden.has(element)) {
                return;
            }
            const htmlElement = element;
            hidden.set(element, {
                visibility: htmlElement.style.visibility,
                opacity: htmlElement.style.opacity,
                pointerEvents: htmlElement.style.pointerEvents,
            });
            htmlElement.style.setProperty("visibility", "hidden", "important");
            htmlElement.style.setProperty("opacity", "0", "important");
            htmlElement.style.setProperty("pointer-events", "none", "important");
        };
        for (const selector of selectorList) {
            document.querySelectorAll(selector).forEach(hideElement);
        }
        if (shouldHideFixed || shouldHideSticky) {
            document.querySelectorAll("body *").forEach((element) => {
                const position = window.getComputedStyle(element).position;
                if ((shouldHideFixed && position === "fixed") || (shouldHideSticky && position === "sticky")) {
                    hideElement(element);
                }
            });
        }
        window.__pwScreenshotHidden =
            hidden;
    }, {
        selectorList: selectors,
        shouldHideFixed: hideFixed,
        shouldHideSticky: hideSticky,
    });
}
async function restoreElementsAfterScreenshot(page) {
    await page.evaluate(() => {
        const hidden = window
            .__pwScreenshotHidden;
        if (!hidden) {
            return;
        }
        for (const [element, state] of hidden.entries()) {
            const htmlElement = element;
            htmlElement.style.visibility = state.visibility;
            htmlElement.style.opacity = state.opacity;
            htmlElement.style.pointerEvents = state.pointerEvents;
        }
        delete window
            .__pwScreenshotHidden;
    });
}`

  const patchedFn = `async function hideElementsForScreenshot(page, options = {}) {
    // ${marker}
    const selectors = options.selectors ?? [];
    const hideFixed = options.hideFixed ?? false;
    const hideSticky = options.hideSticky ?? false;
    if (selectors.length === 0 && !hideFixed && !hideSticky) {
        return;
    }
    await page.evaluate(({ selectorList, shouldHideFixed, shouldHideSticky }) => {
        const hidden = new Map();
        const hideElement = (element) => {
            if (hidden.has(element)) {
                return;
            }
            const htmlElement = element;
            hidden.set(element, {
                visibility: htmlElement.style.visibility,
                opacity: htmlElement.style.opacity,
                pointerEvents: htmlElement.style.pointerEvents,
                display: htmlElement.style.display,
            });
            htmlElement.style.setProperty("visibility", "hidden", "important");
            htmlElement.style.setProperty("opacity", "0", "important");
            htmlElement.style.setProperty("pointer-events", "none", "important");
            htmlElement.style.setProperty("display", "none", "important");
        };
        const hideFixedAncestors = (element) => {
            let parent = element.parentElement;
            while (parent && parent !== document.body) {
                const position = window.getComputedStyle(parent).position;
                if (position === "fixed" || position === "sticky") {
                    hideElement(parent);
                }
                parent = parent.parentElement;
            }
        };
        for (const selector of selectorList) {
            document.querySelectorAll(selector).forEach((element) => {
                hideElement(element);
                hideFixedAncestors(element);
            });
        }
        if (shouldHideFixed || shouldHideSticky) {
            document.querySelectorAll("body *").forEach((element) => {
                const position = window.getComputedStyle(element).position;
                if ((shouldHideFixed && position === "fixed") || (shouldHideSticky && position === "sticky")) {
                    hideElement(element);
                }
            });
        }
        window.__pwScreenshotHidden =
            hidden;
    }, {
        selectorList: selectors,
        shouldHideFixed: hideFixed,
        shouldHideSticky: hideSticky,
    });
}
async function restoreElementsAfterScreenshot(page) {
    await page.evaluate(() => {
        const hidden = window
            .__pwScreenshotHidden;
        if (!hidden) {
            return;
        }
        for (const [element, state] of hidden.entries()) {
            const htmlElement = element;
            htmlElement.style.visibility = state.visibility;
            htmlElement.style.opacity = state.opacity;
            htmlElement.style.pointerEvents = state.pointerEvents;
            if (Object.prototype.hasOwnProperty.call(state, "display")) {
                htmlElement.style.display = state.display;
            }
        }
        delete window
            .__pwScreenshotHidden;
    });
}`

  if (!source.includes(originalFn)) {
    console.warn('audit-kit hide-elements patch skipped: expected function not found')
    return
  }

  await writeFile(pageHelpersPath, source.replace(originalFn, patchedFn))
  console.log('Applied audit-kit hide-elements ancestor patch')
}

async function patchDeviceBucketDetection() {
  const source = await readFile(pageHelpersPath, 'utf8')

  if (source.includes(patchedDeviceBucketSnippet)) {
    console.log('audit-kit device-bucket patch already applied')
    return
  }

  if (!source.includes(originalDeviceBucketSnippet)) {
    console.warn('audit-kit device-bucket patch skipped: expected function not found')
    return
  }

  await writeFile(
    pageHelpersPath,
    source.replace(originalDeviceBucketSnippet, patchedDeviceBucketSnippet),
  )
  console.log('Applied audit-kit device-bucket patch')
}

async function patchPixelmatchScreenshotScale() {
  const source = await readFile(pixelmatchSpecPath, 'utf8')

  if (source.includes(patchedPixelmatchScreenshotSnippet)) {
    console.log('audit-kit pixelmatch screenshot-scale patch already applied')
    return
  }

  if (!source.includes(originalPixelmatchScreenshotSnippet)) {
    console.warn('audit-kit pixelmatch screenshot-scale patch skipped: expected snippet not found')
    return
  }

  await writeFile(
    pixelmatchSpecPath,
    source.replace(originalPixelmatchScreenshotSnippet, patchedPixelmatchScreenshotSnippet),
  )
  console.log('Applied audit-kit pixelmatch screenshot-scale patch')
}

try {
  await patchAdaSpec()
  await patchPlaywrightConfig()
  await patchHideElementsForScreenshot()
  await patchDeviceBucketDetection()
  await patchPixelmatchScreenshotScale()
} catch (error) {
  console.warn(`audit-kit patch skipped: ${error instanceof Error ? error.message : String(error)}`)
}
