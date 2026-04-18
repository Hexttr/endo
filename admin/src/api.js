const BASE = '/api';

// In-memory cache of the current schema id. Updated by SchemaContext (which
// persists to localStorage) so every API call is automatically scoped to the
// active schema without threading the id through every function signature.
let currentSchemaId = null;
try { currentSchemaId = localStorage.getItem('schemaId') || 'endo-bot'; }
catch { currentSchemaId = 'endo-bot'; }

export function setActiveSchemaId(sid) {
  currentSchemaId = sid || 'endo-bot';
  try { localStorage.setItem('schemaId', currentSchemaId); } catch {}
}

export function getActiveSchemaId() {
  return currentSchemaId || 'endo-bot';
}

function getHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    'X-Schema-Id': getActiveSchemaId(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(url, options = {}) {
  const res = await fetch(url, { headers: getHeaders(), ...options });
  if (res.status === 204) return null;
  if (res.status === 401) {
    // Token missing / expired / key rotated. Drop the stale token and bounce
    // back to login so the user can re-auth without a cryptic 401 toast.
    // Ignored for the /auth/login request itself (it has its own handler).
    try { localStorage.removeItem('token'); } catch {}
    if (!/\/auth\/login$/.test(url)) {
      window.location.assign('/');
    }
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || 'Требуется повторный вход');
  }
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

export function batchUpdatePositions(positions) {
  return request(`${BASE}/nodes/layout/positions`, {
    method: 'PATCH',
    body: JSON.stringify(positions),
  });
}

export function resetLayout() {
  return request(`${BASE}/nodes/layout/reset`, { method: 'POST' });
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

export function startPlaygroundSession(userId) {
  return request(`${BASE}/sessions/start`, {
    method: 'POST', body: JSON.stringify({ user_id: userId }),
  });
}

export function submitPlaygroundAnswer(sessionId, nodeId, answer) {
  return request(`${BASE}/sessions/answer`, {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, node_id: nodeId, answer }),
  });
}

// ── Schemas (multi-schema registry) ───────────────────────────────

export function fetchSchemas() {
  return request(`${BASE}/schemas/`);
}

export function fetchSchema(id) {
  return request(`${BASE}/schemas/${id}`);
}

export function createSchema(data) {
  return request(`${BASE}/schemas/`, { method: 'POST', body: JSON.stringify(data) });
}

export function updateSchema(id, data) {
  return request(`${BASE}/schemas/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteSchema(id) {
  return request(`${BASE}/schemas/${id}`, { method: 'DELETE' });
}

export function cloneSchema(id, data) {
  return request(`${BASE}/schemas/${id}/clone`, {
    method: 'POST', body: JSON.stringify(data),
  });
}

// ── Bot bindings (one bot per schema) ─────────────────────────────

export function fetchBot(schemaId) {
  return request(`${BASE}/schemas/${schemaId}/bot/`);
}

export function upsertBot(schemaId, data) {
  return request(`${BASE}/schemas/${schemaId}/bot/`, {
    method: 'PUT', body: JSON.stringify(data),
  });
}

export function toggleBotEnabled(schemaId, enabled) {
  return request(`${BASE}/schemas/${schemaId}/bot/`, {
    method: 'PATCH', body: JSON.stringify({ enabled }),
  });
}

export function deleteBot(schemaId) {
  return request(`${BASE}/schemas/${schemaId}/bot/`, { method: 'DELETE' });
}
