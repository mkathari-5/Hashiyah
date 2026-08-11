import { useCallback, useEffect, useState } from 'react'
import { Group, Panel, Separator, type Layout } from 'react-resizable-panels'
import { CommandPalette } from '@/features/command/CommandPalette'
import { ImportDialog } from '@/features/library/ImportDialog'
import { LibraryHome } from '@/features/library/LibraryHome'
import { LibrarySidebar } from '@/features/library/LibrarySidebar'
import { NotesPanel } from '@/features/notes/NotesPanel'
import { PdfViewer } from '@/features/pdf/PdfViewer'
import { SearchPanel } from '@/features/search/SearchPanel'
import { ShortcutsDialog } from '@/features/shell/ShortcutsDialog'
import { StatusBar } from '@/features/shell/StatusBar'
import { TopBar } from '@/features/shell/TopBar'
import { useShortcuts } from '@/features/shortcuts/useShortcuts'
import { useAppStore } from '@/state/useAppStore'
import { useLibraryStore } from '@/state/useLibraryStore'

export function AppShell() {
  const layout = useAppStore((s) => s.layout)
  const sizes = useAppStore((s) => s.sizes)
  const setSizes = useAppStore((s) => s.setSizes)
  const resetSizes = useAppStore((s) => s.resetSizes)
  const hydrated = useAppStore((s) => s.hydrated)
  const activeNodeId = useLibraryStore((s) => s.activeNodeId)
  const libraryHydrated = useLibraryStore((s) => s.hydrated)

  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)

  useShortcuts()

  const openImport = useCallback(() => {
    setImportFile(null)
    setImportOpen(true)
  }, [])

  // Drop a PDF anywhere in the window (§51).
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth += 1
      setDragging(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const file = Array.from(e.dataTransfer?.files ?? []).find(
        (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name),
      )
      if (file) {
        setImportFile(file)
        setImportOpen(true)
      }
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  if (!hydrated || !libraryHydrated) {
    return <div className="bg-canvas h-full" aria-busy="true" />
  }

  // §E1 — with nothing open, Ḥāshiyah is a library, not an empty reader.
  if (activeNodeId === null) {
    return (
      <div className="bg-canvas flex h-full flex-col">
        <TopBar onImport={openImport} />
        <div className="min-h-0 flex-1">
          <LibraryHome onImport={openImport} />
        </div>
        <StatusBar />
        <CommandPalette onImport={openImport} />
        <SearchPanel />
        <ShortcutsDialog />
        <ImportDialog
          open={importOpen}
          file={importFile}
          onClose={() => setImportOpen(false)}
          onPickFile={setImportFile}
        />
        {dragging && <DropVeil />}
      </div>
    )
  }

  const lesson = layout === 'lesson'
  const showLibrary = layout === 'three'
  const showReader = layout !== 'notes'
  const showNotes = layout !== 'pdf'

  return (
    <div className="bg-canvas flex h-full flex-col">
      {!lesson && <TopBar onImport={openImport} />}

      <div className="min-h-0 flex-1">
        <Group
          // Remounting per layout mode keeps the group's internal sizing honest
          // when panels appear and disappear.
          key={layout}
          orientation="horizontal"
          className="h-full"
          onLayoutChange={(next: Layout) => {
            if (layout !== 'three') return
            const { library, reader, notes } = next
            if (library && reader && notes) setSizes({ library, reader, notes })
          }}
        >
          {showLibrary && (
            <>
              <Panel
                id="library"
                defaultSize={`${sizes.library}%`}
                minSize="12%"
                maxSize="34%"
                className="border-line bg-panel border-e"
              >
                <LibrarySidebar onImport={openImport} />
              </Panel>
              <Handle />
            </>
          )}

          {showReader && (
            <Panel id="reader" defaultSize={`${showNotes ? sizes.reader : 100}%`} minSize="22%">
              <PdfViewer />
            </Panel>
          )}

          {/* §18 — the book/notes divider is the one users actually drag, so it
              gets the double-click-to-restore affordance. */}
          {showReader && showNotes && <Handle onReset={resetSizes} />}

          {showNotes && (
            <Panel
              id="notes"
              defaultSize={`${showReader ? sizes.notes : 100}%`}
              minSize="20%"
              className="border-line bg-canvas border-s"
            >
              <NotesPanel />
            </Panel>
          )}
        </Group>
      </div>

      <StatusBar />

      <CommandPalette onImport={openImport} />
      <SearchPanel />
      <ShortcutsDialog />
      <ImportDialog
        open={importOpen}
        file={importFile}
        onClose={() => setImportOpen(false)}
        onPickFile={setImportFile}
      />

      {dragging && <DropVeil />}
    </div>
  )
}

function DropVeil() {
  return (
    <div className="border-accent bg-canvas/80 pointer-events-none fixed inset-3 z-[80] grid place-items-center rounded-lg border-2 border-dashed">
      <p className="text-accent text-sm font-medium">Drop a PDF to add it to your library</p>
    </div>
  )
}

function Handle({ onReset }: { onReset?: () => void }) {
  return (
    <Separator
      className="group relative w-1 shrink-0 cursor-col-resize"
      title={onReset ? 'Drag to resize · double-click to restore' : undefined}
      onDoubleClick={onReset}
    >
      <div className="bg-line group-hover:bg-accent group-data-[state=dragging]:bg-accent pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors" />
    </Separator>
  )
}
