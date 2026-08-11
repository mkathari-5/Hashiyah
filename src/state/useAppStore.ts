import { create } from 'zustand'
import { appStateRepo } from '@/db/repos/session'

export type Theme = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

/**
 * Layout modes (§19–§21).
 *
 *  three  — library · book · notes
 *  study  — book · notes, library collapsed. The best default while reading.
 *  pdf    — book only
 *  notes  — notes only, for reorganising after a lesson
 *  lesson — book · notes with the chrome stripped and the timer running
 */
export type LayoutMode = 'three' | 'study' | 'pdf' | 'notes' | 'lesson'

export interface PanelSizes {
  library: number
  reader: number
  notes: number
}

const DEFAULT_SIZES: PanelSizes = { library: 19, reader: 48, notes: 33 }

interface AppState {
  theme: Theme
  /** What the theme setting currently resolves to, after consulting the OS. */
  resolvedTheme: ResolvedTheme
  layout: LayoutMode
  /** Layout to come back to when leaving lesson mode. */
  previousLayout: LayoutMode
  sizes: PanelSizes
  paletteOpen: boolean
  searchOpen: boolean
  shortcutsOpen: boolean
  /** Transient "Saved ✓" affordance in the status bar. */
  savedAt: number | null
  saving: boolean
  hydrated: boolean

  hydrate: () => Promise<void>
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setLayout: (layout: LayoutMode) => void
  toggleLessonMode: () => void
  /** Flip between a focus mode and whatever layout preceded it (§51). */
  toggleFocus: (mode: 'notes' | 'pdf') => void
  setSizes: (sizes: PanelSizes) => void
  resetSizes: () => void
  setPaletteOpen: (open: boolean) => void
  setSearchOpen: (open: boolean) => void
  setShortcutsOpen: (open: boolean) => void
  markSaving: () => void
  markSaved: () => void
}

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches

function resolve(theme: Theme): ResolvedTheme {
  if (theme === 'system') return prefersDark() ? 'dark' : 'light'
  return theme
}

function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolve(theme)
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.documentElement.style.colorScheme = resolved
  return resolved
}

export const useAppStore = create<AppState>((set, get) => ({
  theme: 'dark',
  resolvedTheme: 'dark',
  layout: 'three',
  previousLayout: 'three',
  sizes: DEFAULT_SIZES,
  paletteOpen: false,
  searchOpen: false,
  shortcutsOpen: false,
  savedAt: null,
  saving: false,
  hydrated: false,

  async hydrate() {
    const [theme, layout, sizes] = await Promise.all([
      appStateRepo.get<Theme>('theme', 'dark'),
      appStateRepo.get<LayoutMode>('layout', 'three'),
      appStateRepo.get<PanelSizes>('panelSizes', DEFAULT_SIZES),
    ])
    // Never restore straight into lesson mode — it hides navigation, which is a
    // confusing place to land on a cold start.
    const restored: LayoutMode = layout === 'lesson' ? 'three' : layout
    const resolvedTheme = applyTheme(theme)

    // Follow the OS while the preference is "system".
    window
      .matchMedia?.('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (get().theme === 'system') set({ resolvedTheme: applyTheme('system') })
      })

    set({ theme, resolvedTheme, layout: restored, previousLayout: restored, sizes, hydrated: true })
  },

  setTheme(theme) {
    const resolvedTheme = applyTheme(theme)
    set({ theme, resolvedTheme })
    void appStateRepo.set('theme', theme)
  },

  toggleTheme() {
    get().setTheme(get().resolvedTheme === 'dark' ? 'light' : 'dark')
  },

  setLayout(layout) {
    const current = get().layout
    set({ layout, previousLayout: current === 'lesson' ? get().previousLayout : current })
    void appStateRepo.set('layout', layout)
  },

  toggleLessonMode() {
    const { layout, previousLayout, setLayout } = get()
    setLayout(layout === 'lesson' ? previousLayout : 'lesson')
  },

  toggleFocus(mode) {
    const { layout, previousLayout, setLayout } = get()
    // Leaving a focus mode returns to whatever you were doing, not to a
    // hard-coded default — you may have been in study mode, not three-column.
    setLayout(layout === mode ? (previousLayout === mode ? 'three' : previousLayout) : mode)
  },

  setSizes(sizes) {
    set({ sizes })
    void appStateRepo.set('panelSizes', sizes)
  },

  resetSizes() {
    set({ sizes: DEFAULT_SIZES })
    void appStateRepo.set('panelSizes', DEFAULT_SIZES)
  },

  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  markSaving: () => set({ saving: true }),
  markSaved: () => set({ saving: false, savedAt: Date.now() }),
}))
