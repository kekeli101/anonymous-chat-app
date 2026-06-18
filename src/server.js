const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

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
// roomKey -> {
//   type: 'public' | 'private',
//   adminKey: string,            // secret management key: remove users / delete room
//   creator: socketId,           // informational only
//   admins: Set<socketId>,       // sockets currently authenticated as admin
//   users: Map<socketId, username>,
//   createdAt: Date,
//   lastActivity: Date,
//   messages: []
// }
const activeRooms = new Map();

// Get port from environment variable or use default
const PORT = process.env.PORT || 3000;

// Self-pinging logic to keep the app active on Render
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_EXTERNAL_URL) {
  setInterval(() => {
    http.get(RENDER_EXTERNAL_URL, (res) => {
      console.log(`Self-ping status: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error(`Self-ping error: ${err.message}`);
    });
  }, 14 * 60 * 1000); // Ping every 14 minutes
}

// OPTIONAL safety valve. Disabled by default so rooms truly never auto-delete.
// Set ROOM_INACTIVITY_LIMIT_MS (in ms) to auto-remove rooms with no activity
// (messages/joins) for that long. Leave it unset to keep every room forever
// (until deleted with the admin key, or the server restarts).
const ROOM_INACTIVITY_LIMIT_MS = process.env.ROOM_INACTIVITY_LIMIT_MS
  ? Number(process.env.ROOM_INACTIVITY_LIMIT_MS)
  : null;

if (ROOM_INACTIVITY_LIMIT_MS) {
  setInterval(() => {
    const now = Date.now();
    for (const [roomKey, room] of activeRooms.entries()) {
      if (now - new Date(room.lastActivity).getTime() > ROOM_INACTIVITY_LIMIT_MS) {
        io.to(roomKey).emit('roomClosed', { message: 'Room closed due to long inactivity' });
        activeRooms.delete(roomKey);
        console.log(`Room removed (inactivity): ${roomKey}`);
      }
    }
  }, 60 * 1000);
}

// --- Key / id generators -----------------------------------------------------

// 6-digit numeric key for PRIVATE rooms (the secret you share to let people in)
function generatePrivateKey() {
  let key;
  do {
    key = Math.floor(100000 + Math.random() * 900000).toString();
  } while (activeRooms.has(key));
  return key;
}

// Longer, link-friendly id for PUBLIC rooms (shared openly via link)
function generatePublicId() {
  let id;
  do {
    id = crypto.randomBytes(6).toString('hex'); // 12 hex chars
  } while (activeRooms.has(id));
  return id;
}

// Secret management key returned to the creator. NOT needed to join — only to
// remove users or delete the room. This is what keeps a room manageable even
// after the creator has left.
function generateAdminKey() {
  return crypto.randomBytes(16).toString('hex'); // 32 hex chars
}

// Generate a random username
function generateUsername() {
  const adjectives = [
    'Silent', 'Hidden', 'Shadow', 'Secret', 'Masked', 'Mad',
    'Lost', 'Midnight', 'Ghostly', 'Wandering', 'Unknown',
    'Cosmic', 'Nebulous', 'Encrypted', 'Phantom', 'Veiled'
  ];
  const animals = [
    'Raven', 'Wolf', 'Panther', 'Fox', 'Owl', 'Dog',
    'Serpent', 'Falcon', 'Moth', 'Jaguar', 'Lynx'
  ];
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
  return `${randomAdjective}-${randomAnimal}`;
}

// --- Helpers -----------------------------------------------------------------

function publicUserList(room) {
  return Array.from(room.users.entries()).map(([id, username]) => ({ id, username }));
}

function emitUserList(roomKey, room) {
  io.to(roomKey).emit('roomUsers', {
    users: publicUserList(room),
    userCount: room.users.size
  });
}

function isAuthorisedAdmin(room, socketId, adminKey) {
  return room.admins.has(socketId) || (!!adminKey && adminKey === room.adminKey);
}

// --- Socket.IO ---------------------------------------------------------------

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Create a new room (public or private)
  socket.on('createRoom', (data = {}) => {
    const type = data.type === 'public' ? 'public' : 'private';
    const roomKey = type === 'public' ? generatePublicId() : generatePrivateKey();
    const adminKey = generateAdminKey();
    const username = generateUsername();

    const room = {
      type,
      adminKey,
      creator: socket.id,
      admins: new Set([socket.id]),
      users: new Map([[socket.id, username]]),
      createdAt: new Date(),
      lastActivity: new Date(),
      messages: []
    };

    activeRooms.set(roomKey, room);
    socket.join(roomKey);

    socket.emit('roomCreated', {
      roomKey,
      type,
      adminKey,        // creator stores this to manage the room later
      username,
      isAdmin: true,
      userCount: 1
    });

    console.log(`${type} room created: ${roomKey} by ${username} (${socket.id})`);
  });

  // Join an existing room (public link or private key — both look up by id)
  socket.on('joinRoom', (data) => {
    const { roomKey } = data;
    const adminKey = data && data.adminKey ? data.adminKey : null;

    if (!activeRooms.has(roomKey)) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const room = activeRooms.get(roomKey);
    const username = generateUsername();

    room.users.set(socket.id, username);
    room.lastActivity = new Date();
    socket.join(roomKey);

    // Returning creator / moderator may pass the management key to regain admin
    let isAdmin = false;
    if (adminKey && adminKey === room.adminKey) {
      room.admins.add(socket.id);
      isAdmin = true;
    }

    socket.emit('roomJoined', {
      roomKey,
      type: room.type,
      username,
      isAdmin,
      userCount: room.users.size,
      messages: room.messages,
      users: publicUserList(room)
    });

    socket.to(roomKey).emit('userJoined', {
      username,
      timestamp: new Date(),
      userCount: room.users.size
    });

    emitUserList(roomKey, room);

    console.log(`User joined ${room.type} room ${roomKey} as ${username} (${socket.id})`);
  });

  // Unlock admin controls by supplying the management key after joining
  socket.on('authenticateAdmin', (data) => {
    const { roomKey, adminKey } = data || {};
    const room = activeRooms.get(roomKey);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    if (!room.users.has(socket.id)) {
      socket.emit('error', { message: 'Join the room first' });
      return;
    }

    if (adminKey && adminKey === room.adminKey) {
      room.admins.add(socket.id);
      socket.emit('adminAuthenticated', {
        success: true,
        users: publicUserList(room),
        userCount: room.users.size
      });
    } else {
      socket.emit('adminAuthenticated', { success: false, message: 'Invalid management key' });
    }
  });

  // Change username
  socket.on('changeUsername', (data) => {
    const clean = ((data && data.newUsername) || '').toString().trim().slice(0, 30);
    if (!clean) return;

    for (const [roomKey, room] of activeRooms.entries()) {
      if (room.users.has(socket.id)) {
        const oldUsername = room.users.get(socket.id);
        room.users.set(socket.id, clean);
        room.lastActivity = new Date();

        io.to(roomKey).emit('systemMessage', {
          message: `${oldUsername} has changed their name to ${clean}`,
          timestamp: new Date()
        });
        emitUserList(roomKey, room);
        return;
      }
    }
  });

  // Send a message to the room
  socket.on('sendMessage', (data) => {
    const { roomKey, message, replyTo } = data;

    if (!activeRooms.has(roomKey)) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const room = activeRooms.get(roomKey);
    if (!room.users.has(socket.id)) {
      socket.emit('error', { message: 'You are not in this room' });
      return;
    }

    const username = room.users.get(socket.id);
    const text = (message || '').toString();
    if (!text.trim()) return;

    const messageObj = {
      id: Date.now() + Math.random().toString(36).substr(2, 5),
      username,
      message: text,
      timestamp: new Date(),
      replyTo
    };

    room.messages.push(messageObj);
    if (room.messages.length > 100) {
      room.messages = room.messages.slice(-100);
    }
    room.lastActivity = new Date();

    io.to(roomKey).emit('newMessage', messageObj);
    console.log(`Message in room ${roomKey} from ${username}: ${text}`);
  });

  // Typing indicators
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

  // Remove a user from the room (requires the management key)
  socket.on('removeUser', (data) => {
    const { roomKey, adminKey, targetId } = data || {};
    const room = activeRooms.get(roomKey);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    if (!isAuthorisedAdmin(room, socket.id, adminKey)) {
      socket.emit('error', { message: 'Invalid management key' });
      return;
    }
    if (!room.users.has(targetId)) {
      socket.emit('error', { message: 'User is no longer in the room' });
      return;
    }

    const targetUsername = room.users.get(targetId);
    room.users.delete(targetId);
    room.admins.delete(targetId);

    io.to(targetId).emit('removedFromRoom', {
      message: 'You have been removed from the room by an admin'
    });
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) targetSocket.leave(roomKey);

    io.to(roomKey).emit('systemMessage', {
      message: `${targetUsername} was removed by an admin`,
      timestamp: new Date()
    });
    emitUserList(roomKey, room);
    console.log(`User ${targetUsername} removed from ${roomKey}`);
  });

  // Delete the room entirely (requires the management key)
  socket.on('deleteRoom', (data) => {
    const { roomKey, adminKey } = data || {};
    const room = activeRooms.get(roomKey);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    if (!isAuthorisedAdmin(room, socket.id, adminKey)) {
      socket.emit('error', {
        message: 'Invalid management key — only someone with the key can delete this room'
      });
      return;
    }

    io.to(roomKey).emit('roomClosed', { message: 'This room has been deleted by an admin' });
    activeRooms.delete(roomKey);
    console.log(`Room deleted: ${roomKey}`);
  });

  // User disconnects — remove them but KEEP the room alive (even if empty)
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    for (const [roomKey, room] of activeRooms.entries()) {
      if (room.users.has(socket.id)) {
        const username = room.users.get(socket.id);
        room.users.delete(socket.id);
        room.admins.delete(socket.id);

        socket.to(roomKey).emit('userLeft', {
          username,
          timestamp: new Date(),
          userCount: room.users.size
        });
        emitUserList(roomKey, room);

        // Room is intentionally NOT deleted, even when empty. It only goes away
        // when someone deletes it with the management key (or, optionally, after
        // long inactivity if ROOM_INACTIVITY_LIMIT_MS is set).
        console.log(`User left ${roomKey}: ${username} (${socket.id})`);
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
  module.exports = app;
} else {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;

// Last updated: 2026-06-18