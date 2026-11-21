import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

type Operation = {
  operationId?: string
  parameters?: Array<{ name?: string; in?: string; required?: boolean }>
  responses: Record<string, unknown>
}

type Schema = {
  required?: string[]
  properties?: Record<string, unknown>
}

type OpenApiDocument = {
  servers?: Array<{ url: string }>
  paths: Record<string, Record<string, Operation>>
  components: { schemas: Record<string, Schema> }
}

const contract = JSON.parse(
  await readFile(
    new URL('../../../contracts/openapi/openapi.json', import.meta.url),
    'utf8',
  ),
) as OpenApiDocument

describe('generated OpenAPI contract', () => {
  it('publishes the API under /api', () => {
    expect(contract.servers).toEqual(
      expect.arrayContaining([expect.objectContaining({ url: '/api' })]),
    )
  })

  it.each([
    ['/meeting-types', 'get', 'listMeetingTypes', ['200']],
    ['/meeting-types', 'post', 'createMeetingType', ['201', '400', '409']],
    ['/meeting-types/{id}/slots', 'get', 'listSlots', ['200', '404']],
    ['/bookings', 'get', 'listBookings', ['200']],
    ['/bookings', 'post', 'createBooking', ['201', '400', '404', '409']],
    ['/cleanup', 'post', 'clearData', ['204']],
  ])(
    'declares %s %s with operation id and responses',
    (path, method, operationId, statuses) => {
      const operation = contract.paths[path]?.[method]

      expect(operation?.operationId).toBe(operationId)
      expect(Object.keys(operation?.responses ?? {})).toEqual(
        expect.arrayContaining(statuses),
      )
    },
  )

  it('exposes the upcoming query parameter for GET /bookings', () => {
    expect(contract.paths['/bookings']?.get?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: 'query',
          name: 'upcoming',
          required: false,
        }),
      ]),
    )
  })

  it('restricts durationMinutes to the fixed list', () => {
    expect(
      contract.components.schemas.MeetingType?.properties?.durationMinutes,
    ).toMatchObject({ enum: [15, 30, 45, 60] })
    expect(
      contract.components.schemas.MeetingTypeInput?.properties?.durationMinutes,
    ).toMatchObject({ enum: [15, 30, 45, 60] })
  })

  it.each([
    ['MeetingType', ['id', 'title', 'description', 'durationMinutes']],
    ['Slot', ['startsAt', 'endsAt', 'isAvailable']],
    [
      'Booking',
      [
        'id',
        'meetingTypeId',
        'startsAt',
        'guestName',
        'guestEmail',
        'createdAt',
      ],
    ],
    ['ErrorResponse', ['error']],
  ])('declares all required %s fields', (schemaName, fields) => {
    const schema = contract.components.schemas[schemaName]

    expect(schema?.required).toEqual(expect.arrayContaining(fields))
    expect(Object.keys(schema?.properties ?? {})).toEqual(
      expect.arrayContaining(fields),
    )
  })
})
