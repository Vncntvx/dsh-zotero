import { useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import {
  IconDragHandleOutlineRegular,
  IconPinFillRegular,
  IconPinOutlineRegular,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReaderPanelLayout } from '../../reader/reading-state.ts'
import { IconButton } from '../components/IconButton.tsx'
import css from './reader.module.css'

interface Props extends PropsLocale<'zoteroReader'> {
  readonly side: 'left' | 'right'
  readonly label: string
  readonly layout?: ReaderPanelLayout
  readonly save: (layout: ReaderPanelLayout) => void
  /** Panel-owned actions shown before the window controls. */
  readonly action?: ReactNode
  /** Hide the panel from focus and pointer input while a modal overlay owns the page. */
  readonly inert?: boolean
  readonly children: ReactNode
}

function fraction(distance: number, available: number) {
  return available > 0 ? Math.max(0, Math.min(1, distance / available)) : 0
}

const keyOffsets: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-16, 0],
  ArrowRight: [16, 0],
  ArrowUp: [0, -16],
  ArrowDown: [0, 16],
}

export function ReaderPanel({
  t,
  side,
  label,
  layout = {},
  save,
  action,
  inert = false,
  children,
}: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const gesture = useRef<{
    id: number
    mode: 'move' | 'size'
    x: number
    y: number
    box: DOMRect
    bounds: DOMRect
    layout: ReaderPanelLayout
  }>()
  const [preview, setPreview] = useState<ReaderPanelLayout>()
  const current = preview ?? layout
  const floating = current.pinned === false
  const style = {
    '--reader-panel-size': current.width === undefined ? undefined : `${current.width}px`,
    '--reader-panel-x': current.x ?? (side === 'left' ? 0 : 1),
    '--reader-panel-y': current.y ?? 0,
  } as CSSProperties

  const bounds = () => {
    const element = panel.current
    if (!element?.parentElement) return
    return {
      box: element.getBoundingClientRect(),
      bounds: element.parentElement.getBoundingClientRect(),
    }
  }
  const adjusted = (
    base: { box: DOMRect; bounds: DOMRect; layout: ReaderPanelLayout },
    mode: 'move' | 'size',
    dx: number,
    dy: number,
  ): ReaderPanelLayout => {
    const { box, bounds } = base
    if (mode === 'size') {
      const edge = side === 'left' || floating ? 1 : -1
      return {
        ...base.layout,
        width: Math.max(160, Math.min(560, Math.round(box.width + dx * edge))),
      }
    }
    return {
      ...base.layout,
      x: fraction(box.left + dx - bounds.left, bounds.width - box.width),
      y: fraction(box.top + dy - bounds.top, bounds.height - box.height),
    }
  }
  const handle = (mode: 'move' | 'size'): HTMLAttributes<HTMLElement> => ({
    onPointerDown(event) {
      if (event.button !== 0 || !event.isPrimary || gesture.current) return
      const geometry = bounds()
      if (!geometry) return
      event.currentTarget.setPointerCapture(event.pointerId)
      gesture.current = {
        ...geometry,
        id: event.pointerId,
        mode,
        x: event.clientX,
        y: event.clientY,
        layout,
      }
    },
    onPointerMove(event) {
      const start = gesture.current
      if (start?.id !== event.pointerId) return
      setPreview(adjusted(start, start.mode, event.clientX - start.x, event.clientY - start.y))
    },
    onPointerUp(event) {
      const start = gesture.current
      if (start?.id !== event.pointerId) return
      gesture.current = undefined
      setPreview(undefined)
      if (event.clientX !== start.x || event.clientY !== start.y)
        save(adjusted(start, start.mode, event.clientX - start.x, event.clientY - start.y))
    },
    onLostPointerCapture() {
      gesture.current = undefined
      setPreview(undefined)
    },
    onKeyDown(event) {
      const offset = keyOffsets[event.key]
      if (!offset || (mode === 'size' && offset[0] === 0)) return
      const geometry = bounds()
      if (!geometry) return
      event.preventDefault()
      save(adjusted({ ...geometry, layout }, mode, ...offset))
    },
  })
  return (
    <div
      ref={panel}
      className={css.readerPanel}
      data-side={side}
      data-floating={floating}
      style={style}
      {...(inert ? { inert: '' } : {})}
    >
      <div className={css.readerPanelContent}>
        <div className={css.panelHeader}>
          <span className={css.panelTitle}>{label}</span>
          <div className={css.panelActions}>
            {action}
            <Tooltip portal label={t(floating ? 'panelPin' : 'panelFloat', { panel: label })}>
              <IconButton
                shape="square"
                icon={
                  floating ? <IconPinFillRegular size={14} /> : <IconPinOutlineRegular size={14} />
                }
                aria-label={t(floating ? 'panelPin' : 'panelFloat', { panel: label })}
                onClick={() => save({ ...layout, pinned: floating })}
              />
            </Tooltip>
            {floating ? (
              <Tooltip portal label={t('panelMove', { panel: label })}>
                <IconButton
                  shape="square"
                  icon={<IconDragHandleOutlineRegular size={14} />}
                  aria-label={t('panelMove', { panel: label })}
                  className={css.panelMove}
                  {...handle('move')}
                />
              </Tooltip>
            ) : null}
          </div>
        </div>
        {children}
      </div>
      <div
        role="separator"
        aria-label={t('panelResize', { panel: label })}
        aria-orientation="vertical"
        aria-valuemin={160}
        aria-valuemax={560}
        aria-valuenow={current.width ?? 288}
        className={css.panelResize}
        tabIndex={0}
        {...handle('size')}
      />
    </div>
  )
}
