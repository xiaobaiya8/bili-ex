import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Form, Button, Alert, Container } from 'react-bootstrap';
// import '../styles/login.css'; // Assuming you'll create this for styling

const LoginPage: React.FC = () => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Get the path the user was trying to access before being redirected to login
  const from = location.state?.from?.pathname || "/";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await login(password);
      // Redirect to the originally requested page or default to '/' after successful login
      navigate(from, { replace: true }); 
    } catch (err: any) { // Catch the error re-thrown by AuthContext
      setError(err.message || '登录时发生错误');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    // Basic structure, resembling original login.html
    <Container className="d-flex justify-content-center align-items-center vh-100">
      <div className="login-container p-4 border rounded shadow-sm bg-light" style={{ maxWidth: '400px', width: '100%' }}>
        <h1 className="text-center mb-4">BILI-EX</h1>
        <Form onSubmit={handleSubmit} className="login-form">
          <Form.Group className="mb-3" controlId="password">
            <Form.Label>密码</Form.Label>
            <Form.Control 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              required 
              disabled={isLoading}
            />
          </Form.Group>
          
          {error && <Alert variant="danger" className="error-message">{error}</Alert>}
          
          <Button variant="primary" type="submit" className="w-100" disabled={isLoading}>
            {isLoading ? '登录中...' : '登录'}
          </Button>
        </Form>
      </div>
    </Container>
  );
};

export default LoginPage; 