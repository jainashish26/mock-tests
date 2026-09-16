'use client'

import { useState } from 'react'
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { SpatialCard } from "@/components/ui/SpatialCard"
import { Button } from "@/components/ui/Button"

export default function AdminSettingsPage() {
  const [siteName, setSiteName] = useState('MockTests Pro')
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [allowRegistration, setAllowRegistration] = useState(true)
  const [loading, setLoading] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    // Simulate API call
    setTimeout(() => {
      setLoading(false)
      alert("Settings saved successfully!")
    }, 1000)
  }

  return (
    <DashboardLayout role="ADMIN" userName="System Administrator">
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.02em', background: 'linear-gradient(to right, var(--color-primary), #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Site Settings
        </h1>
        <p style={{ color: 'var(--color-text-muted)' }}>Configure global platform settings, access, and appearance.</p>
      </div>

      <div style={{ maxWidth: '800px' }}>
        <form onSubmit={handleSave}>
          <SpatialCard intensity={3}>
            <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>General Settings</h2>
                <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', marginBottom: '1.5rem' }} />
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label htmlFor="siteName" style={{ fontWeight: 600, fontSize: '0.9rem' }}>Site Name</label>
                  <input 
                    id="siteName"
                    type="text" 
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                    style={{ padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'var(--color-background-alt)', width: '100%', maxWidth: '400px' }}
                  />
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>This name will be displayed in the site headers and emails.</span>
                </div>
              </div>

              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Access & Traffic</h2>
                <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', marginBottom: '1.5rem' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div 
                      onClick={() => setMaintenanceMode(!maintenanceMode)}
                      style={{
                        width: '3rem', height: '1.5rem', borderRadius: '1rem', 
                        background: maintenanceMode ? 'var(--color-danger)' : 'var(--color-border)',
                        position: 'relative', cursor: 'pointer', transition: '0.3s'
                      }}
                    >
                      <div style={{
                        width: '1.1rem', height: '1.1rem', background: '#fff', borderRadius: '50%',
                        position: 'absolute', top: '0.2rem', left: maintenanceMode ? '1.7rem' : '0.2rem', transition: '0.3s'
                      }} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>Maintenance Mode</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Disable access to the frontend. Admins can still login.</div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div 
                      onClick={() => setAllowRegistration(!allowRegistration)}
                      style={{
                        width: '3rem', height: '1.5rem', borderRadius: '1rem', 
                        background: allowRegistration ? 'var(--color-success)' : 'var(--color-border)',
                        position: 'relative', cursor: 'pointer', transition: '0.3s'
                      }}
                    >
                      <div style={{
                        width: '1.1rem', height: '1.1rem', background: '#fff', borderRadius: '50%',
                        position: 'absolute', top: '0.2rem', left: allowRegistration ? '1.7rem' : '0.2rem', transition: '0.3s'
                      }} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>Allow New Registrations</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Enable or disable public signups.</div>
                    </div>
                </div>
              </div>

            </div>
            
            <div style={{ background: 'var(--color-background-alt)', padding: '1.5rem 2rem', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit" disabled={loading} style={{ background: 'var(--color-primary)', color: 'white', padding: '0.75rem 2rem' }}>
                {loading ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </SpatialCard>
        </form>
      </div>

    </DashboardLayout>
  )
}
