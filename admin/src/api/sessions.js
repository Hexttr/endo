import { BASE, request } from './_client'

export function fetchSessions(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return request(`${BASE}/sessions/?${qs}`)
}

export function startPlaygroundSession(userId) {
  return request(`${BASE}/sessions/start`, {
    method: 'POST', body: JSON.stringify({ user_id: userId }),
  })
}

export function submitPlaygroundAnswer(sessionId, nodeId, answer) {
  return request(`${BASE}/sessions/answer`, {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, node_id: nodeId, answer }),
  })
}
