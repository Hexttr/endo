const BASE = '/api';

function getHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function login(username, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error('Invalid credentials');
  const data = await res.json();
  localStorage.setItem('token', data.access_token);
  return data;
}

export async function fetchNodes(section) {
  const url = section ? `${BASE}/nodes/?section=${section}` : `${BASE}/nodes/`;
  const res = await fetch(url, { headers: getHeaders() });
  return res.json();
}

export async function fetchNode(id) {
  const res = await fetch(`${BASE}/nodes/${id}`, { headers: getHeaders() });
  return res.json();
}

export async function updateNode(id, data) {
  const res = await fetch(`${BASE}/nodes/${id}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function fetchFinals() {
  const res = await fetch(`${BASE}/finals/`, { headers: getHeaders() });
  return res.json();
}

export async function fetchFinal(id) {
  const res = await fetch(`${BASE}/finals/${id}`, { headers: getHeaders() });
  return res.json();
}

export async function updateFinal(id, data) {
  const res = await fetch(`${BASE}/finals/${id}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function fetchEdges() {
  const res = await fetch(`${BASE}/edges/graph`, { headers: getHeaders() });
  return res.json();
}

export async function fetchSections() {
  const res = await fetch(`${BASE}/nodes/sections/list`, { headers: getHeaders() });
  return res.json();
}

export async function fetchSessions(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/sessions/?${qs}`, { headers: getHeaders() });
  return res.json();
}

export function isLoggedIn() {
  return !!localStorage.getItem('token');
}

export function logout() {
  localStorage.removeItem('token');
}
