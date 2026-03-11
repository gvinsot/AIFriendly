import React from 'react';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';
import UnifiedDashboard from './components/Dashboard/UnifiedDashboard';
import Login from './components/Auth/Login';
import Register from './components/Auth/Register';
import PrivateRoute from './components/PrivateRoute';

function App() {
  return (
    <Router>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <PrivateRoute path="/" component={UnifiedDashboard} />
      </Switch>
    </Router>
  );
}

export default App;