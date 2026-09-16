import crypto from 'crypto'

export const logger = {
  info: (message: string, data?: any) => {
    console.log(JSON.stringify({ level: 'INFO', message, data, timestamp: new Date().toISOString() }))
  },
  warn: (message: string, data?: any) => {
    console.warn(JSON.stringify({ level: 'WARN', message, data, timestamp: new Date().toISOString() }))
  },
  error: (code: string, message: string, error?: any, correlationId?: string) => {
    const cid = correlationId || crypto.randomUUID()
    console.error(JSON.stringify({ level: 'ERROR', code, message, error, correlationId: cid, timestamp: new Date().toISOString() }))
    return { error: { code, message, correlationId: cid } }
  }
}
