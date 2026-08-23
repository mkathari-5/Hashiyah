import { ROOT_LIBRARY_PAGE_ID } from '@/db/repos/libraryPages'
import { LibraryEditor } from '@/features/library/LibraryEditor'

/**
 * Library home — a Notion-style page, not a recursive outline of study nodes.
 *
 * Study material lives in the sidebar once a session is open, and as explicit
 * Study-page blocks on this canvas. This view must not render LibraryTree.
 */
export function LibraryHome({ onImport: _onImport }: { onImport: () => void }) {
  return (
    <div className="library-home">
      <LibraryEditor pageId={ROOT_LIBRARY_PAGE_ID} />
    </div>
  )
}
