export const FORMAT_TEXT_COLORS = [
  { label: 'Default', value: null },
  { label: 'Ink', value: '#1f1b16' },
  { label: 'Amber', value: '#8a6a3b' },
  { label: 'Green', value: '#3f5d4a' },
  { label: 'Blue', value: '#3d5a73' },
  { label: 'Rose', value: '#7a4a48' },
  { label: 'Violet', value: '#5c4d73' },
] as const

export const FORMAT_HIGHLIGHT_COLORS = [
  { label: 'None', value: null },
  { label: 'Amber', value: '#f3d9a0' },
  { label: 'Green', value: '#cfe3d3' },
  { label: 'Blue', value: '#c9d8e6' },
  { label: 'Rose', value: '#f0d4d1' },
  { label: 'Violet', value: '#ddd4ea' },
] as const

export const NOTE_FONTS = [
  { label: 'Source Serif', value: 'var(--font-serif), "Source Serif 4", Georgia, serif' },
  { label: 'Inter', value: 'var(--font-sans), Inter, system-ui, sans-serif' },
  { label: 'Amiri', value: 'var(--font-arabic), Amiri, serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times', value: '"Times New Roman", Times, serif' },
] as const

export const NOTE_FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'] as const

export const NOTE_LINE_SPACING = [
  { label: '1.0', value: '1' },
  { label: '1.15', value: '1.15' },
  { label: '1.5', value: '1.5' },
  { label: '2.0', value: '2' },
] as const
