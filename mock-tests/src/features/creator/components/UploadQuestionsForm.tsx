'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Section } from '@/features/creator/components/CollapsibleSection'
import { useToast } from '@/components/ui/Toast'
import { creatorApi, errorMessage } from '@/lib/creator/client'
import type { UploadQuestionsResult } from '@/lib/creator/types'
import { cn } from '@/lib/utils'

/**
 * Bulk CSV import for the question bank.
 *
 * Posts the file to `POST /api/creator/upload-questions`, which maps the CSV
 * headers onto question columns, inserts each row as a DRAFT owned by the caller
 * and returns a per-row error list. Rows are inserted one at a time server-side,
 * so a bad row never aborts the rest of the import - the results here mirror that.
 */
export function UploadQuestionsForm() {
  const toast = useToast()
  const inputRef = React.useRef<HTMLInputElement>(null)

  const [file, setFile] = React.useState<File | null>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [result, setResult] = React.useState<UploadQuestionsResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const accept = (candidate: File | null | undefined) => {
    if (!candidate) return
    if (!candidate.name.toLowerCase().endsWith('.csv')) {
      setError('That does not look like a CSV file. Export your questions as .csv and try again.')
      return
    }
    setError(null)
    setResult(null)
    setFile(candidate)
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    setResult(null)

    try {
      const response = await creatorApi.uploadQuestions(file)
      setResult(response)

      if (response.inserted > 0) {
        toast.success(
          'Import finished',
          `${response.inserted} of ${response.total} row${response.total === 1 ? '' : 's'} imported as drafts.`
        )
      }
      if (response.errors.length > 0) {
        toast.warning(
          'Some rows were skipped',
          `${response.errors.length} row${response.errors.length === 1 ? '' : 's'} had a problem.`
        )
      }
      if (response.inserted === 0 && response.errors.length === 0) {
        toast.info('Nothing to import', 'The file had a header but no rows.')
      }
    } catch (err) {
      const message = errorMessage(err)
      setError(message)
      toast.error(message)
    } finally {
      setUploading(false)
    }
  }

  const reset = () => {
    setFile(null)
    setResult(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="CSV format" description="What the importer expects before you upload.">
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
            <span>
              Headers are matched case-insensitively, ignoring spaces and underscores. The template has them all.
            </span>
          </li>
          <li className="flex gap-2">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
            <span>
              Required on every row: <strong className="text-foreground">Question Type</strong>,{' '}
              <strong className="text-foreground">Question Text</strong>,{' '}
              <strong className="text-foreground">Exam Type</strong>,{' '}
              <strong className="text-foreground">Year Level</strong> (2–8) and{' '}
              <strong className="text-foreground">Subject</strong>.
            </span>
          </li>
          <li className="flex gap-2">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
            <span>
              Fill in <strong className="text-foreground">ExamID</strong> with a test&apos;s ID to attach each row
              to that test (optionally with <strong className="text-foreground">ExamSection</strong>).
            </span>
          </li>
          <li className="flex gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
            <span>
              Every imported question is saved as a <strong className="text-foreground">draft</strong> owned by
              you. Statistics columns in the file are ignored.
            </span>
          </li>
        </ul>

        <Button asChild variant="outline" size="sm" className="min-h-10 w-fit gap-1.5">
          <a href="/question_template.csv" download>
            <Download size={16} />
            Download CSV template
          </a>
        </Button>
      </Section>

      <Section title="Choose a file" description="One CSV per import.">
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragOver(false)
            accept(event.dataTransfer.files?.[0])
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors',
            dragOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/30'
          )}
        >
          <FileSpreadsheet size={28} className="text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">
            {file ? file.name : 'Drag a CSV here, or tap to browse'}
          </p>
          <p className="text-xs text-muted-foreground">
            {file ? `${(file.size / 1024).toFixed(1)} KB ready to import` : 'Only .csv files are accepted'}
          </p>

          <input
            ref={inputRef}
            id="csv-file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => accept(event.target.files?.[0])}
            disabled={uploading}
          />
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            <Button
              asChild
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10"
              disabled={uploading}
            >
              <label htmlFor="csv-file">{file ? 'Choose a different file' : 'Browse files'}</label>
            </Button>
            {file ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-10 gap-1.5 text-muted-foreground"
                onClick={reset}
                disabled={uploading}
              >
                <Trash2 size={15} />
                Remove
              </Button>
            ) : null}
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
          >
            {error}
          </p>
        ) : null}

        <Button
          type="button"
          className="min-h-12 w-full gap-1.5 sm:w-auto"
          onClick={() => void handleUpload()}
          disabled={!file || uploading}
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {uploading ? 'Importing…' : 'Upload and import'}
        </Button>
      </Section>

      {result ? (
        <Section title="Import results" description={`${result.total} data rows processed.`}>
          <dl className="grid grid-cols-3 gap-2">
            <ResultStat label="Rows" value={result.total} />
            <ResultStat label="Imported" value={result.inserted} tone="success" />
            <ResultStat label="Errors" value={result.errors.length} tone={result.errors.length > 0 ? 'warning' : 'success'} />
          </dl>

          {result.errors.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <XCircle size={16} className="text-destructive" aria-hidden="true" />
                Rows that were skipped
              </p>
              <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto rounded-lg border border-destructive/20 bg-destructive/5 p-2">
                {result.errors.map((rowError, index) => (
                  <li
                    key={`${rowError.row}-${index}`}
                    className="rounded bg-background px-2.5 py-1.5 text-xs text-foreground"
                  >
                    <span className="font-bold">Row {rowError.row}:</span> {rowError.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 size={16} aria-hidden="true" />
              Every row imported cleanly.
            </p>
          )}

          <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row">
            <Button type="button" variant="outline" className="min-h-11 gap-1.5" onClick={reset} disabled={uploading}>
              <Upload size={16} />
              Import another file
            </Button>
            <Button asChild variant="ghost" className="min-h-11">
              <Link href="/creator/questions">Go to question bank</Link>
            </Button>
          </div>
        </Section>
      ) : null}
    </div>
  )
}

function ResultStat({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'success' | 'warning'
}) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-2 text-center">
      <dt className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd
        className={cn(
          'text-xl font-extrabold tabular-nums',
          tone === 'success' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'warning' && 'text-amber-600 dark:text-amber-400',
          tone === 'default' && 'text-foreground'
        )}
      >
        {value}
      </dd>
    </div>
  )
}
