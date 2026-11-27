export const DEFAULT_ANNOTATION_COLOR = '#ffd400'

export function annotationColorOf(color?: string): string {
  return color && /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_ANNOTATION_COLOR
}
