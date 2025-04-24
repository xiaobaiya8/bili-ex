/// <reference types="react" />
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage'; // Placeholder
import DownloadPage from './pages/DownloadPage'; // Placeholder
import FilesPage from './pages/FilesPage'; // Placeholder
import SettingsPage from './pages/SettingsPage'; // Placeholder
import { AuthProvider, useAuth } from './contexts/AuthContext'; // Will be created
import 'bootstrap/dist/css/bootstrap.min.css'; // Import Bootstrap CSS globally
import 'bootstrap-icons/font/bootstrap-icons.css'; // Import Bootstrap Icons globally
import { ToastContainer } from 'react-toastify'; // Import ToastContainer
import 'react-toastify/dist/ReactToastify.css'; // Import react-toastify CSS
import './App.css'; // Your custom global styles if any

// Component to protect routes that require authentication
function PrivateRoute({ children }: { children: React.ReactElement }) {
  const { isLoggedIn, isLoading } = useAuth(); // Get auth state

  if (isLoading) {
    // Optional: Show a loading spinner while checking auth status
    // You might want a more sophisticated loading indicator
    return <div className="d-flex justify-content-center align-items-center vh-100"><div className="spinner-border text-primary" role="status"><span className="visually-hidden">Loading...</span></div></div>;
  }

  // If logged in, render the children components (the protected page)
  // Otherwise, redirect to the login page
  return isLoggedIn ? children : <Navigate to="/login" replace />;
}

function App() {
  return (
    // Wrap the entire app with the AuthProvider to manage login state
    <AuthProvider>
      <BrowserRouter>
        {/* ToastContainer for displaying notifications */}
        <ToastContainer 
          position="top-center" // Position toasts at the top-center
          autoClose={3000} // Auto close after 3 seconds
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="colored" // Use colored themes based on toast type
        />
        <Routes>
          {/* Public route for login */}
          <Route path="/login" element={<LoginPage />} />

          {/* Private routes wrapped in Layout */}
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Layout />
              </PrivateRoute>
            }
          >
            {/* Default route redirects to /download */}
            <Route index element={<Navigate to="/download" replace />} />
            <Route path="download" element={<DownloadPage />} />
            <Route path="files" element={<FilesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            {/* Add other private routes here if needed */}
          </Route>

          {/* Optional: Catch-all route for 404 Not Found */}
          <Route path="*" element={<div className='container mt-5'><h2>404 Not Found</h2><p>The page you requested does not exist.</p></div>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
