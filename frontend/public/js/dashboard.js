const shell = document.getElementById('adminShell');
const toggle = document.getElementById('sidebarToggle');

if (shell && toggle) {
	toggle.addEventListener('click', () => {
		shell.classList.toggle('sidebar-collapsed');
	});
}

(function initDashboardLiveChat() {
	const pathname = window.location.pathname;
	const isDashboardPage = pathname.startsWith('/dashboard');
	const isAbandonedCartsPage = pathname.startsWith('/dashboard/abandoned-carts');

	if (!isDashboardPage || isAbandonedCartsPage) return;

	const chatBody = document.querySelector('.wa-chat-body');
	const composerForm = document.querySelector('.wa-composer-form');
	const chatTopbar = document.querySelector('.wa-chat-topbar');
	const chatStateCard = document.querySelector('.chat-state-card');

	if (!chatBody || !composerForm) return;

	function extractConversationId() {
		const action = composerForm.getAttribute('action') || '';
		const match = action.match(/\/dashboard\/conversations\/([^/]+)\/reply/);
		return match ? match[1] : null;
	}

	const conversationId = extractConversationId();
	if (!conversationId) return;

	function scrollChatToBottom(force = false) {
		if (!chatBody) return;

		const distanceFromBottom =
			chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight;

		const isNearBottom = distanceFromBottom < 120;

		if (force || isNearBottom) {
			chatBody.scrollTop = chatBody.scrollHeight;
		}
	}

	function escapeHtml(value = '') {
		return String(value ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function normalizeText(value = '') {
		return String(value ?? '').trim();
	}

	function buildQueueLabel(queue) {
		switch (String(queue || '').toUpperCase()) {
			case 'HUMAN':
				return 'Atención humana';
			case 'PAYMENT_REVIEW':
				return 'Comprobantes';
			case 'AUTO':
			default:
				return 'Auto';
		}
	}

	function buildQueueBadgeClass(queue) {
		switch (String(queue || '').toUpperCase()) {
			case 'HUMAN':
				return 'warning';
			case 'PAYMENT_REVIEW':
				return 'info';
			case 'AUTO':
			default:
				return 'success';
		}
	}

	function buildAvatar(name = '', phone = '') {
		const base = (name || phone || '?').trim();
		const parts = base.split(/\s+/).filter(Boolean).slice(0, 2);
		const initials = parts.length
			? parts.map((p) => p[0]?.toUpperCase() || '').join('')
			: '?';

		const palette = [
			'linear-gradient(135deg,#22c55e,#16a34a)',
			'linear-gradient(135deg,#06b6d4,#2563eb)',
			'linear-gradient(135deg,#f97316,#ef4444)',
			'linear-gradient(135deg,#a855f7,#ec4899)',
			'linear-gradient(135deg,#eab308,#84cc16)'
		];

		const index = Math.abs(
			base.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
		) % palette.length;

		return {
			initials,
			style: `background:${palette[index]};`
		};
	}

	let lastRenderedMessageId =
		chatBody.querySelector('.wa-msg-row:last-child')?.dataset?.messageId || null;

	let lastRenderedMessageCount =
		chatBody.querySelectorAll('.wa-msg-row').length || 0;

	let lastKnownLastMessageAt = chatBody.dataset.lastMessageAt || '';
	let lastKnownQueue = chatBody.dataset.queue || '';
	let lastKnownAiEnabled = chatBody.dataset.aiEnabled || '';
	let lastKnownStateSignature = chatBody.dataset.stateSignature || '';

	let refreshInFlight = false;
	let fastPollingInterval = null;
	let fastPollingTimeout = null;

	function updateChatHeader(conversation) {
		if (!chatTopbar) return;

		const contactName = conversation?.contact?.name || 'Sin nombre';
		const phone = conversation?.contact?.phone || '';
		const queue = conversation?.queue || 'AUTO';
		const aiEnabled = !!conversation?.aiEnabled;

		const avatar = buildAvatar(contactName, phone);
		const queueLabel = buildQueueLabel(queue);
		const queueBadgeClass = buildQueueBadgeClass(queue);
		const aiBadgeClass = aiEnabled ? 'success' : 'muted';
		const aiBadgeText = aiEnabled ? 'IA activa' : 'IA pausada';

		const userCopy = chatTopbar.querySelector('.wa-chat-user-copy');
		const avatarEl = chatTopbar.querySelector('.avatar.avatar-lg');

		if (avatarEl) {
			avatarEl.setAttribute('style', avatar.style);
			avatarEl.textContent = avatar.initials;
		}

		if (userCopy) {
			const title = userCopy.querySelector('h2');
			const muted = userCopy.querySelector('.muted');
			const meta = userCopy.querySelector('.chat-top-meta');

			if (title) title.textContent = contactName;
			if (muted) muted.textContent = phone;

			if (meta) {
				meta.innerHTML = `
					<span class="badge badge-${queueBadgeClass}">${escapeHtml(queueLabel)}</span>
					<span class="badge badge-${aiBadgeClass}">${escapeHtml(aiBadgeText)}</span>
				`;
			}
		}
	}

	function updateStateCard(conversation) {
		if (!chatStateCard) return;

		const state = conversation?.state || {};
		const handoffReason = state.handoffReason || 'Sin motivo especial';
		const lastIntent = state.lastDetectedIntent || state.lastIntent || 'general';
		const lastGoal = state.lastUserGoal || 'consulta_general';

		chatStateCard.innerHTML = `
			<div><strong>Motivo:</strong> ${escapeHtml(handoffReason)}</div>
			<div><strong>Última intención:</strong> ${escapeHtml(lastIntent)}</div>
			<div><strong>Objetivo:</strong> ${escapeHtml(lastGoal)}</div>
		`;
	}

	function renderMessages(messages = []) {
		const wasNearBottom =
			chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight < 120;

		if (!messages.length) {
			chatBody.innerHTML = '<div class="empty-list muted">Todavía no hay mensajes.</div>';
		} else {
			chatBody.innerHTML = messages
				.map((msg) => {
					const directionClass = msg.direction === 'OUTBOUND' ? 'out' : 'in';
					const attachment =
						msg.attachmentMimeType || msg.attachmentName
							? `
								<div class="wa-msg-attachment">
									📎 ${escapeHtml(
										msg.attachmentName || msg.attachmentMimeType || 'Adjunto recibido'
									)}
								</div>
							`
							: '';

					const tokenMeta =
						msg.tokenTotal
							? `<span>· ${escapeHtml(String(msg.tokenTotal))} tok</span>`
							: '';

					const typeMeta =
						msg.type && msg.type !== 'text'
							? `<span>· ${escapeHtml(msg.type)}</span>`
							: '';

					return `
						<div class="wa-msg-row ${directionClass}" data-message-id="${escapeHtml(msg.id)}">
							<div class="wa-msg-bubble ${directionClass}">
								<div class="wa-msg-text">${escapeHtml(msg.body || '')}</div>
								${attachment}
								<div class="wa-msg-meta">
									<span>${escapeHtml(msg.createdAtLabel || '')}</span>
									${tokenMeta}
									${typeMeta}
								</div>
							</div>
						</div>
					`;
				})
				.join('');
		}

		if (wasNearBottom || !lastRenderedMessageId) {
			scrollChatToBottom(true);
		}

		lastRenderedMessageId = messages.length ? messages[messages.length - 1].id : null;
		lastRenderedMessageCount = messages.length;
	}

	function buildStateSignature(conversation) {
		const state = conversation?.state || {};
		return JSON.stringify({
			queue: conversation?.queue || '',
			aiEnabled: !!conversation?.aiEnabled,
			handoffReason: state.handoffReason || '',
			lastDetectedIntent: state.lastDetectedIntent || '',
			lastIntent: state.lastIntent || '',
			lastUserGoal: state.lastUserGoal || ''
		});
	}

	function startFastPollingWindow() {
		if (fastPollingInterval) return;

		fastPollingInterval = setInterval(() => {
			refreshConversation();
		}, 800);

		fastPollingTimeout = setTimeout(() => {
			clearInterval(fastPollingInterval);
			fastPollingInterval = null;
			fastPollingTimeout = null;
		}, 8000);
	}

	function stopFastPollingWindow() {
		if (fastPollingInterval) {
			clearInterval(fastPollingInterval);
			fastPollingInterval = null;
		}

		if (fastPollingTimeout) {
			clearTimeout(fastPollingTimeout);
			fastPollingTimeout = null;
		}
	}

	async function refreshConversation(force = false) {
		if (document.hidden || refreshInFlight) return;

		refreshInFlight = true;

		try {
			const res = await fetch(`/dashboard/api/conversations/${conversationId}/messages`, {
				headers: {
					'X-Requested-With': 'XMLHttpRequest'
				},
				cache: 'no-store'
			});

			if (!res.ok) return;

			const data = await res.json();
			if (!data?.ok || !data?.conversation) return;

			const conversation = data.conversation;
			const messages = conversation.messages || [];
			const newestId = messages.length ? messages[messages.length - 1].id : null;
			const messageCount = messages.length;
			const serverLastMessageAt = normalizeText(conversation.lastMessageAt || '');
			const serverQueue = normalizeText(conversation.queue || '');
			const serverAiEnabled = String(!!conversation.aiEnabled);
			const serverStateSignature = buildStateSignature(conversation);

			const shouldRender =
				force ||
				newestId !== lastRenderedMessageId ||
				messageCount !== lastRenderedMessageCount ||
				serverLastMessageAt !== lastKnownLastMessageAt ||
				serverQueue !== lastKnownQueue ||
				serverAiEnabled !== lastKnownAiEnabled ||
				serverStateSignature !== lastKnownStateSignature;

			const previousCount = lastRenderedMessageCount;
			const previousLastMessageId = lastRenderedMessageId;

			if (shouldRender) {
				updateChatHeader(conversation);
				updateStateCard(conversation);
				renderMessages(messages);

				lastKnownLastMessageAt = serverLastMessageAt;
				lastKnownQueue = serverQueue;
				lastKnownAiEnabled = serverAiEnabled;
				lastKnownStateSignature = serverStateSignature;

				chatBody.dataset.lastMessageAt = serverLastMessageAt;
				chatBody.dataset.queue = serverQueue;
				chatBody.dataset.aiEnabled = serverAiEnabled;
				chatBody.dataset.stateSignature = serverStateSignature;
			}

			const lastMessage = messages.length ? messages[messages.length - 1] : null;
			const inboundJustArrived =
				messageCount > previousCount &&
				lastMessage &&
				lastMessage.direction === 'INBOUND';

			const lastMessageChanged =
				previousLastMessageId !== newestId && newestId !== null;

			if (inboundJustArrived || (lastMessageChanged && lastMessage?.direction === 'INBOUND')) {
				startFastPollingWindow();
			}
		} catch (error) {
			console.error('Error refrescando conversación:', error);
		} finally {
			refreshInFlight = false;
		}
	}

	window.addEventListener('load', () => {
		scrollChatToBottom(true);
		refreshConversation(true);
	});

	window.addEventListener('focus', () => {
		refreshConversation(true);
	});

	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) {
			refreshConversation(true);
		}
	});

	composerForm.addEventListener('submit', () => {
		stopFastPollingWindow();

		setTimeout(() => {
			refreshConversation(true);
			scrollChatToBottom(true);
			startFastPollingWindow();
		}, 350);
	});

	setInterval(() => {
		refreshConversation();
	}, 3000);
})();