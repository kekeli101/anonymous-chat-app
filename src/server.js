const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store active rooms
const activeRooms = new Map();

// Get port from command line arguments or use default
const PORT = process.env.PORT || process.argv[2]?.split('=')[1] || 3001;

// Generate a random 6-digit room key
function generateRoomKey() {
  let key;
  do {
    key = Math.floor(100000 + Math.random() * 900000).toString();
  } while (activeRooms.has(key));
  return key;
}

// Generate a random username
function generateUsername() {
  const adjectives = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Black', 'White', 'Gray'];
  const animals = ['Lion', 'Tiger', 'Bear', 'Wolf', 'Fox', 'Eagle', 'Hawk', 'Dolphin', 'Shark', 'Elephant'];
  const objects = ['Apple', 'Banana', 'Cherry', 'Diamond', 'Emerald', 'Fire', 'Galaxy', 'Hurricane', 'Ice', 'Jungle'];
  
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
  const randomObject = objects[Math.floor(Math.random() * objects.length)];
  
  return `${randomAdjective}-${randomAnimal}-${randomObject}`;
}

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Create a new room
  socket.on('createRoom', () => {
    const roomKey = generateRoomKey();
    const username = generateUsername();
    
    // Store room information
    activeRooms.set(roomKey, {
      admin: socket.id,
      users: new Map([[socket.id, username]]),
      createdAt: new Date()
    });
    
    // Join the room
    socket.join(roomKey);
    
    // Send room information to the client
    socket.emit('roomCreated', {
      roomKey,
      username,
      isAdmin: true
    });
    
    console.log(`Room created: ${roomKey} by ${username} (${socket.id})`);
  });
  
  // Join an existing room
  socket.on('joinRoom', (data) => {
    const { roomKey } = data;
    
    // Check if room exists
    if (!activeRooms.has(roomKey)) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    const room = activeRooms.get(roomKey);
    const username = generateUsername();
    
    // Add user to room
    room.users.set(socket.id, username);
    
    // Join the room
    socket.join(roomKey);
    
    // Send room information to the client
    socket.emit('roomJoined', {
      roomKey,
      username,
      isAdmin: socket.id === room.admin
    });
    
    // Notify other users in the room
    socket.to(roomKey).emit('userJoined', {
      username,
      timestamp: new Date()
    });
    
    console.log(`User joined room: ${roomKey} as ${username} (${socket.id})`);
  });
  
  // Send a message to the room
  socket.on('sendMessage', (data) => {
    const { roomKey, message } = data;
    
    // Check if room exists
    if (!activeRooms.has(roomKey)) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    const room = activeRooms.get(roomKey);
    const username = room.users.get(socket.id);
    
    // Broadcast message to all users in the room
    io.to(roomKey).emit('newMessage', {
      username,
      message,
      timestamp: new Date()
    });
    
    console.log(`Message in room ${roomKey} from ${username}: ${message}`);
  });
  
  // Close the room (admin only)
  socket.on('closeRoom', (data) => {
    const { roomKey } = data;
    
    // Check if room exists
    if (!activeRooms.has(roomKey)) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    const room = activeRooms.get(roomKey);
    
    // Check if user is admin
    if (socket.id !== room.admin) {
      socket.emit('error', { message: 'Only the admin can close the room' });
      return;
    }
    
    // Notify all users in the room
    io.to(roomKey).emit('roomClosed', {
      message: 'The room has been closed by the admin'
    });
    
    // Remove room
    activeRooms.delete(roomKey);
    
    console.log(`Room closed: ${roomKey}`);
  });
  
  // User disconnects
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Find rooms where user is a member
    for (const [roomKey, room] of activeRooms.entries()) {
      if (room.users.has(socket.id)) {
        const username = room.users.get(socket.id);
        
        // Remove user from room
        room.users.delete(socket.id);
        
        // Notify other users in the room
        socket.to(roomKey).emit('userLeft', {
          username,
          timestamp: new Date()
        });
        
        console.log(`User left room: ${roomKey} - ${username} (${socket.id})`);
        
        // If user was admin, close the room
        if (socket.id === room.admin) {
          // Notify all users in the room
          io.to(roomKey).emit('roomClosed', {
            message: 'The room has been closed because the admin left'
          });
          
          // Remove room
          activeRooms.delete(roomKey);
          
          console.log(`Room closed (admin left): ${roomKey}`);
        }
        
        // If room is empty, remove it
        if (room.users.size === 0) {
          activeRooms.delete(roomKey);
          console.log(`Room removed (empty): ${roomKey}`);
        }
      }
    }
  });
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = { app, server };
