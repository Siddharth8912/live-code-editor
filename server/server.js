// server.js

// This MUST be the very first line of your file
require('dotenv').config(); 

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- Database Connection ---
// Now, this line will run AFTER the .env file has been loaded.
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('SUCCESS: MongoDB connected successfully.'))
    .catch(err => console.error('ERROR: MongoDB connection failed:', err));

// --- User Schema and Model ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

// --- Socket.IO and Express Server Setup ---
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] }});
const PORT = process.env.PORT || 3001;
app.use(express.static(path.join(__dirname, '../client')));

// --- AUTHENTICATION API ROUTES ---

// 1. User Registration
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required.' });
        }
        let user = await User.findOne({ username });
        if (user) {
            return res.status(400).json({ message: 'User already exists.' });
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        user = new User({ username, password: hashedPassword });
        await user.save();
        res.status(201).json({ message: 'User registered successfully!' });
    } catch (err) {
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

// 2. User Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials.' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials.' });
        }
        const payload = { user: { id: user.id } };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (err) {
        res.status(500).json({ message: 'Server error during login.' });
    }
});


// --- Existing Code Execution Route ---
app.post('/execute', async (req, res) => {
    const { code, languageId } = req.body;
    if (!code || !languageId) {
        return res.status(400).json({ error: 'Code and Language ID are required.' });
    }
    const options = {
        method: 'POST',
        url: 'https://judge0-ce.p.rapidapi.com/submissions',
        params: { base64_encoded: 'false', fields: '*' },
        headers: {
            'content-type': 'application/json',
            'X-RapidAPI-Key': process.env.RAPIDAPI_KEY, // Switched to use .env
            'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com'
        },
        data: { language_id: languageId, source_code: code }
    };
    try {
        const response = await axios.request(options);
        const token = response.data.token;
        setTimeout(async () => {
            try {
                const resultResponse = await axios.get(`https://judge0-ce.p.rapidapi.com/submissions/${token}?fields=*`, {
                    headers: {
                        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY, // Switched to use .env
                        'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com'
                    }
                });
                res.json(resultResponse.data);
            } catch (getResultError) {
                res.status(500).json({ error: 'Failed to retrieve execution result.' });
            }
        }, 3000);
    } catch (error) {
        res.status(500).json({ error: 'Failed to submit code for execution.' });
    }
});

// --- Existing Socket.IO Logic ---
io.on('connection', (socket) => {
    socket.on('joinRoom', (roomId) => {
        socket.join(roomId);
        socket.on('codeChange', (code) => {
            socket.to(roomId).emit('codeUpdate', code);
        });
        socket.on('sendMessage', (message) => {
            socket.to(roomId).emit('receiveMessage', { 
                user: `User-${socket.id.substring(0, 5)}`,
                message: message 
            });
        });
    });
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});