import { BASE, request, getActiveSchemaId } from './_client'

export function fetchSchemas() {
  return request(`${BASE}/schemas/`)
}

export function fetchSchema(id) {
  return request(`${BASE}/schemas/${id}`)
}

export function createSchema(data) {
  return request(`${BASE}/schemas/`, { method: 'POST', body: JSON.stringify(data) })
}

export function updateSchema(id, data) {
  return request(`${BASE}/schemas/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function deleteSchema(id) {
  return request(`${BASE}/schemas/${id}`, { method: 'DELETE' })
}

export function cloneSchema(id, data) {
  return request(`${BASE}/schemas/${id}/clone`, {
    method: 'POST', body: JSON.stringify(data),
  })
}

// Structural linter. Defaults to the active schema but accepts an override
// (rarely needed — kept for future multi-schema validation tabs).
export function validateSchema(schemaId) {
  const id = schemaId || getActiveSchemaId()
  return request(`${BASE}/schemas/${id}/validate`)
}
