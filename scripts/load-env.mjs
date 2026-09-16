import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const initialEnv = new Set(Object.keys(process.env))

function loadEnvFile(fileName) {
  const filePath = resolve(process.cwd(), fileName)
  if (!existsSync(filePath)) return

  const contents = readFileSync(filePath, 'utf8')
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/)
    if (!match) continue

    const key = match[1]
    if (initialEnv.has(key)) continue

    let value = match[2] ?? ''
    value = value.trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/, '').trim()
    }

    process.env[key] = value
  }
}

loadEnvFile('.env')
loadEnvFile('.env.local')
