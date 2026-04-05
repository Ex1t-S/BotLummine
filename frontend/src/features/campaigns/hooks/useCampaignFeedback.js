import { useCallback, useEffect, useRef, useState } from 'react';

export function useCampaignFeedback(timeoutMs = 3500) {
	const [feedback, setFeedback] = useState(null);
	const timeoutRef = useRef(null);

	const clearFeedback = useCallback(() => {
		setFeedback(null);
		if (timeoutRef.current) {
			window.clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
	}, []);

	const showFeedback = useCallback(
		(type, message) => {
			setFeedback({ type, message });
			if (timeoutRef.current) {
				window.clearTimeout(timeoutRef.current);
			}
			timeoutRef.current = window.setTimeout(() => {
				setFeedback(null);
				timeoutRef.current = null;
			}, timeoutMs);
		},
		[timeoutMs]
	);

	useEffect(() => clearFeedback, [clearFeedback]);

	return {
		feedback,
		showFeedback,
		clearFeedback,
	};
}
