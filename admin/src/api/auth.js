import { BASE } from './_client'

export async function login(username, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) throw new Error('Invalid credentials')
  const data = await res.json()
  localStorage.setItem('token', data.access_token)
  return data
}

export function isLoggedIn() {
  return !!localStorage.getItem('token')
}

export function logout() {
  localStorage.removeItem('token')
}
