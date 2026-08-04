import { createContext, useContext, useState, useEffect } from "react";
import api from "../api/api";


const AppContext = createContext(undefined)

export function AppContextProvider({children}) {
    //Auth States
    const [user, setUser] = useState(null) // store loaded user data, null if not loaded or error
    const [loadingUser, setLoadingUser] = useState(true)  //if true, prevents navigation/UI while checking auth

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
    
    return (
        <AppContext.Provider value={{
            user, loadingUser
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