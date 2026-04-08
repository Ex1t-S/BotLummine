import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { resolveApiUrl } from '../lib/api.js';
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

function toTimestamp(value) {
	if (!value) return 0;
	const time = new Date(value).getTime();
	return Number.isFinite(time) ? time : 0;
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
	const rawPayload = message.rawPayload || {};

	const rawUrl =
		message.attachmentUrl ||
		rawPayload?.imageUrl ||
		rawPayload?.headerImageUrl ||
		rawPayload?.mediaUrl ||
		rawPayload?.attachmentUrl ||
		rawPayload?.attachment?.url ||
		rawPayload?.templateHeaderImageUrl ||
		'';

	return resolveApiUrl(rawUrl);
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
								key={`part-${lineIndex}-${index}`}
								href={part}
								target="_blank"
								rel="noreferrer"
								className="inbox-inline-link"
							>
								{part}
							</a>
						);
					}

					if (/^\*\*[^*]+\*\*$/i.test(part)) {
						return (
							<strong key={`part-${lineIndex}-${index}`}>
								{part.slice(2, -2)}
							</strong>
						);
					}

					return <span key={`part-${lineIndex}-${index}`}>{part}</span>;
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
			<div className="inbox-attachment-card">
				<audio controls className="inbox-audio-player" src={attachmentUrl}>
					Tu navegador no soporta audio HTML5.
				</audio>

				<a
					href={attachmentUrl}
					target="_blank"
					rel="noreferrer"
					className="inbox-attachment-link"
				>
					Abrir audio
				</a>
			</div>
		);
	}

	if (mediaKind === 'image') {
		return (
			<div className="inbox-attachment-card">
				<a href={attachmentUrl} target="_blank" rel="noreferrer">
					<img
						src={attachmentUrl}
						alt={attachmentName || 'Imagen adjunta'}
						className="inbox-image-preview"
					/>
				</a>

				<a
					href={attachmentUrl}
					target="_blank"
					rel="noreferrer"
					className="inbox-attachment-link"
				>
					Abrir imagen
				</a>
			</div>
		);
	}

	if (mediaKind === 'video') {
		return (
			<div className="inbox-attachment-card">
				<video controls className="inbox-video-preview" src={attachmentUrl}>
					Tu navegador no soporta video HTML5.
				</video>

				<a
					href={attachmentUrl}
					target="_blank"
					rel="noreferrer"
					className="inbox-attachment-link"
				>
					Abrir video
				</a>
			</div>
		);
	}

	if (mediaKind === 'document' || mediaKind === 'file') {
		return (
			<div className="inbox-file-card">
				<div className="inbox-file-name">
					{attachmentName || 'Archivo adjunto'}
				</div>

				<a
					href={attachmentUrl}
					target="_blank"
					rel="noreferrer"
					className="inbox-attachment-link"
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
	const promo = resolvePromoAction(message);
	const hasPromoButton = Boolean(promo.actionLabel);

	return (
		<div
			className={`inbox-message-row ${
				isOutbound ? 'inbox-message-row--outbound' : 'inbox-message-row--inbound'
			}`}
		>
			<div
				className={`inbox-message-bubble ${
					isOutbound
						? 'inbox-message-bubble--outbound'
						: 'inbox-message-bubble--inbound'
				}`}
			>
				{!hideBody || hasPromoButton ? (
					<div className="inbox-message-text">
						{renderFormattedText(hasPromoButton ? promo.bodyText : message.body)}
					</div>
				) : null}

				<AttachmentPreview message={message} />

				{hasPromoButton ? (
					promo.url ? (
						<a
							href={promo.url}
							target="_blank"
							rel="noreferrer"
							className="inbox-promo-button"
						>
							↗ {promo.actionLabel}
						</a>
					) : (
						<div className="inbox-promo-button inbox-promo-button--disabled">
							{promo.actionLabel}
						</div>
					)
				) : null}

				<div className="inbox-message-meta">
					<span>{message.senderName || (isOutbound ? 'Lummine' : 'Cliente')}</span>
					<span>{message.createdAtLabel || ''}</span>
				</div>
			</div>
		</div>
	);
}

function ActionButton({
	children,
	danger = false,
	active = false,
	disabled = false,
	onClick,
}) {
	const className = [
		'inbox-action-btn',
		active ? 'inbox-action-btn--active' : '',
		danger ? 'inbox-action-btn--danger' : '',
	]
		.filter(Boolean)
		.join(' ');

	return (
		<button type="button" className={className} disabled={disabled} onClick={onClick}>
			{children}
		</button>
	);
}

export default function InboxPage() {
	const queryClient = useQueryClient();

	const messagesContainerRef = useRef(null);
	const emojiPickerRef = useRef(null);
	const textareaRef = useRef(null);
	const lastInboxSnapshotRef = useRef({});

	const [queue, setQueue] = useState('AUTO');
	const [showArchived, setShowArchived] = useState(false);
	const [showEmojiPicker, setShowEmojiPicker] = useState(false);
	const [selectedConversationId, setSelectedConversationId] = useState(null);
	const [messageText, setMessageText] = useState('');
	const [searchTerm, setSearchTerm] = useState('');
	const [newMessageCounts, setNewMessageCounts] = useState({});

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

	const normalizedSearch = searchTerm.trim().toLowerCase();

	const filteredContacts = useMemo(() => {
		const sorted = [...contacts].sort(
			(a, b) => toTimestamp(b.lastMessageAt) - toTimestamp(a.lastMessageAt)
		);

		if (!normalizedSearch) return sorted;

		return sorted.filter((contact) => {
			const haystack = [
				contact.displayName,
				contact.phoneDisplay,
				contact.preview,
				contact.lastMessageLabel,
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();

			return haystack.includes(normalizedSearch);
		});
	}, [contacts, normalizedSearch]);

	useEffect(() => {
		setNewMessageCounts((prev) => {
			let next = prev;
			let changed = false;
			const seenConversationIds = new Set();

			for (const contact of contacts) {
				const conversationId = contact.conversationId;
				const currentTimestamp = toTimestamp(contact.lastMessageAt);
				const previousTimestamp = lastInboxSnapshotRef.current[conversationId];

				seenConversationIds.add(conversationId);

				if (
					typeof previousTimestamp === 'number' &&
					currentTimestamp > previousTimestamp &&
					conversationId !== selectedConversationId
				) {
					if (next === prev) next = { ...prev };
					next[conversationId] = (next[conversationId] || 0) + 1;
					changed = true;
				}

				lastInboxSnapshotRef.current[conversationId] = currentTimestamp;
			}

			for (const storedConversationId of Object.keys(lastInboxSnapshotRef.current)) {
				if (!seenConversationIds.has(storedConversationId)) {
					delete lastInboxSnapshotRef.current[storedConversationId];
				}
			}

			return changed ? next : prev;
		});
	}, [contacts, selectedConversationId]);

	useEffect(() => {
		if (!selectedConversationId) return;

		setNewMessageCounts((prev) => {
			if (!prev[selectedConversationId]) return prev;
			const next = { ...prev };
			delete next[selectedConversationId];
			return next;
		});
	}, [selectedConversationId]);

	useEffect(() => {
		if (!filteredContacts.length) {
			setSelectedConversationId(null);
			return;
		}

		const stillExists = filteredContacts.some(
			(contact) => contact.conversationId === selectedConversationId
		);

		if (stillExists) return;

		const preferredSelectedId = inboxQuery.data?.selectedContact?.conversationId;
		const preferredExists = filteredContacts.some(
			(contact) => contact.conversationId === preferredSelectedId
		);

		const preferredId =
			(preferredExists ? preferredSelectedId : null) ||
			filteredContacts[0]?.conversationId ||
			null;

		setSelectedConversationId(preferredId);
	}, [filteredContacts, selectedConversationId, inboxQuery.data]);

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
			filteredContacts.find(
				(contact) => contact.conversationId === selectedConversationId
			) ||
			contacts.find(
				(contact) => contact.conversationId === selectedConversationId
			) ||
			null
		);
	}, [filteredContacts, contacts, selectedConversationId]);

	useEffect(() => {
		const el = messagesContainerRef.current;
		if (!el) return;

		const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		const shouldStickToBottom = distanceFromBottom < 120;

		if (shouldStickToBottom || !el.dataset.initialized) {
			el.scrollTop = el.scrollHeight;
			el.dataset.initialized = 'true';
		}
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
			await api.patch(`/dashboard/conversations/${selectedConversationId}/reset-context`);
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
			await api.patch(`/dashboard/conversations/${selectedConversationId}/archive`, {
				archived,
			});
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
			<div className="inbox-shell">
				<aside className="inbox-sidebar">
					<div className="inbox-queue-tabs">
						{QUEUES.map((item) => {
							const isActive = queue === item.key;

							return (
								<button
									key={item.key}
									type="button"
									className={`inbox-queue-tab ${
										isActive ? 'inbox-queue-tab--active' : ''
									}`}
									onClick={() => {
										setQueue(item.key);
										setSelectedConversationId(null);
									}}
								>
									{item.label} · {counts[item.key] || 0}
								</button>
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
								{deduplicateContactsMutation.isPending ? 'Deduplicando...' : 'Deduplicar'}
							</ActionButton>
						</div>
					</div>

					<div className="inbox-search-box">
						<input
							type="text"
							className="inbox-search-input"
							placeholder="Buscar por nombre, teléfono o mensaje..."
							value={searchTerm}
							onChange={(event) => setSearchTerm(event.target.value)}
						/>
					</div>

					<div className="inbox-contacts-list">
						{inboxQuery.isLoading ? (
							<div className="inbox-empty-state">Cargando conversaciones...</div>
						) : null}

						{!inboxQuery.isLoading && !filteredContacts.length ? (
							<div className="inbox-empty-state">
								{showArchived
									? 'No hay conversaciones archivadas.'
									: 'No hay conversaciones en esta bandeja.'}
							</div>
						) : null}

						{filteredContacts.map((contact) => {
							const isSelected = contact.conversationId === selectedConversationId;
							const unreadCount = newMessageCounts[contact.conversationId] || 0;
							const hasUnread = unreadCount > 0;

							return (
								<button
									key={contact.conversationId}
									type="button"
									onClick={() => setSelectedConversationId(contact.conversationId)}
									className={`inbox-contact-card ${
										isSelected ? 'inbox-contact-card--selected' : ''
									} ${hasUnread ? 'inbox-contact-card--unread' : ''}`}
								>
									<div className="inbox-contact-row">
										<div
											className={`inbox-contact-avatar ${
												hasUnread ? 'inbox-contact-avatar--unread' : ''
											}`}
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

											{hasUnread ? <span className="inbox-contact-dot" /> : null}
										</div>

										<div className="inbox-contact-content">
											<div className="inbox-contact-top">
												<div className="inbox-contact-name-row">
													<div className="inbox-contact-name">
														{contact.displayName}
													</div>

													{hasUnread ? (
														<span className="inbox-contact-unread-badge">
															{unreadCount}
														</span>
													) : null}
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
						<div className="inbox-chat-empty">
							<div>
								<div className="inbox-chat-empty-title">
									Seleccioná una conversación
								</div>
								<div className="inbox-chat-empty-text">
									Acá vas a ver los mensajes, archivos y acciones del chat.
								</div>
							</div>
						</div>
					) : (
						<>
							<header className="inbox-chat-header">
								<div className="inbox-chat-header-main">
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

								<div className="inbox-chat-header-right">
									<div className="inbox-chat-status">
										<span className="inbox-status-pill">
											{conversation?.queue || activeContact?.queue || queue}
										</span>

										<span
											className={`inbox-status-pill ${
												conversation?.aiEnabled
													? 'inbox-status-pill--success'
													: 'inbox-status-pill--muted'
											}`}
										>
											{conversation?.aiEnabled ? 'IA activa' : 'Humano'}
										</span>
									</div>

									<div className="inbox-chat-actions">
										<ActionButton
											active={(conversation?.queue || activeContact?.queue) === 'AUTO'}
											disabled={moveQueueMutation.isPending}
											onClick={() => handleMoveQueue('AUTO')}
										>
											Automático
										</ActionButton>

										<ActionButton
											active={(conversation?.queue || activeContact?.queue) === 'HUMAN'}
											disabled={moveQueueMutation.isPending}
											onClick={() => handleMoveQueue('HUMAN')}
										>
											Atención humana
										</ActionButton>

										<ActionButton
											active={
												(conversation?.queue || activeContact?.queue) ===
												'PAYMENT_REVIEW'
											}
											disabled={moveQueueMutation.isPending}
											onClick={() => handleMoveQueue('PAYMENT_REVIEW')}
										>
											Comprobantes
										</ActionButton>

										<ActionButton
											disabled={archiveConversationMutation.isPending}
											onClick={() => {
												const confirmed = window.confirm(
													showArchived
														? 'Este chat va a volver a la bandeja activa. ¿Continuar?'
														: 'Este chat se va a sacar del inbox, pero no se va a borrar.\n¿Continuar?'
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
											disabled={resetContextMutation.isPending}
											onClick={() => resetContextMutation.mutate()}
										>
											Reiniciar IA
										</ActionButton>

										<ActionButton
											danger
											disabled={clearHistoryMutation.isPending}
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
							</header>

							<div className="inbox-messages" ref={messagesContainerRef}>
								{conversationQuery.isLoading ? (
									<div className="inbox-empty-state">Cargando mensajes...</div>
								) : null}

								{!conversationQuery.isLoading &&
								(conversation?.messages || []).length === 0 ? (
									<div className="inbox-empty-state">
										Esta conversación todavía no tiene mensajes.
									</div>
								) : null}

								{(conversation?.messages || []).map((msg) => (
									<MessageBubble key={msg.id} message={msg} />
								))}
							</div>

							{!showArchived ? (
								<div className="inbox-composer-shell">
									<form className="inbox-composer" onSubmit={handleSubmit}>
										<div className="inbox-composer-toolbar" ref={emojiPickerRef}>
											<button
												type="button"
												className="inbox-emoji-toggle"
												onClick={() => setShowEmojiPicker((prev) => !prev)}
												title="Emoji"
											>
												😊
											</button>

											{showEmojiPicker ? (
												<div className="inbox-emoji-picker">
													<div className="inbox-emoji-picker-title">
														Elegí un emoji
													</div>

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
											className="inbox-composer-textarea"
											placeholder="Escribí un mensaje..."
											value={messageText}
											onChange={(event) => setMessageText(event.target.value)}
											onKeyDown={handleComposerKeyDown}
											rows={1}
										/>

										<button
											type="submit"
											className="inbox-send-btn"
											disabled={sendMessageMutation.isPending || !messageText.trim()}
											title={sendMessageMutation.isPending ? 'Enviando...' : 'Enviar'}
										>
											➤
										</button>
									</form>
								</div>
							) : (
								<div className="inbox-archived-hint">
									Este chat está archivado. Desarchivalo para volver a responder.
								</div>
							)}
						</>
					)}
				</section>
			</div>
		</div>
	);
}