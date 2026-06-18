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
//   name: string | null,         // public rooms only
//   deleteCode: string,          // 6-digit code to delete the room (private: same as roomKey)
//   creator: socketId,
//   admins: Set<socketId>,
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
        const wasPublic = room.type === 'public';
        activeRooms.delete(roomKey);
        if (wasPublic) broadcastPublicRooms();
        console.log(`Room removed (inactivity): ${roomKey}`);
      }
    }
  }, 60 * 1000);
}

// --- Key / id generators -----------------------------------------------------

// 6-digit numeric delete code (save this to delete the room later)
function generateDeleteCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Longer, link-friendly id for PUBLIC rooms (shared openly via link)
function generatePublicId() {
  let id;
  do {
    id = crypto.randomBytes(6).toString('hex'); // 12 hex chars
  } while (activeRooms.has(id));
  return id;
}

// 6-digit numeric key for PRIVATE rooms (the secret you share to let people in)
function generatePrivateKey() {
  let key;
  do {
    key = Math.floor(100000 + Math.random() * 900000).toString();
  } while (activeRooms.has(key));
  return key;
}

function getPublicRoomsList() {
  const rooms = [];
  for (const [roomKey, room] of activeRooms.entries()) {
    if (room.type === 'public') {
      rooms.push({
        roomKey,
        name: room.name,
        userCount: room.users.size,
        createdAt: room.createdAt,
      });
    }
  }
  return rooms.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function broadcastPublicRooms() {
  io.emit('publicRoomsUpdated', { rooms: getPublicRoomsList() });
}

function removeUserFromRoom(socket, roomKey, room, leaveSocket = true) {
  if (!room.users.has(socket.id)) return;

  const username = room.users.get(socket.id);
  room.users.delete(socket.id);
  room.admins.delete(socket.id);
  if (leaveSocket) socket.leave(roomKey);

  if (room.users.size > 0) {
    socket.to(roomKey).emit('userLeft', {
      username,
      timestamp: new Date(),
      userCount: room.users.size,
    });
    emitUserList(roomKey, room);
  }

  ensureRoomHasAdmin(roomKey, room);
  deleteRoomIfEmpty(roomKey, room);
  console.log(`User left ${roomKey}: ${username} (${socket.id})`);
}

function pruneStaleAdmins(room) {
  for (const adminId of [...room.admins]) {
    if (!room.users.has(adminId)) {
      room.admins.delete(adminId);
    }
  }
}

function ensureRoomHasAdmin(roomKey, room) {
  pruneStaleAdmins(room);
  if (room.users.size === 0 || room.admins.size > 0) return;

  const newAdminId = room.users.keys().next().value;
  room.admins.add(newAdminId);
  room.creator = newAdminId;

  io.to(newAdminId).emit('promotedToAdmin', {
    message: 'You are now the room admin because the previous admin left.',
    users: publicUserList(room),
    userCount: room.users.size,
  });
  emitUserList(roomKey, room);
  console.log(`Promoted ${newAdminId} to admin in ${roomKey}`);
}

function deleteRoomIfEmpty(roomKey, room) {
  if (room.users.size > 0) return false;

  const wasPublic = room.type === 'public';
  activeRooms.delete(roomKey);
  if (wasPublic) broadcastPublicRooms();
  console.log(`Room deleted (empty): ${roomKey}`);
  return true;
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

function isRoomAdmin(room, socketId) {
  return room.admins.has(socketId);
}

// --- Socket.IO ---------------------------------------------------------------

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Create a new room (public or private)
  socket.on('createRoom', (data = {}) => {
    const type = data.type === 'public' ? 'public' : 'private';
    const roomName = (data.name || '').toString().trim().slice(0, 50);

    if (type === 'public' && !roomName) {
      socket.emit('error', { message: 'Please enter a room name before creating' });
      return;
    }

    const roomKey = type === 'public' ? generatePublicId() : generatePrivateKey();
    const deleteCode = type === 'private' ? roomKey : generateDeleteCode();
    const username = generateUsername();

    const room = {
      type,
      name: type === 'public' ? roomName : null,
      deleteCode,
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
      name: room.name,
      deleteCode,
      username,
      isAdmin: true,
      userCount: 1
    });

    if (type === 'public') {
      broadcastPublicRooms();
    }

    console.log(`${type} room created: ${roomKey} (${roomName || 'private'}) by ${username} (${socket.id})`);
  });

  // Join an existing room (public link or private key — both look up by id)
  socket.on('joinRoom', (data) => {
    const { roomKey } = data;
    const deleteCode = data && data.deleteCode ? data.deleteCode : null;

    if (!activeRooms.has(roomKey)) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const room = activeRooms.get(roomKey);
    const username = generateUsername();

    room.users.set(socket.id, username);
    room.lastActivity = new Date();
    socket.join(roomKey);

    let isAdmin = room.admins.has(socket.id);

    socket.emit('roomJoined', {
      roomKey,
      type: room.type,
      name: room.name,
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

  // Leave a room without deleting it
  socket.on('leaveRoom', (data) => {
    const { roomKey } = data || {};
    const room = activeRooms.get(roomKey);
    if (!room) return;
    removeUserFromRoom(socket, roomKey, room);
    socket.emit('leftRoom', { roomKey });
  });

  // Unlock admin controls by supplying the delete code after joining
  socket.on('authenticateAdmin', (data) => {
    const { roomKey, deleteCode } = data || {};
    const room = activeRooms.get(roomKey);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    if (!room.users.has(socket.id)) {
      socket.emit('error', { message: 'Join the room first' });
      return;
    }

    if (deleteCode && deleteCode === room.deleteCode) {
      room.admins.add(socket.id);
      socket.emit('adminAuthenticated', {
        success: true,
        users: publicUserList(room),
        userCount: room.users.size
      });
    } else {
      socket.emit('adminAuthenticated', { success: false, message: 'Invalid delete code' });
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

  // Remove a user from the room (requires the delete code)
  socket.on('removeUser', (data) => {
    const { roomKey, targetId } = data || {};
    const room = activeRooms.get(roomKey);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    if (!isRoomAdmin(room, socket.id)) {
      socket.emit('error', { message: 'Only a room admin can remove users' });
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
    ensureRoomHasAdmin(roomKey, room);
    deleteRoomIfEmpty(roomKey, room);
    console.log(`User ${targetUsername} removed from ${roomKey}`);
  });

  // Delete the room entirely (admin only, and only when alone in the room)
  socket.on('deleteRoom', (data) => {
    const { roomKey } = data || {};
    const room = activeRooms.get(roomKey);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    if (!isRoomAdmin(room, socket.id)) {
      socket.emit('error', { message: 'Only a room admin can delete this room' });
      return;
    }
    if (room.users.size > 1) {
      socket.emit('error', {
        message: 'This room can only be deleted when no one else is in it. Ask others to leave first.'
      });
      return;
    }

    io.to(roomKey).emit('roomClosed', { message: 'This room has been deleted' });
    activeRooms.delete(roomKey);
    if (room.type === 'public') {
      broadcastPublicRooms();
    }
    console.log(`Room deleted: ${roomKey}`);
  });

  // User disconnects — remove them but KEEP the room alive (even if empty)
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    for (const [roomKey, room] of activeRooms.entries()) {
      if (room.users.has(socket.id)) {
        removeUserFromRoom(socket, roomKey, room, false);
      }
    }
  });
});

// Routes
app.get('/api/public-rooms', (req, res) => {
  res.json({ rooms: getPublicRoomsList() });
});

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