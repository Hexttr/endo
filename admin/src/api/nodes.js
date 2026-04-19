import { BASE, request } from './_client'

// Nodes are scoped to the active schema via the X-Schema-Id header.
export function fetchNodes(section) {
  const url = section ? `${BASE}/nodes/?section=${section}` : `${BASE}/nodes/`
  return request(url)
}

// Load nodes for an arbitrary schema (not necessarily the active one). Used
// by the Schemas page to pick a starting node for any schema without having
// to flip the global X-Schema-Id first.
export function fetchNodesFor(schemaId) {
  return request(`${BASE}/schemas/${schemaId}/nodes/`)
}

export function fetchNode(id) {
  return request(`${BASE}/nodes/${id}`)
}

export function createNode(data) {
  return request(`${BASE}/nodes/`, { method: 'POST', body: JSON.stringify(data) })
}

export function updateNode(id, data) {
  return request(`${BASE}/nodes/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function deleteNode(id) {
  return request(`${BASE}/nodes/${id}`, { method: 'DELETE' })
}

export function batchUpdatePositions(positions) {
  return request(`${BASE}/nodes/layout/positions`, {
    method: 'PATCH',
    body: JSON.stringify(positions),
  })
}

export function resetLayout() {
  return request(`${BASE}/nodes/layout/reset`, { method: 'POST' })
}

// ── Options (sub-resource of nodes) ───────────────────────────────

export function createOption(nodeId, data) {
  return request(`${BASE}/nodes/${nodeId}/options`, { method: 'POST', body: JSON.stringify(data) })
}

export function updateOption(nodeId, optionDbId, data) {
  return request(`${BASE}/nodes/${nodeId}/options/${optionDbId}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function deleteOption(nodeId, optionDbId) {
  return request(`${BASE}/nodes/${nodeId}/options/${optionDbId}`, { method: 'DELETE' })
}
