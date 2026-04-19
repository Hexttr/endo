import { BASE, request } from './_client'

// Two endpoints live here:
//   * /nodes/sections/list — legacy, returns a flat list of slugs that the
//     bot + older admin code still use. Kept for backward-compat.
//   * /sections/          — the first-class CRUD introduced with the editable
//     Dashboard. Prefer this one everywhere new.

export function fetchSections() {
  return request(`${BASE}/sections/`)
}

export function fetchSectionSlugs() {
  // Used only by the legacy NodeEditor section dropdown fallback.
  return request(`${BASE}/nodes/sections/list`)
}

export function createSection(data) {
  return request(`${BASE}/sections/`, { method: 'POST', body: JSON.stringify(data) })
}

export function updateSection(slug, data) {
  return request(`${BASE}/sections/${slug}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function deleteSection(slug, reassignTo) {
  const qs = reassignTo ? `?reassign_to=${encodeURIComponent(reassignTo)}` : ''
  return request(`${BASE}/sections/${slug}${qs}`, { method: 'DELETE' })
}
