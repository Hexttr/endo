const BASE = '/api';

function getHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(url, options = {}) {
  const res = await fetch(url, { headers: getHeaders(), ...options });
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────

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

export function isLoggedIn() {
  return !!localStorage.getItem('token');
}

export function logout() {
  localStorage.removeItem('token');
}

// ── Nodes ─────────────────────────────────────────────────────────

export function fetchNodes(section) {
  const url = section ? `${BASE}/nodes/?section=${section}` : `${BASE}/nodes/`;
  return request(url);
}

export function fetchNode(id) {
  return request(`${BASE}/nodes/${id}`);
}

export function createNode(data) {
  return request(`${BASE}/nodes/`, { method: 'POST', body: JSON.stringify(data) });
}

export function updateNode(id, data) {
  return request(`${BASE}/nodes/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteNode(id) {
  return request(`${BASE}/nodes/${id}`, { method: 'DELETE' });
}

// ── Options (sub-resource of nodes) ───────────────────────────────

export function createOption(nodeId, data) {
  return request(`${BASE}/nodes/${nodeId}/options`, { method: 'POST', body: JSON.stringify(data) });
}

export function updateOption(nodeId, optionDbId, data) {
  return request(`${BASE}/nodes/${nodeId}/options/${optionDbId}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteOption(nodeId, optionDbId) {
  return request(`${BASE}/nodes/${nodeId}/options/${optionDbId}`, { method: 'DELETE' });
}

// ── Edges ─────────────────────────────────────────────────────────

export function fetchEdges(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(`${BASE}/edges/?${qs}`);
}

export function fetchEdgesGraph() {
  return request(`${BASE}/edges/graph`);
}

export function createEdge(data) {
  return request(`${BASE}/edges/`, { method: 'POST', body: JSON.stringify(data) });
}

export function updateEdge(edgeId, data) {
  return request(`${BASE}/edges/${edgeId}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteEdge(edgeId) {
  return request(`${BASE}/edges/${edgeId}`, { method: 'DELETE' });
}

// ── Finals ────────────────────────────────────────────────────────

export function fetchFinals() {
  return request(`${BASE}/finals/`);
}

export function fetchFinal(id) {
  return request(`${BASE}/finals/${id}`);
}

export function createFinal(data) {
  return request(`${BASE}/finals/`, { method: 'POST', body: JSON.stringify(data) });
}

export function updateFinal(id, data) {
  return request(`${BASE}/finals/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteFinal(id) {
  return request(`${BASE}/finals/${id}`, { method: 'DELETE' });
}

// ── Sections ──────────────────────────────────────────────────────

export function fetchSections() {
  return request(`${BASE}/nodes/sections/list`);
}

// ── Sessions ──────────────────────────────────────────────────────

export function fetchSessions(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(`${BASE}/sessions/?${qs}`);
}
