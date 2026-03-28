import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
	const [user, setUser] = useState(null);
	const [loading, setLoading] = useState(true);

	async function refreshMe() {
		try {
			const res = await api.get('/auth/me');
			setUser(res.data.user || null);
		} catch {
			setUser(null);
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		refreshMe();
	}, []);

	async function login(credentials) {
		const res = await api.post('/auth/login', credentials);
		setUser(res.data.user || null);
		return res.data;
	}

	async function logout() {
		await api.post('/auth/logout');
		setUser(null);
	}

	const value = useMemo(() => ({
		user,
		loading,
		login,
		logout,
		refreshMe
	}), [user, loading]);

	return (
		<AuthContext.Provider value={value}>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const ctx = useContext(AuthContext);

	if (!ctx) {
		throw new Error('useAuth debe usarse dentro de AuthProvider');
	}

	return ctx;
}