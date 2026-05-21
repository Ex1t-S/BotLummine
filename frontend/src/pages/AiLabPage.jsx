import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { List, RotateCcw, Send } from 'lucide-react';
import api from '../lib/api.js';
import { ActionButton } from '../components/ui/InternalPage.jsx';
import { useInternalDarkOverrides } from '../hooks/useInternalDarkOverrides.js';
import './AiLabPage.css';

const BLANK_FIXTURE_KEY = 'blank';

function getApiError(error) {
	return error?.response?.data?.error || error?.message || 'Error desconocido';
}

function getInteractivePayload(message = {}) {
	if (String(message.type || '').toLowerCase() !== 'interactive') return null;
	const payload = message.interactivePayload || null;
	return payload && typeof payload === 'object' ? payload : null;
}

function getInteractiveMenuRows(payload = {}) {
	return (payload.sections || [])
		.flatMap((section) =>
			(section?.rows || []).map((row) => ({
				id: row.id,
				title: row.title,
				description: row.description || section.title || '',
			}))
		)
		.filter((row) => row.id && row.title);
}

function renderFormattedText(text = '') {
	return String(text || '').split('\n').map((line, lineIndex, lines) => (
		<span key={`line-${lineIndex}`}>
			{line}
			{lineIndex < lines.length - 1 ? <br /> : null}
		</span>
	));
}

function AiLabInteractiveMenuMessage({ message, isBusy, onSelect }) {
	const payload = getInteractivePayload(message) || {};
	const rows = getInteractiveMenuRows(payload);
	const createdAtLabel = new Date(message.createdAt).toLocaleTimeString('es-ES', {
		hour: '2-digit',
		minute: '2-digit',
	});
	const title = String(payload.headerText || message.provider || 'BladeIA').trim();
	const bodyText = String(payload.bodyText || payload.body || message.text || '').trim();
	const buttonText = String(payload.buttonText || '').trim() || 'Ver opciones';

	return (
		<div className="ai-lab-interactive-menu-card">
			<div className="ai-lab-interactive-menu-content">
				{title ? <div className="ai-lab-interactive-menu-title">{title}</div> : null}
				{bodyText ? (
					<div className="ai-lab-interactive-menu-body">
						{renderFormattedText(bodyText)}
					</div>
				) : null}
				<div className="ai-lab-interactive-menu-time">{createdAtLabel}</div>
			</div>
			<div className="ai-lab-interactive-menu-action" aria-hidden="true">
				<List size={18} strokeWidth={2.4} />
				<span>{buttonText}</span>
			</div>
			{rows.length ? (
				<div className="ai-lab-interactive-menu-options">
					{rows.map((row, index) => (
						<button
							key={row.id}
							type="button"
							className="ai-lab-interactive-menu-option"
							onClick={() => onSelect(row.id)}
							disabled={isBusy}
						>
							<span>{index + 1}</span>
							<strong>{row.title}</strong>
							{row.description ? <small>{row.description}</small> : null}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}

export default function AiLabPage() {
	useInternalDarkOverrides();

	const messagesEndRef = useRef(null);
	const didCreateSessionRef = useRef(false);
	const [session, setSession] = useState(null);
	const [messageText, setMessageText] = useState('');
	const [uiError, setUiError] = useState('');

	const createSessionMutation = useMutation({
		mutationFn: async () => {
			const res = await api.post('/ai-lab/sessions', { fixtureKey: BLANK_FIXTURE_KEY });
			return res.data.session;
		},
		onSuccess: (nextSession) => {
			setUiError('');
			setSession(nextSession);
			setMessageText('');
		},
		onError: (error) => setUiError(`No se pudo iniciar la conversacion: ${getApiError(error)}`),
	});

	const resetSessionMutation = useMutation({
		mutationFn: async () => {
			if (!session?.id) {
				const res = await api.post('/ai-lab/sessions', { fixtureKey: BLANK_FIXTURE_KEY });
				return res.data.session;
			}
			const res = await api.post(`/ai-lab/sessions/${session.id}/reset`, { fixtureKey: BLANK_FIXTURE_KEY });
			return res.data.session;
		},
		onSuccess: (nextSession) => {
			setUiError('');
			setSession(nextSession);
			setMessageText('');
		},
		onError: (error) => setUiError(`No se pudo reiniciar la conversacion: ${getApiError(error)}`),
	});

	const sendMessageMutation = useMutation({
		mutationFn: async (payload = {}) => {
			if (!session?.id) return null;
			const res = await api.post(`/ai-lab/sessions/${session.id}/messages`, {
				body: payload.body || '',
				selectionId: payload.selectionId || '',
			});
			return res.data.session;
		},
		onSuccess: (nextSession) => {
			if (!nextSession) return;
			setUiError('');
			setSession(nextSession);
			setMessageText('');
		},
		onError: (error) => setUiError(`No se pudo enviar el mensaje: ${getApiError(error)}`),
	});

	useEffect(() => {
		if (didCreateSessionRef.current || createSessionMutation.isPending || session?.id) return;
		didCreateSessionRef.current = true;
		createSessionMutation.mutate();
	}, [createSessionMutation, session?.id]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
	}, [session?.messages?.length]);

	const isBusy =
		createSessionMutation.isPending ||
		resetSessionMutation.isPending ||
		sendMessageMutation.isPending;

	function handleSubmit(event) {
		event.preventDefault();
		const cleanMessage = messageText.trim();
		if (!cleanMessage || !session?.id) return;
		sendMessageMutation.mutate({ body: cleanMessage });
	}

	function handleMenuSelection(selectionId) {
		if (!session?.id || !selectionId) return;
		sendMessageMutation.mutate({ selectionId });
	}

	return (
		<div className="ai-lab-page">
			<section className="ai-lab-chat-card">
				<div className="ai-lab-chat-header">
					<div>
						<h1>AI Lab</h1>
						<p>Conversacion nueva de prueba</p>
					</div>
					<ActionButton
						variant="secondary"
						className="ai-lab-reset-btn"
						onClick={() => resetSessionMutation.mutate()}
						disabled={isBusy}
						icon={RotateCcw}
					>
						Reiniciar conversacion
					</ActionButton>
				</div>

				{uiError ? (
					<div className="ai-lab-error" role="alert">
						{uiError}
					</div>
				) : null}

				<div className="ai-lab-chat-body">
					{session?.messages?.length ? (
						session.messages.map((message) => {
							const isAssistant = message.role === 'assistant';
							const interactivePayload = getInteractivePayload(message);
							const createdAtLabel = new Date(message.createdAt).toLocaleTimeString('es-ES', {
								hour: '2-digit',
								minute: '2-digit',
							});

							return (
								<div
									key={message.id}
									className={`ai-lab-message-row ${isAssistant ? 'ai-lab-message-row--outbound' : 'ai-lab-message-row--inbound'}`}
								>
									<div className="ai-lab-message-avatar" aria-hidden="true">
										{isAssistant ? 'IA' : 'CL'}
									</div>
									<div className="ai-lab-message-stack">
										<div className={`ai-lab-bubble ${isAssistant ? 'assistant' : 'user'} ${interactivePayload ? 'ai-lab-bubble--interactive-menu' : ''}`}>
											{interactivePayload ? (
												<AiLabInteractiveMenuMessage
													message={message}
													isBusy={isBusy}
													onSelect={handleMenuSelection}
												/>
											) : (
												<div className="ai-lab-bubble-inner">
													<div className="ai-lab-bubble-text">{message.text}</div>
													<div className="ai-lab-bubble-meta">
														<span>{isAssistant ? 'IA' : 'Cliente'}</span>
														<span>{createdAtLabel}</span>
													</div>
												</div>
											)}
										</div>
									</div>
								</div>
							);
						})
					) : (
						<div className="ai-lab-empty">
							{isBusy ? 'Preparando conversacion...' : 'Escribi un mensaje para empezar la prueba.'}
						</div>
					)}
					{isBusy && session?.messages?.length ? (
						<div className="ai-lab-turn-status" role="status">
							<span aria-hidden="true" />
							Procesando...
						</div>
					) : null}
					<div ref={messagesEndRef} />
				</div>

				<form className="ai-lab-chat-form" onSubmit={handleSubmit}>
					<textarea
						value={messageText}
						onChange={(event) => setMessageText(event.target.value)}
						placeholder="Escribi como si fueras el cliente..."
						rows={2}
						disabled={!session?.id || isBusy}
					/>
					<button type="submit" disabled={!messageText.trim() || !session?.id || isBusy}>
						<Send size={16} strokeWidth={2.2} aria-hidden="true" />
						<span>{sendMessageMutation.isPending ? 'Enviando' : 'Enviar'}</span>
					</button>
				</form>
			</section>
		</div>
	);
}
