import axios from 'axios';

// Configure axios defaults
axios.defaults.baseURL = import.meta.env.VITE_API_URL || 'https://api.stucrow.com:8444/api' || 'http://localhost:5002/api';
axios.defaults.withCredentials = true;
axios.defaults.timeout = 30000; // 30 seconds

// Request interceptor
axios.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Unauthorized - redirect to login
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

export default axios;