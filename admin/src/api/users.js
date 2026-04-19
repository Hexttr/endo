import { BASE, request } from './_client'

// Admin-only CRUD. The server restricts mutations to role='admin'; non-admins
// still get 'me' + a self-only listing for UI identity displays.

export function fetchUsers() {
  return request(`${BASE}/users/`)
}

export function fetchMe() {
  return request(`${BASE}/users/me`)
}

export function createUser(data) {
  return request(`${BASE}/users/`, { method: 'POST', body: JSON.stringify(data) })
}

export function updateUser(id, data) {
  return request(`${BASE}/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function deleteUser(id) {
  return request(`${BASE}/users/${id}`, { method: 'DELETE' })
}
