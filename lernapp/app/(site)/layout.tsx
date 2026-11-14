import { TopBar } from '../topbar.tsx'

/** Seiten ohne Person: Start, Inbox, Import, Login. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-4 sm:py-6">{children}</main>
    </>
  )
}
