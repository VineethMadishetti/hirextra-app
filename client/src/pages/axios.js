import axios from 'axios';

// Create a base instance for general API requests
const api = axios.create({
  baseURL: '/api', // Your API's base URL
  withCredentials: true, // This is crucial for sending cookies (like the refresh token)
});

// Create a separate instance specifically for the token refresh logic
// This prevents an infinite loop if the refresh endpoint itself returns a 401
const axiosRefresh = axios.create({
  baseURL: '/api',
  withCredentials: true,
});


// Use a response interceptor to handle 401 errors globally
api.interceptors.response.use(
  (response) => response, // If the response is successful, just pass it through
  async (error) => {
    const originalRequest = error.config;

    // Check if the error is a 401 Unauthorized and if it's the first time this request has failed
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true; // Mark this request as having been retried

      try {
        // Attempt to get a new access token by calling the refresh endpoint
        await axiosRefresh.post('/auth/refresh');
        
        // If the refresh is successful, the new access token is now in an httpOnly cookie.
        // The browser will automatically use it for the next request.
        // We can now retry the original request that failed.
        return api(originalRequest);
      } catch (refreshError) {
        // If the refresh token is also invalid or the refresh fails, the user must log in again.
        // We can trigger a logout or redirect here. For now, we'll let the request fail.
        console.error('Token refresh failed. User needs to re-authenticate.', refreshError);
        return Promise.reject(refreshError);
      }
    }

    // For any other errors, just reject the promise
    return Promise.reject(error);
  }
);

export default api;