import { Server } from 'socket.io';
import { config } from '../config/env.js';
import { verifyIdToken } from '../integrations/firebase.js';
import { Organization, User } from '../models/index.js';

let io = null;

// Live updates: each signed-in browser joins a room for its user and its company.
export function initSocket(httpServer) {
  io = new Server(httpServer, { cors: { origin: config.appUrl, credentials: true } });
  io.use(async (socket, next) => {
    try {
      const decoded = await verifyIdToken(socket.handshake.auth?.token);
      const user = await User.findOne({ firebaseUid: decoded.uid });
      if (!user) return next(new Error('unknown user'));
      // Same rules as every other request: closed accounts and suspended companies get nothing.
      if (user.status !== 'active') return next(new Error('account not active'));
      if (user.orgId && (await Organization.exists({ _id: user.orgId, status: 'suspended' }))) return next(new Error('company suspended'));
      socket.data.userId = String(user._id);
      socket.data.orgId = user.orgId ? String(user.orgId) : null;
      return next();
    } catch {
      return next(new Error('unauthorised'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`);
    if (socket.data.orgId) socket.join(`org:${socket.data.orgId}`);
  });
  return io;
}

export function emitToUser(userId, event, payload = {}) {
  if (io && userId) io.to(`user:${userId}`).emit(event, payload);
}

export function emitToOrg(orgId, event, payload = {}) {
  if (io && orgId) io.to(`org:${orgId}`).emit(event, payload);
}

// Closes the live connections of someone whose account was closed, or of everyone in a suspended
// company, so they stop receiving updates straight away rather than when their sign-in expires.
export function disconnectUser(userId) {
  if (io && userId) io.in(`user:${userId}`).disconnectSockets(true);
}

export function disconnectOrg(orgId) {
  if (io && orgId) io.in(`org:${orgId}`).disconnectSockets(true);
}
