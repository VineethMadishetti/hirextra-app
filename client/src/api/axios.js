import axios from 'axios';

// This logic ensures the correct API URL is used for development and production.
// 1. In Production: It uses the URL from the VITE_API_URL environment variable.
// 2. In Development: It uses a relative path '/api' which is then handled by the Vite proxy.
// If VITE_API_URL is not set in production, it defaults to a relative '/api' path,
// assuming the frontend and backend are served from the same domain.
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // REQUIRED for cookies
});

// 🔄 Auto-refresh access token on expiry
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      error.response?.data?.code === 'ACCESS_TOKEN_EXPIRED' &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;

      try {
        // Call refresh token endpoint
        await axios.post(
          `${api.defaults.baseURL}/auth/refresh`,
          {},
          { withCredentials: true }
        );

        // Retry original request
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed → force logout
        window.location.href = '/';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
