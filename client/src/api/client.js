import axios from 'axios';

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  timeout: 30000,
});

// Any 401 outside the login call means the session is gone - bounce to /login.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const url = err.config?.url || '';
    if (status === 401 && !url.includes('/auth/login')) {
      if (window.location.pathname !== '/login') {
        window.location.replace('/login');
      }
    }
    return Promise.reject(err);
  }
);

export const errMsg = (err, fallback = 'Something went wrong') =>
  err?.response?.data?.error || err?.message || fallback;

/* ------------------------------------------------------------------- auth */
export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }).then((r) => r.data),
  logout: () => api.post('/auth/logout').then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
};

/* ------------------------------------------------------ generic CRUD shape */
const crud = (path) => ({
  list: (params) => api.get(path, { params }).then((r) => r.data.items),
  get: (id) => api.get(`${path}/${id}`).then((r) => r.data),
  create: (body) => api.post(path, body).then((r) => r.data),
  update: (id, body) => api.put(`${path}/${id}`, body).then((r) => r.data),
  patch: (id, body) => api.patch(`${path}/${id}`, body).then((r) => r.data),
  remove: (id) => api.delete(`${path}/${id}`).then((r) => r.data),
});

export const sourcesApi = crud('/sources');
export const networksApi = {
  ...crud('/networks'),
  rotateKey: (id) => api.post(`/networks/${id}/rotate-key`).then((r) => r.data),
};
export const offersApi = crud('/offers');
export const landersApi = crud('/landers');
export const campaignsApi = {
  ...crud('/campaigns'),
  links: (id) => api.get(`/campaigns/${id}/links`).then((r) => r.data),
};

/* -------------------------------------------------------------- dashboard */
export const dashboardApi = {
  get: () => api.get('/dashboard').then((r) => r.data),
};

/* ----------------------------------------------------------------- report */
export const reportApi = {
  report: (params) => api.get('/report', { params }).then((r) => r.data),
  timeseries: (params) => api.get('/report/timeseries', { params }).then((r) => r.data.points),
  summary: (params) => api.get('/report/summary', { params }).then((r) => r.data),
  dimensions: () => api.get('/report/dimensions').then((r) => r.data.dimensions),
};

/* ------------------------------------------------------------------- logs */
export const logsApi = {
  clicks: (params) => api.get('/clicks', { params }).then((r) => r.data.items),
  click: (clickid) => api.get(`/clicks/${clickid}`).then((r) => r.data),
  conversions: (params) => api.get('/conversions', { params }).then((r) => r.data.items),
  updateConversion: (id, body) => api.patch(`/conversions/${id}`, body).then((r) => r.data),
  postbacks: (params) => api.get('/logs/postbacks', { params }).then((r) => r.data.items),
  clickErrors: (params) => api.get('/logs/click-errors', { params }).then((r) => r.data.items),
};

/* --------------------------------------------------------------- settings */
export const settingsApi = {
  get: () => api.get('/settings').then((r) => r.data),
  update: (body) => api.put('/settings', body).then((r) => r.data),
  telegramTest: () => api.post('/settings/telegram-test').then((r) => r.data),
  users: () => api.get('/users').then((r) => r.data.items),
  createUser: (body) => api.post('/users', body).then((r) => r.data),
  updateUser: (id, body) => api.patch(`/users/${id}`, body).then((r) => r.data),
  rotateApiKey: (id) => api.post(`/users/${id}/rotate-api-key`).then((r) => r.data),
  deleteUser: (id) => api.delete(`/users/${id}`).then((r) => r.data),
};

/* ------------------------------------------------------------------- cost */
export const costApi = {
  push: (body) => api.post('/cost', body).then((r) => r.data),
  list: (params) => api.get('/cost', { params }).then((r) => r.data.items),
};

export const healthApi = () => axios.get('/health').then((r) => r.data);
