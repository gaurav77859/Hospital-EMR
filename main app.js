const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
require('./db/db');

const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/user', userRoutes);
app.use('/admin', adminRoutes);

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ message: 'Server is running!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;