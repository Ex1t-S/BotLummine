import { useEffect, useState } from 'react';
import api from '../lib/api.js';

const QUEUES = [
	{ key: 'AUTO', label: 'Automático' },
	{ key: 'HUMAN', label: 'Atención humana' },
	{ key: 'PAYMENT_REVIEW', label: 'Comprobantes' }
];

export default function InboxPage() {
	const [queue, setQueue] = useState('AUTO');
	const [loadingList, setLoadingList] = useState(true);
	const [loadingMessages, setLoadingMessages] = useState(false);
	const [sending, setSending] = useState(false);
	const [movingQueue, setMovingQueue] = useState(false);

	const [contacts, setContacts] = useState([]);
	const [selectedConversationId, setSelectedConversationId] = useState(null);
	const [conversation, setConversation] = useState(null);
	const [messageText, setMessageText] = useState('');
	const [counts, setCounts] = useState({
		AUTO: 0,
		HUMAN: 0,
		PAYMENT_REVIEW: 0
	});

	async function loadInbox(nextQueue = queue) {
		setLoadingList(true);

		try {
			const res = await api.get('/dashboard/inbox', {
				params: { queue: nextQueue }
			});

			const nextContacts = res.data.contacts || [];
			setContacts(nextContacts);
			setCounts(res.data.counts || { AUTO: 0, HUMAN: 0, PAYMENT_REVIEW: 0 });

			const preferredId =
				res.data.selectedContact?.conversationId ||
				nextContacts[0]?.conversationId ||
				null;

			setSelectedConversationId(preferredId);
		} catch (error) {
			console.error(error);
		} finally {
			setLoadingList(false);
		}
	}

	async function loadMessages(conversationId) {
		if (!conversationId) {
			setConversation(null);
			return;
		}

		setLoadingMessages(true);

		try {
			const res = await api.get(`/dashboard/conversations/${conversationId}/messages`);
			setConversation(res.data.conversation || null);
		} catch (error) {
			console.error(error);
			setConversation(null);
		} finally {
			setLoadingMessages(false);
		}
	}

	useEffect(() => {
		loadInbox(queue);
	}, [queue]);

	useEffect(() => {
		loadMessages(selectedConversationId);
	}, [selectedConversationId]);

	async function handleSendMessage(e) {
		e.preventDefault();

		if (!selectedConversationId || !messageText.trim()) return;

		setSending(true);

		try {
			await api.post(`/dashboard/conversations/${selectedConversationId}/messages`, {
				body: messageText
			});

			setMessageText('');
			await loadMessages(selectedConversationId);
			await loadInbox(queue);
		} catch (error) {
			console.error(error);
		} finally {
			setSending(false);
		}
	}

	async function handleMoveQueue(nextQueue) {
		if (!selectedConversationId) return;

		setMovingQueue(true);

		try {
			await api.patch(`/dashboard/conversations/${selectedConversationId}/queue`, {
				queue: nextQueue
			});

			if (queue !== nextQueue) {
				setConversation(null);
				await loadInbox(queue);
			} else {
				await loadInbox(queue);
				await loadMessages(selectedConversationId);
			}
		} catch (error) {
			console.error(error);
		} finally {
			setMovingQueue(false);
		}
	}

	return (
		<div className="inbox-shell">
			<aside className="inbox-sidebar">
				<div className="inbox-queues">
					{QUEUES.map((item) => (
						<button
							key={item.key}
							className={`queue-pill${queue === item.key ? ' active' : ''}`}
							onClick={() => setQueue(item.key)}
							type="button"
						>
							{item.label} <span>{counts[item.key] || 0}</span>
						</button>
					))}
				</div>

				<div className="inbox-list">
					{loadingList ? <p>Cargando conversaciones...</p> : null}

					{contacts.map((contact) => (
						<button
							key={contact.conversationId}
							type="button"
							className={`inbox-contact${selectedConversationId === contact.conversationId ? ' active' : ''}`}
							onClick={() => setSelectedConversationId(contact.conversationId)}
						>
							<div
								className="inbox-avatar"
								style={{ background: contact.avatar?.style?.replace('background:', '') }}
							>
								{contact.avatar?.initials || '?'}
							</div>

							<div className="inbox-contact-copy">
								<div className="inbox-contact-top">
									<strong>{contact.displayName}</strong>
									<span>{contact.lastMessageTime}</span>
								</div>

								<div className="inbox-contact-bottom">
									<span>{contact.phoneDisplay}</span>
								</div>

								<p>{contact.preview || 'Sin mensajes'}</p>
							</div>
						</button>
					))}
				</div>
			</aside>

			<section className="inbox-chat">
				{loadingMessages ? <p>Cargando mensajes...</p> : null}

				{!conversation && !loadingMessages ? (
					<div className="empty-chat">
						<h2>Seleccioná una conversación</h2>
					</div>
				) : null}

				{conversation ? (
					<>
						<div className="chat-header">
							<div>
								<h2>{conversation.contact?.name || 'Sin nombre'}</h2>
								<p>{conversation.contact?.phone || 'Sin teléfono'}</p>
							</div>

							<div className="chat-right-actions">
								<div className="chat-meta">
									<span>{conversation.queue}</span>
									<span>{conversation.aiEnabled ? 'IA activa' : 'Humano'}</span>
								</div>

								<div className="chat-move-buttons">
									<button type="button" disabled={movingQueue} onClick={() => handleMoveQueue('AUTO')}>
										Automático
									</button>
									<button type="button" disabled={movingQueue} onClick={() => handleMoveQueue('HUMAN')}>
										Atención humana
									</button>
									<button type="button" disabled={movingQueue} onClick={() => handleMoveQueue('PAYMENT_REVIEW')}>
										Comprobantes
									</button>
								</div>
							</div>
						</div>

						<div className="chat-messages">
							{(conversation.messages || []).map((msg) => (
								<div
									key={msg.id}
									className={`chat-bubble ${msg.direction === 'OUTBOUND' ? 'outbound' : 'inbound'}`}
								>
									<div className="chat-bubble-body">{msg.body}</div>
									<div className="chat-bubble-meta">{msg.createdAtLabel}</div>
								</div>
							))}
						</div>

						<form className="chat-composer" onSubmit={handleSendMessage}>
							<textarea
								value={messageText}
								onChange={(e) => setMessageText(e.target.value)}
								placeholder="Escribí una respuesta..."
								rows={3}
							/>

							<button type="submit" disabled={sending}>
								{sending ? 'Enviando...' : 'Enviar'}
							</button>
						</form>
					</>
				) : null}
			</section>
		</div>
	);
}