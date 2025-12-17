import { createContext, useState, useEffect } from 'react';
import axios from 'axios';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Configure Axios globally
  const baseURL = import.meta.env.VITE_API_URL || 'https://hirextra-app.onrender.com/api';
  axios.defaults.baseURL = baseURL;
  axios.defaults.withCredentials = true;

  // Add response interceptor for token refresh
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        // If token expired, try to refresh
        if (
          error.response?.status === 401 &&
          error.response?.data?.code === 'ACCESS_TOKEN_EXPIRED' &&
          !originalRequest._retry
        ) {
          originalRequest._retry = true;

          try {
            // Try to refresh the token
            await axios.post(`${baseURL}/auth/refresh`, {}, { withCredentials: true });
            // Retry the original request
            return axios(originalRequest);
          } catch (refreshError) {
            // Refresh failed - clear user and redirect to login
            setUser(null);
            localStorage.removeItem('userInfo');
            window.location.href = '/';
            return Promise.reject(refreshError);
          }
        }

        // If no access token, clear user
        if (error.response?.status === 401 && error.response?.data?.code === 'NO_ACCESS_TOKEN') {
          setUser(null);
          localStorage.removeItem('userInfo');
        }

        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.response.eject(interceptor);
    };
  }, [baseURL]);

  // Verify token on mount
  useEffect(() => {
    const verifyAuth = async () => {
      const savedUser = localStorage.getItem('userInfo');
      
      if (savedUser) {
        try {
          // Verify token by calling /auth/me endpoint
          const { data } = await axios.get('/auth/me');
          setUser(data);
          localStorage.setItem('userInfo', JSON.stringify(data));
        } catch (error) {
          // Token invalid or expired - try refresh first
          if (error.response?.status === 401) {
            try {
              await axios.post('/auth/refresh', {}, { withCredentials: true });
              // Retry /auth/me after refresh
              const { data } = await axios.get('/auth/me');
              setUser(data);
              localStorage.setItem('userInfo', JSON.stringify(data));
            } catch (refreshError) {
              // Refresh failed - clear user
              setUser(null);
              localStorage.removeItem('userInfo');
            }
          } else {
            // Other error - clear user
            setUser(null);
            localStorage.removeItem('userInfo');
          }
        }
      }
      
      setLoading(false);
    };

    verifyAuth();
  }, []);

  const login = async (email, password) => {
    try {
      const { data } = await axios.post('/auth/login', { email, password });
      setUser(data);
      localStorage.setItem('userInfo', JSON.stringify(data));
      return { success: true };
    } catch (error) {
      console.error("Login Error:", error.response?.data?.message);
      return { success: false, message: error.response?.data?.message || 'Login failed' };
    }
  };

  const logout = async () => {
    try {
      await axios.post('/auth/logout');
    } catch (err) {
      console.error(err);
    }
    setUser(null);
    localStorage.removeItem('userInfo');
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};