import { createContext } from 'react'
import type { ReaderTranslationTarget } from '../../reader/config.ts'

export const ReaderTranslationTargetContext = createContext<ReaderTranslationTarget>('auto')
