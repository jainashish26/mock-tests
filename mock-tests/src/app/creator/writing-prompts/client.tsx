'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, RefreshCw } from 'lucide-react'
import { creatorApi, errorMessage } from '@/lib/creator/client'
import type { WritingPromptRow, WritingPromptInput, WritingPromptType } from '@/lib/creator/types'
import { CONTENT_STATUSES, STATUS_LABELS, type ContentStatus } from '@/lib/creator/content-meta'

const YEARS = [2, 3, 4, 5, 6, 7, 8, 9]
const PAGE_SIZE = 20

interface FormState {
  year_level: number
  type: WritingPromptType
  territory: string
  text: string
  status: ContentStatus
}

const blankForm = (): FormState => ({
  year_level: 5,
  type: 'narrative',
  territory: '',
  text: '',
  status: 'DRAFT',
})

const fieldClass =
  'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40'

export function WritingPromptsManager() {
  const [rows, setRows] = useState<WritingPromptRow[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [year, setYear] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const [form, setForm] = useState<FormState | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await creatorApi.listWritingPrompts({
        page,
        pageSize: PAGE_SIZE,
        year_level: year ? Number(year) : '',
        type: (type || '') as WritingPromptType | '',
        status: (status || '') as ContentStatus | '',
        search,
      })
      setRows(res.data)
      setCount(res.count)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [page, year, type, status, search])

  useEffect(() => {
    void load()
  }, [load])

  const openNew = () => {
    setEditingId(null)
    setForm(blankForm())
    setFormError(null)
  }

  const openEdit = (row: WritingPromptRow) => {
    setEditingId(row.id)
    setForm({
      year_level: row.year_level,
      type: row.type,
      territory: row.territory,
      text: row.text,
      status: row.status,
    })
    setFormError(null)
  }

  const closeForm = () => {
    setForm(null)
    setEditingId(null)
    setFormError(null)
  }

  const save = async () => {
    if (!form) return
    setSaving(true)
    setFormError(null)
    try {
      const payload: WritingPromptInput = {
        year_level: form.year_level,
        type: form.type,
        territory: form.territory,
        text: form.text,
        status: form.status,
      }
      if (editingId) await creatorApi.updateWritingPrompt(editingId, payload)
      else await creatorApi.createWritingPrompt(payload)
      closeForm()
      await load()
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (row: WritingPromptRow) => {
    if (!window.confirm(`Delete this ${row.type} prompt for Year ${row.year_level}? This cannot be undone.`)) return
    try {
      await creatorApi.deleteWritingPrompt(row.id)
      await load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Writing Prompts</h1>
          <p className="text-sm text-muted-foreground">
            The AI Practice Lab prompt bank (Years 2–9). {count} prompt{count === 1 ? '' : 's'}.
          </p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Plus size={16} /> New prompt
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Year
          <select value={year} onChange={(e) => { setYear(e.target.value); setPage(1) }} className={fieldClass}>
            <option value="">All years</option>
            {YEARS.map((y) => <option key={y} value={y}>Year {y}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Type
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1) }} className={fieldClass}>
            <option value="">All types</option>
            <option value="narrative">Narrative</option>
            <option value="persuasive">Persuasive</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Status
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className={fieldClass}>
            <option value="">All statuses</option>
            {CONTENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
          Search
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search prompt text or territory…"
            className={fieldClass}
          />
        </label>
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Year</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Territory</th>
              <th className="px-3 py-2">Prompt</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No prompts match these filters.</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b align-top last:border-0">
                  <td className="whitespace-nowrap px-3 py-2">Y{row.year_level}</td>
                  <td className="whitespace-nowrap px-3 py-2 capitalize">{row.type}</td>
                  <td className="whitespace-nowrap px-3 py-2">{row.territory}</td>
                  <td className="max-w-md px-3 py-2"><span className="line-clamp-2">{row.text}</span></td>
                  <td className="whitespace-nowrap px-3 py-2">{STATUS_LABELS[row.status] ?? row.status}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button onClick={() => openEdit(row)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
                      <Pencil size={13} /> Edit
                    </button>
                    <button onClick={() => void remove(row)} className="ml-2 inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10">
                      <Trash2 size={13} /> Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Page {page} of {totalPages}</span>
        <div className="flex gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-md border px-3 py-1 hover:bg-accent disabled:opacity-40">Previous</button>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded-md border px-3 py-1 hover:bg-accent disabled:opacity-40">Next</button>
        </div>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-card p-5 shadow-xl">
            <h2 className="text-lg font-bold">{editingId ? 'Edit prompt' : 'New prompt'}</h2>
            {formError && (
              <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Year level
                <select value={form.year_level} onChange={(e) => setForm({ ...form, year_level: Number(e.target.value) })} className={fieldClass}>
                  {YEARS.map((y) => <option key={y} value={y}>Year {y}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Type
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as WritingPromptType })} className={fieldClass}>
                  <option value="narrative">Narrative</option>
                  <option value="persuasive">Persuasive</option>
                </select>
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Territory
                <input value={form.territory} onChange={(e) => setForm({ ...form, territory: e.target.value })} placeholder="e.g. Courage, Fairness, Technology" className={fieldClass} />
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Prompt text
                <textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} rows={4} placeholder="Write the prompt students will respond to…" className={fieldClass} />
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Status
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ContentStatus })} className={fieldClass}>
                  {CONTENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </label>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Only <strong>Published</strong> prompts appear in the AI Practice Lab. Drafts stay hidden until you publish them.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={closeForm} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
              <button
                onClick={() => void save()}
                disabled={saving || !form.text.trim() || !form.territory.trim()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create prompt'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}