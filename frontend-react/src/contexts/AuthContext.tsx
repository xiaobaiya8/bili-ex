import React, { createContext, useState, useContext, useCallback, ReactNode, useEffect } from 'react';
import api from '../services/api'; // Import the actual API service

interface AuthState {
  isLoggedIn: boolean;
  username: string | null;
  isLoading: boolean; // To indicate if auth status is being checked
}

interface AuthContextType extends AuthState {
  login: (password: string) => Promise<void>;
  logout: () => void;
  checkLogin: () => Promise<void>;
}

// Create the context with a default undefined value to ensure consumers are within the Provider
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Define the props for the AuthProvider component
interface AuthProviderProps {
  children: ReactNode; // Allows the provider to wrap other components
}

// AuthProvider component manages the authentication state
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>({
    isLoggedIn: false,
    username: null,
    isLoading: true, // Start in loading state until first check is done
  });

  // Function to handle user login
  const login = useCallback(async (password: string) => {
    setAuthState(prev => ({ ...prev, isLoading: true }));
    try {
      const response = await api.login(password); // Use actual API call
      // No need to simulate delay here

      if (response.success) {
        setAuthState({
          isLoggedIn: true,
          username: response.username || '用户',
          isLoading: false,
        });
      } else {
        // If API call succeeded but login failed (e.g., wrong password)
        setAuthState(prev => ({ ...prev, isLoggedIn: false, isLoading: false }));
        throw new Error(response.message || '登录失败');
      }
    } catch (error) {
      console.error("Login error:", error);
      setAuthState(prev => ({ ...prev, isLoggedIn: false, isLoading: false }));
      throw error; // Re-throw to be caught by the calling component
    }
  }, []);

  // Function to handle user logout
  const logout = useCallback(() => {
    setAuthState({
      isLoggedIn: false,
      username: null,
      isLoading: false,
    });
    // Note: The actual API call to /logout should be triggered 
    // by the UI element (e.g., Logout button in Header) calling api.logout()
  }, []);

  // Function to check the current login status with the backend
  const checkLogin = useCallback(async () => {
    // Only set loading true if not already logged in, to avoid flicker on refresh
    if (!authState.isLoggedIn) {
      setAuthState(prev => ({ ...prev, isLoading: true }));
    }
    
    try {
      const response = await api.checkLogin(); // Use actual API call
      // No need to simulate delay or random success

      if (response.success && response.isLogin) {
        setAuthState({
          isLoggedIn: true,
          username: response.username || '用户',
          isLoading: false,
        });
      } else {
        setAuthState({
          isLoggedIn: false,
          username: null,
          isLoading: false,
        });
      }
    } catch (error) {
      console.error("Check login error:", error);
      // Even if check fails, update state to reflect not logged in
      setAuthState({
        isLoggedIn: false,
        username: null,
        isLoading: false,
      });
    }
  }, [authState.isLoggedIn]); // 只依赖isLoggedIn状态

  // Perform an initial login check when the provider mounts
  useEffect(() => {
    checkLogin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once on mount

  // Provide the state and functions to consuming components
  const value = { ...authState, login, logout, checkLogin };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Custom hook to use the AuthContext easily in components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 