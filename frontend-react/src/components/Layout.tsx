import React from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header'; // Will be created
// import ToastContainerComponent from './ToastContainer'; // Placeholder for Toast notifications
import { Container } from 'react-bootstrap';
import './Layout.css'; // 引入Layout样式

const Layout: React.FC = () => {
  return (
    <div className="d-flex flex-column vh-100 bili-layout">
      {/* Render the Header component at the top */}
      <Header />
      
      {/* Placeholder for a global Toast notification container */}
      {/* <ToastContainerComponent /> */}
      
      {/* The main content area with top padding to avoid navbar overlap */}
      <main className="flex-grow-1 d-flex bili-main-content">
        <Container fluid className="py-3">
          {/* Outlet renders the matched child route component */}
          <Outlet />
        </Container>
      </main>
      
      {/* Optional: Footer could go here */}
      {/* <footer className="mt-auto py-3 bg-light bili-footer">
        <div className="container text-center">
          <span className="text-muted">Bili-EX © 2023</span>
        </div>
      </footer> */}
    </div>
  );
};

export default Layout; 