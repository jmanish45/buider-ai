import { createContext, useContext, useState, useEffect } from "react";
import api from "../api/api";
import toast from 'react-hot-toast';
import { Navigate, useNavigate } from "react-router-dom";

const AppContext = createContext(undefined)

export function AppContextProvider({children}) {
    //Auth States
    const [user, setUser] = useState(null) // store loaded user data, null if not loaded or error
    const [loadingUser, setLoadingUser] = useState(true)  //if true, prevents navigation/UI while checking auth
    const navigate = useNavigate()
    //Auth Actions
    const checkSession = async () => {
        try {
            const {data} = await api.get('/api/auth/me');
            setUser(data.user);
        }
        catch(err) {
            setUser(null)
        }
        finally {
            setLoadingUser(false)
        }
    }
    useEffect(()=> {
        checkSession()
    },[])
    
    const login = async (email, password) => {
        try{
            setLoadingUser(true)
            const {data} = await api.post('/api/auth/login', {email, password})
            setUser(data.user)
            toast.success("Welcome Back")
            navigate("/")
        }
        catch(err) {
            console.error("Login Failed : ", err);
            const errMsg = err?.response?.data?.error || "Invalid email or password"
            toast.error(errMsg);
            throw new Error(errMsg);  
        }
        finally {
            setLoadingUser(false)
        }
    }

    const register = async (name, email, password) => {
        try{
            setLoadingUser(true)
            const {data} = await api.post('/api/auth/register', {name, email, password})
            setUser(data.user)
            toast.success("Account successfully created")
            navigate("/")
        }
        catch(err) {
            console.error("Registration Failed : ", err);
            const errMsg = err?.response?.data?.error || "Email already registered"
            toast.error(errMsg);
            throw new Error(errMsg);  
        }
        finally {
            setLoadingUser(false)
        }
    }
    return (
        <AppContext.Provider value={{
            user, loadingUser , login, register , checkSession
        }}>  {/* later you will put all shared state and handlers here */}
            {children}
        </AppContext.Provider>
    )
}

export function useAppContext() {
    const context = useContext(AppContext);  //return the context
    if (context === undefined) {
        throw new Error("useAppContext must be used within AppContextProvider");
    }
    return context;
}