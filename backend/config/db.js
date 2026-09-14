import mongoose from "mongoose";

export async function connectToDatabase() {
    mongoose.connection.on('connected', ()=>{
        console.log("Successfully connected to MongoDB.")
    })

    mongoose.connection.on('error', (error)=>{
        console.log("MongoDB connection error:", error);
    })
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Database connection established.")
}