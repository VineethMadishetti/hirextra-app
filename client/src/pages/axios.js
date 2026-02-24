import axios from 'axios';
import toast from 'react-hot-toast';

// Use environment variable, or fallback to '/api' in dev (for proxy), or absolute URL in prod
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Create a base instance for general API requests
const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // This is crucial for sending cookies (like the refresh token)
  timeout: 60000, // Increased to 60s for slow search queries
});

// Create a separate instance specifically for the token refresh logic
// This prevents an infinite loop if the refresh endpoint itself returns a 401
const axiosRefresh = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
});

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Use a response interceptor to handle 401 errors globally
api.interceptors.response.use(
  (response) => response, // If the response is successful, just pass it through
  async (error) => {
    const originalRequest = error.config;

    // Check if the error is a 401 Unauthorized and if it's the first time this request has failed
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise(function (resolve, reject) {
          failedQueue.push({ resolve, reject });
        })
          .then(function () {
            return api(originalRequest);
          })
          .catch(function (err) {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true; // Mark this request as having been retried
      isRefreshing = true;

      try {
        // Attempt to get a new access token by calling the refresh endpoint
        await axiosRefresh.post('/auth/refresh');
        
        // If the refresh is successful, the new access token is now in an httpOnly cookie.
        // The browser will automatically use it for the next request.
        // We can now retry the original request that failed.
        processQueue(null);
        return api(originalRequest);
      } catch (refreshError) {
        // If the refresh token is also invalid or the refresh fails, the user must log in again.
        // We can trigger a logout or redirect here. For now, we'll let the request fail.
        processQueue(refreshError, null);
        console.error('Token refresh failed. User needs to re-authenticate.', refreshError);
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Handle Server Errors (500-599)
    if (error.response && error.response.status >= 500) {
      console.error('Server Error:', error.response.data);
      toast.error('Server error. Please try a more specific search.');
    }

    // For any other errors, just reject the promise
    return Promise.reject(error);
  }
);

export default api;