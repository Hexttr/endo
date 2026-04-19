import { BASE, request } from './_client'

// Admin-only audit log of mutations across all entity types.
export function fetchAuditLog(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString()
  return request(`${BASE}/audit/${qs ? `?${qs}` : ''}`)
}
