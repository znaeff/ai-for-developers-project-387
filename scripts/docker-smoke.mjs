import { execFileSync } from 'node:child_process'

const image = 'calendar-booking:local'
const container = 'calendar-booking-smoke'
const baseUrl = 'http://127.0.0.1:3100'

function docker(args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe' })
}

async function waitForServer() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/`)
      if (response.ok) {
        return
      }
    } catch {
      // The port-forward may not be ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(`Docker container did not become ready at ${baseUrl}`)
}

async function expectResponse(path, status, includes) {
  const response = await fetch(`${baseUrl}${path}`)
  if (response.status !== status) {
    throw new Error(`${path}: expected ${status}, received ${response.status}`)
  }

  if (includes) {
    const body = await response.text()
    if (!body.includes(includes)) {
      throw new Error(`${path}: response does not include ${includes}`)
    }
  }
}

try {
  try {
    docker(['rm', '-f', container])
  } catch {
    // A stale container does not exist.
  }

  docker([
    'run',
    '--rm',
    '-d',
    '--name',
    container,
    '-p',
    '3100:3000',
    image,
  ])

  await waitForServer()

  await expectResponse('/', 200, 'Календарь звонков')
  await expectResponse('/guest', 200, 'Календарь звонков')
  await expectResponse('/owner', 200, 'Календарь звонков')
  await expectResponse('/api/meeting-types', 200)
  await expectResponse('/api/bookings', 200)

  const reset = await fetch(`${baseUrl}/api/__test__/reset`, { method: 'POST' })
  if (reset.status !== 404) {
    throw new Error(
      `/api/__test__/reset: expected 404, received ${reset.status}`,
    )
  }

  console.log('Docker smoke test passed')
} finally {
  try {
    docker(['rm', '-f', container])
  } catch {
    // The container may not have been created.
  }
}
