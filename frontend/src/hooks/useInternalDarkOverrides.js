import { useEffect } from 'react';

export function useInternalDarkOverrides() {
	useEffect(() => {
		void import('../styles/internal-dark-overrides.css');
	}, []);
}
