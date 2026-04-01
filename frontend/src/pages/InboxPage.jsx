import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api.js';
import { queryKeys, queryPresets } from '../lib/queryClient.js';

const QUEUES = [
	{ key: 'AUTO', label: 'Automático' },
	{ key: 'HUMAN', label: 'Atención humana' },
	{ key: 'PAYMENT_REVIEW', label: 'Comprobantes' },
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
	if (!message.attachmentUrl) return false;
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
				<audio
					controls
					preload="none"
					src={attachmentUrl}
					style={{ width: '100%', maxWidth: 320 }}
				>
					Tu navegador no soporta audio HTML5.
				</audio>
			</div>
		);
	}

	if (mediaKind === 'image') {
		return (
			<div style={{ marginTop: 10 }}>
				<a
					href={attachmentUrl}
					target="_blank"
					rel="noreferrer"
					style={{ display: 'inline-block' }}
				>
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
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			style={{
				padding: '10px 14px',
				borderRadius: 12,
				border: danger
					? '1px solid rgba(239, 68, 68, 0.35)'
					: active
						? '1px solid rgba(37, 99, 235, 0.28)'
						: '1px solid rgba(15, 23, 42, 0.12)',
				background: danger
					? '#fff5f5'
					: active
						? '#eff6ff'
						: '#ffffff',
				color: danger ? '#dc2626' : active ? '#1d4ed8' : '#0f172a',
				fontWeight: 700,
				cursor: disabled ? 'not-allowed' : 'pointer',
				opacity: disabled ? 0.6 : 1,
			}}
		>
			{children}
		</button>
	);
}

export default function InboxPage() {
	const queryClient = useQueryClient();
	const messagesContainerRef = useRef(null);

	const [queue, setQueue] = useState('AUTO');
	const [selectedConversationId, setSelectedConversationId] = useState(null);
	const [messageText, setMessageText] = useState('');

	const inboxQuery = useQuery({
		queryKey: queryKeys.inbox(queue),
		queryFn: async () => {
			const res = await api.get('/dashboard/inbox', {
				params: { queue },
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
			const res = await api.get(
				`/dashboard/conversations/${selectedConversationId}/messages`
			);
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

	const invalidateInboxAndConversation = async (
		conversationId = selectedConversationId
	) => {
		await queryClient.invalidateQueries({
			queryKey: queryKeys.inbox(queue),
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

			await api.post(
				`/dashboard/conversations/${selectedConversationId}/messages`,
				{ body }
			);
		},
		onSuccess: async () => {
			setMessageText('');
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

			return {
				nextQueue,
				data: res.data,
			};
		},
		onSuccess: async (result) => {
			if (!result) return;

			await queryClient.invalidateQueries({
				queryKey: queryKeys.inbox(queue),
			});

			await queryClient.invalidateQueries({
				queryKey: queryKeys.inbox(result.nextQueue),
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
			await api.delete(
				`/dashboard/conversations/${selectedConversationId}/history`
			);
		},
		onSuccess: async () => {
			await invalidateInboxAndConversation();
		},
		onError: (error) => {
			console.error(error);
		},
	});
		const archiveConversationMutation = useMutation({
			mutationFn: async () => {
				if (!selectedConversationId) return;

				await api.patch(
					`/dashboard/conversations/${selectedConversationId}/archive`,
					{ archived: true }
				);
			},
			onSuccess: async () => {
				const archivedConversationId = selectedConversationId;

				setSelectedConversationId(null);

				await queryClient.invalidateQueries({
					queryKey: ['dashboard', 'inbox'],
				});

				if (archivedConversationId) {
					await queryClient.invalidateQueries({
						queryKey: queryKeys.conversation(archivedConversationId),
					});
				}
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
	function handleComposerKeyDown(event) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();

			if (messageText.trim() && !sendMessageMutation.isPending) {
				sendMessageMutation.mutate();
			}
		}
	}
	return (
		<div
			style={{
				display: 'grid',
				gridTemplateColumns: '320px minmax(0, 1fr)',
				gap: 16,
				minHeight: '78vh',
			}}
		>
			<aside
				style={{
					background: '#ffffff',
					border: '1px solid rgba(15, 23, 42, 0.08)',
					borderRadius: 20,
					padding: 16,
					display: 'flex',
					flexDirection: 'column',
					minHeight: 0,
				}}
			>
				<div
					style={{
						display: 'flex',
						flexWrap: 'wrap',
						gap: 8,
						marginBottom: 14,
					}}
				>
					{QUEUES.map((item) => {
						const isActive = queue === item.key;

						return (
							<ActionButton
								key={item.key}
								active={isActive}
								disabled={inboxQuery.isFetching && isActive}
								onClick={() => setQueue(item.key)}
							>
								{item.label} · {counts[item.key] || 0}
							</ActionButton>
						);
					})}
				</div>

				<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: 10,
					marginBottom: 12,
				}}
			>
				<div
					style={{
						fontSize: 14,
						fontWeight: 700,
						color: '#0f172a',
					}}
				>
					Conversaciones
					{inboxQuery.isFetching ? (
						<span
							style={{
								marginLeft: 8,
								fontSize: 12,
								fontWeight: 600,
								color: '#64748b',
							}}
						>
							Actualizando...
						</span>
					) : null}
				</div>

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

				<div
					style={{
						overflowY: 'auto',
						display: 'flex',
						flexDirection: 'column',
						gap: 10,
					}}
				>
					{inboxQuery.isLoading ? (
						<div style={{ color: '#64748b', fontSize: 14 }}>
							Cargando conversaciones...
						</div>
					) : null}

					{!inboxQuery.isLoading && !contacts.length ? (
						<div style={{ color: '#64748b', fontSize: 14 }}>
							No hay conversaciones en esta bandeja.
						</div>
					) : null}

					{contacts.map((contact) => {
						const isSelected =
							contact.conversationId === selectedConversationId;

						return (
							<button
								key={contact.conversationId}
								type="button"
								onClick={() =>
									setSelectedConversationId(contact.conversationId)
								}
								style={{
									textAlign: 'left',
									padding: 14,
									borderRadius: 16,
									border: isSelected
										? '1px solid rgba(37, 99, 235, 0.28)'
										: '1px solid rgba(15, 23, 42, 0.08)',
									background: isSelected ? '#eff6ff' : '#ffffff',
									cursor: 'pointer',
								}}
							>
								<div
									style={{
										display: 'flex',
										alignItems: 'flex-start',
										gap: 12,
									}}
								>
									<div
										style={{
											width: 42,
											height: 42,
											borderRadius: 999,
											display: 'grid',
											placeItems: 'center',
											color: '#ffffff',
											fontWeight: 700,
											fontSize: 14,
											flexShrink: 0,
											...(contact.avatar?.style
												? {
														background: undefined,
														backgroundImage: contact.avatar.style.replace(
															'background:',
															''
														).replace(/;$/, ''),
													}
												: { background: '#94a3b8' }),
										}}
									>
										{contact.avatar?.initials || '?'}
									</div>

									<div style={{ minWidth: 0, flex: 1 }}>
										<div
											style={{
												display: 'flex',
												justifyContent: 'space-between',
												gap: 10,
												alignItems: 'center',
												marginBottom: 4,
											}}
										>
											<div
												style={{
													fontSize: 14,
													fontWeight: 700,
													color: '#0f172a',
													overflow: 'hidden',
													textOverflow: 'ellipsis',
													whiteSpace: 'nowrap',
												}}
											>
												{contact.displayName}
											</div>

											<div
												style={{
													fontSize: 12,
													color: '#64748b',
													flexShrink: 0,
												}}
											>
												{contact.lastMessageTime || ''}
											</div>
										</div>

										<div
											style={{
												fontSize: 12,
												color: '#64748b',
												marginBottom: 6,
											}}
										>
											{contact.phoneDisplay || 'Sin teléfono'}
										</div>

										<div
											style={{
												fontSize: 13,
												color: '#334155',
												overflow: 'hidden',
												textOverflow: 'ellipsis',
												whiteSpace: 'nowrap',
											}}
										>
											{contact.preview || 'Sin mensajes'}
										</div>
									</div>
								</div>
							</button>
						);
					})}
				</div>
			</aside>

			<section
				style={{
					background: '#ffffff',
					border: '1px solid rgba(15, 23, 42, 0.08)',
					borderRadius: 20,
					display: 'flex',
					flexDirection: 'column',
					minHeight: 0,
					overflow: 'hidden',
				}}
			>
				{!selectedConversationId ? (
					<div
						style={{
							flex: 1,
							display: 'grid',
							placeItems: 'center',
							padding: 24,
							color: '#64748b',
							fontSize: 16,
						}}
					>
						Seleccioná una conversación
					</div>
				) : (
					<>
						<div
							style={{
								padding: '18px 20px 16px',
								borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
							}}
						>
							<div
								style={{
									display: 'flex',
									justifyContent: 'space-between',
									alignItems: 'flex-start',
									gap: 16,
									flexWrap: 'wrap',
								}}
							>
								<div>
									<div
										style={{
											fontSize: 18,
											fontWeight: 800,
											color: '#0f172a',
											marginBottom: 4,
										}}
									>
										{conversation?.contact?.name ||
											activeContact?.displayName ||
											'Sin nombre'}
									</div>

									<div
										style={{
											fontSize: 14,
											color: '#64748b',
										}}
									>
										{conversation?.contact?.phone ||
											activeContact?.phoneDisplay ||
											'Sin teléfono'}
									</div>
								</div>

								<div
									style={{
										display: 'flex',
										gap: 8,
										flexWrap: 'wrap',
										alignItems: 'center',
									}}
								>
									<span
										style={{
											padding: '8px 12px',
											borderRadius: 999,
											background: '#f8fafc',
											border: '1px solid rgba(15, 23, 42, 0.08)',
											fontSize: 12,
											fontWeight: 800,
											color: '#334155',
										}}
									>
										{conversation?.queue || activeContact?.queue || queue}
									</span>

									<span
										style={{
											padding: '8px 12px',
											borderRadius: 999,
											background: conversation?.aiEnabled
												? '#eff6ff'
												: '#fff7ed',
											border: conversation?.aiEnabled
												? '1px solid rgba(37, 99, 235, 0.18)'
												: '1px solid rgba(249, 115, 22, 0.18)',
											fontSize: 12,
											fontWeight: 800,
											color: conversation?.aiEnabled
												? '#1d4ed8'
												: '#c2410c',
										}}
									>
										{conversation?.aiEnabled ? 'IA activa' : 'Humano'}
									</span>
								</div>
							</div>

							<div
								style={{
									display: 'flex',
									flexWrap: 'wrap',
									gap: 10,
									marginTop: 14,
								}}
							>
								<ActionButton
									active={conversation?.queue === 'AUTO'}
									disabled={moveQueueMutation.isPending}
									onClick={() => handleMoveQueue('AUTO')}
								>
									Automático
								</ActionButton>

								<ActionButton
									active={conversation?.queue === 'HUMAN'}
									disabled={moveQueueMutation.isPending}
									onClick={() => handleMoveQueue('HUMAN')}
								>
									Atención humana
								</ActionButton>

								<ActionButton
									active={conversation?.queue === 'PAYMENT_REVIEW'}
									disabled={moveQueueMutation.isPending}
									onClick={() => handleMoveQueue('PAYMENT_REVIEW')}
								>
									Comprobantes
								</ActionButton>

								<div style={{ flex: 1 }} />
								<ActionButton
									disabled={
										archiveConversationMutation.isPending || !selectedConversationId
									}
									onClick={() => {
										const confirmed = window.confirm(
											'Este chat se va a sacar del inbox, pero no se va a borrar. ¿Continuar?'
										);

										if (confirmed) {
											archiveConversationMutation.mutate();
										}
									}}
								>
									{archiveConversationMutation.isPending ? 'Archivando...' : 'Archivar chat'}
								</ActionButton>
								<ActionButton
									danger
									disabled={
										resetContextMutation.isPending || !selectedConversationId
									}
									onClick={() => resetContextMutation.mutate()}
								>
									Reiniciar IA
								</ActionButton>

								<ActionButton
									danger
									disabled={
										clearHistoryMutation.isPending || !selectedConversationId
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

						<div
							ref={messagesContainerRef}
							style={{
								flex: 1,
								overflowY: 'auto',
								padding: 18,
								background: '#f8fafc',
							}}
						>
							{conversationQuery.isLoading ? (
								<div style={{ color: '#64748b', fontSize: 14 }}>
									Cargando mensajes...
								</div>
							) : null}

							{!conversationQuery.isLoading &&
							(conversation?.messages || []).length === 0 ? (
								<div style={{ color: '#64748b', fontSize: 14 }}>
									Esta conversación todavía no tiene mensajes.
								</div>
							) : null}

							{(conversation?.messages || []).map((msg) => (
								<MessageBubble key={msg.id} message={msg} />
							))}
						</div>

						<form
							onSubmit={handleSubmit}
							style={{
								borderTop: '1px solid rgba(15, 23, 42, 0.08)',
								padding: 12,
								background: '#f0f2f5',
							}}
						>
							<div
								style={{
									display: 'flex',
									alignItems: 'flex-end',
									gap: 10,
									background: '#ffffff',
									borderRadius: 28,
									padding: '8px 10px 8px 12px',
									border: '1px solid rgba(15, 23, 42, 0.08)',
								}}
							>
								<button
									type="button"
									style={{
										width: 38,
										height: 38,
										borderRadius: 999,
										border: 'none',
										background: 'transparent',
										fontSize: 22,
										cursor: 'pointer',
										color: '#54656f',
									}}
									title="Emoji"
								>
									😊
								</button>

								<textarea
									value={messageText}
									onChange={(event) => setMessageText(event.target.value)}
									onKeyDown={handleComposerKeyDown}
									placeholder="Escribe un mensaje"
									rows={1}
									disabled={sendMessageMutation.isPending}
									style={{
										flex: 1,
										resize: 'none',
										border: 'none',
										outline: 'none',
										fontSize: 15,
										background: 'transparent',
										padding: '10px 4px',
										minHeight: 24,
										maxHeight: 120,
										lineHeight: 1.4,
									}}
								/>

								<button
									type="submit"
									disabled={sendMessageMutation.isPending || !messageText.trim()}
									title="Enviar"
									style={{
										width: 42,
										height: 42,
										border: 'none',
										borderRadius: 999,
										background:
											sendMessageMutation.isPending || !messageText.trim()
												? '#cbd5e1'
												: '#00a884',
										color: '#ffffff',
										fontSize: 18,
										fontWeight: 800,
										cursor:
											sendMessageMutation.isPending || !messageText.trim()
												? 'not-allowed'
												: 'pointer',
										flexShrink: 0,
									}}
								>
									➤
								</button>
							</div>
						</form>
					</>
				)}
			</section>
		</div>
	);
}