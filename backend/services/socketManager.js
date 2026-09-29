import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

/**
 * Singleton WebSocket manager.
 * - Authenticates socket connections using the same JWT cookie as the REST API.
 * - Manages "project rooms" so events only reach the correct user/project.
 * - Exposes emitToProject() for controllers to push real-time updates.
 */
class SocketManager {
    init(httpServer) {
        this.io = new Server(httpServer, {
            cors: {
                origin: process.env.ORIGINS.split(','),
                credentials: true,
            },
        });

        // Authenticate socket connections with cookie OR auth header/token
        this.io.use((socket, next) => {
            try {
                const cookieHeader = socket.handshake.headers.cookie || '';
                const cookieToken = cookieHeader.match(/token=([^;]+)/)?.[1];
                const authToken = socket.handshake.auth?.token;
                const token = cookieToken || authToken;
                
                if (!token) return next(new Error('Authentication required'));

                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
                socket.userId = decoded.userId;
                next();
            } catch (err) {
                next(new Error('Invalid or expired token'));
            }
        });

        this.io.on('connection', (socket) => {
            console.log(`[WS] User ${socket.userId} connected (socket ${socket.id})`);

            // User joins a project room to receive updates for that project
            socket.on('project:join', (projectId) => {
                socket.join(`project:${projectId}`);
                console.log(`[WS] User ${socket.userId} joined project room ${projectId}`);
            });

            // User leaves a project room
            socket.on('project:leave', (projectId) => {
                socket.leave(`project:${projectId}`);
                console.log(`[WS] User ${socket.userId} left project room ${projectId}`);
            });

            socket.on('disconnect', () => {
                console.log(`[WS] User ${socket.userId} disconnected (socket ${socket.id})`);
            });
        });

        console.log('[WS] Socket.io server initialized');
    }

    /**
     * Emit a real-time event to all clients in a project room.
     * Controllers call this during generation/revision to push updates.
     */
    emitToProject(projectId, event, data) {
        if (this.io) {
            this.io.to(`project:${projectId}`).emit(event, data);
        }
    }
}

export const socketManager = new SocketManager();
