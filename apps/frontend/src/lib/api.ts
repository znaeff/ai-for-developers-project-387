import { client } from '@/api/generated/client.gen'
import {
  clearData as sdkClearData,
  createBooking as sdkCreateBooking,
  createMeetingType as sdkCreateMeetingType,
  listBookings as sdkListBookings,
  listMeetingTypes as sdkListMeetingTypes,
  listSlots as sdkListSlots,
  type Booking,
  type BookingInput,
  type ErrorResponse,
  type MeetingType,
  type MeetingTypeInput,
  type Slot,
} from '@/api/generated'

client.setConfig({ baseUrl: '/api' })

export type { Booking, BookingInput, MeetingType, MeetingTypeInput, Slot }

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type SdkResult<T> = {
  data?: T
  error?: unknown
  response?: Response
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'string'
  )
}

async function unwrap<T>(result: Promise<SdkResult<T>>): Promise<T> {
  try {
    const { data, error, response } = await result
    const status = response?.status ?? 0

    if (error !== undefined) {
      throw new ApiError(
        isErrorResponse(error) ? error.error : 'Ошибка запроса',
        status,
      )
    }
    if (data === undefined) {
      throw new ApiError('Сервер вернул пустой ответ', status)
    }
    return data
  } catch (caught) {
    if (caught instanceof ApiError) {
      throw caught
    }
    throw new ApiError('Не удалось связаться с сервером', 0)
  }
}

export function listMeetingTypes(): Promise<MeetingType[]> {
  return unwrap(sdkListMeetingTypes())
}

export function createMeetingType(input: MeetingTypeInput): Promise<MeetingType> {
  return unwrap(sdkCreateMeetingType({ body: input }))
}

export function listSlots(meetingTypeId: string): Promise<Slot[]> {
  return unwrap(sdkListSlots({ path: { id: meetingTypeId } }))
}

export function listBookings(): Promise<Booking[]> {
  return unwrap(sdkListBookings({ query: { upcoming: true } }))
}

export function createBooking(input: BookingInput): Promise<Booking> {
  return unwrap(sdkCreateBooking({ body: input }))
}

async function unwrapNoContent(result: Promise<SdkResult<void>>): Promise<void> {
  try {
    const { error, response } = await result
    const status = response?.status ?? 0

    if (error !== undefined) {
      throw new ApiError(
        isErrorResponse(error) ? error.error : 'Ошибка запроса',
        status,
      )
    }
  } catch (caught) {
    if (caught instanceof ApiError) {
      throw caught
    }
    throw new ApiError('Не удалось связаться с сервером', 0)
  }
}

export function clearData(): Promise<void> {
  return unwrapNoContent(sdkClearData())
}
