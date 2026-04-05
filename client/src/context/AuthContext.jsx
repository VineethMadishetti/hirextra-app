import { createContext, useState, useEffect } from 'react';
import api from '../api/axios';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Single response interceptor — handles token expiry and auto-refresh
  useEffect(() => {
    const interceptor = api.interceptors.response.use(
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
            await api.post('/auth/refresh', {}, { withCredentials: true });
            return api(originalRequest);
          } catch {
            setUser(null);
            window.location.href = '/';
            return Promise.reject(error);
          }
        }

        if (error.response?.status === 401 && error.response?.data?.code === 'NO_ACCESS_TOKEN') {
          setUser(null);
        }

        return Promise.reject(error);
      }
    );

    return () => api.interceptors.response.eject(interceptor);
  }, []);

  // Verify auth on mount — source of truth is the httpOnly cookie + /auth/me
  useEffect(() => {
    const verifyAuth = async () => {
      try {
        const { data } = await api.get('/auth/me');
        setUser(data);
      } catch (error) {
        if (error.response?.status === 401) {
          try {
            await api.post('/auth/refresh', {}, { withCredentials: true });
            const { data } = await api.get('/auth/me');
            setUser(data);
          } catch {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      } finally {
        setLoading(false);
      }
    };

    verifyAuth();
  }, []);

  const login = async (email, password) => {
    try {
      const { data } = await api.post('/auth/login', { email, password });
      setUser(data);
      return { success: true };
    } catch (error) {
      const msg  = error.response?.data?.message || error.message || 'Login failed';
      const code = error.response?.data?.code;
      return { success: false, message: msg, code };
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore — always clear local state
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
