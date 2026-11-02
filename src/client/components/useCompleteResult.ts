/**
 * The one complete-result reader shared by the export card and the generic file
 * toolview: fetch the persisted body by event coordinates, prefer the raw
 * export text, and never surface an aborted read as a failure.
 * @module dsh-zotero/client/components/useCompleteResult
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { rawExportText, readCompleteResult, type ResultCoordinates } from '../result-reader.ts'

/** One loaded body: the text the user copies plus the format its file name follows. */
export interface CompleteResultBody {
  readonly text: string
  readonly format: string
}

/** The reader's render state; a settled body and an error are mutually exclusive. */
export interface CompleteResultState {
  readonly body?: CompleteResultBody
  readonly error?: string
  readonly loading?: boolean
}

export interface CompleteResultOptions {
  /** The owning session; a missing session is an unreadable coordinate, not a failure. */
  readonly sessionId?: string
  /** The recorded event coordinates, or undefined when the block carries none. */
  readonly coordinates?: ResultCoordinates
  /** Export cards need the native export text; a non-export tool falls back to JSON. */
  readonly requireExportText: boolean
  /** The localized message for a refused or failed read. */
  readonly failureMessage: string
}

export interface CompleteResultReader {
  readonly state: CompleteResultState
  load: () => Promise<void>
}

/**
 * Read one persisted result body on demand.
 * @param options - the session, coordinates, and the failure text to show.
 * @returns the render state and the loader.
 */
export function useCompleteResult(options: CompleteResultOptions): CompleteResultReader {
  const { sessionId, coordinates, requireExportText, failureMessage } = options
  const active = useRef<AbortController>()
  useEffect(() => () => active.current?.abort(), [])
  const [state, setState] = useState<CompleteResultState>({})
  const seq = coordinates?.seq
  const index = coordinates?.index
  const load = useCallback(async (): Promise<void> => {
    if (sessionId === undefined || seq === undefined || index === undefined) return
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    setState({ loading: true })
    try {
      const data = await readCompleteResult(sessionId, { seq, index }, controller.signal)
      controller.signal.throwIfAborted()
      const exported = rawExportText(data)
      if (requireExportText && exported === undefined) throw new Error(failureMessage)
      setState({
        body: {
          text: exported ?? JSON.stringify(data, null, 2),
          format: typeof data['format'] === 'string' ? data['format'] : '',
        },
      })
    } catch {
      if (!controller.signal.aborted) setState({ error: failureMessage })
    }
  }, [sessionId, seq, index, requireExportText, failureMessage])
  return { state, load }
}
