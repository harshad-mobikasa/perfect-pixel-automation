import { spawn } from 'node:child_process'

const role = (process.env.APP_ROLE ?? 'web').trim().toLowerCase()
const script = role === 'worker' ? 'worker' : 'start'

const child = spawn('npm', ['run', script], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
