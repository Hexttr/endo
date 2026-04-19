import { BASE, request } from './_client'

// Bot bindings are inherently per-schema — there's at most one Telegram bot
// per diagnostic schema. The URL pattern always embeds the schema id.

export function fetchBot(schemaId) {
  return request(`${BASE}/schemas/${schemaId}/bot/`)
}

export function upsertBot(schemaId, data) {
  return request(`${BASE}/schemas/${schemaId}/bot/`, {
    method: 'PUT', body: JSON.stringify(data),
  })
}

export function toggleBotEnabled(schemaId, enabled) {
  return request(`${BASE}/schemas/${schemaId}/bot/`, {
    method: 'PATCH', body: JSON.stringify({ enabled }),
  })
}

export function deleteBot(schemaId) {
  return request(`${BASE}/schemas/${schemaId}/bot/`, { method: 'DELETE' })
}
