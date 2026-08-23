import { useState } from 'react'
import { ROOT_LIBRARY_PAGE_ID } from '@/db/repos/libraryPages'
import { LibraryEditor } from '@/features/library/LibraryEditor'

/**
 * Library home — a Notion-style page, not a recursive outline of study nodes.
 *
 * Study material lives in the sidebar once a session is open, and as explicit
 * Study-page blocks. Previous Library is a separate archive page.
 */
export function LibraryHome({ onImport: _onImport }: { onImport: () => void }) {
  const [pageId, setPageId] = useState(ROOT_LIBRARY_PAGE_ID)
  return (
    <div className="library-home">
      <LibraryEditor pageId={pageId} onOpenPage={setPageId} />
    </div>
  )
}
