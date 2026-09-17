'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Flag, Accessibility, Moon, Sun, Monitor, Save, Cloud, CloudOff } from 'lucide-react'
import styles from './TestRunner.module.css'
import utils from '@/styles/utils.module.css'

type Theme = 'light' | 'dark' | 'high-contrast'
type FontSize = 'small' | 'medium' | 'large'

export function TestRunner({ attemptId, timeLimitMins, initialQuestions }: { attemptId: string, timeLimitMins: number, initialQuestions: any[] }) {
  // State
  const [timeLeft, setTimeLeft] = useState(timeLimitMins * 60)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [responses, setResponses] = useState<Record<string, string>>({})
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const [syncQueue, setSyncQueue] = useState<any[]>([])
  
  // UX State
  const [theme, setTheme] = useState<Theme>('light')
  const [fontSize, setFontSize] = useState<FontSize>('medium')
  const [isOnline, setIsOnline] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false)
  const [maxUnlockedIndex, setMaxUnlockedIndex] = useState(0)
  
  const router = useRouter()
  const currentQ = initialQuestions[currentIndex]

  // Network listener & LocalStorage Restore
  useEffect(() => {
    // Restore locally saved inputs if they exist for this attempt
    const savedResponses = localStorage.getItem(`exam_${attemptId}_responses`)
    const savedFlags = localStorage.getItem(`exam_${attemptId}_flags`)
    const savedQueue = localStorage.getItem(`exam_${attemptId}_queue`)
    
    if (savedResponses) setResponses(JSON.parse(savedResponses))
    if (savedFlags) setFlags(JSON.parse(savedFlags))
    if (savedQueue) setSyncQueue(JSON.parse(savedQueue))

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [attemptId])

  // Sync effect when back online
  useEffect(() => {
    if (isOnline && syncQueue.length > 0) {
      flushSyncQueue()
    }
  }, [isOnline, syncQueue])

  // Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          handleFinalSubmit()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Auto-save local storage
  useEffect(() => {
    localStorage.setItem(`exam_${attemptId}_responses`, JSON.stringify(responses))
    localStorage.setItem(`exam_${attemptId}_flags`, JSON.stringify(flags))
    localStorage.setItem(`exam_${attemptId}_queue`, JSON.stringify(syncQueue))
  }, [responses, flags, syncQueue, attemptId])


  const flushSyncQueue = async () => {
    setIsSyncing(true)
    const currentQueue = [...syncQueue]
    try {
      const promises = currentQueue.map(item => 
        fetch('/api/runner/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        })
      )
      await Promise.all(promises)
      setSyncQueue([])
    } catch (e) {
      console.error('Failed to flush queue', e)
    } finally {
      setIsSyncing(false)
    }
  }

  const handleSelectOption = useCallback(async (option: string) => {
    if (!currentQ) return

    setResponses(prev => ({ ...prev, [currentQ.id]: option }))
    
    const payload = {
      attemptId,
      questionId: currentQ.id,
      sectionName: currentQ.section_name || 'General',
      answer: option
    }

    if (isOnline) {
      setIsSyncing(true)
      try {
        await fetch('/api/runner/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      } catch (e) {
        setSyncQueue(prev => [...prev, payload])
      } finally {
        setIsSyncing(false)
      }
    } else {
      setSyncQueue(prev => [...prev, payload])
    }
  }, [currentQ, attemptId, isOnline])

  const toggleFlag = () => {
    if (currentQ) {
      setFlags(prev => ({ ...prev, [currentQ.id]: !prev[currentQ.id] }))
    }
  }

  const handleNext = useCallback(() => {
    if (currentIndex === maxUnlockedIndex) {
      let consecutiveUnanswered = 0;
      for (let i = maxUnlockedIndex; i >= 0; i--) {
        if (!responses[initialQuestions[i].id]) {
          consecutiveUnanswered++;
        } else {
          break;
        }
      }

      if (consecutiveUnanswered >= 3) {
        alert("You must attempt some of the skipped questions before revealing new ones.");
        return;
      }
    }

    const nextIdx = Math.min(currentIndex + 1, initialQuestions.length - 1);
    setCurrentIndex(nextIdx);
    setMaxUnlockedIndex(m => Math.max(m, nextIdx));
  }, [currentIndex, maxUnlockedIndex, responses, initialQuestions]);

  const handlePrev = useCallback(() => {
    setCurrentIndex(c => Math.max(c - 1, 0));
  }, []);

  // Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if they are actively filling out a text input (if exists)
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return

      if (e.key === 'ArrowRight') {
        handleNext()
      } else if (e.key === 'ArrowLeft') {
        handlePrev()
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFlag()
      } else if (['a', 'b', 'c', 'd', 'e'].includes(e.key.toLowerCase())) {
        if (!currentQ?.options) return
        const map: Record<string, number> = { 'a': 0, 'b': 1, 'c': 2, 'd': 3, 'e': 4 }
        const idx = map[e.key.toLowerCase()]
        if (idx < currentQ.options.length) {
          handleSelectOption(currentQ.options[idx])
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex, currentQ, initialQuestions.length, handleSelectOption, handleNext, handlePrev])

  const handleFinalSubmit = async () => {
    if (syncQueue.length > 0) {
      await flushSyncQueue()
    }
    try {
      await fetch('/api/runner/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId })
      })
      localStorage.removeItem(`exam_${attemptId}_responses`)
      localStorage.removeItem(`exam_${attemptId}_flags`)
      localStorage.removeItem(`exam_${attemptId}_queue`)
      router.push(`/student/report/${attemptId}`)
    } catch(e) {
      alert("Failed to submit test. Please check your connection and try again.")
    }
  }

  if (!currentQ) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading exam details...</div>

  // Timer Calculation & Styling
  const mins = Math.floor(timeLeft / 60)
  const secs = timeLeft % 60
  let timerClass = styles.timerGreen
  if (mins < 5) timerClass = styles.timerRed
  else if (mins < 15) timerClass = styles.timerOrange

  // Stats for Modal
  const answeredCount = Object.keys(responses).length
  const flaggedCount = Object.values(flags).filter(Boolean).length
  const totalCount = initialQuestions.length

  const getOptionLabel = (idx: number) => String.fromCharCode(65 + idx) // A, B, C, D...

  return (
    <div className={styles.runnerContainer} data-theme={theme} data-font-size={fontSize}>
      {!isOnline && <div className={styles.offlineBanner} role="alert"><CloudOff size={16} className={utils['u-inline-mr2']}/> Offline Mode: Answers are saving to your device automatically.</div>}
      {isOnline && syncQueue.length > 0 && <div className={styles.syncingBanner} role="status"><Cloud size={16} className={`${utils['u-inline-mr2']} ${utils['u-bounce']}`}/> Back online! Syncing responses...</div>}
      
      {/* Header */}
      <header className={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Question {currentIndex + 1}</h2>
          <span style={{ color: 'var(--color-text-muted)' }} aria-live="polite">
            {isSyncing ? 'Saving...' : 'Saved'}
          </span>
        </div>
        
        <div className={`${styles.timer} ${timerClass}`} aria-live="assertive" aria-label="Time remaining">
          {mins}:{secs.toString().padStart(2, '0')}
        </div>
      </header>

      {/* Settings Toolbar */}
      <div className={styles.toolbar} role="toolbar" aria-label="Accessibility Settings">
        <button className={styles.toolBtn} onClick={() => setFontSize(f => f==='small'?'medium':f==='medium'?'large':'small')} aria-label="Toggle Font Size">
          <Accessibility size={14} className={utils['u-inline-mr1']} /> Size: {fontSize.toUpperCase()}
        </button>
        <button className={styles.toolBtn} onClick={() => setTheme('light')} aria-pressed={theme === 'light'}>
          <Sun size={14} className={utils['u-inline-mr1']} /> Light
        </button>
        <button className={styles.toolBtn} onClick={() => setTheme('dark')} aria-pressed={theme === 'dark'}>
          <Moon size={14} className={utils['u-inline-mr1']} /> Dark
        </button>
        <button className={styles.toolBtn} onClick={() => setTheme('high-contrast')} aria-pressed={theme === 'high-contrast'}>
          <Monitor size={14} className={utils['u-inline-mr1']} /> High Contrast
        </button>
      </div>

      <main className={styles.mainContent}>
        {/* Left Side: Question */}
        <section className={styles.questionSection} aria-labelledby="question-text">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>{currentQ.section_name}</span>
            <button 
              onClick={toggleFlag} 
              className={styles.toolBtn}
              style={{ color: flags[currentQ.id] ? 'var(--color-warning)' : 'inherit', borderColor: flags[currentQ.id] ? 'var(--color-warning)' : 'inherit' }}
              aria-pressed={flags[currentQ.id]}
            >
              <Flag size={14} className={utils['u-inline-mr1']} />
              {flags[currentQ.id] ? 'Flagged' : 'Flag for review'} (F)
            </button>
          </div>

          <div id="question-text" className={styles.questionStem}>{currentQ.stem}</div>

          {currentQ.options && (
            <div className={styles.optionsGrid} role="radiogroup">
              {currentQ.options.map((opt: string, i: number) => {
                const isSelected = responses[currentQ.id] === opt
                return (
                  <button 
                    key={i}
                    onClick={() => handleSelectOption(opt)}
                    className={`${styles.optionBtn} ${isSelected ? styles.optionSelected : ''}`}
                    aria-checked={isSelected}
                    role="radio"
                    tabIndex={0}
                  >
                    <span className={styles.optionLabel}>{getOptionLabel(i)}</span>
                    <span style={{ fontSize: '1.1em' }}>{opt}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Nav Footer inside question section */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto', paddingTop: '3rem' }}>
             <button 
                onClick={handlePrev}
                disabled={currentIndex === 0}
                style={{ opacity: currentIndex === 0 ? 0.3 : 1 }}
                className={styles.toolBtn}
             >
               ← Previous
             </button>
             
             {currentIndex === totalCount - 1 ? (
                <button 
                  onClick={() => setShowConfirmSubmit(true)}
                  style={{ background: 'var(--color-success)', color: 'white', border: 'none', padding: '0.75rem 2rem', borderRadius: 'var(--radius-full)', fontWeight: 600, cursor: 'pointer' }}
                >
                  Finish Test
                </button>
             ) : (
                <button 
                  onClick={handleNext}
                  style={{ background: 'var(--color-primary)', color: 'white', border: 'none', padding: '0.75rem 2rem', borderRadius: 'var(--radius-full)', fontWeight: 600, cursor: 'pointer' }}
                >
                  Next →
                </button>
             )}
          </div>
        </section>

        {/* Right Side: Map */}
        <aside className={styles.sidebar}>
          <h3 style={{ margin: 0, fontSize: '1rem', borderBottom: '1px solid var(--runner-border)', paddingBottom: '0.5rem' }}>Question Navigator</h3>
          <div className={styles.navGrid} role="navigation" aria-label="Question Navigator">
            {initialQuestions.slice(0, maxUnlockedIndex + 1).map((q, i) => {
              const isAnswered = !!responses[q.id]
              const isFlagged = !!flags[q.id]
              const isCurrent = i === currentIndex

              let btnClass = styles.navBadge
              if (isCurrent) btnClass += ` ${styles.navBadgeCurrent}`
              if (isAnswered) btnClass += ` ${styles.navBadgeAnswered}`
              if (isFlagged) btnClass += ` ${styles.navBadgeFlagged}`

              return (
                <button 
                  key={q.id}
                  onClick={() => setCurrentIndex(i)}
                  className={btnClass}
                  aria-label={`Go to question ${i+1}. ${isAnswered ? 'Answered' : 'Unanswered'}. ${isFlagged ? 'Flagged' : ''}`}
                >
                  {i + 1}
                </button>
              )
            })}
          </div>
          
          <button 
             onClick={() => setShowConfirmSubmit(true)}
             style={{ marginTop: 'auto', background: 'transparent', color: 'var(--runner-fg)', border: '2px solid var(--color-primary)', padding: '0.75rem', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', width: '100%' }}
          >
            Submit Test
          </button>
        </aside>
      </main>

      {/* Confirmation Modal */}
      {showConfirmSubmit && (
        <div className={styles.modalOverlay} onClick={() => setShowConfirmSubmit(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <h2 id="modal-title" style={{ margin: 0 }}>Ready to Submit?</h2>
            <p style={{ color: 'var(--color-text-muted)' }}>You cannot change your answers after submission.</p>
            
            <div className={styles.modalGrid}>
              <div className={styles.statBox}>
                <div className={styles.statNumber} style={{ color: 'var(--color-success)' }}>{answeredCount}</div>
                <div className={styles.statLabel}>Answered</div>
              </div>
              <div className={styles.statBox}>
                <div className={styles.statNumber} style={{ color: 'var(--color-danger)' }}>{totalCount - answeredCount}</div>
                <div className={styles.statLabel}>Unanswered</div>
              </div>
              {flaggedCount > 0 && (
                <div className={styles.statBox} style={{ gridColumn: 'span 2', borderColor: 'var(--color-warning)' }}>
                   <div style={{ color: 'var(--color-warning)', fontWeight: 'bold' }}>You have {flaggedCount} flagged questions.</div>
                </div>
              )}
            </div>

            <div className={styles.modalActions}>
              <button 
                onClick={() => setShowConfirmSubmit(false)}
                style={{ padding: '0.75rem 1.5rem', border: '1px solid var(--runner-border)', background: 'transparent', color: 'var(--runner-fg)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
              >
                Go Back
              </button>
              <button 
                onClick={handleFinalSubmit}
                style={{ padding: '0.75rem 2rem', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 'bold', cursor: 'pointer' }}
              >
                Confirm Submission
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
