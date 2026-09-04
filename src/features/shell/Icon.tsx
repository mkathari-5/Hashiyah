/**
 * A small hand-picked icon set drawn inline.
 *
 * Deliberately not an icon library: the brief asks for a calm, scholarly
 * interface, and a consistent 1.5px stroke on a 16px grid does more for that
 * than a thousand pictograms. It also keeps the app fully offline.
 */

const PATHS = {
  'chevron-up': 'M4 10l4-4 4 4',
  'chevron-down': 'M4 6l4 4 4-4',
  'chevron-right': 'M6 4l4 4-4 4',
  minus: 'M3.5 8h9',
  plus: 'M8 3.5v9M3.5 8h9',
  search: 'M11.2 11.2L14 14M12.5 7.25a5.25 5.25 0 11-10.5 0 5.25 5.25 0 0110.5 0z',
  book: 'M3 3.5h4a2 2 0 012 2v7a1.6 1.6 0 00-1.6-1.6H3zM13 3.5H9a2 2 0 00-2 2v7a1.6 1.6 0 011.6-1.6H13z',
  folder: 'M2 4.5A1.5 1.5 0 013.5 3h2.2l1.3 1.6h5.5A1.5 1.5 0 0114 6.1v5.4A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5z',
  sun: 'M8 11a3 3 0 100-6 3 3 0 000 6zM8 1.5v1.2M8 13.3v1.2M2.4 2.4l.9.9M12.7 12.7l.9.9M1.5 8h1.2M13.3 8h1.2M2.4 13.6l.9-.9M12.7 3.3l.9-.9',
  moon: 'M13.2 9.6A5.6 5.6 0 016.4 2.8 5.6 5.6 0 108 14a5.6 5.6 0 005.2-4.4z',
  x: 'M4 4l8 8M12 4l-8 8',
  quote: 'M6 5.5C4.6 5.5 3.5 6.6 3.5 8s1.1 2.5 2.5 2.5c0 0 0 2-2 2.5M13 5.5c-1.4 0-2.5 1.1-2.5 2.5s1.1 2.5 2.5 2.5c0 0 0 2-2 2.5',
  'arrow-up-right': 'M5.5 10.5l5-5M6.5 5.5h4v4',
  'panel-left': 'M2.5 3.5h11v9h-11zM6 3.5v9',
  'panel-right': 'M2.5 3.5h11v9h-11zM10 3.5v9',
  columns: 'M2.5 3.5h11v9h-11zM6 3.5v9M10 3.5v9',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2a1 1 0 001 .8h3.8a1 1 0 001-.8l.6-8.2',
  star: 'M8 2.5l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.2 4.6 13l.7-3.8L2.5 6.5l3.8-.5z',
  file: 'M4 2h5l3 3v9H4zM9 2v3h3',
  import: 'M8 2.5v7M5.2 6.7L8 9.5l2.8-2.8M3 12.5h10',
  note: 'M3.5 2.5h9v11h-9zM6 5.5h4M6 8h4M6 10.5h2.5',
  'chevrons-right': 'M3.5 4l4 4-4 4M9 4l4 4-4 4',
  clock: 'M8 4.2V8l2.4 1.4M14 8A6 6 0 112 8a6 6 0 0112 0z',
  settings:
    'M8 10a2 2 0 100-4 2 2 0 000 4zM13 8a5 5 0 00-.1-1l1.2-.9-1.2-2-1.4.5a5 5 0 00-1.7-1L9.5 2h-3l-.3 1.6a5 5 0 00-1.7 1l-1.4-.5-1.2 2 1.2.9a5 5 0 000 2l-1.2.9 1.2 2 1.4-.5a5 5 0 001.7 1l.3 1.6h3l.3-1.6a5 5 0 001.7-1l1.4.5 1.2-2-1.2-.9c.06-.33.1-.66.1-1z',
  keyboard: 'M2 4.5h12v7H2zM4.5 7h.01M7 7h.01M9.5 7h.01M11.5 7h.01M4.5 9.5h7',
  list: 'M3 4.5h10M3 8h10M3 11.5h6',
  dots: 'M4 8h.01M8 8h.01M12 8h.01',
  maximise: 'M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10',
  minimise: 'M2.5 6H6V2.5M13.5 6H10V2.5M2.5 10H6v3.5M13.5 10H10v3.5',
  bookmark: 'M4 2.5h8v11l-4-3-4 3z',
  snip: 'M2 5.5h2M12 5.5h2M2 10.5h2M12 10.5h2M5.5 2v2M5.5 12v2M10.5 2v2M10.5 12v2M5.5 5.5h5v5h-5z',
  'snip-explain': 'M2 5.5h2M12 5.5h2M2 10.5h2M5.5 2v2M5.5 12v2M10.5 2v2M5.5 5.5h5v5h-5zM11 12.5h3.5M12.75 10.75v3.5',
  layers: 'M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3',
  pencil: 'M10.6 2.9l2.5 2.5M3 13.1l.6-2.6 7-7 2.5 2.5-7 7z',
  grip: 'M5.5 4h.01M10.5 4h.01M5.5 8h.01M10.5 8h.01M5.5 12h.01M10.5 12h.01',
  cursor: 'M3.5 2.5l8.5 6.2-3.6.4-2 5.4z',
  hand: 'M5.5 8.2V4.8M5.5 8.2V12.2a2 2 0 002 2h2.2a2 2 0 002-2V7.2M7.8 8.2V3.8M10.1 8.2V4.6M12.4 8.2V5.8',
  highlight: 'M3 12.5h10M5 10.2l6.2-6.2 1.8 1.8-6.2 6.2H5z',
  underline: 'M4 12.7h8M5 4.2v5.2a3 3 0 006 0V4.2',
  eraser: 'M3.5 10.2l5.3-5.3 3.3 3.3-5.3 5.3H3.5zM7.2 6.5l3.1 3.1',
  undo: 'M4.2 7.2H11a2.8 2.8 0 010 5.6H8.5M4.2 7.2l2.2-2.2M4.2 7.2L6.4 9.4',
  redo: 'M11.8 7.2H5a2.8 2.8 0 000 5.6h2.5M11.8 7.2l-2.2-2.2M11.8 7.2L9.6 9.4',
  rotate: 'M12.5 6A4.5 4.5 0 118 3.5M12.5 6V3.2M12.5 6h-2.8',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
