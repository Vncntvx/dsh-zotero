import { useEffect, useRef, useState } from 'react'
import type { ZoteroBatchParseView, ZoteroDocumentMaintenanceRemote } from '../../contract.ts'
import { messageOf } from '../error-text.ts'
import { typedRemoteResult } from './parse-controller.ts'

export function batchIsActive(batch: ZoteroBatchParseView | null | undefined) {
  return batch?.state === 'running' || batch?.state === 'stopping'
}

/** The manager owns this read while visible, including when the dialog closes. */
export function useBatchParseStatus(
  remote: ZoteroDocumentMaintenanceRemote | undefined,
  sessionId: string,
  enabled: boolean,
) {
  const [batch, setBatch] = useState<ZoteroBatchParseView | null>()
  const [error, setError] = useState<string>()
  const [offset, setOffset] = useState(0)
  const [epoch, setEpoch] = useState(0)
  const reading = useRef<AbortController>()
  useEffect(() => {
    if (!enabled || !remote) return
    const abort = new AbortController()
    reading.current = abort
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const result = typedRemoteResult(
          await remote.batchParseStatus({ sessionId, offset }, abort.signal),
        )
        if (abort.signal.aborted) return
        setBatch(result)
        setError(undefined)
        if (batchIsActive(result)) timer = setTimeout(() => void read(), 1000)
      } catch (cause) {
        if (!abort.signal.aborted) setError(messageOf(cause))
      }
    }
    void read()
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
  }, [enabled, epoch, offset, remote, sessionId])

  const refresh = () => {
    reading.current?.abort()
    setError(undefined)
    setEpoch((value) => value + 1)
  }
  return {
    batch,
    error,
    offset,
    setOffset,
    refresh,
    accept(next: ZoteroBatchParseView) {
      setBatch(next)
      setOffset(0)
      refresh()
    },
  }
}

export type BatchParseStatus = ReturnType<typeof useBatchParseStatus>
