# Anonymous Chat Application

## Overview
This is a simple real-time anonymous chat application where users can create or join chat rooms, send messages, and chat anonymously with others in the same room. The person who creates the room becomes the "admin" and has the ability to close the room, which disconnects all users.

## Features
1. **Create Room**: Users can create a new chat room with a unique 6-digit room key.
2. **Join Room**: Users can join an existing room by entering the 6-digit room key.
3. **Anonymous Usernames**: Each user is assigned a random, anonymous username (e.g., Red-Lion-Apple).
4. **Real-Time Messaging**: Users can send and receive messages in real-time within the room.
5. **Admin Controls**: The room creator (admin) can close the room, which disconnects all users.
6. **Responsive UI**: The application has a clean and responsive interface that works on both desktop and mobile devices.

## How to Access
The application is deployed and accessible online at:
(https://anonymous-chat-app-vhd5.onrender.com)

## How to Use

### Creating a Room
1. Visit the application URL
2. Click the "Create Room" button on the greeting page
3. A unique 6-digit room key will be generated and displayed
4. You are now the admin of the room and can start chatting
5. Share the room key with others so they can join

### Joining a Room
1. Visit the application URL
2. Click the "Join Room" button on the greeting page
3. Enter the 6-digit room key provided by the room admin
4. Click "Join"
5. You will be assigned a random username and joined into the room

### Sending Messages
1. Once in the chat room, type your message in the input box at the bottom
2. Press Enter or click the send button (paper airplane icon)
3. Your message will be sent to all users in the room in real-time

### Closing a Room (Admin Only)
1. If you are the admin, you will see a "Close Room" button at the top right
2. Click this button to close the room
3. All users in the room will be disconnected and redirected to the greeting page

## Technical Details
- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Node.js, Express
- **Real-time Communication**: Socket.IO
- **Deployment**: PM2 process manager

## Privacy and Security
- No user data is stored permanently
- Usernames are randomly generated and anonymous
- Chat history is not saved after the room is closed
- Room keys are randomly generated 6-digit numbers

## Troubleshooting
- If you cannot connect to a room, make sure the room key is correct
- If messages are not sending, try refreshing the page
- If the room suddenly closes, the admin may have closed it or disconnected
- If the application URL is not loading, please wait a moment and try again

## Limitations
- Chat history is not preserved if you refresh the page
- No file sharing capabilities
- No user authentication or registration

## Screenshots
<img width="1366" height="768" alt="Screenshot (95)" src="https://github.com/user-attachments/assets/c61fbd8d-6736-4d82-80aa-1080b45c4c3a" />
<img width="1366" height="768" alt="Screenshot (94)" src="https://github.com/user-attachments/assets/28c8f892-3426-444f-bca0-ce78290de433" />
<img width="1366" height="768" alt="Screenshot (93)" src="https://github.com/user-attachments/assets/91617165-55a4-4287-85a2-e73671267abd" />
<img width="1366" height="768" alt="Screenshot (92)" src="https://github.com/user-attachments/assets/38bde0a6-26d5-49a9-ae1d-f2e229f347bd" />
