import express from 'express'
import "dotenv/config"
import cors from 'cors'
import cookieParser from 'cookie-parser';
import { connectToDatabase } from './config/db';
import authRouter from "./routes/authRoutes.js";

const app = express();

connectToDatabase();
app.use(cors({origin : process.env.ORIGINS.split(','), credentials : true}));
//why split with ',' :- Because we are passing multiple origins in the .env file separated by commas.


app.use(cookieParser())  // is a middleware used in Node.js to parse the HTTP Cookie header from incoming client requests

app.use(express.json())

app.get('/', (req, res) => res.send("Server is Live!"))
app.use('/api/auth', authRouter)

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

app.listen(port, () => {
    console.log(`Server is running on port http://localhost:${port}`);
})

