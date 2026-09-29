import express from 'express'
import { createServer } from 'http';
import "dotenv/config"
import cors from 'cors'
import cookieParser from 'cookie-parser';
import { connectToDatabase } from './config/db.js';
import authRouter from "./routes/authRoutes.js";
import projectRouter from './routes/projectRoutes.js';
import { socketManager } from './services/socketManager.js';

const app = express();
const httpServer = createServer(app);

await connectToDatabase();

// Initialize WebSocket server on the same HTTP server
socketManager.init(httpServer);

const rawOrigins = process.env.ORIGINS || "http://localhost:5173";
const allowedOrigins = rawOrigins.split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const normalized = origin.trim().replace(/\/$/, '');
        if (allowedOrigins.includes(normalized) || allowedOrigins.includes('*') || normalized.endsWith('.onrender.com') || normalized.includes('localhost')) {
            return callback(null, true);
        }
        return callback(null, true);
    },
    credentials: true,
}));


app.use(cookieParser())  // is a middleware used in Node.js to parse the HTTP Cookie header from incoming client requests

app.use(express.json())

app.get('/', (req, res) => res.send("Server is Live!"))
app.use('/api/auth', authRouter)
app.use('/api/projects', projectRouter)

//Centralise error handler
app.use((error,req,res,next)=>{
    const statusCode = error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    res.status(statusCode).json({
        success: false,
        statusCode,
        message,
        stack: error.stack,
    })
})

const port = process.env.PORT || 3000 

httpServer.listen(port, () => {
    console.log(`Server is running on port http://localhost:${port}`);
})

