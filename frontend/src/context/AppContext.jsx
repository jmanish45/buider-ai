// Import React APIs and application dependencies.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import api from "../api/api";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import debounce from "lodash.debounce";
import { socket } from "../services/socket";
// Create the shared application context.
const AppContext = createContext(undefined);

// Provide authentication, project, and editor state to the application.
export function AppContextProvider({children}){

    // Initialize navigation access.
    const navigate = useNavigate()

     // Auth States
     const [user, setUser] = useState(null)
     const [loadingUser, setLoadingUser] = useState(true);

     // States
     const [projects, setProjects] = useState([]);
     const [loadingProjects, setLoadingProjects] = useState(true);
     const [activeProject, setActiveProject] = useState(null);
     const [loadingActiveProject, setLoadingActiveProject] = useState(true);
     const [chatLoading, setChatLoading] = useState(false);
     const [generatingProject, setGeneratingProject] = useState(false);
     const [activeFile, setActiveFile] = useState("/App.js");
     const [showCode, setShowCode] = useState(false);

    // Check whether the current session is authenticated.
      const checkSession = async ()=>{
        try {
            const { data } = await api.get("/api/auth/me");
            setUser(data.user);
        } catch (error) {
            setUser(null)
        }finally{
            setLoadingUser(false)
        }
      }

    // Restore the user session when the provider mounts.
    useEffect(()=>{
        checkSession()
      },[])

    // Authenticate a user and redirect to the home page.
    const login = async (email, password) => {
        try {
            const { data } = await api.post("/api/auth/login", {email, password});
            setUser(data.user)
            toast.success("Welcome back!")
            navigate("/")
        } catch (err) {
            console.error("Login failed:", err);
            const errMsg = err?.response?.data?.error || "Invalid email or password";
             toast.error(errMsg);
             throw new Error(errMsg);
        }
      }

    // Register a new user and redirect to the home page.
    const register = async (name, email, password) => {
        try {
            const { data } = await api.post("/api/auth/register", {name, email, password});
            setUser(data.user)
            toast.success("Account created successfully!")
            navigate("/")
        } catch (err) {
            console.error("Registration failed:", err);
            const errMsg = err?.response?.data?.error || "Registration failed";
             toast.error(errMsg);
             throw new Error(errMsg);
        }
      }

    // End the current session and clear project state.
    const logout = async ()=>{
        try {
            await api.post("/api/auth/logout")
            setUser(null)
            setProjects([])
            setActiveProject(null)
            toast.success("Logged out successfully")
            navigate("/login")
        } catch (err) {
             console.error("Logout failed:", err);
             toast.error("Logout failed");
        }
      }

    // Load the authenticated user's project list.
      const loadProjects = async () =>{
        if(!user) return;
        try {
            const { data } = await api.get("/api/projects")
            setProjects(data)
        } catch (err) {
            console.error("Failed to list projects:", err);
            toast.error("Failed to load projects list");
        }finally{
            setLoadingProjects(false);
        }
      }

    // Load one project and select a valid project file.
    const loadProject =  async (id, silent = false)=>{
        console.log("load project");
        
        if(!user) return;
        if (!silent) setLoadingActiveProject(true)
            try {
                const { data } = await api.get(`/api/projects/${id}`)
                 setActiveProject(data);

                 // Default file selection
                 const files = Object.keys(data.files);
                 if(files.length > 0){
                    setActiveFile((prev)=>{
                        if(files.includes(prev)) return prev;
                        if(files.includes("/App.js"))  return "/App.js";
                        return files[0]
                    })
                 }
            } catch (err) {
                console.error("Failed to load project:", err);
                if(!silent){
                    toast.error("Failed to load project details");
                    navigate("/");
                }
            }finally{
                if (!silent) setLoadingActiveProject(false)
            }
      }

    // Connect/disconnect socket based on authentication state.
    useEffect(() => {
        if (user) {
            socket.connect();
        } else {
            socket.disconnect();
        }
        return () => {
            socket.disconnect();
        };
    }, [user]);

    // Listen for real-time WebSocket events on the active project.
    // Replaces the old 2-second polling interval with instant updates.
       useEffect(()=>{
        if (!activeProject?._id || !user) return;

        const projectId = activeProject._id;

        // Join the project room to receive events for this project
        socket.emit('project:join', projectId);

        // Track whether the project is in an ongoing generation/revision state
        const isOngoing = activeProject.status === "generating" || activeProject.status === "pending" || activeProject.status === "revising";
        if (isOngoing) {
            setChatLoading(true);
        }

        // --- WebSocket event handlers ---

        const onPlan = (data) => {
            console.log('[WS] Received generation:plan', data);
            setActiveProject(prev => prev ? {
                ...prev,
                name: data.name || prev.name,
                status: data.status || prev.status,
                filesPlanned: data.filesPlanned || prev.filesPlanned,
            } : prev);
        };

        const onFileStart = (data) => {
            console.log('[WS] Received generation:file_start', data);
            setActiveProject(prev => prev ? {
                ...prev,
                currentFile: data.currentFile,
            } : prev);
        };

        const onFileDone = (data) => {
            console.log('[WS] Received generation:file_done', data);
            // Reload full project to get file contents (WS only sends metadata)
            loadProject(projectId, true);
        };

        const onComplete = (data) => {
            console.log('[WS] Received generation:complete or revision:complete', data);
            // Reload full project to get final state with all files
            loadProject(projectId, true);
            setChatLoading(false);
        };

        const onFailed = (data) => {
            console.log('[WS] Received generation:failed', data);
            setActiveProject(prev => prev ? {
                ...prev,
                status: 'failed',
                error: data.error,
            } : prev);
            setChatLoading(false);
            toast.error(`Generation failed: ${data.error}`);
        };

        socket.on('generation:plan', onPlan);
        socket.on('generation:file_start', onFileStart);
        socket.on('generation:file_done', onFileDone);
        socket.on('generation:complete', onComplete);
        socket.on('revision:complete', onComplete);
        socket.on('generation:failed', onFailed);

        // Safety fallback: poll every 8 seconds in case a WS event is missed
        // (e.g. brief network blip). This is much less aggressive than the old 2s.
        let fallbackInterval = null;
        if (isOngoing) {
            fallbackInterval = setInterval(() => {
                loadProject(projectId, true);
            }, 8000);
        }

        return () => {
            socket.emit('project:leave', projectId);
            socket.off('generation:plan', onPlan);
            socket.off('generation:file_start', onFileStart);
            socket.off('generation:file_done', onFileDone);
            socket.off('generation:complete', onComplete);
            socket.off('revision:complete', onComplete);
            socket.off('generation:failed', onFailed);
            if (fallbackInterval) clearInterval(fallbackInterval);
        };

       },[activeProject?._id, activeProject?.status, loadProject, user])

    // Create a project from an AI prompt.
    const handleGenerate = useCallback(
        async (prompt) => {
            if(!user) return;

            setGeneratingProject(true);
            try {
                const { data } = await api.post("/api/projects", { prompt });
                toast.success("AI Agent is planning structure...")
                navigate(`/builder/${data._id}`);
            } catch (err) {
                console.error("Failed to generate project:", err);
                toast.error(err?.response?.data?.error || "Failed to generate project");
            }finally{
                setGeneratingProject(false);
            }

        },[navigate, user]
       )

    // Delete a project and remove it from local state.
    const handleDelete = useCallback(
        async (id) => {
            if(!user) return;

            try {
                await api.delete(`/api/projects/${id}`);
               setProjects((prev)=>prev.filter((p)=>p._id !== id))
               toast.success("Project deleted successfully")
            } catch (err) {
               console.error("Failed to delete project:", err);
                toast.error("Failed to delete project");
            }

        },[user]
       )

    // Send a revision prompt for the active project.
    const handleChat = useCallback(
        async (prompt)=>{
            if(!activeProject || !user) return;
            setChatLoading(true)
            try {
                const { data } = await api.post(`/api/projects/${activeProject._id}/chat`, {prompt});
                setActiveProject(data)
                if(data.errors && data.errors.length > 0){
                     toast.error(`${data.errors.length} revision patch(es) failed`);
                }else{
                   toast.success(`Updated to version ${data.version}`); 
                }
            } catch (err) {
                console.error("Revision request failed:", err);
                toast.error(err?.response?.data?.error || "Revision request failed");
            }finally{
                setChatLoading(false)
            }
        },[activeProject, user]
       )

    // Debounce project file saves to reduce API requests.
    const debouncedSave = React.useMemo(
        ()=>debounce(async (files, id) => {
            try {
                await api.put(`/api/projects/${id}/files`, {files})
            } catch (err) {
                console.error("Failed to auto-save files:", err);
                toast.error("Failed to save code modifications");
            }
        }, 1000),[],
       )

    // Flush pending file changes when the provider unmounts.
    useEffect(()=>{
        return ()=>{
            debouncedSave.flush();
        }
       },[debouncedSave])

    // Schedule updated project files for persistence.
    const updateProjectFiles = useCallback(
        async (files) => {
            if(!activeProject || !user) return;
            debouncedSave(files, activeProject._id)
        },[activeProject, user, debouncedSave]
       )

    // Expose shared state and actions through the context provider.
    return (
        <AppContext.Provider value={{
            user,
            loadingUser,
            login,
            register,
            projects,
            loadingProjects,
            activeProject,
            loadingActiveProject,
            chatLoading,
            generatingProject,
            activeFile,
            showCode,
            setActiveFile,
            setShowCode,
            loadProjects,
            loadProject,
            handleGenerate,
            handleDelete,
            logout,
            updateProjectFiles,
            handleChat
        }}>
            {children}
        </AppContext.Provider>
    )
}

// Access the shared application context from child components.
export function useAppContext(){
    const context = useContext(AppContext);
    if(context === undefined){
        throw new Error("useAppContext must be used within an AppContextProvider");
    }
    return context;
}