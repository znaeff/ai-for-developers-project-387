import { useState, type FormEvent } from 'react'
import { inputClassName } from '@/components/formStyles'
import { Button } from '@/components/ui/button'
import {
  createMeetingType,
  type MeetingType,
  type MeetingTypeInput,
} from '@/lib/api'

type MeetingTypeFormProps = {
  onCreated: (meetingType: MeetingType) => void
}

export function MeetingTypeForm({ onCreated }: MeetingTypeFormProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('30')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    setError(null)
    setIsSubmitting(true)

    try {
      const meetingType = await createMeetingType({
        title,
        description,
        durationMinutes: Number(
          durationMinutes,
        ) as MeetingTypeInput['durationMinutes'],
      })
      onCreated(meetingType)
      setTitle('')
      setDescription('')
      setDurationMinutes('30')
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Не удалось создать тип встречи',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Новый тип встречи</h2>
      <form className="space-y-4" noValidate onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="meeting-type-title">
            Название
          </label>
          <input
            className={inputClassName}
            id="meeting-type-title"
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="meeting-type-description">
            Описание
          </label>
          <textarea
            className={inputClassName}
            id="meeting-type-description"
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            value={description}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="meeting-type-duration">
            Длительность, минут
          </label>
          <select
            className={inputClassName}
            id="meeting-type-duration"
            onChange={(event) => setDurationMinutes(event.target.value)}
            value={durationMinutes}
          >
            <option value="15">15 минут</option>
            <option value="30">30 минут</option>
            <option value="45">45 минут</option>
            <option value="60">60 минут</option>
          </select>
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Создание…' : 'Создать тип встречи'}
        </Button>
      </form>
    </section>
  )
}
