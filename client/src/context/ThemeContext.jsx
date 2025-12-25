// client/src/context/ThemeContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState('light');
  const [mounted, setMounted] = useState(false);

  // Set theme on initial load - always start with light theme
  useEffect(() => {
    // Always start with light theme, regardless of localStorage
    setTheme('light');
    document.documentElement.classList.remove('dark'); // Ensure dark class is removed
    setMounted(true);
  }, []);

  // Update document class and localStorage when theme changes
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    localStorage.setItem('theme', newTheme);
  };

  if (!mounted) {
    return null; // Prevent flash of unstyled content
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};