/**
 * Safe logging helpers — never log tokens, UIDs, phones, names, or coordinates.
 */

export function safeInfo(message: string, meta?: Record<string, string | number | boolean>): void {
  // Structured aggregate-only logs. Avoid console.log to satisfy lint (warn/error only),
  // so use warn for operational info in Functions.
  if (meta) {
    console.warn(`[TRN Notif] ${message}`, meta)
  } else {
    console.warn(`[TRN Notif] ${message}`)
  }
}

export function safeError(message: string, code?: string): void {
  console.error(`[TRN Notif] ${message}`, code ? { code } : undefined)
}
