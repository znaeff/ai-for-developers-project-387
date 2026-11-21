import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { createServer } from './app.js'
import type { MeetingType } from './meeting-types.js'

let servers: Server[] = []

async function startServer(options?: {
  apiPrefix?: string
  now?: () => Date
  allowTestReset?: boolean
}): Promise<AddressInfo> {
  const current = createServer(options)
  servers.push(current)
  await new Promise<void>((resolve) => current.listen(0, '127.0.0.1', resolve))
  return current.address() as AddressInfo
}

async function createMeetingType(
  port: number,
  input: {
    title?: string
    description?: string
    durationMinutes: number
  },
): Promise<MeetingType> {
  const response = await fetch(`http://127.0.0.1:${port}/meeting-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: input.title ?? 'Знакомство',
      description: input.description ?? '',
      durationMinutes: input.durationMinutes,
    }),
  })

  return (await response.json()) as MeetingType
}

async function getSlots(
  port: number,
  meetingTypeId: string,
): Promise<{ startsAt: string; endsAt: string; isAvailable: boolean }[]> {
  const response = await fetch(
    `http://127.0.0.1:${port}/meeting-types/${meetingTypeId}/slots`,
  )

  return (await response.json()) as {
    startsAt: string
    endsAt: string
    isAvailable: boolean
  }[]
}

async function getBookings(
  port: number,
  prefix = '',
): Promise<Record<string, unknown>[]> {
  const response = await fetch(`http://127.0.0.1:${port}${prefix}/bookings`)

  return (await response.json()) as Record<string, unknown>[]
}

async function bookSlot(
  port: number,
  input: {
    meetingTypeId: string
    startsAt: string
    guestName?: string
    guestEmail?: string
  },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guestName: input.guestName ?? 'Анна',
      guestEmail: input.guestEmail ?? 'anna@example.com',
      ...input,
    }),
  })

  const text = await response.text()
  let body: Record<string, unknown>
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = { raw: text }
  }

  return { status: response.status, body }
}

afterEach(async () => {
  const current = servers
  servers = []
  await Promise.all(
    current.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    ),
  )
})

it('responds with Reserved on GET /reserve', async () => {
  const address = await startServer()
  const response = await fetch(`http://127.0.0.1:${address.port}/reserve`)

  expect(response.status).toBe(200)
  expect(await response.text()).toBe('Reserved')
})

it('returns 404 for unknown routes', async () => {
  const address = await startServer()
  const response = await fetch(`http://127.0.0.1:${address.port}/unknown`)

  expect(response.status).toBe(404)
})

it('starts with an empty meeting types list', async () => {
  const address = await startServer()
  const response = await fetch(`http://127.0.0.1:${address.port}/meeting-types`)

  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('application/json')
  expect(await response.json()).toEqual([])
})

it('creates a meeting type and includes it in the list', async () => {
  const address = await startServer()
  const created = await fetch(`http://127.0.0.1:${address.port}/meeting-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Знакомство',
      description: 'Короткий созвон',
      durationMinutes: 30,
    }),
  })

  expect(created.status).toBe(201)
  const meetingType = (await created.json()) as MeetingType
  expect(meetingType).toMatchObject({
    title: 'Знакомство',
    description: 'Короткий созвон',
    durationMinutes: 30,
  })
  expect(meetingType.id).toEqual(expect.any(String))

  const listed = await fetch(`http://127.0.0.1:${address.port}/meeting-types`)
  expect(await listed.json()).toEqual([meetingType])
})

it('rejects a meeting type without a title', async () => {
  const address = await startServer()
  const response = await fetch(`http://127.0.0.1:${address.port}/meeting-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: '   ',
      description: 'Короткий созвон',
      durationMinutes: 30,
    }),
  })

  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: expect.any(String) })
})

it.each([0, -15, 2.5, 14, 16, 75, 600])(
  'rejects duration %s minutes',
  async (durationMinutes) => {
  const address = await startServer()
  const response = await fetch(`http://127.0.0.1:${address.port}/meeting-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Знакомство',
      description: '',
      durationMinutes,
    }),
  })

  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: expect.any(String) })
})

it('keeps an empty description', async () => {
  const address = await startServer()
  const response = await fetch(`http://127.0.0.1:${address.port}/meeting-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Знакомство',
      description: '',
      durationMinutes: 30,
    }),
  })

  expect(response.status).toBe(201)
  expect(await response.json()).toMatchObject({ description: '' })
})

it('rejects a second meeting type with the same duration', async () => {
  const address = await startServer()
  await createMeetingType(address.port, { title: 'Первая', durationMinutes: 30 })

  const duplicate = await fetch(
    `http://127.0.0.1:${address.port}/meeting-types`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Вторая',
        description: '',
        durationMinutes: 30,
      }),
    },
  )

  expect(duplicate.status).toBe(409)
  expect(await duplicate.json()).toEqual({ error: expect.any(String) })

  await createMeetingType(address.port, { title: 'Третья', durationMinutes: 45 })

  const listed = await fetch(`http://127.0.0.1:${address.port}/meeting-types`)
  expect(await listed.json()).toHaveLength(2)
})

it('keeps meeting types isolated between servers', async () => {
  const first = await startServer()
  await fetch(`http://127.0.0.1:${first.port}/meeting-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Знакомство',
      description: '',
      durationMinutes: 30,
    }),
  })

  const second = await startServer()
  const listed = await fetch(`http://127.0.0.1:${second.port}/meeting-types`)

  expect(await listed.json()).toEqual([])
})

it('rejects malformed JSON with a JSON error', async () => {
  const address = await startServer()
  const response = await fetch(`http://127.0.0.1:${address.port}/meeting-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"title":',
  })

  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: expect.any(String) })
})

it('generates slots on a 15-minute grid inside working hours', async () => {
  const now = new Date('2026-01-05T05:00:00Z') // Monday, 08:00 in Moscow
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })

  const slots = await getSlots(address.port, meetingType.id)
  const firstDay = slots.filter((slot) => slot.startsAt.startsWith('2026-01-05'))

  expect(slots[0]).toEqual({
    startsAt: '2026-01-05T09:00:00+03:00',
    endsAt: '2026-01-05T09:30:00+03:00',
    isAvailable: true,
  })
  expect(firstDay).toHaveLength(35)
  expect(firstDay[1]).toEqual({
    startsAt: '2026-01-05T09:15:00+03:00',
    endsAt: '2026-01-05T09:45:00+03:00',
    isAvailable: true,
  })
  expect(firstDay.at(-1)).toEqual({
    startsAt: '2026-01-05T17:30:00+03:00',
    endsAt: '2026-01-05T18:00:00+03:00',
    isAvailable: true,
  })
  expect(slots.every((slot) => /\+03:00$/.test(slot.startsAt))).toBe(true)
  expect(slots.every((slot) => /\+03:00$/.test(slot.endsAt))).toBe(true)
})

it.each([
  ['09:10', '2026-01-05T09:15:00+03:00'],
  ['09:00', '2026-01-05T09:15:00+03:00'],
])('skips slots that already started at %s Moscow time', async (moscowTime, expected) => {
  const now = new Date(`2026-01-05T${moscowTime}:00+03:00`)
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })

  const slots = await getSlots(address.port, meetingType.id)

  expect(slots[0]?.startsAt).toBe(expected)
})

it('excludes weekends', async () => {
  const now = new Date('2026-01-05T05:00:00Z') // Monday, 08:00 in Moscow
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })

  const slots = await getSlots(address.port, meetingType.id)
  const starts = slots.map((slot) => slot.startsAt)

  expect(starts.some((start) => start.startsWith('2026-01-10'))).toBe(false)
  expect(starts.some((start) => start.startsWith('2026-01-11'))).toBe(false)
  expect(starts).toContain('2026-01-09T17:30:00+03:00')
  expect(starts.indexOf('2026-01-12T09:00:00+03:00')).toBe(
    starts.indexOf('2026-01-09T17:30:00+03:00') + 1,
  )
})

it('starts on the next workday when opened on a weekend', async () => {
  const now = new Date('2026-01-10T05:00:00Z') // Saturday, 08:00 in Moscow
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })

  const slots = await getSlots(address.port, meetingType.id)

  expect(slots[0]?.startsAt).toBe('2026-01-12T09:00:00+03:00')
})

it('limits slots to the next 14 days', async () => {
  const now = new Date('2026-01-05T05:00:00Z') // Monday, 08:00 in Moscow
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })

  const slots = await getSlots(address.port, meetingType.id)

  expect(slots.at(-1)).toEqual({
    startsAt: '2026-01-16T17:30:00+03:00',
    endsAt: '2026-01-16T18:00:00+03:00',
    isAvailable: true,
  })
  expect(slots.some((slot) => slot.startsAt.startsWith('2026-01-19'))).toBe(false)
})

it('keeps 45-minute meetings on the 15-minute grid and before 18:00', async () => {
  const now = new Date('2026-01-05T05:00:00Z') // Monday, 08:00 in Moscow
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 45 })

  const slots = await getSlots(address.port, meetingType.id)
  const firstDay = slots.filter((slot) => slot.startsAt.startsWith('2026-01-05'))

  expect(firstDay[0]).toEqual({
    startsAt: '2026-01-05T09:00:00+03:00',
    endsAt: '2026-01-05T09:45:00+03:00',
    isAvailable: true,
  })
  expect(firstDay[1]).toEqual({
    startsAt: '2026-01-05T09:15:00+03:00',
    endsAt: '2026-01-05T10:00:00+03:00',
    isAvailable: true,
  })
  expect(firstDay[2]).toEqual({
    startsAt: '2026-01-05T09:30:00+03:00',
    endsAt: '2026-01-05T10:15:00+03:00',
    isAvailable: true,
  })
  expect(firstDay.some((slot) => slot.startsAt.startsWith('2026-01-05T09:45'))).toBe(
    true,
  )
  expect(firstDay.at(-1)).toEqual({
    startsAt: '2026-01-05T17:15:00+03:00',
    endsAt: '2026-01-05T18:00:00+03:00',
    isAvailable: true,
  })
})

it('returns a JSON 404 for slots of an unknown meeting type', async () => {
  const address = await startServer()

  const response = await fetch(
    `http://127.0.0.1:${address.port}/meeting-types/missing/slots`,
  )

  expect(response.status).toBe(404)
  expect(response.headers.get('content-type')).toContain('application/json')
  expect(await response.json()).toEqual({ error: expect.any(String) })
})

it('serves meeting types under the production api prefix', async () => {
  const address = await startServer({ apiPrefix: '/api' })
  const baseUrl = `http://127.0.0.1:${address.port}/api/meeting-types`

  const created = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Знакомство',
      description: 'Короткий созвон',
      durationMinutes: 30,
    }),
  })

  expect(created.status).toBe(201)
  expect(await (await fetch(baseUrl)).json()).toHaveLength(1)
})

it('serves slots under the production api prefix', async () => {
  const now = new Date('2026-01-05T05:00:00Z')
  const address = await startServer({ apiPrefix: '/api', now: () => now })
  const baseUrl = `http://127.0.0.1:${address.port}/api`

  const created = await fetch(`${baseUrl}/meeting-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Знакомство', durationMinutes: 30 }),
  })
  const meetingType = (await created.json()) as MeetingType

  const response = await fetch(`${baseUrl}/meeting-types/${meetingType.id}/slots`)
  const slots = (await response.json()) as { startsAt: string }[]

  expect(response.status).toBe(200)
  expect(slots[0]?.startsAt).toBe('2026-01-05T09:00:00+03:00')
})

it('creates a booking for an available slot', async () => {
  const now = new Date('2026-01-05T05:00:00Z') // Monday, 08:00 in Moscow
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })

  const { status, body } = await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
    guestName: '  Анна  ',
    guestEmail: '  anna@example.com ',
  })

  expect(status).toBe(201)
  expect(body).toMatchObject({
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
    guestName: 'Анна',
    guestEmail: 'anna@example.com',
  })
  expect(body.id).toEqual(expect.any(String))
  expect(body.createdAt).toEqual(expect.any(String))
  expect(Number.isNaN(Date.parse(body.createdAt as string))).toBe(false)
})

it('marks a booked slot and overlapping slots as unavailable', async () => {
  const now = new Date('2026-01-05T05:00:00Z') // Monday, 08:00 in Moscow
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })
  const before = await getSlots(address.port, meetingType.id)

  await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
  })

  const after = await getSlots(address.port, meetingType.id)

  expect(after).toHaveLength(before.length)
  expect(after.find((slot) => slot.startsAt === '2026-01-05T09:00:00+03:00')).toMatchObject({
    isAvailable: false,
  })
  expect(after.find((slot) => slot.startsAt === '2026-01-05T09:15:00+03:00')).toMatchObject({
    isAvailable: false,
  })
  expect(after.find((slot) => slot.startsAt === '2026-01-05T09:30:00+03:00')).toMatchObject({
    isAvailable: true,
  })
})

it('marks every slot that overlaps a 45-minute booking as unavailable', async () => {
  const now = new Date('2026-01-05T05:00:00Z') // Monday, 08:00 in Moscow
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 45 })
  const before = await getSlots(address.port, meetingType.id)

  await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
  })

  const after = await getSlots(address.port, meetingType.id)
  const unavailableStarts = after
    .filter((slot) => !slot.isAvailable)
    .map((slot) => slot.startsAt)

  expect(after).toHaveLength(before.length)
  expect(unavailableStarts).toEqual(
    expect.arrayContaining([
      '2026-01-05T09:00:00+03:00',
      '2026-01-05T09:15:00+03:00',
      '2026-01-05T09:30:00+03:00',
    ]),
  )
  expect(after.find((slot) => slot.startsAt === '2026-01-05T09:45:00+03:00')).toMatchObject({
    isAvailable: true,
  })
  expect(after.find((slot) => slot.startsAt === '2026-01-05T10:00:00+03:00')).toMatchObject({
    isAvailable: true,
  })
})

it('marks slots of another meeting type that overlap a booking as unavailable', async () => {
  const now = new Date('2026-01-05T05:00:00Z') // Monday, 08:00 in Moscow
  const address = await startServer({ now: () => now })
  const longType = await createMeetingType(address.port, {
    title: 'Длинная встреча',
    durationMinutes: 45,
  })
  const shortType = await createMeetingType(address.port, {
    title: 'Короткая встреча',
    durationMinutes: 30,
  })

  await bookSlot(address.port, {
    meetingTypeId: longType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
  })

  const slots = await getSlots(address.port, shortType.id)

  expect(slots.find((slot) => slot.startsAt === '2026-01-05T09:00:00+03:00')).toMatchObject({
    isAvailable: false,
  })
  expect(slots.find((slot) => slot.startsAt === '2026-01-05T09:15:00+03:00')).toMatchObject({
    isAvailable: false,
  })
  expect(slots.find((slot) => slot.startsAt === '2026-01-05T09:30:00+03:00')).toMatchObject({
    isAvailable: false,
  })
  expect(slots.find((slot) => slot.startsAt === '2026-01-05T09:45:00+03:00')).toMatchObject({
    isAvailable: true,
  })
  expect(slots.find((slot) => slot.startsAt === '2026-01-05T10:00:00+03:00')).toMatchObject({
    isAvailable: true,
  })
})

it('returns 409 when a booking overlaps a booking of another meeting type', async () => {
  const now = new Date('2026-01-05T05:00:00Z') // Monday, 08:00 in Moscow
  const address = await startServer({ now: () => now })
  const longType = await createMeetingType(address.port, {
    title: 'Длинная встреча',
    durationMinutes: 45,
  })
  const shortType = await createMeetingType(address.port, {
    title: 'Короткая встреча',
    durationMinutes: 30,
  })

  await bookSlot(address.port, {
    meetingTypeId: longType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
  })

  const conflict = await bookSlot(address.port, {
    meetingTypeId: shortType.id,
    startsAt: '2026-01-05T09:30:00+03:00',
  })

  expect(conflict.status).toBe(409)
  expect(conflict.body).toEqual({ error: expect.any(String) })
})

it('allows only one of two simultaneous bookings for the same slot', async () => {
  const now = new Date('2026-01-05T05:00:00Z')
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })

  const results = await Promise.all([
    bookSlot(address.port, {
      meetingTypeId: meetingType.id,
      startsAt: '2026-01-05T09:00:00+03:00',
    }),
    bookSlot(address.port, {
      meetingTypeId: meetingType.id,
      startsAt: '2026-01-05T09:00:00+03:00',
    }),
  ])

  expect(results.map((result) => result.status).sort()).toEqual([201, 409])
})

it('returns 409 when the slot is already booked', async () => {
  const now = new Date('2026-01-05T05:00:00Z') // Monday, 08:00 in Moscow
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })
  const first = await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
  })

  const second = await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
  })

  expect(first.status).toBe(201)
  expect(second.status).toBe(409)
  expect(second.body).toEqual({ error: expect.any(String) })
})

it('returns 409 when the slot overlaps an existing booking', async () => {
  const now = new Date('2026-01-05T05:00:00Z') // Monday, 08:00 in Moscow
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 45 })

  await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
  })

  const overlapping = await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:30:00+03:00',
  })

  expect(overlapping.status).toBe(409)
  expect(overlapping.body).toEqual({ error: expect.any(String) })
})

it('does not create a second booking after a conflict', async () => {
  const now = new Date('2026-01-05T05:00:00Z') // Monday, 08:00 in Moscow
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 45 })
  const before = await getSlots(address.port, meetingType.id)

  await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
  })
  const afterFirst = await getSlots(address.port, meetingType.id)

  await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
  })
  const afterConflict = await getSlots(address.port, meetingType.id)

  expect(afterFirst).toHaveLength(before.length)
  expect(afterConflict).toEqual(afterFirst)
})

it('rejects a booking with an empty guest name', async () => {
  const now = new Date('2026-01-05T05:00:00Z')
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })

  const { status, body } = await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
    guestName: '   ',
  })

  expect(status).toBe(400)
  expect(body).toEqual({ error: expect.any(String) })
})

it.each(['', 'anna', 'anna@', 'anna@example', '@example.com'])(
  'rejects the invalid guest email %j',
  async (guestEmail) => {
    const now = new Date('2026-01-05T05:00:00Z')
    const address = await startServer({ now: () => now })
    const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })

    const { status, body } = await bookSlot(address.port, {
      meetingTypeId: meetingType.id,
      startsAt: '2026-01-05T09:00:00+03:00',
      guestEmail,
    })

    expect(status).toBe(400)
    expect(body).toEqual({ error: expect.any(String) })
  },
)

it('rejects a booking without a meeting type or start time', async () => {
  const now = new Date('2026-01-05T05:00:00Z')
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })

  const withoutType = await bookSlot(address.port, {
    meetingTypeId: '   ',
    startsAt: '2026-01-05T09:00:00+03:00',
  })
  const withoutStart = await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '',
  })

  expect(withoutType.status).toBe(400)
  expect(withoutStart.status).toBe(400)
})

it('returns 404 when booking an unknown meeting type', async () => {
  const now = new Date('2026-01-05T05:00:00Z')
  const address = await startServer({ now: () => now })

  const { status, body } = await bookSlot(address.port, {
    meetingTypeId: 'missing',
    startsAt: '2026-01-05T09:00:00+03:00',
  })

  expect(status).toBe(404)
  expect(body).toEqual({ error: expect.any(String) })
})

it('rejects a booking outside the available slot grid', async () => {
  const now = new Date('2026-01-05T05:00:00Z')
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })

  const offGrid = await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:10:00+03:00',
  })
  const weekend = await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-10T09:00:00+03:00',
  })
  const past = await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T08:30:00+03:00',
  })
  const malformed = await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: 'not-a-date',
  })

  expect(offGrid.status).toBe(400)
  expect(weekend.status).toBe(400)
  expect(past.status).toBe(400)
  expect(malformed.status).toBe(400)
})

it('stores bookings per server instance', async () => {
  const now = new Date('2026-01-05T05:00:00Z')
  const first = await startServer({ now: () => now })
  const meetingType = await createMeetingType(first.port, { durationMinutes: 30 })

  await bookSlot(first.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
  })

  const second = await startServer({ now: () => now })
  const secondType = await createMeetingType(second.port, { durationMinutes: 30 })
  const slots = await getSlots(second.port, secondType.id)

  expect(slots[0]?.startsAt).toBe('2026-01-05T09:00:00+03:00')
})

it('starts with an empty bookings list', async () => {
  const address = await startServer()
  const response = await fetch(`http://127.0.0.1:${address.port}/bookings`)

  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('application/json')
  expect(await response.json()).toEqual([])
})

it('lists a booking with its meeting type and guest details', async () => {
  const now = new Date('2026-01-05T05:00:00Z')
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, {
    title: 'Консультация',
    durationMinutes: 30,
  })

  const created = await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
    guestName: 'Иван',
    guestEmail: 'ivan@example.com',
  })

  const bookings = await getBookings(address.port)

  expect(bookings).toHaveLength(1)
  expect(bookings[0]).toEqual({
    id: created.body.id,
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
    guestName: 'Иван',
    guestEmail: 'ivan@example.com',
    createdAt: created.body.createdAt,
  })
  expect(bookings[0]).not.toHaveProperty('meetingTypeTitle')
})

it('lists only upcoming bookings when upcoming=true', async () => {
  let now = new Date('2026-01-05T05:00:00Z') // Monday, 08:00 in Moscow
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })

  await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
  })

  const upcoming = await fetch(
    `http://127.0.0.1:${address.port}/bookings?upcoming=true`,
  )
  expect(await upcoming.json()).toHaveLength(1)

  now = new Date('2026-01-05T07:00:00Z') // Monday, 10:00 in Moscow

  const afterStart = await fetch(
    `http://127.0.0.1:${address.port}/bookings?upcoming=true`,
  )
  expect(await afterStart.json()).toEqual([])
  expect(await getBookings(address.port)).toHaveLength(1)
})

it('sorts bookings by start time across meeting types', async () => {
  const now = new Date('2026-01-05T05:00:00Z')
  const address = await startServer({ now: () => now })
  const laterType = await createMeetingType(address.port, {
    title: 'Поздняя встреча',
    durationMinutes: 45,
  })
  const earlierType = await createMeetingType(address.port, {
    title: 'Ранняя встреча',
    durationMinutes: 30,
  })

  await bookSlot(address.port, {
    meetingTypeId: laterType.id,
    startsAt: '2026-01-05T10:00:00+03:00',
  })
  await bookSlot(address.port, {
    meetingTypeId: earlierType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
  })

  const bookings = await getBookings(address.port)

  expect(bookings.map((booking) => booking.startsAt)).toEqual([
    '2026-01-05T09:00:00+03:00',
    '2026-01-05T10:00:00+03:00',
  ])
  expect(bookings.map((booking) => booking.meetingTypeId)).toEqual([
    earlierType.id,
    laterType.id,
  ])
})

it('keeps bookings isolated between servers', async () => {
  const now = new Date('2026-01-05T05:00:00Z')
  const first = await startServer({ now: () => now })
  const meetingType = await createMeetingType(first.port, { durationMinutes: 30 })

  await bookSlot(first.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
  })

  const second = await startServer({ now: () => now })

  expect(await getBookings(second.port)).toEqual([])
})

it('serves the bookings list under the production api prefix', async () => {
  const now = new Date('2026-01-05T05:00:00Z')
  const address = await startServer({ apiPrefix: '/api', now: () => now })
  const baseUrl = `http://127.0.0.1:${address.port}/api`

  const created = await fetch(`${baseUrl}/meeting-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Знакомство', durationMinutes: 30 }),
  })
  const meetingType = (await created.json()) as MeetingType

  await fetch(`${baseUrl}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meetingTypeId: meetingType.id,
      startsAt: '2026-01-05T09:00:00+03:00',
      guestName: 'Анна',
      guestEmail: 'anna@example.com',
    }),
  })

  const bookings = await getBookings(address.port, '/api')

  expect(bookings).toHaveLength(1)
  expect(bookings[0]).toMatchObject({
    meetingTypeId: meetingType.id,
    guestName: 'Анна',
  })
  expect(bookings[0]).not.toHaveProperty('meetingTypeTitle')
})

it('serves booking creation under the production api prefix', async () => {
  const now = new Date('2026-01-05T05:00:00Z')
  const address = await startServer({ apiPrefix: '/api', now: () => now })
  const baseUrl = `http://127.0.0.1:${address.port}/api`

  const created = await fetch(`${baseUrl}/meeting-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Знакомство', durationMinutes: 30 }),
  })
  const meetingType = (await created.json()) as MeetingType

  const response = await fetch(`${baseUrl}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meetingTypeId: meetingType.id,
      startsAt: '2026-01-05T09:00:00+03:00',
      guestName: 'Анна',
      guestEmail: 'anna@example.com',
    }),
  })

  expect(response.status).toBe(201)
})

it('clears meeting types and bookings through the cleanup endpoint', async () => {
  const now = new Date('2026-01-05T05:00:00Z') // Monday, 08:00 in Moscow
  const address = await startServer({ now: () => now })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })

  await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
  })

  expect(
    await (await fetch(`http://127.0.0.1:${address.port}/meeting-types`)).json(),
  ).not.toEqual([])
  expect(await getBookings(address.port)).not.toEqual([])

  const cleanup = await fetch(`http://127.0.0.1:${address.port}/cleanup`, {
    method: 'POST',
  })

  expect(cleanup.status).toBe(204)
  expect(
    await (await fetch(`http://127.0.0.1:${address.port}/meeting-types`)).json(),
  ).toEqual([])
  expect(await getBookings(address.port)).toEqual([])
})

it('allows cleaning up an already empty server', async () => {
  const address = await startServer()

  const first = await fetch(`http://127.0.0.1:${address.port}/cleanup`, {
    method: 'POST',
  })
  const second = await fetch(`http://127.0.0.1:${address.port}/cleanup`, {
    method: 'POST',
  })

  expect(first.status).toBe(204)
  expect(second.status).toBe(204)
})

it('serves the cleanup endpoint under the production api prefix', async () => {
  const now = new Date('2026-01-05T05:00:00Z')
  const address = await startServer({ apiPrefix: '/api', now: () => now })
  const baseUrl = `http://127.0.0.1:${address.port}/api`
  const created = await fetch(`${baseUrl}/meeting-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Знакомство',
      description: '',
      durationMinutes: 30,
    }),
  })
  const meetingType = (await created.json()) as { id: string }

  await fetch(`${baseUrl}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meetingTypeId: meetingType.id,
      startsAt: '2026-01-05T09:00:00+03:00',
      guestName: 'Анна',
      guestEmail: 'anna@example.com',
    }),
  })

  const cleanup = await fetch(`${baseUrl}/cleanup`, { method: 'POST' })

  expect(cleanup.status).toBe(204)
  expect(await (await fetch(`${baseUrl}/meeting-types`)).json()).toEqual([])
  expect(await getBookings(address.port, '/api')).toEqual([])
})

it('does not expose the test reset endpoint by default', async () => {
  const address = await startServer()

  const response = await fetch(
    `http://127.0.0.1:${address.port}/__test__/reset`,
    { method: 'POST' },
  )

  expect(response.status).toBe(404)
})

it('clears meeting types and bookings through the test reset endpoint', async () => {
  const now = new Date('2026-01-05T05:00:00Z')
  const address = await startServer({ now: () => now, allowTestReset: true })
  const meetingType = await createMeetingType(address.port, { durationMinutes: 30 })

  await bookSlot(address.port, {
    meetingTypeId: meetingType.id,
    startsAt: '2026-01-05T09:00:00+03:00',
  })

  const reset = await fetch(`http://127.0.0.1:${address.port}/__test__/reset`, {
    method: 'POST',
  })

  expect(reset.status).toBe(204)
  expect(
    await (await fetch(`http://127.0.0.1:${address.port}/meeting-types`)).json(),
  ).toEqual([])
  expect(await getBookings(address.port)).toEqual([])
})

it('serves the test reset endpoint under the production api prefix', async () => {
  const address = await startServer({ apiPrefix: '/api', allowTestReset: true })

  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/__test__/reset`,
    { method: 'POST' },
  )

  expect(response.status).toBe(204)
})
