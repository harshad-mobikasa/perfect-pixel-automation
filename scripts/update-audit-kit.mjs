import { spawn } from 'node:child_process'
import { join } from 'node:path'

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

async function main() {
  if (process.env.AUDIT_KIT_AUTO_UPDATE === 'false') {
    console.log('Skipping audit-kit auto-update (AUDIT_KIT_AUTO_UPDATE=false)')
    return
  }

  if (!process.env.NPM_TOKEN) {
    console.warn('Skipping audit-kit auto-update: NPM_TOKEN is not set. Using the installed version.')
    return
  }

  console.log('Installing latest @sahilmobikasa/storefront-audit-kit')
  await run('npm', ['install', '@sahilmobikasa/storefront-audit-kit@latest', '--ignore-scripts', '--no-save'])
  await run(process.execPath, [join(process.cwd(), 'scripts', 'patch-audit-kit.mjs')])
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
