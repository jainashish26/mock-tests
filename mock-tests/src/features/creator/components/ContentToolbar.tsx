'use client'

import * as React from 'react'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Search, SlidersHorizontal, X } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/utils'

/**
 * Search / filter / sort bar shared by the tests and questions managers.
 *
 * Mobile-first: the search field and the primary action stay on the first row
 * (the two things used most), and the filters collapse behind a "Filters"
 * button that shows how many are active. From `sm` up the filters sit inline and
 * the toggle is hidden.
 */

export interface ToolbarFilter {
  key: string
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}

interface ContentToolbarProps {
  idPrefix: string
  searchLabel: string
  search: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  filters?: ToolbarFilter[]
  sortLabel?: string
  sort: string
  dir: 'asc' | 'desc'
  sortOptions: { value: string; label: string }[]
  onSortChange: (sort: string) => void
  onDirChange: (dir: 'asc' | 'desc') => void
  activeFilterCount: number
  onClearFilters: () => void
  actions?: React.ReactNode
}

export function ContentToolbar({
  idPrefix,
  searchLabel,
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filters = [],
  sortLabel = 'Sort by',
  sort,
  dir,
  sortOptions,
  onSortChange,
  onDirChange,
  activeFilterCount,
  onClearFilters,
  actions,
}: ContentToolbarProps) {
  const [showFilters, setShowFilters] = React.useState(false)
  const hasFilters = filters.length > 0 || sortOptions.length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            id={`${idPrefix}-search`}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
            className="pl-9"
          />
        </div>

        {hasFilters ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10 shrink-0 gap-1.5 px-3 sm:hidden"
            onClick={() => setShowFilters((open) => !open)}
            aria-expanded={showFilters}
            aria-controls={`${idPrefix}-filters`}
          >
            <SlidersHorizontal size={16} />
            Filters
            {activeFilterCount > 0 ? (
              <span className="ml-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-[0.6875rem] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
        ) : null}

        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>

      {hasFilters ? (
        <div
          id={`${idPrefix}-filters`}
          className={cn(
            'flex-col gap-2 rounded-xl border border-border bg-muted/40 p-3 sm:flex sm:flex-row sm:flex-wrap sm:items-end sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0',
            showFilters ? 'flex' : 'hidden'
          )}
        >
          {filters.map((filter) => (
            <div key={filter.key} className="flex min-w-0 flex-col gap-1 sm:max-w-52 sm:flex-1">
              <label htmlFor={`${idPrefix}-${filter.key}`} className="text-xs font-semibold text-muted-foreground">
                {filter.label}
              </label>
              <Select
                id={`${idPrefix}-${filter.key}`}
                value={filter.value}
                onChange={(event) => filter.onChange(event.target.value)}
                className="sm:h-9"
              >
                {filter.options.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}

          <div className="flex min-w-0 flex-col gap-1 sm:max-w-56 sm:flex-1">
            <label htmlFor={`${idPrefix}-sort`} className="text-xs font-semibold text-muted-foreground">
              {sortLabel}
            </label>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  id={`${idPrefix}-sort`}
                  value={sort}
                  onChange={(event) => onSortChange(event.target.value)}
                  className="sm:h-9"
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-9 shrink-0 px-2.5 sm:h-9"
                onClick={() => onDirChange(dir === 'asc' ? 'desc' : 'asc')}
                aria-label={dir === 'asc' ? 'Sort ascending' : 'Sort descending'}
                title={dir === 'asc' ? 'Ascending' : 'Descending'}
              >
                {dir === 'asc' ? <ArrowUpNarrowWide size={16} /> : <ArrowDownWideNarrow size={16} />}
              </Button>
            </div>
          </div>

          {activeFilterCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-9 justify-start gap-1.5 text-muted-foreground sm:mb-0.5"
              onClick={onClearFilters}
            >
              <X size={14} />
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
