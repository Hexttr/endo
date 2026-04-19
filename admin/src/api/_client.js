// Low-level fetch wrapper shared by every per-entity API module.
//
// Responsibilities:
//   * Inject JSON + auth + X-Schema-Id headers on every request.
//   * Normalise response handling — 204 ⇒ null, 401 ⇒ clear token + redirect,
//     non-2xx ⇒ throw Error(detail|status).
//   * Keep the active schema id in-memory + in localStorage so callers don't
//     have to thread it through every function signature. SchemaContext
//     drives this via setActiveSchemaId.

export const BASE = '/api'

let currentSchemaId = null
try { currentSchemaId = localStorage.getItem('schemaId') || 'endo-bot' }
catch { currentSchemaId = 'endo-bot' }

export function setActiveSchemaId(sid) {
  currentSchemaId = sid || 'endo-bot'
  try { localStorage.setItem('schemaId', currentSchemaId) } catch {}
}

export function getActiveSchemaId() {
  return currentSchemaId || 'endo-bot'
}

function getHeaders() {
  const token = localStorage.getItem('token')
  return {
    'Content-Type': 'application/json',
    'X-Schema-Id': getActiveSchemaId(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export async function request(url, options = {}) {
  const res = await fetch(url, { headers: getHeaders(), ...options })
  if (res.status === 204) return null
  if (res.status === 401) {
    // Token is missing / expired / signing key rotated. Drop it and bounce
    // back to login so the user doesn't stare at a cryptic 401 toast. The
    // login form itself handles its own error — bypass the redirect for it.
    try { localStorage.removeItem('token') } catch {}
    if (!/\/auth\/login$/.test(url)) {
      window.location.assign('/')
    }
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || 'Требуется повторный вход')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `HTTP ${res.status}`)
  }
  return res.json()
}
