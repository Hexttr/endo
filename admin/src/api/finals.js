import { BASE, request } from './_client'

export function fetchFinals() {
  return request(`${BASE}/finals/`)
}

export function fetchFinal(id) {
  return request(`${BASE}/finals/${id}`)
}

export function createFinal(data) {
  return request(`${BASE}/finals/`, { method: 'POST', body: JSON.stringify(data) })
}

export function updateFinal(id, data) {
  return request(`${BASE}/finals/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function deleteFinal(id) {
  return request(`${BASE}/finals/${id}`, { method: 'DELETE' })
}
