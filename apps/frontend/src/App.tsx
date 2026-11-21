import { GuestPage } from '@/pages/GuestPage'
import { HomePage } from '@/pages/HomePage'
import { OwnerPage } from '@/pages/OwnerPage'

export default function App() {
  switch (window.location.pathname) {
    case '/guest':
      return <GuestPage />
    case '/owner':
      return <OwnerPage />
    default:
      return <HomePage />
  }
}
