import mongoose from "mongoose";

export async function connectToDatabase() {
    mongoose.connection.on('connected', ()=>{
        console.log("Successfully connected to MongoDB.")
    })

    mongoose.connection.on('error', (error)=>{
        console.log("MongoDB connection error:", error);
    })
    const uri = process.env.MONGODB_URI || process.env.MONGOB_URI;
    if (!uri) {
        throw new Error("MONGODB_URI is not defined in the environment variables (.env file).");
    }
    await mongoose.connect(uri);
    console.log("Database connection established.")
}