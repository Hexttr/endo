import { BASE, request } from './_client'

export function fetchEdges(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return request(`${BASE}/edges/?${qs}`)
}

export function fetchEdgesGraph() {
  return request(`${BASE}/edges/graph`)
}

export function createEdge(data) {
  return request(`${BASE}/edges/`, { method: 'POST', body: JSON.stringify(data) })
}

export function updateEdge(edgeId, data) {
  return request(`${BASE}/edges/${edgeId}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function deleteEdge(edgeId) {
  return request(`${BASE}/edges/${edgeId}`, { method: 'DELETE' })
}
