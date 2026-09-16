'use client'

import { useState, useRef } from 'react'
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { SpatialCard } from "@/components/ui/SpatialCard"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle, ArrowLeft, Download } from "lucide-react"
import Link from 'next/link'

interface UploadResult {
  total: number
  inserted: number
  errors: { row: number; message: string }[]
}

export default function UploadQuestionsPage() {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (f: File) => {
    if (f.name.endsWith('.csv')) {
      setFile(f)
      setResult(null)
    }
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/creator/upload-questions', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (data.error) {
        setResult({ total: 0, inserted: 0, errors: [{ row: 0, message: data.error }] })
      } else {
        setResult(data)
      }
    } catch (err: any) {
      setResult({ total: 0, inserted: 0, errors: [{ row: 0, message: err.message }] })
    } finally {
      setUploading(false)
    }
  }

  return (
    <DashboardLayout role="CREATOR" userName="Expert Content Creator">
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
          <Link href="/creator">
            <Button variant="ghost" size="icon"><ArrowLeft size={20} /></Button>
          </Link>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>Upload Question Bank</h1>
            <p style={{ color: 'var(--color-text-muted)', margin: 0, marginTop: '0.25rem' }}>Import questions from a CSV file into the question bank.</p>
          </div>
        </div>

        {/* CSV Template info */}
        <SpatialCard intensity={2}>
          <div style={{ padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ background: '#ecfdf5', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                <FileSpreadsheet size={20} color="#059669" />
              </div>
              <div>
                <div style={{ fontWeight: 700 }}>CSV Format Requirements</div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                  Your CSV must include headers matching the field glossary. Required: <strong>ExamType, YearLevel, Subject, Question Type, Question Text, Correct, Answer A, Answer B</strong>.
                </div>
              </div>
            </div>
            <a href="/question_template.csv" download>
              <Button variant="outline" size="sm" className="flex items-center gap-2">
                <Download size={16} /> Download CSV Template
              </Button>
            </a>
          </div>
        </SpatialCard>

        {/* Drag-and-Drop zone */}
        <SpatialCard intensity={5}>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files[0]
              if (f) handleFileSelect(f)
            }}
            onClick={() => fileRef.current?.click()}
            style={{
              padding: '4rem 2rem',
              textAlign: 'center',
              cursor: 'pointer',
              border: `2px dashed ${dragOver ? 'var(--color-primary)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-lg)',
              margin: '2rem',
              background: dragOver ? 'var(--color-primary-light)' : 'transparent',
              transition: 'all 0.2s',
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFileSelect(f)
              }}
              style={{ display: 'none' }}
            />
            {file ? (
              <>
                <FileSpreadsheet size={48} style={{ color: 'var(--color-primary)', marginBottom: '1rem' }} />
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>{file.name}</h3>
                <p style={{ color: 'var(--color-text-muted)', margin: '0.5rem 0 0' }}>
                  {(file.size / 1024).toFixed(1)} KB — Click to change file
                </p>
              </>
            ) : (
              <>
                <Upload size={48} style={{ color: 'var(--color-text-muted)', opacity: 0.3, marginBottom: '1rem' }} />
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Drag & Drop your CSV here</h3>
                <p style={{ color: 'var(--color-text-muted)', margin: '0.5rem 0 0' }}>
                  or click to browse files
                </p>
              </>
            )}
          </div>
        </SpatialCard>

        {/* Upload button */}
        {file && !result && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
            <Button onClick={handleUpload} disabled={uploading} size="lg">
              {uploading ? 'Processing CSV…' : 'Upload & Import Questions'}
            </Button>
          </div>
        )}

        {/* Results */}
        {result && (
          <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <SpatialCard intensity={3}>
                <div style={{ padding: '1.5rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', fontWeight: 800 }}>{result.total}</div>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 700 }}>Rows Processed</div>
                </div>
              </SpatialCard>
              <SpatialCard intensity={3}>
                <div style={{ padding: '1.5rem', textAlign: 'center' }}>
                  <CheckCircle2 size={20} style={{ color: '#059669', marginBottom: '0.25rem' }} />
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#059669' }}>{result.inserted}</div>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 700 }}>Imported</div>
                </div>
              </SpatialCard>
              <SpatialCard intensity={3}>
                <div style={{ padding: '1.5rem', textAlign: 'center' }}>
                  {result.errors.length > 0 ? <AlertTriangle size={20} style={{ color: '#ca8a04', marginBottom: '0.25rem' }} /> : <CheckCircle2 size={20} style={{ color: '#059669', marginBottom: '0.25rem' }} />}
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: result.errors.length > 0 ? '#ca8a04' : '#059669' }}>{result.errors.length}</div>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 700 }}>Errors</div>
                </div>
              </SpatialCard>
            </div>

            {/* Error list */}
            {result.errors.length > 0 && (
              <SpatialCard intensity={0}>
                <div style={{ padding: '1.5rem' }}>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <XCircle size={18} style={{ color: '#ef4444' }} /> Import Errors
                  </h3>
                  <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {result.errors.map((err, i) => (
                      <div key={i} style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 'var(--radius-sm)', fontSize: '0.8125rem' }}>
                        <strong>Row {err.row}:</strong> {err.message}
                      </div>
                    ))}
                  </div>
                </div>
              </SpatialCard>
            )}

            {/* Upload another */}
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <Button variant="outline" onClick={() => { setFile(null); setResult(null) }}>
                Upload Another File
              </Button>
              <Link href="/creator">
                <Button>Back to Dashboard</Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
