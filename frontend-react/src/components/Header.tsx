import React, { useEffect, useRef } from 'react';
import { Navbar, Nav, Container, Button } from 'react-bootstrap';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import './Header.css'; // 引入对应的CSS文件

// CSS needs to be imported or defined for .bili-navbar styles
// Assuming you will create a CSS file or use inline styles/CSS-in-JS
// import './Header.css'; // Example CSS import

const Header: React.FC = () => {
  // Get authentication state and functions from AuthContext
  const { isLoggedIn, username, isLoading, checkLogin, logout: authLogout } = useAuth();
  const navigate = useNavigate();
  const checkLoginTimerRef = useRef<number | null>(null);

  // 手动实现防抖逻辑
  const debouncedCheckLogin = () => {
    if (checkLoginTimerRef.current !== null) {
      clearTimeout(checkLoginTimerRef.current);
    }
    
    checkLoginTimerRef.current = window.setTimeout(() => {
      checkLogin();
      checkLoginTimerRef.current = null;
    }, 1000); // 1000ms延迟
  };

  // Check login status when the component mounts
  useEffect(() => {
    if (!isLoading) { // Avoid checking multiple times if already loading
      debouncedCheckLogin(); 
    }
    
    // 组件卸载时清除定时器
    return () => {
      if (checkLoginTimerRef.current !== null) {
        clearTimeout(checkLoginTimerRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在组件挂载时检查一次

  // Handle user logout
  const handleLogout = async () => {
    try {
      await api.logout(); // Call the actual logout API
      authLogout(); // Update the auth state locally via context
      navigate('/login', { replace: true }); // Redirect to login page
    } catch (error) {
      console.error("Logout failed:", error);
      // Optional: Show an error toast notification to the user
      // Consider using a dedicated toast library/context
      alert('退出登录时出错，请稍后重试。'); // Simple alert for now
    }
  };

  // Custom NavLink wrapper to integrate react-router-dom NavLink
  // with Bootstrap styling and active state handling.
  const CustomNavLink = ({ to, children, ...props }: { to: string; children: React.ReactNode; [key: string]: any }) => (
    <NavLink
      to={to}
      // Apply Bootstrap's nav-link class and conditionally 'active' class
      className={({ isActive }: { isActive: boolean }) => 
        `nav-link bili-nav-link ${isActive ? 'active' : ''}`
      }
      {...props}
    >
      {children}
    </NavLink>
  );


  return (
    // 修改导航栏，使其全宽显示并固定在顶部
    <Navbar 
      bg="light" 
      expand="lg" 
      className="bili-navbar shadow-sm" 
      fixed="top" 
      style={{ width: '100%', zIndex: 1030 }}
    >
      <Container fluid>
        {/* Brand link */}
        <Navbar.Brand as={NavLink} to="/" className="bili-brand">
          <i className="bi bi-play-circle-fill me-2"></i>
          BILI-EX
        </Navbar.Brand>
        {/* Responsive toggle button */}
        <Navbar.Toggle aria-controls="basic-navbar-nav" className="bili-navbar-toggler" />
        {/* Navbar content */}
        <Navbar.Collapse id="basic-navbar-nav">
          {/* Main navigation links - Use CustomNavLink directly */}
          <Nav className="me-auto bili-nav">
            <CustomNavLink to="/download">
              <i className="bi bi-download me-1"></i>下载
            </CustomNavLink>
            <CustomNavLink to="/files">
              <i className="bi bi-collection-play me-1"></i>视频列表
            </CustomNavLink>
            <CustomNavLink to="/settings">
              <i className="bi bi-gear me-1"></i>设置
            </CustomNavLink>
          </Nav>
          {/* Right-aligned navigation items */}
          <Nav className="ms-auto align-items-center">
            {/* Display login status */}
            <div className="bili-login-status me-3">
              {isLoading ? (
                <div className="loading-spinner">
                  <span className="spinner-text">检查中</span>
                  <div className="spinner-dots">
                    <span className="dot"></span>
                    <span className="dot"></span>
                    <span className="dot"></span>
                  </div>
                </div>
              ) : isLoggedIn ? (
                <div className="user-info">
                  <i className="bi bi-person-circle me-1"></i>
                  <span className="username">{username || '用户'}</span>
                </div>
              ) : (
                <div className="not-logged-in">
                  <i className="bi bi-person-x me-1"></i>
                  <span>未登录</span>
                </div>
              )}
            </div>
            {/* Show logout button only if logged in */}
            {isLoggedIn && (
              <Button 
                variant="outline-danger" 
                size="sm" 
                onClick={handleLogout}
                className="bili-logout-btn"
              >
                <i className="bi bi-box-arrow-right me-1"></i>
                退出
              </Button>
            )}
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

export default Header; 