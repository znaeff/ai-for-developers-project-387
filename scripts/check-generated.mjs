import { execFileSync } from 'node:child_process'

execFileSync('pnpm', ['generate'], { stdio: 'inherit' })

const status = execFileSync(
  'git',
  [
    'status',
    '--porcelain',
    '--',
    'contracts/openapi',
    'apps/frontend/src/api/generated',
  ],
  { encoding: 'utf8' },
)

if (status.trim() !== '') {
  console.error('Generated API artifacts are out of date:')
  console.error(status)
  console.error('Run `mise run generate` and commit the result.')
  process.exit(1)
}
