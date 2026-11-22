import {
  IconCloseOutlineRegular,
  Tooltip,
  IconLinkOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  Input,
  Pill,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { ResponsiveActionButton } from '../../components/ResponsiveActionButton.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { FILTERS, FILTER_LABELS, type StateFilter } from './types.ts'
import css from '../parsed-manager.module.css'

interface ParsedManagerToolbarProps {
  filter: StateFilter
  onFilterChange: (next: StateFilter) => void
  query: string
  onQueryChange: (query: string) => void
  busy: boolean
  listAllowed: boolean
  urlParseDisabled: boolean
  onOpenUrl?: () => void
  onRefresh: () => void
  t: TranslateNS<'zotero'>
}

export function ParsedManagerToolbar(props: ParsedManagerToolbarProps) {
  const {
    filter,
    onFilterChange,
    query,
    onQueryChange,
    busy,
    listAllowed,
    urlParseDisabled,
    onOpenUrl,
    onRefresh,
    t,
  } = props

  return (
    <header className={css.toolbar}>
      <div className={css.filters} role="group" aria-label={t('parsedManagerFilterLabel')}>
        {FILTERS.map((value) => (
          <Pill
            key={value}
            active={filter === value}
            aria-pressed={filter === value}
            disabled={!listAllowed}
            onClick={() => onFilterChange(value)}
          >
            {t(FILTER_LABELS[value])}
          </Pill>
        ))}
      </div>
      <div className={css.toolbarRow}>
        <Input
          className={css.search}
          icon={<IconSearchOutlineRegular size={14} />}
          type="search"
          placeholder={t('parsedManagerSearchPlaceholder')}
          aria-label={t('parsedManagerSearchPlaceholder')}
          value={query}
          disabled={!listAllowed}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {query !== '' && (
          <Tooltip label={t('parsedManagerClearSearch')} side="bottom" delayMs={500} portal>
            <IconButton
              shape="round"
              size="sm"
              icon={<IconCloseOutlineRegular size={12} />}
              aria-label={t('parsedManagerClearSearch')}
              onClick={() => onQueryChange('')}
            />
          </Tooltip>
        )}
        <ResponsiveActionButton
          variant="outline"
          size="sm"
          className={css.textSeat}
          label={t('libraryParseUrl')}
          icon={<IconLinkOutlineRegular size={13} className={css.urlParseGlyph} />}
          disabled={urlParseDisabled}
          onClick={onOpenUrl}
        />
        <IconButton
          shape="square"
          variant="outline"
          size="sm"
          aria-label={t('parsedManagerRefresh')}
          aria-busy={busy}
          disabled={busy || !listAllowed}
          icon={
            busy ? <StateDot state="ongoing" size={13} /> : <IconRefreshOutlineRegular size={13} />
          }
          onClick={onRefresh}
        />
      </div>
    </header>
  )
}
