import { readFile, stat } from 'node:fs/promises'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { extname, resolve, sep } from 'node:path'
import {
  busyIntervals,
  createBookingStore,
  parseBookingInput,
  type BookingStore,
} from './bookings.js'
import {
  createMeetingTypeStore,
  parseMeetingTypeInput,
  type MeetingTypeStore,
} from './meeting-types.js'
import { generateSlots } from './slots.js'

type ServerOptions = {
  staticDir?: string
  apiPrefix?: string
  now?: () => Date
  allowTestReset?: boolean
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export function createServer(options: ServerOptions = {}): Server {
  const staticDir = options.staticDir ? resolve(options.staticDir) : undefined
  const apiPrefix = options.apiPrefix?.replace(/\/+$/, '')
  const now = options.now ?? (() => new Date())
  const meetingTypes = createMeetingTypeStore()
  const bookings = createBookingStore(meetingTypes)

  return createHttpServer((request, response) => {
    void handleRequest(
      request,
      response,
      staticDir,
      apiPrefix,
      meetingTypes,
      bookings,
      now,
      options.allowTestReset ?? false,
    )
  })
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  staticDir: string | undefined,
  apiPrefix: string | undefined,
  meetingTypes: MeetingTypeStore,
  bookings: BookingStore,
  now: () => Date,
  allowTestReset: boolean,
): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const isApiRequest = apiPrefix
      ? url.pathname === apiPrefix || url.pathname.startsWith(`${apiPrefix}/`)
      : false

    let pathname = url.pathname
    if (isApiRequest && apiPrefix) {
      pathname = pathname.slice(apiPrefix.length) || '/'
    }

    if (request.method === 'GET' && pathname === '/reserve') {
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Reserved')
      return
    }

    if (request.method === 'POST' && pathname === '/cleanup') {
      meetingTypes.clear()
      bookings.clear()
      response.writeHead(204)
      response.end()
      return
    }

    if (
      allowTestReset &&
      request.method === 'POST' &&
      pathname === '/__test__/reset'
    ) {
      meetingTypes.clear()
      bookings.clear()
      response.writeHead(204)
      response.end()
      return
    }

    if (request.method === 'GET' && pathname === '/meeting-types') {
      sendJson(response, 200, meetingTypes.list())
      return
    }

    if (request.method === 'POST' && pathname === '/meeting-types') {
      const body = await readJsonBody(request)
      if (!body.ok) {
        sendJson(response, 400, { error: body.error })
        return
      }

      const parsed = parseMeetingTypeInput(body.value)
      if (!parsed.ok) {
        sendJson(response, 400, { error: parsed.error })
        return
      }

      const created = meetingTypes.create(parsed.value)
      if (!created.ok) {
        sendJson(response, 409, {
          error: `Тип встречи с длительностью ${parsed.value.durationMinutes} минут уже существует`,
        })
        return
      }

      sendJson(response, 201, created.meetingType)
      return
    }

    const slotsMatch = /^\/meeting-types\/([^/]+)\/slots$/.exec(pathname)
    if (request.method === 'GET' && slotsMatch) {
      const meetingType = meetingTypes.find(slotsMatch[1])
      if (!meetingType) {
        sendJson(response, 404, { error: 'Тип встречи не найден' })
        return
      }

      const busy = busyIntervals(bookings.list(), meetingTypes)
      sendJson(response, 200, generateSlots(meetingType, now(), busy))
      return
    }

    if (request.method === 'GET' && pathname === '/bookings') {
      const onlyUpcoming = url.searchParams.get('upcoming') === 'true'
      const allBookings = bookings.list()
      const upcomingBookings = onlyUpcoming
        ? allBookings.filter(
            (booking) => Date.parse(booking.startsAt) >= now().getTime(),
          )
        : allBookings

      sendJson(response, 200, upcomingBookings)
      return
    }

    if (request.method === 'POST' && pathname === '/bookings') {
      const body = await readJsonBody(request)
      if (!body.ok) {
        sendJson(response, 400, { error: body.error })
        return
      }

      const parsed = parseBookingInput(body.value)
      if (!parsed.ok) {
        sendJson(response, 400, { error: parsed.error })
        return
      }

      const meetingType = meetingTypes.find(parsed.value.meetingTypeId)
      if (!meetingType) {
        sendJson(response, 404, { error: 'Тип встречи не найден' })
        return
      }

      const created = bookings.create(meetingType, parsed.value, now())
      if (!created.ok) {
        if (created.reason === 'invalid-slot') {
          sendJson(response, 400, { error: 'Выбранный слот недоступен' })
        } else {
          sendJson(response, 409, { error: 'Слот уже занят' })
        }
        return
      }

      sendJson(response, 201, created.booking)
      return
    }

    if (
      isApiRequest ||
      !staticDir ||
      (request.method !== 'GET' && request.method !== 'HEAD')
    ) {
      sendNotFound(response)
      return
    }

    await serveStaticFile(pathname, request.method === 'HEAD', response, staticDir)
  } catch {
    sendNotFound(response)
  }
}

async function serveStaticFile(
  pathname: string,
  headOnly: boolean,
  response: ServerResponse,
  staticDir: string,
): Promise<void> {
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    sendNotFound(response)
    return
  }

  const relativePath = decodedPath.replace(/^\/+/, '')
  const requestedPath = resolve(staticDir, relativePath)
  if (requestedPath !== staticDir && !requestedPath.startsWith(`${staticDir}${sep}`)) {
    sendNotFound(response)
    return
  }

  let filePath = requestedPath
  try {
    const info = await stat(filePath)
    if (info.isDirectory()) {
      filePath = resolve(filePath, 'index.html')
    }
  } catch {
    if (extname(decodedPath)) {
      sendNotFound(response)
      return
    }
    filePath = resolve(staticDir, 'index.html')
  }

  try {
    const body = await readFile(filePath)
    const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    response.writeHead(200, { 'Content-Type': contentType })
    response.end(headOnly ? undefined : body)
  } catch {
    sendNotFound(response)
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

const MAX_BODY_BYTES = 1024 * 1024

async function readJsonBody(request: IncomingMessage): Promise<JsonBodyResult> {
  const chunks: Buffer[] = []
  let size = 0

  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
      size += buffer.length
      if (size > MAX_BODY_BYTES) {
        return { ok: false, error: 'Тело запроса слишком большое' }
      }
      chunks.push(buffer)
    }
  } catch {
    return { ok: false, error: 'Не удалось прочитать тело запроса' }
  }

  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { ok: false, error: 'Некорректный JSON в теле запроса' }
  }
}

function sendNotFound(response: ServerResponse): void {
  if (response.headersSent) {
    response.end()
    return
  }
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end('Not Found')
}
