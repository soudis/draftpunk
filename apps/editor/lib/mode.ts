export type EditorMode = 'edit' | 'setup'

export function parseMode(value: string | null | undefined): EditorMode {
  return value === 'setup' ? 'setup' : 'edit'
}
