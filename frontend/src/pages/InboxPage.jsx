import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api.js';
import { queryKeys, queryPresets } from '../lib/queryClient.js';

const QUEUES = [
	{ key: 'AUTO', label: 'Automático' },
	{ key: 'HUMAN', label: 'Atención humana' },
	{ key: 'PAYMENT_REVIEW', label: 'Comprobantes' },
];

export default function InboxPage() {
	const queryClient = useQueryClient();

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

	const invalidateInboxAndConversation = async (conversationId = selectedConversationId) => {
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

			await api.post(`/dashboard/conversations/${selectedConversationId}/messages`, {
				body,
			});
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

			return { nextQueue, data: res.data };
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

	function handleSubmit(e) {
		e.preventDefault();
		if (!messageText.trim()) return;
		sendMessageMutation.mutate();
	}

	function handleMoveQueue(nextQueue) {
		moveQueueMutation.mutate(nextQueue);
	}

	return (
		<div className="inbox-page">
			<aside className="inbox-sidebar">
				<div className="inbox-queues">
					{QUEUES.map((item) => {
						const isActive = queue === item.key;

						return (
							<button
								key={item.key}
								type="button"
								className={`queue-tab ${isActive ? 'active' : ''}`}
								onClick={() => setQueue(item.key)}
								disabled={inboxQuery.isFetching && isActive}
							>
								<span>{item.label}</span>
								<strong>{counts[item.key] || 0}</strong>
							</button>
						);
					})}
				</div>

				<div className="inbox-sidebar-header">
					<h2>Conversaciones</h2>
					{inboxQuery.isFetching ? (
						<span className="soft-status">Actualizando...</span>
					) : null}
				</div>

				<div className="inbox-contact-list">
					{inboxQuery.isLoading ? (
						<div className="empty-state">Cargando conversaciones...</div>
					) : null}

					{!inboxQuery.isLoading && !contacts.length ? (
						<div className="empty-state">No hay conversaciones en esta bandeja.</div>
					) : null}

					{contacts.map((contact) => {
						const isSelected =
							contact.conversationId === selectedConversationId;

						return (
							<button
								key={contact.conversationId}
								type="button"
								className={`contact-card ${isSelected ? 'active' : ''}`}
								onClick={() =>
									setSelectedConversationId(contact.conversationId)
								}
							>
								<div
									className="contact-avatar"
									style={{
										background:
											contact.avatar?.style?.replace('background:', '').replace(';', '') ||
											'linear-gradient(135deg,#22c55e,#16a34a)',
									}}
								>
									{contact.avatar?.initials || '?'}
								</div>

								<div className="contact-content">
									<div className="contact-topline">
										<strong className="contact-name">
											{contact.displayName}
										</strong>
										<span className="contact-time">
											{contact.lastMessageTime || ''}
										</span>
									</div>

									<div className="contact-phone">
										{contact.phoneDisplay || 'Sin teléfono'}
									</div>

									<div className="contact-preview">
										{contact.preview || 'Sin mensajes'}
									</div>
								</div>
							</button>
						);
					})}
				</div>
			</aside>

			<section className="chat-panel">
				{!selectedConversationId ? (
					<div className="empty-state large">
						Seleccioná una conversación
					</div>
				) : (
					<>
						<div className="chat-header">
							<div>
								<h2>
									{conversation?.contact?.name ||
										activeContact?.displayName ||
										'Sin nombre'}
								</h2>
								<p>
									{conversation?.contact?.phone ||
										activeContact?.phoneDisplay ||
										'Sin teléfono'}
								</p>
							</div>

							<div className="chat-header-actions">
								<span className="queue-pill">
									{conversation?.queue || activeContact?.queue || queue}
								</span>
								<span className="queue-pill secondary">
									{conversation?.aiEnabled ? 'IA activa' : 'Humano'}
								</span>
							</div>
						</div>

						<div className="chat-toolbar">
							<div className="toolbar-group">
								<button
									type="button"
									onClick={() => handleMoveQueue('AUTO')}
									disabled={moveQueueMutation.isPending}
								>
									Automático
								</button>

								<button
									type="button"
									onClick={() => handleMoveQueue('HUMAN')}
									disabled={moveQueueMutation.isPending}
								>
									Atención humana
								</button>

								<button
									type="button"
									onClick={() => handleMoveQueue('PAYMENT_REVIEW')}
									disabled={moveQueueMutation.isPending}
								>
									Comprobantes
								</button>
							</div>

							<div className="toolbar-group danger-zone">
								<button
									type="button"
									onClick={() => resetContextMutation.mutate()}
									disabled={
										resetContextMutation.isPending || !selectedConversationId
									}
								>
									Reiniciar IA
								</button>

								<button
									type="button"
									onClick={() => {
										const confirmed = window.confirm(
											'Esto va a borrar el historial y limpiar el contexto de esta conversación. ¿Continuar?'
										);

										if (confirmed) {
											clearHistoryMutation.mutate();
										}
									}}
									disabled={
										clearHistoryMutation.isPending || !selectedConversationId
									}
								>
									Borrar historial
								</button>
							</div>
						</div>

						<div className="chat-messages">
							{conversationQuery.isLoading ? (
								<div className="empty-state">Cargando mensajes...</div>
							) : null}

							{!conversationQuery.isLoading &&
							(conversation?.messages || []).length === 0 ? (
								<div className="empty-state">
									Esta conversación todavía no tiene mensajes.
								</div>
							) : null}

							{(conversation?.messages || []).map((msg) => (
								<div
									key={msg.id}
									className={`chat-message ${
										msg.direction === 'OUTBOUND' ? 'outbound' : 'inbound'
									}`}
								>
									<div className="chat-bubble">
										<div className="chat-body">
											{msg.body || 'Mensaje sin texto'}
										</div>
										<div className="chat-meta">
											<span>{msg.senderName || ''}</span>
											<span>{msg.createdAtLabel}</span>
										</div>
									</div>
								</div>
							))}
						</div>

						<form className="chat-form" onSubmit={handleSubmit}>
							<textarea
								value={messageText}
								onChange={(e) => setMessageText(e.target.value)}
								placeholder="Escribí una respuesta..."
								rows={3}
								disabled={sendMessageMutation.isPending}
							/>

							<button
								type="submit"
								disabled={
									sendMessageMutation.isPending || !messageText.trim()
								}
							>
								{sendMessageMutation.isPending ? 'Enviando...' : 'Enviar'}
							</button>
						</form>
					</>
				)}
			</section>
		</div>
	);
}