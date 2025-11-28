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

// Get port from environment variable or use default
const PORT = process.env.PORT || 3000;

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
      createdAt: new Date(),
      messages: [] // Store messages for reply functionality
    });
    
    // Join the room
    socket.join(roomKey);
    
    // Send room information to the client
    socket.emit('roomCreated', {
      roomKey,
      username,
      isAdmin: true,
      userCount: 1 // Initial user count
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
      isAdmin: socket.id === room.admin,
      userCount: room.users.size, // Current user count
      messages: room.messages // Send existing messages for history
    });
    
    // Notify other users in the room
    socket.to(roomKey).emit('userJoined', {
      username,
      timestamp: new Date(),
      userCount: room.users.size // Updated user count
    });
    
    console.log(`User joined room: ${roomKey} as ${username} (${socket.id})`);
  });
  
  // Send a message to the room
  socket.on('sendMessage', (data) => {
    const { roomKey, message, replyTo } = data;
    
    // Check if room exists
    if (!activeRooms.has(roomKey)) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    const room = activeRooms.get(roomKey);
    const username = room.users.get(socket.id);
    
    // Create message object with unique ID
    const messageObj = {
      id: Date.now() + Math.random().toString(36).substr(2, 5), // Generate unique ID
      username,
      message,
      timestamp: new Date(),
      replyTo // Include reply information if present
    };
    
    // Store message in room history
    room.messages.push(messageObj);
    
    // Limit message history to prevent memory issues (keep last 100 messages)
    if (room.messages.length > 100) {
      room.messages = room.messages.slice(-100);
    }
    
    // Broadcast message to all users in the room
    io.to(roomKey).emit('newMessage', messageObj);
    
    console.log(`Message in room ${roomKey} from ${username}: ${message}`);
  });
  
  // Typing indicator
  socket.on('typing', (data) => {
    const { roomKey } = data;
    const room = activeRooms.get(roomKey);
    if (room && room.users.has(socket.id)) {
      const username = room.users.get(socket.id);
      socket.to(roomKey).emit('userTyping', { username });
    }
  });

  socket.on('stopTyping', (data) => {
    const { roomKey } = data;
    const room = activeRooms.get(roomKey);
    if (room && room.users.has(socket.id)) {
      const username = room.users.get(socket.id);
      socket.to(roomKey).emit('userStopTyping', { username });
    }
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
          timestamp: new Date(),
          userCount: room.users.size // Updated user count
        });
        
        console.log(`User left room: ${roomKey} - ${username} (${socket.id})`);
        
        // If user was admin, close the room
        if (socket.id === room.admin) {
          // Find a new admin
          const remainingUsers = Array.from(room.users.keys()).filter(id => id !== socket.id);
          if (remainingUsers.length > 0) {
            const newAdminId = remainingUsers[0]; // Or choose based on other criteria
            room.admin = newAdminId;
            io.to(roomKey).emit("adminChanged", { newAdminId, message: `Admin role transferred to ${room.users.get(newAdminId)}` });
            console.log(`Admin role in room ${roomKey} transferred to ${room.users.get(newAdminId)}`);
          } else {
            // If no other users, then close the room (optional, based on desired behavior)
            io.to(roomKey).emit("roomClosed", {
              message: "The room has been closed because the admin left and no other users remained"
            });
            activeRooms.delete(roomKey);
            console.log(`Room closed (admin left, no users): ${roomKey}`);
          }
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

// For Vercel serverless functions
if (process.env.VERCEL) {
  // Export the express app for Vercel serverless deployment
  module.exports = app;
} else {
  // Start server for local development
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Export for Vercel
module.exports = app;
