import React, { useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import Modal from '../Modal/Modal';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const UnifiedDashboard = () => {
  const [stats, setStats] = useState({ availability: 0, access: 0, security: 0 });
  const [history, setHistory] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);

  useEffect(() => {
    // Fetch stats and history data
    const fetchData = async () => {
      // Replace with actual API calls
      const statsResponse = await fetch('/api/stats');
      const statsData = await statsResponse.json();
      setStats(statsData);

      const historyResponse = await fetch('/api/history');
      const historyData = await historyResponse.json();
      setHistory(historyData);
    };

    fetchData();
  }, []);

  const chartData = {
    labels: history.map(item => item.date),
    datasets: [
      {
        label: 'Availability',
        data: history.map(item => item.availability),
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1
      },
      {
        label: 'Access',
        data: history.map(item => item.access),
        borderColor: 'rgb(153, 102, 255)',
        tension: 0.1
      },
      {
        label: 'Security',
        data: history.map(item => item.security),
        borderColor: 'rgb(255, 159, 64)',
        tension: 0.1
      }
    ]
  };

  const handleEventClick = (event) => {
    setSelectedEvent(event);
  };

  const closeModal = () => {
    setSelectedEvent(null);
  };

  return (
    <div className="unified-dashboard">
      <h1>Unified Dashboard</h1>

      <div className="stats-section">
        <div className="stat-card">
          <h3>Availability</h3>
          <p>{stats.availability}%</p>
        </div>
        <div className="stat-card">
          <h3>Access</h3>
          <p>{stats.access}%</p>
        </div>
        <div className="stat-card">
          <h3>Security</h3>
          <p>{stats.security}%</p>
        </div>
      </div>

      <div className="chart-container">
        <Line data={chartData} />
      </div>

      <div className="history-section">
        <h2>Scan History</h2>
        <ul className="event-list">
          {history.map((event, index) => (
            <li key={index} onClick={() => handleEventClick(event)}>
              <div className="event-date">{event.date}</div>
              <div className="event-type">{event.type}</div>
              <div className="event-status">{event.status}</div>
            </li>
          ))}
        </ul>
      </div>

      {selectedEvent && (
        <Modal onClose={closeModal}>
          <h2>Event Details</h2>
          <p><strong>Date:</strong> {selectedEvent.date}</p>
          <p><strong>Type:</strong> {selectedEvent.type}</p>
          <p><strong>Status:</strong> {selectedEvent.status}</p>
          <p><strong>Details:</strong> {selectedEvent.details}</p>
        </Modal>
      )}
    </div>
  );
};

export default UnifiedDashboard;