import { useEffect, useState } from 'react'
import { AppShell } from '@/features/shell/AppShell'
import { bootstrapLibrary } from '@/services/library/bootstrap'
import { useAppStore } from '@/state/useAppStore'

export function App() {
  const hydrate = useAppStore((s) => s.hydrate)
  const [fatal, setFatal] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        await hydrate()
        // Fills in any missing library nodes for existing books and subjects.
        // Idempotent, and deliberately *after* the schema is open: a failure
        // here leaves the tree incomplete rather than the database broken, and
        // the next start finishes the job.
        await bootstrapLibrary()
      } catch (error) {
        setFatal(
          error instanceof Error
            ? `The local database could not be opened: ${error.message}`
            : 'The local database could not be opened.',
        )
      }
    })()
  }, [hydrate])

  if (fatal) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md text-center">
          <p className="text-hl-rose text-sm">{fatal}</p>
          <p className="text-ink-faint mt-3 text-xs">
            Your notes are stored in this browser profile. If you are in a private window, or storage
            is blocked, nothing can be saved.
          </p>
        </div>
      </div>
    )
  }

  return <AppShell />
}
