import { Router } from "express";
import { login, logout, me, register } from "../controllers/authController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const authRouter = Router();

authRouter.post('/register', register)
authRouter.post('/login', login)
authRouter.post('/logout', logout)
authRouter.get('/me', authMiddleware, me)  //WHY middleware is used here only ? :- because here we are checking if user is logged in or not , before getting the data

    export default authRouter;