import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
	ArchiveRestore,
	ArrowLeft,
	Bot,
	CheckCheck,
	Clock3,
	Eraser,
	EyeOff,
	Inbox,
	MessageCircle,
	Paperclip,
	RefreshCw,
	RotateCcw,
	Send,
	Smile,
	UserRound,
} from 'lucide-react';
import api, { createApiEventSource, resolveApiUrl } from '../lib/api.js';
import { queryKeys, queryPresets } from '../lib/queryClient.js';
import './InboxPage.css';
import { useAuth } from '../context/AuthContext.jsx';
import { isAdminUser } from '../lib/authz.js';
import { useInternalDarkOverrides } from '../hooks/useInternalDarkOverrides.js';

const QUEUES = [
	{ key: 'ALL', label: 'Todos' },
	{ key: 'AUTO', label: 'Automatico' },
	{ key: 'HUMAN', label: 'Atencion humana' },
	{ key: 'PAYMENT_REVIEW', label: 'Comprobantes' },
];

const QUEUE_ROUTES = {
	ALL: 'todos',
	AUTO: 'automatico',
	HUMAN: 'atencion-humana',
	PAYMENT_REVIEW: 'comprobantes',
};

const QUEUE_BY_ROUTE = Object.fromEntries(
	Object.entries(QUEUE_ROUTES).map(([queueKey, slug]) => [slug, queueKey])
);

function resolveQueueFromSlug(slug = '') {
	return QUEUE_BY_ROUTE[String(slug || '').trim().toLowerCase()] || 'AUTO';
}

function buildInboxPath(queueKey = 'AUTO', conversationId = '', readFilter = 'ALL') {
	const slug = QUEUE_ROUTES[queueKey] || QUEUE_ROUTES.AUTO;
	const params = new URLSearchParams();
	if (conversationId) params.set('conversation', conversationId);
	if (readFilter && readFilter !== 'ALL') params.set('read', readFilter);
	const query = params.toString() ? `?${params.toString()}` : '';
	return `/inbox/${slug}${query}`;
}

const QUICK_EMOJIS = [
	'😊', '😂', '😍', '😉', '👍', '🙏',
	'❤️', '🔥', '🎉', '😮', '😢', '🤝',
	'✨', '💬', '📦', '🛍️', '✅', '🙌',
];

const READ_FILTERS = [
	{ key: 'ALL', label: 'Todos' },
	{ key: 'UNREAD', label: 'No leídos' },
	{ key: 'READ', label: 'Leídos' },
];

const QUEUE_LABELS = {
	ALL: 'Todos',
	AUTO: 'Automatico',
	HUMAN: 'Atencion humana',
	PAYMENT_REVIEW: 'Comprobantes',
};

function getQueueLabel(queueKey = '') {
	return QUEUE_LABELS[queueKey] || queueKey || 'Bandeja';
}

function resolveReadFilter(value = '') {
	const normalized = String(value || '').trim().toUpperCase();
	return READ_FILTERS.some((item) => item.key === normalized) ? normalized : 'ALL';
}

const EXTENDED_QUICK_EMOJIS = [
	'\u{1F600}', '\u{1F603}', '\u{1F604}', '\u{1F601}', '\u{1F606}', '\u{1F605}', '\u{1F602}', '\u{1F923}',
	'\u{1F60A}', '\u{1F607}', '\u{1F642}', '\u{1F609}', '\u{1F60D}', '\u{1F970}', '\u{1F618}', '\u{1F617}',
	'\u{1F61C}', '\u{1F61D}', '\u{1F911}', '\u{1F917}', '\u{1F914}', '\u{1F92D}', '\u{1F92B}', '\u{1F928}',
	'\u{1F610}', '\u{1F62E}', '\u{1F632}', '\u{1F97A}', '\u{1F622}', '\u{1F62D}', '\u{1F621}', '\u{1F624}',
	'\u{1F44B}', '\u{1F91A}', '\u{1F44C}', '\u{1F44D}', '\u{1F44E}', '\u{1F64C}', '\u{1F64F}', '\u{1F91D}',
	'\u{1F44F}', '\u{1F4AA}', '\u{1F525}', '\u{2728}', '\u{2B50}', '\u{1F389}', '\u{1F381}', '\u{1F48C}',
	'\u{2764}\u{FE0F}', '\u{1F9E1}', '\u{1F49B}', '\u{1F49A}', '\u{1F499}', '\u{1F49C}', '\u{1F90D}', '\u{1F5A4}',
	'\u{1F4AC}', '\u{1F4A1}', '\u{1F4E6}', '\u{1F6CD}\u{FE0F}', '\u{1F457}', '\u{1F460}', '\u{1F48E}', '\u{2705}',
];

const MEDIA_PLACEHOLDER_BODIES = new Set([
	'[Audio recibido]',
	'[Imagen recibida]',
	'[Video recibido]',
	'[Sticker recibido]',
]);

const INBOX_PAGE_SIZE = 60;

function isDocumentVisible() {
	if (typeof document === 'undefined') return true;
	return !document.hidden;
}

function isCompactInboxViewport() {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(max-width: 900px)').matches;
}

function getRequestErrorMessage(error, fallback = 'No pudimos completar la acción. Probá nuevamente.') {
	return (
		error?.response?.data?.error ||
		error?.response?.data?.message ||
		error?.message ||
		fallback
	);
}

function toTimestamp(value) {
	if (!value) return 0;
	const time = new Date(value).getTime();
	return Number.isFinite(time) ? time : 0;
}

function formatArgentinaTime(value) {
	if (!value) return '';

	try {
		return new Date(value).toLocaleTimeString('es-AR', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'America/Argentina/Buenos_Aires',
		});
	} catch {
		return '';
	}
}

function formatArgentinaDateTime(value) {
	if (!value) return '';

	try {
		return new Date(value).toLocaleString('es-AR', {
			timeZone: 'America/Argentina/Buenos_Aires',
		});
	} catch {
		return '';
	}
}

function cleanPreviewText(value = '') {
	return String(value || '')
		.replace(/^🖼️\s*/u, '')
		.replace(/^🎧\s*/u, '')
		.replace(/^📄\s*/u, '')
		.trim();
}

function formatFileSize(bytes = 0) {
	const size = Number(bytes || 0);
	if (!Number.isFinite(size) || size <= 0) return '';
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getMediaKind(message = {}) {
	const type = String(message.type || '').toLowerCase();
	const mime = String(message.attachmentMimeType || '').toLowerCase();

	if (type === 'audio' || mime.startsWith('audio/')) return 'audio';
	if (type === 'image' || mime.startsWith('image/')) return 'image';
	if (type === 'video' || mime.startsWith('video/')) return 'video';
	if (type === 'document') return 'document';
	if (type === 'sticker') return 'image';
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

	const resolved = resolveApiUrl(rawUrl);
	if (!resolved) return '';

	try {
		const url = new URL(
			resolved,
			typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
		);

		if (typeof window !== 'undefined' && url.pathname.startsWith('/api/media/inbox/')) {
			return `${window.location.origin}${url.pathname}`;
		}

		return url.toString();
	} catch {
		return resolved;
	}
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
								className="inbox-message-link"
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
							className="inbox-message-text-chunk"
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
			<div className="inbox-attachment-preview">
				<audio
					controls
					preload="none"
					src={attachmentUrl}
					className="inbox-attachment-audio"
				>
					Tu navegador no soporta audio HTML5.
				</audio>
			</div>
		);
	}

	if (mediaKind === 'image') {
		return (
			<div className="inbox-attachment-preview">
				<a
					href={attachmentUrl}
					target="_blank"
					rel="noreferrer"
					className="inbox-attachment-link-wrap"
				>
					<img
						src={attachmentUrl}
						alt={attachmentName || 'Imagen recibida'}
						loading="lazy"
						className={`inbox-attachment-media inbox-attachment-image ${
							String(message.type || '').toLowerCase() === 'sticker'
								? 'inbox-attachment-sticker'
								: ''
						}`}
					/>
				</a>
			</div>
		);
	}

	if (mediaKind === 'video') {
		return (
			<div className="inbox-attachment-preview">
				<video
					controls
					preload="metadata"
					src={attachmentUrl}
					className="inbox-attachment-media inbox-attachment-video"
				>
					Tu navegador no soporta video HTML5.
				</video>
			</div>
		);
	}

	if (mediaKind === 'document' || mediaKind === 'file') {
		return (
			<div className="inbox-attachment-preview">
				<div className="inbox-attachment-file-card">
					<div className="inbox-attachment-file-name">
						{attachmentName || 'Archivo adjunto'}
					</div>

					<a
						href={attachmentUrl}
						target="_blank"
						rel="noreferrer"
						className="inbox-attachment-file-link"
					>
						Abrir archivo
					</a>
				</div>
			</div>
		);
	}

	return null;
}

function resolveMessageReadState(message = {}, conversation = null) {
	if (message.direction !== 'OUTBOUND') return null;

	const createdAt = toTimestamp(message.createdAt);
	const lastReadAt = toTimestamp(conversation?.lastReadAt);

	if (!createdAt) return 'sent';
	if (lastReadAt && createdAt <= lastReadAt) return 'read';

	return 'sent';
}

function MessageBubble({ message, conversation }) {
	const isOutbound = message.direction === 'OUTBOUND';
	const hideBody = shouldHideBodyBecauseItIsOnlyPlaceholder(message);
	const promo = resolvePromoAction(message);
	const hasPromoButton = Boolean(promo.actionLabel);
	const attachmentUrl = resolveMessageAttachmentUrl(message);
	const readState = resolveMessageReadState(message, conversation);

	return (
		<div
			className={`inbox-message-row ${
				isOutbound ? 'inbox-message-row--outbound' : 'inbox-message-row--inbound'
			}`}
		>
			<div
				className={`inbox-message-bubble ${
					isOutbound ? 'inbox-message-bubble--outbound' : 'inbox-message-bubble--inbound'
				}`}
			>
				<div className="inbox-message-bubble-inner">
					<AttachmentPreview message={message} />

					{!hideBody || hasPromoButton ? (
						<div
							className={`inbox-message-body ${
								attachmentUrl ? 'inbox-message-body--with-attachment' : ''
							}`}
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
								className="inbox-promo-action"
							>
								↗ {promo.actionLabel}
							</a>
						) : (
							<div className="inbox-promo-action inbox-promo-action--static">
								{promo.actionLabel}
							</div>
						)
					) : null}

					<div className="inbox-message-meta">
						<span className="inbox-message-sender-pill">
							{message.senderName || (isOutbound ? 'Lummine' : 'Cliente')}
						</span>

						<span>{formatArgentinaDateTime(message.createdAt) || message.createdAtLabel || ''}</span>
						{isOutbound ? (
							<span
								className={`inbox-message-status ${
									readState === 'read'
										? 'inbox-message-status--read'
										: 'inbox-message-status--sent'
								}`}
								aria-label={readState === 'read' ? 'Leido' : 'Enviado'}
								title={readState === 'read' ? 'Leido' : 'Enviado'}
							>
								{readState === 'read' ? '✓✓' : '✓'}
							</span>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
}

function ActionButton({ children, danger = false, active = false, disabled = false, onClick, icon: Icon }) {
	const className = [
		'inbox-action-btn',
		active ? 'inbox-action-btn--active' : '',
		danger ? 'inbox-action-btn--danger' : '',
	]
		.filter(Boolean)
		.join(' ');

	return (
		<button type="button" onClick={onClick} disabled={disabled} className={className}>
			{Icon ? <Icon size={15} strokeWidth={2.3} aria-hidden="true" /> : null}
			{children}
		</button>
	);
}

export default function InboxPage() {
	useInternalDarkOverrides();

	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { queueSlug } = useParams();
	const [searchParams] = useSearchParams();
	const { user } = useAuth();
	const isAdmin = isAdminUser(user);
	const contactsContainerRef = useRef(null);
	const messagesContainerRef = useRef(null);
	const emojiPickerRef = useRef(null);
	const fileInputRef = useRef(null);
	const textareaRef = useRef(null);
	const shouldStickToBottomRef = useRef(true);
	const selectedConversationIdRef = useRef(null);
	const lastReadRequestRef = useRef('');
	const manuallyUnreadConversationIdRef = useRef(null);

	const routeQueue = resolveQueueFromSlug(queueSlug);
	const routeConversationId = searchParams.get('conversation') || null;
	const routeReadFilter = resolveReadFilter(searchParams.get('read') || '');

	const [queue, setQueue] = useState(routeQueue);
	const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
	const [showEmojiPicker, setShowEmojiPicker] = useState(false);
	const [selectedConversationId, setSelectedConversationId] = useState(routeConversationId);
	const [messageText, setMessageText] = useState('');
	const [selectedFile, setSelectedFile] = useState(null);
	const [searchTerm, setSearchTerm] = useState('');
	const [readFilter, setReadFilter] = useState(routeReadFilter);
	const [olderMessages, setOlderMessages] = useState([]);
	const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
	const [showConversationSidebar, setShowConversationSidebar] = useState(true);
	const [composerError, setComposerError] = useState('');
	const [actionFeedback, setActionFeedback] = useState('');
	const normalizedSearch = searchTerm.trim().toLowerCase();

	useEffect(() => {
		const expectedPath = buildInboxPath(routeQueue, routeConversationId || '', routeReadFilter);

		if (!queueSlug || !QUEUE_BY_ROUTE[String(queueSlug || '').trim().toLowerCase()]) {
			navigate(expectedPath, { replace: true });
			return;
		}

		setQueue((current) => (current === routeQueue ? current : routeQueue));
		setSelectedConversationId((current) => (
			current === routeConversationId ? current : routeConversationId
		));
		setReadFilter((current) => (current === routeReadFilter ? current : routeReadFilter));
	}, [navigate, queueSlug, routeQueue, routeConversationId, routeReadFilter]);

	function selectQueue(nextQueue) {
		if (nextQueue === queue) return;
		setQueue(nextQueue);
		setSelectedConversationId(null);
		navigate(buildInboxPath(nextQueue, '', readFilter), { replace: false });
	}

	function selectConversation(conversationId) {
		setSelectedConversationId(conversationId);
		navigate(buildInboxPath(queue, conversationId, readFilter), { replace: false });
		if (isCompactInboxViewport()) {
			setShowConversationSidebar(false);
		}
	}

	function clearSelectedConversation() {
		setSelectedConversationId(null);
		setShowConversationSidebar(true);
		navigate(buildInboxPath(queue, '', readFilter), { replace: true });
	}

	function selectReadFilter(nextFilter) {
		setReadFilter(nextFilter);
		setSelectedConversationId(null);
		navigate(buildInboxPath(queue, '', nextFilter), { replace: false });
	}

	const inboxQuery = useInfiniteQuery({
		queryKey: queryKeys.inbox(queue, normalizedSearch, readFilter),
		queryFn: async ({ pageParam = 0 }) => {
			const res = await api.get('/dashboard/inbox', {
				params: {
					queue,
					limit: INBOX_PAGE_SIZE,
					offset: pageParam,
					q: normalizedSearch || undefined,
					read: readFilter,
				},
			});

			return res.data;
		},
		initialPageParam: 0,
		getNextPageParam: (lastPage) => lastPage?.nextOffset ?? undefined,
		placeholderData: (previousData) => previousData,
		refetchInterval: false,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		...queryPresets.inbox,
	});

	const inboxPages = inboxQuery.data?.pages || [];
	const contacts = inboxPages.flatMap((page) => page?.contacts || []);
	const firstInboxPage = inboxPages[0] || null;
	const counts = firstInboxPage?.counts || {
		ALL: 0,
		AUTO: 0,
		HUMAN: 0,
		PAYMENT_REVIEW: 0,
	};

	const filteredContacts = useMemo(() => {
		const normalizedContacts = contacts.map((contact) => ({
			...contact,
			preview: cleanPreviewText(contact.preview || ''),
			lastMessageTime: formatArgentinaTime(contact.lastMessageAt || contact.lastMessageTime),
			lastMessageLabel: formatArgentinaDateTime(contact.lastMessageAt || contact.lastMessageLabel),
		}));

		const sorted = [...normalizedContacts].sort(
			(a, b) => toTimestamp(b.lastMessageAt) - toTimestamp(a.lastMessageAt)
		);

		if (!normalizedSearch) return sorted;
		const bySearch = sorted.filter((contact) => {
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

		return bySearch;
	}, [contacts, normalizedSearch]);

	const visibleContacts = useMemo(() => {
		const filtered = filteredContacts.filter((contact) => {
			const hasUnread = Boolean(contact.hasUnread) || Number(contact.unreadCount || 0) > 0;

			if (readFilter === 'UNREAD') return hasUnread;
			if (readFilter === 'READ') return !hasUnread;
			return true;
		});

		if (
			readFilter === 'UNREAD' &&
			selectedConversationId &&
			!filtered.some((contact) => contact.conversationId === selectedConversationId)
		) {
			const selectedContact = filteredContacts.find(
				(contact) => contact.conversationId === selectedConversationId
			);

			if (selectedContact) {
				return [selectedContact, ...filtered];
			}
		}

		return filtered;
	}, [filteredContacts, readFilter, selectedConversationId]);

	useEffect(() => {
		selectedConversationIdRef.current = selectedConversationId;
	}, [selectedConversationId]);

	useEffect(() => {
		if (readFilter === 'UNREAD' && !selectedConversationId) {
			return;
		}

		if (selectedConversationId) return;
		if (inboxQuery.isPlaceholderData) return;

		if (!visibleContacts.length) {
			return;
		}

		const preferredSelectedId = firstInboxPage?.selectedContact?.conversationId;
		const preferredExists = visibleContacts.some(
			(contact) => contact.conversationId === preferredSelectedId
		);

		const preferredId =
			(preferredExists ? preferredSelectedId : null) ||
			visibleContacts[0]?.conversationId ||
			null;

		setSelectedConversationId(preferredId);
		if (preferredId) {
			navigate(buildInboxPath(queue, preferredId, readFilter), { replace: true });
		}
	}, [
		visibleContacts,
		selectedConversationId,
		firstInboxPage,
		readFilter,
		navigate,
		queue,
		inboxQuery.isPlaceholderData,
	]);

	useEffect(() => {
		if (typeof window === 'undefined') return undefined;

		let isDisposed = false;
		let fallbackIntervalId = null;

		function stopFallbackPolling() {
			if (fallbackIntervalId) {
				window.clearInterval(fallbackIntervalId);
				fallbackIntervalId = null;
			}
		}

		function runFallbackRefresh() {
			if (!isDocumentVisible()) return;

			queryClient.invalidateQueries({
				queryKey: ['dashboard', 'inbox'],
			});

			const activeConversationId = selectedConversationIdRef.current;
			if (activeConversationId) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.conversation(activeConversationId),
				});
			}
		}

		function startFallbackPolling() {
			if (fallbackIntervalId) return;

			fallbackIntervalId = window.setInterval(() => {
				runFallbackRefresh();
			}, 30000);
		}

		function handleInboxEvent(event) {
			let payload = null;

			try {
				payload = JSON.parse(event.data || '{}');
			} catch {
				payload = null;
			}

			const eventQueue = payload?.queue || null;
			const activeConversationId = selectedConversationIdRef.current;
			const eventConversationId = payload?.conversationId || null;

			if (payload?.action === 'read' && eventConversationId) {
				updateInboxContactCache(eventConversationId, {
					unreadCount: 0,
					hasUnread: false,
					lastReadAt: payload.lastReadAt || new Date().toISOString(),
				});

				queryClient.setQueryData(queryKeys.conversation(eventConversationId), (current) => {
					if (!current?.conversation) return current;

					return {
						...current,
						conversation: {
							...current.conversation,
							unreadCount: 0,
							hasUnread: false,
							lastReadAt: payload.lastReadAt || new Date().toISOString(),
						},
					};
				});
				return;
			}

			if (payload?.action === 'unread' && eventConversationId) {
				updateInboxContactCache(eventConversationId, {
					unreadCount: payload.unreadCount || 1,
					hasUnread: true,
					lastReadAt: null,
				});

				queryClient.setQueryData(queryKeys.conversation(eventConversationId), (current) => {
					if (!current?.conversation) return current;

					return {
						...current,
						conversation: {
							...current.conversation,
							unreadCount: payload.unreadCount || 1,
							hasUnread: true,
							lastReadAt: null,
						},
					};
				});
				return;
			}

			if (!eventQueue || eventQueue === queue || eventConversationId === activeConversationId) {
				queryClient.invalidateQueries({
					queryKey: ['dashboard', 'inbox'],
				});
			}

			if (
				activeConversationId &&
				(!eventConversationId || eventConversationId === activeConversationId)
			) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.conversation(activeConversationId),
				});
			}
		}

		const eventSource = createApiEventSource('/dashboard/inbox/stream');

		eventSource.onopen = () => {
			if (isDisposed) return;
			setIsRealtimeConnected(true);
			stopFallbackPolling();

			queryClient.invalidateQueries({
				queryKey: ['dashboard', 'inbox'],
			});
		};

		eventSource.onerror = () => {
			if (isDisposed) return;
			setIsRealtimeConnected(false);
			startFallbackPolling();
		};

		eventSource.addEventListener('inbox:update', handleInboxEvent);

		return () => {
			isDisposed = true;
			stopFallbackPolling();
			eventSource.removeEventListener('inbox:update', handleInboxEvent);
			eventSource.close();
		};
	}, [queryClient, queue]);

	const conversationQuery = useQuery({
		queryKey: queryKeys.conversation(selectedConversationId),
		queryFn: async () => {
			const res = await api.get(`/dashboard/conversations/${selectedConversationId}/messages`);
			return res.data;
		},
		enabled: Boolean(selectedConversationId),
		placeholderData: (previousData) => previousData,
		refetchInterval: false,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		...queryPresets.conversation,
	});

	const conversation = conversationQuery.data?.conversation || null;
	const conversationMessages = conversation?.messages || [];
	const displayedMessages = useMemo(() => {
		const seen = new Set();
		return [...olderMessages, ...conversationMessages].filter((message) => {
			if (!message?.id || seen.has(message.id)) return false;
			seen.add(message.id);
			return true;
		});
	}, [olderMessages, conversationMessages]);
	const hasOlderMessages = Boolean(conversation?.messagesPage?.hasMore);

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

	function updateInboxContactCache(conversationId, patch) {
		if (!conversationId) return;

		queryClient.setQueriesData({ queryKey: ['dashboard', 'inbox'] }, (current) => {
			if (!current?.pages) return current;

			return {
				...current,
				pages: current.pages.map((page) => ({
					...page,
					contacts: (page.contacts || []).map((contact) =>
						contact.conversationId === conversationId
							? {
									...contact,
									...(typeof patch === 'function' ? patch(contact) : patch),
							  }
							: contact
					),
				})),
			};
		});
	}

	const markConversationReadMutation = useMutation({
		mutationFn: async (conversationId) => {
			if (!conversationId) return null;

			const res = await api.patch(`/dashboard/conversations/${conversationId}/read`);
			return { conversationId, data: res.data };
		},
		onSuccess: async (result) => {
			if (!result?.conversationId) return;

			updateInboxContactCache(result.conversationId, {
				unreadCount: 0,
				hasUnread: false,
				lastReadAt: result.data?.lastReadAt || new Date().toISOString(),
			});

			queryClient.setQueryData(queryKeys.conversation(result.conversationId), (current) => {
				if (!current?.conversation) return current;

				return {
					...current,
					conversation: {
						...current.conversation,
						unreadCount: 0,
						hasUnread: false,
						lastReadAt: result.data?.lastReadAt || new Date().toISOString(),
					},
				};
			});

		},
		onError: (error) => {
			console.error(error);
		},
	});

	const markConversationUnreadMutation = useMutation({
		mutationFn: async (conversationId) => {
			if (!conversationId) return null;

			const res = await api.patch(`/dashboard/conversations/${conversationId}/unread`);
			return { conversationId, data: res.data };
		},
		onSuccess: async (result) => {
			if (!result?.conversationId) return;

			manuallyUnreadConversationIdRef.current = result.conversationId;
			lastReadRequestRef.current = `${result.conversationId}:manual-unread`;

			updateInboxContactCache(result.conversationId, {
				unreadCount: result.data?.unreadCount || 1,
				hasUnread: true,
				lastReadAt: null,
			});

			queryClient.setQueryData(queryKeys.conversation(result.conversationId), (current) => {
				if (!current?.conversation) return current;

				return {
					...current,
					conversation: {
						...current.conversation,
						unreadCount: result.data?.unreadCount || 1,
						hasUnread: true,
						lastReadAt: null,
					},
				};
			});
		},
		onError: (error) => {
			console.error(error);
		},
	});

	useEffect(() => {
		if (!selectedConversationId || !isDocumentVisible()) return;

		const unreadCount = Math.max(
			0,
			Number(activeContact?.unreadCount || conversation?.unreadCount || 0)
		);

		if (unreadCount < 1) {
			lastReadRequestRef.current = '';
			if (manuallyUnreadConversationIdRef.current === selectedConversationId) {
				manuallyUnreadConversationIdRef.current = null;
			}
			return;
		}

		if (manuallyUnreadConversationIdRef.current === selectedConversationId) {
			return;
		}

		const requestKey = `${selectedConversationId}:${unreadCount}`;
		if (
			markConversationReadMutation.isPending ||
			lastReadRequestRef.current === requestKey
		) {
			return;
		}

		lastReadRequestRef.current = requestKey;
		markConversationReadMutation.mutate(selectedConversationId);
	}, [
		selectedConversationId,
		activeContact?.unreadCount,
		conversation?.unreadCount,
		markConversationReadMutation,
	]);

	useEffect(() => {
		const el = messagesContainerRef.current;
		if (!el) return;

		shouldStickToBottomRef.current = true;

		const run = () => {
			el.scrollTop = el.scrollHeight;
		};

		requestAnimationFrame(run);
		const timeout = window.setTimeout(run, 60);

		return () => window.clearTimeout(timeout);
	}, [selectedConversationId]);

	useEffect(() => {
		setOlderMessages([]);
		setIsLoadingOlderMessages(false);
		setComposerError('');
		setActionFeedback('');
	}, [selectedConversationId]);

	useEffect(() => {
		const el = messagesContainerRef.current;
		if (!el) return;

		if (!shouldStickToBottomRef.current) return;

		requestAnimationFrame(() => {
			el.scrollTop = el.scrollHeight;
		});
	}, [conversation?.messages?.length]);

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

	useEffect(() => {
		if (!actionFeedback) return undefined;

		const timeout = window.setTimeout(() => {
			setActionFeedback('');
		}, 3200);

		return () => window.clearTimeout(timeout);
	}, [actionFeedback]);

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
		mutationFn: async ({ conversationId, body, file }) => {
			if (!conversationId || (!body && !file)) return null;

			if (file) {
				const formData = new FormData();
				formData.append('body', body);
				formData.append('file', file);

				await api.post(
					`/dashboard/conversations/${conversationId}/messages`,
					formData
				);
				return { conversationId, body, fileName: file.name || '' };
			}

			await api.post(
				`/dashboard/conversations/${conversationId}/messages`,
				{ body }
			);
			return { conversationId, body, fileName: '' };
		},
		onSuccess: async (result) => {
			if (result?.conversationId === selectedConversationId) {
				setMessageText((current) => (
					current.trim() === result.body ? '' : current
				));
				setSelectedFile((current) => (
					!current || current.name === result.fileName ? null : current
				));
				if (fileInputRef.current) fileInputRef.current.value = '';
			}
			setComposerError('');
			setShowEmojiPicker(false);
			shouldStickToBottomRef.current = true;
			await invalidateInboxAndConversation(result?.conversationId || selectedConversationId);
		},
		onError: (error) => {
			console.error(error);
			setComposerError(getRequestErrorMessage(error, 'No se pudo enviar el mensaje. Revisa la conexion e intenta de nuevo.'));
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
			setActionFeedback('Bandeja actualizada.');

			await queryClient.invalidateQueries({
				queryKey: ['dashboard', 'inbox'],
			});

			await queryClient.invalidateQueries({
				queryKey: queryKeys.conversation(selectedConversationId),
			});

			if (result.nextQueue !== queue) {
				clearSelectedConversation();
			}
		},
		onError: (error) => {
			console.error(error);
			setActionFeedback(getRequestErrorMessage(error, 'No se pudo cambiar la bandeja.'));
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
			setActionFeedback('Contexto de IA reiniciado.');
			await invalidateInboxAndConversation();
		},
		onError: (error) => {
			console.error(error);
			setActionFeedback(getRequestErrorMessage(error, 'No se pudo reiniciar la IA.'));
		},
	});

	const clearHistoryMutation = useMutation({
		mutationFn: async () => {
			if (!selectedConversationId) return;
			await api.delete(`/dashboard/conversations/${selectedConversationId}/history`);
		},
		onSuccess: async () => {
			setActionFeedback('Historial borrado.');
			await invalidateInboxAndConversation();
		},
		onError: (error) => {
			console.error(error);
			setActionFeedback(getRequestErrorMessage(error, 'No se pudo borrar el historial.'));
		},
	});

	function handleMessagesScroll() {
		const el = messagesContainerRef.current;
		if (!el) return;

		const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		shouldStickToBottomRef.current = distanceFromBottom < 120;
	}

	async function handleLoadOlderMessages() {
		if (
			!selectedConversationId ||
			!conversation?.messagesPage?.nextBefore ||
			isLoadingOlderMessages
		) {
			return;
		}

		const el = messagesContainerRef.current;
		const previousScrollHeight = el?.scrollHeight || 0;
		const previousScrollTop = el?.scrollTop || 0;

		try {
			setIsLoadingOlderMessages(true);
			const res = await api.get(`/dashboard/conversations/${selectedConversationId}/messages`, {
				params: {
					limit: 80,
					before: conversation.messagesPage.nextBefore,
				},
			});

			const olderPage = res.data?.conversation?.messages || [];
			setOlderMessages((current) => {
				const seen = new Set(current.map((message) => message.id));
				const nextMessages = olderPage.filter((message) => !seen.has(message.id));
				return [...nextMessages, ...current];
			});

			queryClient.setQueryData(queryKeys.conversation(selectedConversationId), (current) => {
				if (!current?.conversation) return current;

				return {
					...current,
					conversation: {
						...current.conversation,
						messagesPage: res.data?.conversation?.messagesPage || {
							limit: 80,
							hasMore: false,
							nextBefore: null,
						},
					},
				};
			});

			requestAnimationFrame(() => {
				const nextEl = messagesContainerRef.current;
				if (!nextEl) return;
				nextEl.scrollTop = nextEl.scrollHeight - previousScrollHeight + previousScrollTop;
			});
		} catch (error) {
			console.error(error);
		} finally {
			setIsLoadingOlderMessages(false);
		}
	}

	function handleContactsScroll() {
		const el = contactsContainerRef.current;
		if (!el || !inboxQuery.hasNextPage || inboxQuery.isFetchingNextPage) return;

		const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		if (distanceFromBottom < 260) {
			inboxQuery.fetchNextPage();
		}
	}

	function handleSubmit(event) {
		event.preventDefault();
		const body = messageText.trim();
		if (!selectedConversationId || (!body && !selectedFile)) return;
		setComposerError('');
		sendMessageMutation.mutate({
			conversationId: selectedConversationId,
			body,
			file: selectedFile,
		});
	}

	function handleSelectFile(event) {
		const file = event.target.files?.[0] || null;
		setComposerError('');
		setSelectedFile(file);
	}

	function handleClearSelectedFile() {
		setSelectedFile(null);
		if (fileInputRef.current) fileInputRef.current.value = '';
	}

	function handleMoveQueue(nextQueue) {
		moveQueueMutation.mutate(nextQueue);
	}

	function handlePaymentVerified() {
		if (!selectedConversationId || moveQueueMutation.isPending) return;
		moveQueueMutation.mutate('HUMAN');
	}

	function handleMarkUnread() {
		if (!selectedConversationId || markConversationUnreadMutation.isPending) return;
		markConversationUnreadMutation.mutate(selectedConversationId);
	}

	function insertEmoji(emoji) {
		setMessageText((prev) => `${prev}${emoji}`);
		setShowEmojiPicker(false);
		textareaRef.current?.focus();
	}

	function handleComposerKeyDown(event) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();

			const body = messageText.trim();
			if (selectedConversationId && (body || selectedFile) && !sendMessageMutation.isPending) {
				setComposerError('');
				sendMessageMutation.mutate({
					conversationId: selectedConversationId,
					body,
					file: selectedFile,
				});
			}
		}
	}

	const inboxPageClassName = [
		'inbox-page',
		!showConversationSidebar ? 'inbox-page--contacts-hidden' : '',
	]
		.filter(Boolean)
		.join(' ');
	const currentQueue = conversation?.queue || activeContact?.queue || queue;
	const currentQueueLabel = getQueueLabel(currentQueue);
	const isBusyWithConversationAction =
		moveQueueMutation.isPending ||
		resetContextMutation.isPending ||
		clearHistoryMutation.isPending ||
		markConversationUnreadMutation.isPending;

	return (
		<div className={inboxPageClassName}>
			{showConversationSidebar ? (
			<aside className="inbox-sidebar">
				<div className="inbox-sidebar-top">
					<div>
						<strong>Inbox</strong>
						<span>{counts.ALL || 0} conversaciones en esta vista</span>
					</div>
					<button
						type="button"
						className="inbox-sidebar-refresh"
						onClick={() => inboxQuery.refetch()}
						disabled={inboxQuery.isFetching}
					>
						<RefreshCw size={14} strokeWidth={2.4} aria-hidden="true" />
						<span>{inboxQuery.isFetching ? '...' : 'Actualizar'}</span>
					</button>
				</div>

				<div className="inbox-queue-tabs">
					{QUEUES.map((item) => {
						const isActive = queue === item.key;

						return (
							<ActionButton
								key={item.key}
								active={isActive}
								disabled={inboxQuery.isFetching && isActive}
								onClick={() => selectQueue(item.key)}
								icon={item.key === 'PAYMENT_REVIEW' ? CheckCheck : item.key === 'HUMAN' ? UserRound : item.key === 'AUTO' ? Bot : Inbox}
							>
								<span>{getQueueLabel(item.key)}</span>
								<strong>{counts[item.key] || 0}</strong>
							</ActionButton>
						);
					})}
				</div>

				<div className="inbox-section-header">
					<div className="inbox-section-title">
						Conversaciones
					</div>

					<div className="inbox-section-actions">
						<span
							className={`inbox-realtime-badge ${
								isRealtimeConnected
									? 'inbox-realtime-badge--live'
									: 'inbox-realtime-badge--fallback'
							}`}
						>
							{isRealtimeConnected ? 'Tiempo real' : 'Respaldo'}
						</span>
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

				<div className="inbox-read-filters">
					{READ_FILTERS.map((item) => (
						<button
							key={item.key}
							type="button"
							onClick={() => selectReadFilter(item.key)}
							className={`inbox-read-filter-btn ${
								readFilter === item.key ? 'inbox-read-filter-btn--active' : ''
							}`}
						>
							{item.label}
						</button>
					))}
				</div>

				<div
					ref={contactsContainerRef}
					className="inbox-contacts-scroll"
					onScroll={handleContactsScroll}
				>
					{inboxQuery.isLoading ? (
						<div className="inbox-empty">
							<strong>Cargando conversaciones</strong>
							<span>Estamos actualizando la bandeja con los últimos mensajes.</span>
						</div>
					) : null}

					{!inboxQuery.isLoading && !visibleContacts.length ? (
						<div className="inbox-empty">
							<strong>No hay conversaciones en esta vista</strong>
							<span>
								{normalizedSearch
									? 'Probá con otro nombre, teléfono o mensaje.'
									: readFilter === 'UNREAD'
										? 'No quedan chats sin leer. Cambiá el filtro para ver el resto.'
										: 'Cuando entren mensajes nuevos, van a aparecer acá.'}
							</span>
						</div>
					) : null}

					{visibleContacts.map((contact) => {
						const isSelected = contact.conversationId === selectedConversationId;
						const unreadCount = Math.max(0, Number(contact.unreadCount || 0));
						const hasUnread = Boolean(contact.hasUnread) || unreadCount > 0;

						return (
							<button
								key={contact.conversationId}
								type="button"
								onClick={() => selectConversation(contact.conversationId)}
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

										<div className="inbox-contact-preview-row">
											{contact.lastMessageDirection ? (
												<span
													className={`inbox-contact-preview-prefix ${
														contact.lastMessageDirection === 'OUTBOUND'
															? 'inbox-contact-preview-prefix--outbound'
															: 'inbox-contact-preview-prefix--inbound'
													}`}
												>
													{contact.lastMessageDirection === 'OUTBOUND' ? 'Vos:' : 'Cliente:'}
												</span>
											) : null}

											<div className="inbox-contact-preview">
												{contact.preview || 'Sin mensajes'}
											</div>
										</div>
									</div>
								</div>
							</button>
						);
					})}

					{inboxQuery.hasNextPage ? (
						<button
							type="button"
							className="inbox-load-more"
							disabled={inboxQuery.isFetchingNextPage}
							onClick={() => inboxQuery.fetchNextPage()}
						>
							{inboxQuery.isFetchingNextPage
								? 'Cargando...'
								: 'Cargar más conversaciones'}
						</button>
					) : contacts.length > 0 ? (
						<div className="inbox-list-end">No hay más conversaciones.</div>
					) : null}
				</div>
			</aside>
			) : null}

			<section className="inbox-chat-panel">
				{!selectedConversationId ? (
					<div className="inbox-chat-empty">
						{!showConversationSidebar ? (
							<ActionButton onClick={() => setShowConversationSidebar(true)} icon={Inbox}>
								Mostrar conversaciones
							</ActionButton>
						) : null}
						Seleccioná una conversación para ver el historial y responder.
					</div>
				) : (
					<div className="inbox-chat-workspace">
						<div className="inbox-chat-main">
						<div className="inbox-chat-header">
							<div className="inbox-chat-header-top">
								<button
									type="button"
									className="inbox-back-to-list-btn"
									onClick={() => setShowConversationSidebar(true)}
								>
									<ArrowLeft size={15} strokeWidth={2.4} aria-hidden="true" />
									<span>Conversaciones</span>
								</button>

								<div className="inbox-chat-identity">
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
										{currentQueueLabel}
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
								<div className="inbox-actions-primary">
									<ActionButton
										active={showConversationSidebar}
										onClick={() => setShowConversationSidebar((prev) => !prev)}
										icon={showConversationSidebar ? EyeOff : Inbox}
									>
										{showConversationSidebar ? 'Ocultar conversaciones' : 'Mostrar conversaciones'}
									</ActionButton>

									<ActionButton
										active={conversation?.queue === 'AUTO'}
										disabled={moveQueueMutation.isPending}
										onClick={() => handleMoveQueue('AUTO')}
										icon={Bot}
									>
										Automático
									</ActionButton>

									<ActionButton
										active={conversation?.queue === 'HUMAN'}
										disabled={moveQueueMutation.isPending}
										onClick={() => handleMoveQueue('HUMAN')}
										icon={UserRound}
									>
										Atención humana
									</ActionButton>

									<ActionButton
										active={conversation?.queue === 'PAYMENT_REVIEW'}
										disabled={moveQueueMutation.isPending}
										onClick={() => handleMoveQueue('PAYMENT_REVIEW')}
										icon={CheckCheck}
									>
										Comprobantes
									</ActionButton>

									{conversation?.queue === 'PAYMENT_REVIEW' ? (
										<ActionButton
											disabled={moveQueueMutation.isPending}
											onClick={handlePaymentVerified}
											icon={ArchiveRestore}
										>
											Comprobante verificado
										</ActionButton>
									) : null}

									<ActionButton
										active={Boolean(activeContact?.hasUnread || conversation?.hasUnread)}
										disabled={
											markConversationUnreadMutation.isPending ||
											!selectedConversationId
										}
										onClick={handleMarkUnread}
										icon={Clock3}
									>
										Marcar no leído
									</ActionButton>
								</div>

								{isAdmin ? (
									<div className="inbox-actions-danger">
										<ActionButton
											danger
											disabled={
												resetContextMutation.isPending ||
												!selectedConversationId
											}
											onClick={() => resetContextMutation.mutate()}
											icon={RotateCcw}
										>
											Reiniciar IA
										</ActionButton>

										<ActionButton
											danger
											disabled={
												clearHistoryMutation.isPending ||
												!selectedConversationId
											}
											onClick={() => {
												const confirmed = window.confirm(
													'Borrar historial\n\nSe eliminarán los mensajes y el contexto de esta conversación. Esta acción no se puede deshacer.\n\n¿Querés borrar el historial?'
												);

												if (confirmed) {
													clearHistoryMutation.mutate();
												}
											}}
											icon={Eraser}
										>
											Borrar historial
										</ActionButton>
									</div>
								) : null}
							</div>

							{actionFeedback || isBusyWithConversationAction ? (
								<div
									className={`inbox-action-feedback ${
										isBusyWithConversationAction ? 'inbox-action-feedback--busy' : ''
									}`}
								>
									{isBusyWithConversationAction ? 'Procesando acción...' : actionFeedback}
								</div>
							) : null}
						</div>

						<div
							ref={messagesContainerRef}
							className="inbox-messages"
							onScroll={handleMessagesScroll}
						>
							<div className="inbox-messages-list">
								{conversationQuery.isLoading ? (
									<div className="inbox-empty">
										<strong>Cargando mensajes</strong>
										<span>Estamos preparando el historial de esta conversación.</span>
									</div>
								) : null}

								{hasOlderMessages ? (
									<button
										type="button"
										className="inbox-load-older-messages"
										disabled={isLoadingOlderMessages}
										onClick={handleLoadOlderMessages}
									>
										{isLoadingOlderMessages
											? 'Cargando mensajes...'
											: 'Cargar mensajes anteriores'}
									</button>
								) : null}

								{!conversationQuery.isLoading &&
								displayedMessages.length === 0 ? (
									<div className="inbox-empty">
										Todavía no hay mensajes. Cuando el cliente escriba, el historial va a aparecer acá.
									</div>
								) : null}

								{displayedMessages.map((msg) => (
									<MessageBubble key={msg.id} message={msg} conversation={conversation} />
								))}
							</div>
						</div>

						<div className="inbox-composer-shell">
							{composerError ? (
								<div className="inbox-composer-feedback inbox-composer-feedback--error">
									{composerError}
								</div>
							) : sendMessageMutation.isPending ? (
								<div className="inbox-composer-feedback inbox-composer-feedback--sending">
									Enviando mensaje...
								</div>
							) : null}

							{selectedFile ? (
								<div className="inbox-selected-file">
									<div className="inbox-selected-file-main">
										<span className="inbox-selected-file-icon">
											<Paperclip size={13} strokeWidth={2.4} aria-hidden="true" />
										</span>
										<span className="inbox-selected-file-name">{selectedFile.name}</span>
										<span className="inbox-selected-file-size">
											{formatFileSize(selectedFile.size)}
										</span>
									</div>

									<button
										type="button"
										className="inbox-selected-file-remove"
										onClick={handleClearSelectedFile}
										disabled={sendMessageMutation.isPending}
										title="Quitar archivo"
									>
										x
									</button>
								</div>
							) : null}

							<form onSubmit={handleSubmit} className="inbox-composer">
								<div className="inbox-composer-leading" ref={emojiPickerRef}>
									<button
										type="button"
										className="inbox-emoji-trigger"
										onClick={() => setShowEmojiPicker((prev) => !prev)}
										title="Emoji"
									>
										🙂
									</button>

									{showEmojiPicker ? (
										<div className="inbox-emoji-picker">
											<div className="inbox-emoji-title">Elegí un emoji</div>

											<div className="inbox-emoji-grid">
												{EXTENDED_QUICK_EMOJIS.map((emoji) => (
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

								<input
									ref={fileInputRef}
									type="file"
									className="inbox-file-input"
									accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv"
									onChange={handleSelectFile}
									disabled={sendMessageMutation.isPending}
								/>

								<button
									type="button"
									className="inbox-attach-trigger"
									onClick={() => fileInputRef.current?.click()}
									disabled={sendMessageMutation.isPending}
									title="Adjuntar archivo"
								>
									<Paperclip size={18} strokeWidth={2.3} aria-hidden="true" />
								</button>

								<textarea
									ref={textareaRef}
									value={messageText}
									onChange={(event) => {
										setComposerError('');
										setMessageText(event.target.value);
									}}
									onKeyDown={handleComposerKeyDown}
									placeholder="Escribí un mensaje"
									rows={1}
									className="inbox-textarea"
								/>

								<button
									type="submit"
									disabled={
										sendMessageMutation.isPending || (!messageText.trim() && !selectedFile)
									}
									title="Enviar"
									className="inbox-send-btn"
								>
									➤
								</button>
							</form>
						</div>
						</div>

					</div>
				)}
			</section>
		</div>
	);
}
