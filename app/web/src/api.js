/**
 * Fetch-based API client for ig-autoposter backend.
 */

const API_BASE = '';

async function api(method, path, body = null) {
  const opts = { method, headers: {} };
  if (body != null && typeof body === 'object' && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    opts.body = body;
  }
  const res = await fetch(`${API_BASE}${path}`, opts);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || res.statusText || `HTTP ${res.status}`);
  return data;
}

export const apiClient = {
  get: (path) => api('GET', path),
  post: (path, body) => api('POST', path, body),
  put: (path, body) => api('PUT', path, body),
  delete: (path) => api('DELETE', path),
};

export const status = () => apiClient.get('/api/status');
export const getQueue = () => apiClient.get('/api/queue');
export const getUnifiedQueue = (status) =>
  apiClient.get(status ? `/api/unified-queue?status=${status}` : '/api/unified-queue');
export const getHistory = () => apiClient.get('/api/history');
export const getConfig = () => apiClient.get('/api/config');
export const updateConfig = (body) => apiClient.put('/api/config', body);
export const postNow = () => apiClient.post('/api/post-now');
export const postQueueItemNow = (id) => apiClient.post(`/api/unified-queue/${id}/post-now`);
export const schedulePost = (id, scheduledAt) =>
  apiClient.put(`/api/unified-queue/${id}/schedule`, { scheduled_at: scheduledAt });
export const deleteQueueItem = (id) => apiClient.delete(`/api/unified-queue/${id}`);
