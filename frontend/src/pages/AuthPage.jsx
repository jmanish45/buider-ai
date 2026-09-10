import React, { useState } from 'react'
import LoginLeft from '../components/LoginLeft';
import { Link, useNavigate } from 'react-router-dom';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

const AuthPage = ({ mode }) => {
    const islogin = mode === 'login';  //this means if the mode is login then islogin will be true otherwise false
    const { login, register } = useAppContext()
    // to show loading on button we have to track that
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(''); //this is for error handling if the user enters wrong credentials or any other error occurs
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setshowPassword] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setLoading(true)
        try {
            if (mode==="login") {
                await login(email, password)
            }
            else {
                await register(name, email, password)
            }
            navigate('/')
        }
        catch (err) {
            setError(err.message || (mode==="login" ? "Invalid credentials" : "Email already registered"))
        }
        finally {
            setLoading(false)
        }
    }
    return (
        <div className='min-h-screen bg-white flex text-zinc-900 font-sans'>
            {/* Left Panel */}
            <LoginLeft />
            {/* Right Panel */}
            <div className="flex-1 flex items-center justify-center p-8">
                <div className="w-full max-w-sm">
                    <div className="mb-10">
                        <h1 className='text-4xl font-medium tracking-tight text-zinc-900 mb-1.5 font-sans'>{islogin ? "Sign In" : "Create an account"}</h1>
                        <p className='text-zinc-600 mt-2 text-sm font-normal leading-relaxed'>
                            {islogin ? "Welcome back! Please enter your details." : "Join Builder AI and start creating your website today."}
                        </p>
                    </div>
                    {error && <div className='mb-6 p-3 border border-red-200 bg-red-50 text-red-700 text-xs rounded'>{error}</div>}
                    <form className='space-y-6' onSubmit={handleSubmit}>
                        {!islogin && (
                            <div>
                                <label className='block text-[11px] font-semibold text-zinc-400 uppercase tracking-widest mb-2'>
                                    Full Name
                                </label>
                                <input type="text" value={name} onChange={(e) => setName(e.target.value)} required
                                    className='w-full px-3 py-2 border border-zinc-300 bg-transparent placeholder-zinc-300 rounded outline-none focus:ring-2 focus:ring-primary'
                                    placeholder='Manish Jaiswal'
                                    aria-label='Full Name' />
                            </div>
                        )}
                        <div>
                            <label className='block text-[11px] font-semibold text-zinc-400 uppercase tracking-widest mb-2'>
                                Email
                            </label>
                            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                                className='w-full px-3 py-2 border border-zinc-300 bg-transparent placeholder-zinc-300 rounded outline-none focus:ring-2 focus:ring-primary'
                                placeholder='xyz@gmail.com'
                                aria-label='Email' />
                        </div>

                        <div className='relative'>
                            <label className='block text-[11px] font-semibold text-zinc-400 uppercase tracking-widest mb-2'>
                                Password
                            </label>
                            <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required
                                className='w-full px-3 py-2 border border-zinc-300 bg-transparent placeholder-zinc-300 rounded outline-none focus:ring-2 focus:ring-primary pr-10'
                                placeholder='********'
                                aria-label='Password' />
                            <button type="button" onClick={() => setshowPassword(!showPassword)}
                                className="absolute right-3 top-[38px] text-zinc-400 hover:text-zinc-600 flex items-center justify-center cursor-pointer transition-colors duration-200">
                                {
                                    showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />
                                }
                            </button>
                        </div>

                        <button type="submit" disabled={loading}
                            className='w-full py-2.5 bg-zinc-900 text-white rounded-md font-medium text-sm hover:bg-zinc-800 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed'>
                            {loading ? 'Please wait...' : (islogin ? 'Sign In' : 'Create Account')}
                        </button>
                    </form>
                    <p className="text-sm text-zinc-400 mt-8 pt-6 border-t border-zinc-100 font-sans">
                        {islogin ? (
                            <>
                                New to Builder AI?{" "}
                                <Link to="/register" className='text-zinc-900 font-bold '>Create an account</Link>
                            </>
                        ) : (
                            <>
                                Already have an account?{" "}
                                <Link to="/login" className='text-zinc-900 font-bold '>Sign In</Link>
                            </>
                        )}
                    </p>
                </div>
            </div>
        </div>
    )
}

export default AuthPage