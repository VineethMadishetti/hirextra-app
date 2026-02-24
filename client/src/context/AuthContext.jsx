import { createContext, useState, useEffect } from 'react';
import api from '../api/axios';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Add response interceptor for token refresh
  useEffect(() => {
    const interceptor = api.interceptors.response.use(
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
            await api.post('/auth/refresh', {}, { withCredentials: true });
            // Retry the original request
            return api(originalRequest);
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
      api.interceptors.response.eject(interceptor);
    };
  }, []);

  // Verify token on mount
  useEffect(() => {
    const verifyAuth = async () => {
      const savedUser = localStorage.getItem('userInfo');
      
      if (savedUser) {
        try {
          // Verify token by calling /auth/me endpoint
          const { data } = await api.get('/auth/me');
          setUser(data);
          localStorage.setItem('userInfo', JSON.stringify(data));
        } catch (error) {
          // Token invalid or expired - try refresh first
          if (error.response?.status === 401) {
            try {
              await api.post('auth/refresh', {}, { withCredentials: true });
              // Retry /auth/me after refresh
              const { data } = await api.get('/auth/me');
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
      const { data } = await api.post('auth/login', { email, password });
      setUser(data);
      localStorage.setItem('userInfo', JSON.stringify(data));
      return { success: true };
    } catch (error) {
      const msg = error.response?.data?.message || error.message || 'Login failed';
      console.error("Login Error:", msg);
      return { success: false, message: msg };
    }
  };

  const logout = async () => {
    try {
      await api.post('auth/logout');
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