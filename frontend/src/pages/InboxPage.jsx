import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api.js';
import { queryKeys, queryPresets } from '../lib/queryClient.js';
import './InboxPage.css';

const QUEUES = [
	{ key: 'AUTO', label: 'Automático' },
	{ key: 'HUMAN', label: 'Atención humana' },
	{ key: 'PAYMENT_REVIEW', label: 'Comprobantes' },
];

const QUICK_EMOJIS = [
	'😊', '😂', '😍', '😉', '👍', '🙏',
	'❤️', '🔥', '🎉', '😮', '😢', '🤝',
	'✨', '💬', '📦', '🛍️', '✅', '🙌',
];

const MEDIA_PLACEHOLDER_BODIES = new Set([
	'[Audio recibido]',
	'[Imagen recibida]',
	'[Video recibido]',
	'[Sticker recibido]',
]);

function isDocumentVisible() {
	if (typeof document === 'undefined') return true;
	return !document.hidden;
}

function getMediaKind(message = {}) {
	const type = String(message.type || '').toLowerCase();
	const mime = String(message.attachmentMimeType || '').toLowerCase();

	if (type === 'audio' || mime.startsWith('audio/')) return 'audio';
	if (type === 'image' || mime.startsWith('image/')) return 'image';
	if (type === 'video' || mime.startsWith('video/')) return 'video';
	if (type === 'document') return 'document';
	if (type === 'sticker') return mime.startsWith('image/') ? 'image' : 'file';
	if (mime === 'application/pdf') return 'document';
	if (message.attachmentUrl) return 'file';

	return null;
}

function shouldHideBodyBecauseItIsOnlyPlaceholder(message = {}) {
	const body = String(message.body || '').trim();

	if (!body) return true;
	if (!message.attachmentUrl && !message.rawPayload) return false;
	if (MEDIA_PLACEHOLDER_BODIES.has(body)) return true;
	if (body.startsWith('[Documento recibido')) return true;

	return false;
}

function firstUrlFromText(text = '') {
	const match = String(text || '').match(/https?:\/\/[^\s]+/i);
	return match ? match[0] : '';
}

function splitPromoBody(text = '') {
	const lines = String(text || '').split('\n');
	let actionLabel = '';
	const cleanLines = [];

	for (const rawLine of lines) {
		const line = String(rawLine || '').trim();

		if (!line) {
			cleanLines.push(rawLine);
			continue;
		}

		if (line.startsWith('[URL]')) {
			actionLabel = line.replace('[URL]', '').trim() || 'Ver promo';
			continue;
		}

		cleanLines.push(rawLine);
	}

	return {
		bodyText: cleanLines.join('\n').trim(),
		actionLabel,
	};
}

function resolveRawButtonUrl(rawPayload = null) {
	if (!rawPayload || typeof rawPayload !== 'object') return '';

	return (
		rawPayload?.buttonUrl ||
		rawPayload?.ctaUrl ||
		rawPayload?.url ||
		rawPayload?.templateButtonUrl ||
		rawPayload?.campaignButtonUrl ||
		rawPayload?.attachment?.url ||
		rawPayload?.interactive?.action?.parameters?.url ||
		''
	);
}

function resolveMessageAttachmentUrl(message = {}) {
	if (message.attachmentUrl) return message.attachmentUrl;

	const rawPayload = message.rawPayload || {};
	return (
		rawPayload?.imageUrl ||
		rawPayload?.headerImageUrl ||
		rawPayload?.mediaUrl ||
		rawPayload?.attachmentUrl ||
		rawPayload?.attachment?.url ||
		rawPayload?.templateHeaderImageUrl ||
		''
	);
}

function resolvePromoAction(message = {}) {
	const body = String(message.body || '');
	const rawPayload = message.rawPayload || {};
	const { bodyText, actionLabel } = splitPromoBody(body);

	return {
		bodyText,
		actionLabel,
		url: resolveRawButtonUrl(rawPayload) || firstUrlFromText(body),
	};
}

function renderFormattedText(text = '') {
	const value = String(text || '');
	if (!value) return null;

	const lines = value.split('\n');

	return lines.map((line, lineIndex) => {
		const parts = line.split(/(https?:\/\/[^\s]+|\*\*[^*]+\*\*)/gi);

		return (
			<span key={`line-${lineIndex}`}>
				{parts.map((part, index) => {
					if (/^https?:\/\/[^\s]+$/i.test(part)) {
						return (
							<a
								key={`link-${lineIndex}-${index}`}
								href={part}
								target="_blank"
								rel="noreferrer"
								style={{
									color: '#2563eb',
									textDecoration: 'underline',
									wordBreak: 'break-word',
								}}
							>
								{part}
							</a>
						);
					}

					if (/^\*\*[^*]+\*\*$/i.test(part)) {
						return (
							<strong key={`strong-${lineIndex}-${index}`}>
								{part.slice(2, -2)}
							</strong>
						);
					}

					return (
						<span
							key={`text-${lineIndex}-${index}`}
							style={{
								whiteSpace: 'pre-wrap',
								wordBreak: 'break-word',
							}}
						>
							{part}
						</span>
					);
				})}
				{lineIndex < lines.length - 1 ? <br /> : null}
			</span>
		);
	});
}

function AttachmentPreview({ message }) {
	const mediaKind = getMediaKind(message);
	const attachmentUrl = resolveMessageAttachmentUrl(message);
	const attachmentName = String(message.attachmentName || '').trim();

	if (!mediaKind || !attachmentUrl) return null;

	if (mediaKind === 'audio') {
		return (
			<div style={{ marginTop: 10 }}>
				<audio controls preload="none" src={attachmentUrl} style={{ width: '100%', maxWidth: 320 }}>
					Tu navegador no soporta audio HTML5.
				</audio>
			</div>
		);
	}

	if (mediaKind === 'image') {
		return (
			<div style={{ marginTop: 10 }}>
				<a href={attachmentUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block' }}>
					<img
						src={attachmentUrl}
						alt={attachmentName || 'Imagen recibida'}
						loading="lazy"
						style={{
							display: 'block',
							maxWidth: '100%',
							width: 'min(330px, 100%)',
							borderRadius: 18,
							border: '1px solid rgba(15, 23, 42, 0.08)',
							boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
						}}
					/>
				</a>
			</div>
		);
	}

	if (mediaKind === 'video') {
		return (
			<div style={{ marginTop: 10 }}>
				<video
					controls
					preload="metadata"
					src={attachmentUrl}
					style={{
						display: 'block',
						maxWidth: '100%',
						width: 'min(330px, 100%)',
						borderRadius: 18,
						border: '1px solid rgba(15, 23, 42, 0.08)',
						background: '#000',
					}}
				>
					Tu navegador no soporta video HTML5.
				</video>
			</div>
		);
	}

	if (mediaKind === 'document' || mediaKind === 'file') {
		return (
			<div
				style={{
					marginTop: 10,
					padding: '12px 14px',
					borderRadius: 16,
					background: 'rgba(15, 23, 42, 0.05)',
					border: '1px solid rgba(15, 23, 42, 0.08)',
				}}
			>
				<div
					style={{
						fontSize: 13,
						fontWeight: 700,
						color: '#0f172a',
						marginBottom: 6,
					}}
				>
					{attachmentName || 'Archivo adjunto'}
				</div>

				<a
					href={attachmentUrl}
					target="_blank"
					rel="noreferrer"
					style={{
						fontSize: 13,
						fontWeight: 600,
						color: '#2563eb',
						textDecoration: 'underline',
						wordBreak: 'break-word',
					}}
				>
					Abrir archivo
				</a>
			</div>
		);
	}

	return null;
}

function MessageBubble({ message }) {
	const isOutbound = message.direction === 'OUTBOUND';
	const hideBody = shouldHideBodyBecauseItIsOnlyPlaceholder(message);
	const bubbleBackground = isOutbound ? '#d9fdd3' : '#ffffff';
	const bubbleBorder = isOutbound
		? '1px solid rgba(34, 197, 94, 0.14)'
		: '1px solid rgba(15, 23, 42, 0.08)';

	const promo = resolvePromoAction(message);
	const hasPromoButton = Boolean(promo.actionLabel);
	const attachmentUrl = resolveMessageAttachmentUrl(message);

	return (
		<div
			style={{
				display: 'flex',
				justifyContent: isOutbound ? 'flex-end' : 'flex-start',
				marginBottom: 12,
			}}
		>
			<div
				style={{
					maxWidth: '78%',
					minWidth: 140,
					borderRadius: 18,
					background: bubbleBackground,
					border: bubbleBorder,
					boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)',
					overflow: 'hidden',
				}}
			>
				<div style={{ padding: '10px 12px 8px' }}>
					<AttachmentPreview message={message} />

					{!hideBody || hasPromoButton ? (
						<div
							style={{
								fontSize: 15,
								lineHeight: 1.45,
								color: '#0f172a',
								marginTop: attachmentUrl ? 10 : 0,
							}}
						>
							{renderFormattedText(hasPromoButton ? promo.bodyText : message.body)}
						</div>
					) : null}

					{hasPromoButton ? (
						promo.url ? (
							<a
								href={promo.url}
								target="_blank"
								rel="noreferrer"
								style={{
									marginTop: 12,
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									gap: 8,
									padding: '10px 12px',
									borderRadius: 12,
									background: '#ffffff',
									border: '1px solid rgba(22, 163, 74, 0.18)',
									color: '#128c7e',
									fontWeight: 700,
									textDecoration: 'none',
								}}
							>
								↗ {promo.actionLabel}
							</a>
						) : (
							<div
								style={{
									marginTop: 12,
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									padding: '10px 12px',
									borderRadius: 12,
									background: '#ffffff',
									border: '1px solid rgba(22, 163, 74, 0.18)',
									color: '#128c7e',
									fontWeight: 700,
								}}
							>
								{promo.actionLabel}
							</div>
						)
					) : null}

					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 8,
							flexWrap: 'wrap',
							marginTop: 10,
							fontSize: 12,
							color: '#475569',
						}}
					>
						<span
							style={{
								padding: '3px 8px',
								borderRadius: 999,
								background: 'rgba(15, 23, 42, 0.06)',
								fontWeight: 700,
							}}
						>
							{message.senderName || (isOutbound ? 'Lummine' : 'Cliente')}
						</span>

						<span>{message.createdAtLabel || ''}</span>
					</div>
				</div>
			</div>
		</div>
	);
}

function ActionButton({ children, danger = false, active = false, disabled = false, onClick }) {
	const className = [
		'inbox-action-btn',
		active ? 'inbox-action-btn--active' : '',
		danger ? 'inbox-action-btn--danger' : '',
	]
		.filter(Boolean)
		.join(' ');

	return (
		<button type="button" onClick={onClick} disabled={disabled} className={className}>
			{children}
		</button>
	);
}

export default function InboxPage() {
	const queryClient = useQueryClient();
	const messagesContainerRef = useRef(null);
	const emojiPickerRef = useRef(null);
	const textareaRef = useRef(null);

	const [queue, setQueue] = useState('AUTO');
	const [showArchived, setShowArchived] = useState(false);
	const [showEmojiPicker, setShowEmojiPicker] = useState(false);
	const [selectedConversationId, setSelectedConversationId] = useState(null);
	const [messageText, setMessageText] = useState('');

	const inboxQuery = useQuery({
		queryKey: [...queryKeys.inbox(queue), showArchived ? 'archived' : 'active'],
		queryFn: async () => {
			const res = await api.get('/dashboard/inbox', {
				params: {
					queue,
					archived: showArchived,
				},
			});

			return res.data;
		},
		placeholderData: (previousData) => previousData,
		refetchInterval: () => (isDocumentVisible() ? 5000 : false),
		refetchIntervalInBackground: false,
		...queryPresets.inbox,
	});

	const contacts = inboxQuery.data?.contacts || [];
	const counts = inboxQuery.data?.counts || {
		AUTO: 0,
		HUMAN: 0,
		PAYMENT_REVIEW: 0,
	};

	useEffect(() => {
		if (!contacts.length) {
			setSelectedConversationId(null);
			return;
		}

		const stillExists = contacts.some(
			(contact) => contact.conversationId === selectedConversationId
		);

		if (stillExists) return;

		const preferredId =
			inboxQuery.data?.selectedContact?.conversationId ||
			contacts[0]?.conversationId ||
			null;

		setSelectedConversationId(preferredId);
	}, [contacts, selectedConversationId, inboxQuery.data]);

	const conversationQuery = useQuery({
		queryKey: queryKeys.conversation(selectedConversationId),
		queryFn: async () => {
			const res = await api.get(`/dashboard/conversations/${selectedConversationId}/messages`);
			return res.data;
		},
		enabled: Boolean(selectedConversationId),
		placeholderData: (previousData) => previousData,
		refetchInterval: () =>
			selectedConversationId && isDocumentVisible() ? 3000 : false,
		refetchIntervalInBackground: false,
		...queryPresets.conversation,
	});

	const conversation = conversationQuery.data?.conversation || null;

	const activeContact = useMemo(() => {
		return (
			contacts.find(
				(contact) => contact.conversationId === selectedConversationId
			) || null
		);
	}, [contacts, selectedConversationId]);

	useEffect(() => {
		const el = messagesContainerRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
	}, [conversation?.messages?.length, selectedConversationId]);

	useEffect(() => {
		function handleOutsideClick(event) {
			if (!emojiPickerRef.current) return;

			if (!emojiPickerRef.current.contains(event.target)) {
				setShowEmojiPicker(false);
			}
		}

		document.addEventListener('mousedown', handleOutsideClick);
		return () => document.removeEventListener('mousedown', handleOutsideClick);
	}, []);

	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;

		el.style.height = '24px';
		el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
	}, [messageText]);

	const invalidateInboxAndConversation = async (
		conversationId = selectedConversationId
	) => {
		await queryClient.invalidateQueries({
			queryKey: ['dashboard', 'inbox'],
		});

		if (conversationId) {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.conversation(conversationId),
			});
		}
	};

	const sendMessageMutation = useMutation({
		mutationFn: async () => {
			const body = messageText.trim();
			if (!selectedConversationId || !body) return;

			await api.post(`/dashboard/conversations/${selectedConversationId}/messages`, {
				body,
			});
		},
		onSuccess: async () => {
			setMessageText('');
			setShowEmojiPicker(false);
			await invalidateInboxAndConversation();
		},
		onError: (error) => {
			console.error(error);
		},
	});

	const moveQueueMutation = useMutation({
		mutationFn: async (nextQueue) => {
			if (!selectedConversationId) return null;

			const res = await api.patch(
				`/dashboard/conversations/${selectedConversationId}/queue`,
				{ queue: nextQueue }
			);

			return { nextQueue, data: res.data };
		},
		onSuccess: async (result) => {
			if (!result) return;

			await queryClient.invalidateQueries({
				queryKey: ['dashboard', 'inbox'],
			});

			await queryClient.invalidateQueries({
				queryKey: queryKeys.conversation(selectedConversationId),
			});

			if (result.nextQueue !== queue) {
				setSelectedConversationId(null);
			}
		},
		onError: (error) => {
			console.error(error);
		},
	});

	const resetContextMutation = useMutation({
		mutationFn: async () => {
			if (!selectedConversationId) return;
			await api.patch(
				`/dashboard/conversations/${selectedConversationId}/reset-context`
			);
		},
		onSuccess: async () => {
			await invalidateInboxAndConversation();
		},
		onError: (error) => {
			console.error(error);
		},
	});

	const clearHistoryMutation = useMutation({
		mutationFn: async () => {
			if (!selectedConversationId) return;
			await api.delete(`/dashboard/conversations/${selectedConversationId}/history`);
		},
		onSuccess: async () => {
			await invalidateInboxAndConversation();
		},
		onError: (error) => {
			console.error(error);
		},
	});

	const archiveConversationMutation = useMutation({
		mutationFn: async (archived) => {
			if (!selectedConversationId) return;
			await api.patch(
				`/dashboard/conversations/${selectedConversationId}/archive`,
				{ archived }
			);
		},
		onSuccess: async () => {
			setSelectedConversationId(null);
			await queryClient.invalidateQueries({
				queryKey: ['dashboard', 'inbox'],
			});
		},
		onError: (error) => {
			console.error(error);
		},
	});

	const deduplicateContactsMutation = useMutation({
		mutationFn: async () => {
			const res = await api.post('/dashboard/inbox/deduplicate');
			return res.data;
		},
		onSuccess: async (data) => {
			setSelectedConversationId(null);

			await queryClient.invalidateQueries({
				queryKey: ['dashboard', 'inbox'],
			});

			window.alert(
				`Deduplicación lista.\n\nGrupos fusionados: ${data?.mergedGroups || 0}\nConversaciones removidas: ${data?.removedConversations || 0}\nContactos removidos: ${data?.removedContacts || 0}\nMensajes movidos: ${data?.movedMessages || 0}`
			);
		},
		onError: (error) => {
			console.error(error);
		},
	});

	function handleSubmit(event) {
		event.preventDefault();
		if (!messageText.trim()) return;
		sendMessageMutation.mutate();
	}

	function handleMoveQueue(nextQueue) {
		moveQueueMutation.mutate(nextQueue);
	}

	function insertEmoji(emoji) {
		setMessageText((prev) => `${prev}${emoji}`);
		setShowEmojiPicker(false);
	}

	function handleComposerKeyDown(event) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();

			if (messageText.trim() && !sendMessageMutation.isPending) {
				sendMessageMutation.mutate();
			}
		}
	}

	return (
		<div className="inbox-page">
			<aside className="inbox-sidebar">
				<div className="inbox-queue-tabs">
					{QUEUES.map((item) => {
						const isActive = queue === item.key;

						return (
							<ActionButton
								key={item.key}
								active={isActive}
								disabled={inboxQuery.isFetching && isActive}
								onClick={() => {
									setQueue(item.key);
									setSelectedConversationId(null);
								}}
							>
								{item.label} · {counts[item.key] || 0}
							</ActionButton>
						);
					})}
				</div>

				<div className="inbox-section-header">
					<div className="inbox-section-title">
						Conversaciones
						{inboxQuery.isFetching ? (
							<span className="inbox-section-subtle">Actualizando...</span>
						) : null}
					</div>

					<div className="inbox-section-actions">
						<ActionButton
							active={showArchived}
							onClick={() => {
								setSelectedConversationId(null);
								setShowArchived((prev) => !prev);
							}}
						>
							{showArchived ? 'Ver activos' : 'Archivados'}
						</ActionButton>

						<ActionButton
							disabled={deduplicateContactsMutation.isPending}
							onClick={() => {
								const confirmed = window.confirm(
									'Esto va a fusionar contactos y conversaciones duplicadas del inbox. ¿Continuar?'
								);

								if (confirmed) {
									deduplicateContactsMutation.mutate();
								}
							}}
						>
							{deduplicateContactsMutation.isPending
								? 'Deduplicando...'
								: 'Deduplicar'}
						</ActionButton>
					</div>
				</div>

				<div className="inbox-contacts-scroll">
					{inboxQuery.isLoading ? (
						<div className="inbox-empty">Cargando conversaciones...</div>
					) : null}

					{!inboxQuery.isLoading && !contacts.length ? (
						<div className="inbox-empty">
							{showArchived
								? 'No hay conversaciones archivadas.'
								: 'No hay conversaciones en esta bandeja.'}
						</div>
					) : null}

					{contacts.map((contact) => {
						const isSelected = contact.conversationId === selectedConversationId;

						return (
							<button
								key={contact.conversationId}
								type="button"
								onClick={() => setSelectedConversationId(contact.conversationId)}
								className={`inbox-contact-card ${
									isSelected ? 'inbox-contact-card--selected' : ''
								}`}
							>
								<div className="inbox-contact-row">
									<div
										className="inbox-contact-avatar"
										style={
											contact.avatar?.style
												? {
														background: undefined,
														backgroundImage: contact.avatar.style
															.replace('background:', '')
															.replace(/;$/, ''),
													}
												: { background: '#94a3b8' }
										}
									>
										{contact.avatar?.initials || '?'}
									</div>

									<div className="inbox-contact-content">
										<div className="inbox-contact-top">
											<div className="inbox-contact-name">
												{contact.displayName}
											</div>

											<div className="inbox-contact-time">
												{contact.lastMessageTime || ''}
											</div>
										</div>

										<div className="inbox-contact-phone">
											{contact.phoneDisplay || 'Sin teléfono'}
										</div>

										<div className="inbox-contact-preview">
											{contact.preview || 'Sin mensajes'}
										</div>
									</div>
								</div>
							</button>
						);
					})}
				</div>
			</aside>

			<section className="inbox-chat-panel">
				{!selectedConversationId ? (
					<div className="inbox-chat-empty">Seleccioná una conversación</div>
				) : (
					<>
						<div className="inbox-chat-header">
							<div className="inbox-chat-header-top">
								<div>
									<div className="inbox-chat-title">
										{conversation?.contact?.name ||
											activeContact?.displayName ||
											'Sin nombre'}
									</div>
									<div className="inbox-chat-subtitle">
										{conversation?.contact?.phone ||
											activeContact?.phoneDisplay ||
											'Sin teléfono'}
									</div>
								</div>

								<div className="inbox-badges">
									<span className="inbox-badge inbox-badge--neutral">
										{conversation?.queue || activeContact?.queue || queue}
									</span>

									<span
										className={`inbox-badge ${
											conversation?.aiEnabled
												? 'inbox-badge--ai'
												: 'inbox-badge--human'
										}`}
									>
										{conversation?.aiEnabled ? 'IA activa' : 'Humano'}
									</span>
								</div>
							</div>

							<div className="inbox-actions">
								<ActionButton
									active={conversation?.queue === 'AUTO'}
									disabled={moveQueueMutation.isPending || showArchived}
									onClick={() => handleMoveQueue('AUTO')}
								>
									Automático
								</ActionButton>

								<ActionButton
									active={conversation?.queue === 'HUMAN'}
									disabled={moveQueueMutation.isPending || showArchived}
									onClick={() => handleMoveQueue('HUMAN')}
								>
									Atención humana
								</ActionButton>

								<ActionButton
									active={conversation?.queue === 'PAYMENT_REVIEW'}
									disabled={moveQueueMutation.isPending || showArchived}
									onClick={() => handleMoveQueue('PAYMENT_REVIEW')}
								>
									Comprobantes
								</ActionButton>

								<div className="inbox-actions-spacer" />

								<ActionButton
									disabled={
										archiveConversationMutation.isPending || !selectedConversationId
									}
									onClick={() => {
										const confirmed = window.confirm(
											showArchived
												? 'Este chat va a volver a la bandeja activa. ¿Continuar?'
												: 'Este chat se va a sacar del inbox, pero no se va a borrar. ¿Continuar?'
										);

										if (confirmed) {
											archiveConversationMutation.mutate(!showArchived);
										}
									}}
								>
									{archiveConversationMutation.isPending
										? showArchived
											? 'Restaurando...'
											: 'Archivando...'
										: showArchived
											? 'Desarchivar'
											: 'Archivar chat'}
								</ActionButton>

								<ActionButton
									danger
									disabled={
										resetContextMutation.isPending ||
										!selectedConversationId ||
										showArchived
									}
									onClick={() => resetContextMutation.mutate()}
								>
									Reiniciar IA
								</ActionButton>

								<ActionButton
									danger
									disabled={
										clearHistoryMutation.isPending ||
										!selectedConversationId ||
										showArchived
									}
									onClick={() => {
										const confirmed = window.confirm(
											'Esto va a borrar el historial y limpiar el contexto de esta conversación. ¿Continuar?'
										);

										if (confirmed) {
											clearHistoryMutation.mutate();
										}
									}}
								>
									Borrar historial
								</ActionButton>
							</div>
						</div>

						<div ref={messagesContainerRef} className="inbox-messages">
							{conversationQuery.isLoading ? (
								<div className="inbox-empty">Cargando mensajes...</div>
							) : null}

							{!conversationQuery.isLoading &&
							(conversation?.messages || []).length === 0 ? (
								<div className="inbox-empty">
									Esta conversación todavía no tiene mensajes.
								</div>
							) : null}

							{(conversation?.messages || []).map((msg) => (
								<MessageBubble key={msg.id} message={msg} />
							))}
						</div>

						{!showArchived ? (
							<div className="inbox-composer-shell">
								<form onSubmit={handleSubmit} className="inbox-composer">
									<div className="inbox-composer-leading" ref={emojiPickerRef}>
										<button
											type="button"
											className="inbox-emoji-trigger"
											onClick={() => setShowEmojiPicker((prev) => !prev)}
											title="Emoji"
										>
											😊
										</button>

										{showEmojiPicker ? (
											<div className="inbox-emoji-picker">
												<div className="inbox-emoji-title">Elegí un emoji</div>

												<div className="inbox-emoji-grid">
													{QUICK_EMOJIS.map((emoji) => (
														<button
															key={emoji}
															type="button"
															className="inbox-emoji-btn"
															onClick={() => insertEmoji(emoji)}
														>
															{emoji}
														</button>
													))}
												</div>
											</div>
										) : null}
									</div>

									<textarea
										ref={textareaRef}
										value={messageText}
										onChange={(event) => setMessageText(event.target.value)}
										onKeyDown={handleComposerKeyDown}
										placeholder="Escribe un mensaje"
										rows={1}
										disabled={sendMessageMutation.isPending}
										className="inbox-textarea"
									/>

									<button
										type="submit"
										disabled={
											sendMessageMutation.isPending || !messageText.trim()
										}
										title="Enviar"
										className="inbox-send-btn"
									>
										➤
									</button>
								</form>
							</div>
						) : (
							<div className="inbox-archived-hint">
								Estás viendo conversaciones archivadas.
							</div>
						)}
					</>
				)}
			</section>
		</div>
	);
}