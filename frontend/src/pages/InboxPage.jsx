import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
	ArchiveRestore,
	Bot,
	CheckCheck,
	Clock3,
	Eraser,
	EyeOff,
	Inbox,
	List,
	MoreVertical,
	RefreshCw,
	RotateCcw,
	UserRound,
} from 'lucide-react';
import api, { buildApiUrl, createApiEventSource, resolveApiUrl } from '../lib/api.js';
import { queryKeys, queryPresets } from '../lib/queryClient.js';
import AiChatInput from '../components/ui/ai-chat-input';
import MessageConversation from '../components/ui/messaging-conversation';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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


const MEDIA_PLACEHOLDER_BODIES = new Set([
	'[Audio recibido]',
	'[Imagen recibida]',
	'[Video recibido]',
	'[Sticker recibido]',
]);

const INBOX_PAGE_SIZE = 30;

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

function getAttachmentDownloadState(message = {}) {
	const attachment = message.rawPayload?.attachment || {};
	const downloadError = String(attachment.downloadError || '').trim();

	return {
		pending: Boolean(attachment.downloadPending || downloadError),
		error: downloadError,
	};
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

		if (url.pathname.startsWith('/api/media/inbox/')) {
			return buildApiUrl(`${url.pathname.replace(/^\/api\/+/, '')}${url.search || ''}`);
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

function getInteractivePayload(message = {}) {
	if (String(message.type || '').toLowerCase() !== 'interactive') return null;
	const payload = message.rawPayload?.interactivePayload || message.rawPayload?.sendResult?.interactivePayload || null;
	return payload && typeof payload === 'object' ? payload : null;
}

function isGenericMenuTitle(value = '') {
	return /^(men[uú]\s+principal|marca)$/i.test(String(value || '').trim());
}

function stripMenuFallbackOptions(text = '') {
	const normalized = String(text || '')
		.replace(/\*\s*([^*]+?)\s*\*/g, '$1')
		.replace(/\s+\d+\s*[-.)]\s+[^0-9\n]+(?=(\s+\d+\s*[-.)]\s+|$))/g, ' ')
		.replace(/\bmen[uú]\s+principal\b/gi, ' ')
		.replace(/\bescrib[ií]\s+0\s+o\s+men[uú]\s+para\s+volver[^\n]*/gi, ' ');
	const lines = normalized.split('\n');
	const cleanLines = [];

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			if (cleanLines.length && cleanLines[cleanLines.length - 1] !== '') cleanLines.push('');
			continue;
		}
		if (/^\*[^*]+\*$/.test(line)) continue;
		if (/^(\d+[-.)]|[-*•])\s+/i.test(line)) continue;
		if (/^menu principal$/i.test(line)) continue;
		if (/^escribi\s+0\s+o\s+menu\s+para\s+volver/i.test(line)) continue;
		if (/^(menu_|[a-z0-9_]+)$/i.test(line)) continue;
		cleanLines.push(rawLine);
	}

	return cleanLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function resolveInteractiveMenuDisplay(message = {}) {
	const payload = getInteractivePayload(message) || {};
	const fallbackBody = stripMenuFallbackOptions(message.body);
	const bodyText = String(payload.bodyText || payload.body || '').trim() || fallbackBody;
	const headerText = String(payload.headerText || '').trim();
	const title =
		(isGenericMenuTitle(headerText) ? '' : headerText) ||
		String(message.senderName || '').trim() ||
		'Lummine';
	const buttonText = String(payload.buttonText || '').trim() || 'Abrir menu';

	return {
		title,
		bodyText,
		buttonText,
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

function InteractiveMenuMessage({ message, readState }) {
	const display = resolveInteractiveMenuDisplay(message);

	return (
		<div className="inbox-interactive-menu-card">
			<div className="inbox-interactive-menu-content">
				<div className="inbox-interactive-menu-title">{display.title}</div>
				{display.bodyText ? (
					<div className="inbox-interactive-menu-body">
						{renderFormattedText(display.bodyText)}
					</div>
				) : null}
				<div className="inbox-interactive-menu-time">
					<span>{formatArgentinaDateTime(message.createdAt) || message.createdAtLabel || ''}</span>
					<span
						className={`inbox-message-status ${
							readState === 'read' ? 'inbox-message-status--read' : 'inbox-message-status--sent'
						}`}
						aria-label={readState === 'read' ? 'Leido' : 'Enviado'}
						title={readState === 'read' ? 'Leido' : 'Enviado'}
					>
						{readState === 'read' ? '✓✓' : '✓'}
					</span>
				</div>
			</div>
			<div className="inbox-interactive-menu-action" aria-hidden="true">
				<List size={18} strokeWidth={2.4} />
				<span>{display.buttonText}</span>
			</div>
		</div>
	);
}

function AttachmentPreview({ message }) {
	const mediaKind = getMediaKind(message);
	const attachmentUrl = resolveMessageAttachmentUrl(message);
	const attachmentName = String(message.attachmentName || '').trim();
	const downloadState = getAttachmentDownloadState(message);

	if (!mediaKind || !attachmentUrl) return null;

	if (downloadState.pending) {
		return (
			<div className="inbox-attachment-preview">
				<div className="inbox-attachment-file-card inbox-attachment-file-card--pending">
					<div className="inbox-attachment-file-name">
						{attachmentName || 'Archivo adjunto'}
					</div>
					{downloadState.error ? (
						<div className="inbox-attachment-file-status">
							No se pudo descargar automaticamente.
						</div>
					) : null}
					<a
						href={attachmentUrl}
						target="_blank"
						rel="noreferrer"
						className="inbox-attachment-file-link"
					>
						Reintentar descarga
					</a>
				</div>
			</div>
		);
	}

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

function getInitials(value = '') {
	const words = String(value || '')
		.trim()
		.split(/\s+/)
		.filter(Boolean);

	if (!words.length) return '?';
	if (words.length === 1) return words[0].charAt(0).toUpperCase();
	return `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase();
}

function resolveContactAvatarUrl(contact = null) {
	if (!contact) return '';
	const rawUrl = (
		contact.avatar?.url ||
		contact.avatarUrl ||
		contact.profileImageUrl ||
		contact.profilePhotoUrl ||
		contact.pictureUrl ||
		''
	);

	return resolveApiUrl(rawUrl);
}

function AvatarImageOrFallback({ url = '', fallback = '?' }) {
	const resolvedUrl = String(url || '').trim();
	const [failedUrl, setFailedUrl] = useState('');
	const canShowImage = Boolean(resolvedUrl) && failedUrl !== resolvedUrl;

	if (!canShowImage) {
		return fallback || '?';
	}

	return (
		<img
			src={resolvedUrl}
			alt=""
			loading="lazy"
			onError={() => setFailedUrl(resolvedUrl)}
		/>
	);
}

function MessageBubble({ message, conversation }) {
	const isOutbound = message.direction === 'OUTBOUND';
	const interactivePayload = getInteractivePayload(message);
	const hideBody = shouldHideBodyBecauseItIsOnlyPlaceholder(message);
	const promo = resolvePromoAction(message);
	const hasPromoButton = Boolean(promo.actionLabel);
	const attachmentUrl = resolveMessageAttachmentUrl(message);
	const readState = resolveMessageReadState(message, conversation);
	const senderLabel = message.senderName || (isOutbound ? 'Marca' : conversation?.contact?.name || 'Cliente');
	const createdAtLabel = formatArgentinaDateTime(message.createdAt) || message.createdAtLabel || '';
	const inboundAvatarUrl = !isOutbound ? resolveContactAvatarUrl(conversation?.contact) : '';

	return (
		<div
			className={`inbox-message-row ${
				isOutbound ? 'inbox-message-row--outbound' : 'inbox-message-row--inbound'
			}`}
		>
			<div className="inbox-message-avatar" aria-hidden="true">
				<AvatarImageOrFallback url={inboundAvatarUrl} fallback={getInitials(senderLabel)} />
			</div>
			<div className="inbox-message-stack">
			<div
				className={`inbox-message-bubble ${
					isOutbound ? 'inbox-message-bubble--outbound' : 'inbox-message-bubble--inbound'
				} ${interactivePayload ? 'inbox-message-bubble--interactive-menu' : ''}`}
			>
				{interactivePayload ? (
					<InteractiveMenuMessage message={message} readState={readState} />
				) : (
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

					<div className="inbox-message-meta inbox-message-meta--legacy">
						<span className="inbox-message-sender-pill">
							{message.senderName || (isOutbound ? 'Marca' : 'Cliente')}
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
				)}
			</div>
			<div className="inbox-message-meta">
				<span className="inbox-message-sender-pill">
					{senderLabel}
				</span>

				<span>{createdAtLabel}</span>
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
	const shouldStickToBottomRef = useRef(true);
	const selectedConversationIdRef = useRef(null);
	const lastReadRequestRef = useRef('');
	const manuallyUnreadConversationIdRef = useRef(null);

	const routeQueue = resolveQueueFromSlug(queueSlug);
	const routeConversationId = searchParams.get('conversation') || null;
	const routeReadFilter = resolveReadFilter(searchParams.get('read') || '');

	const [queue, setQueue] = useState(routeQueue);
	const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
	const [selectedConversationId, setSelectedConversationId] = useState(routeConversationId);
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
		if (!routeConversationId) return;
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
		routeConversationId,
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

			if (payload?.action === 'queue-updated' && eventConversationId) {
				queryClient.invalidateQueries({
					queryKey: ['dashboard', 'inbox'],
				});

				if (activeConversationId === eventConversationId) {
					queryClient.invalidateQueries({
						queryKey: queryKeys.conversation(activeConversationId),
					});
				}
				return;
			}

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
				setSelectedFile((current) => (
					!current || current.name === result.fileName ? null : current
				));
			}
			setComposerError('');
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

	function handleSendComposerMessage(message = '') {
		const body = String(message || '').trim();
		if (!selectedConversationId || (!body && !selectedFile)) return;
		setComposerError('');
		sendMessageMutation.mutate({
			conversationId: selectedConversationId,
			body,
			file: selectedFile,
		});
	}

	function handleSelectFile(file) {
		setComposerError('');
		setSelectedFile(file || null);
	}

	function handleClearSelectedFile() {
		setSelectedFile(null);
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
					<div className="inbox-sidebar-actions">
						<button
							type="button"
							className="inbox-sidebar-refresh"
							onClick={() => inboxQuery.refetch()}
							disabled={inboxQuery.isFetching}
						>
							<RefreshCw size={14} strokeWidth={2.4} aria-hidden="true" />
							<span>{inboxQuery.isFetching ? '...' : 'Actualizar'}</span>
						</button>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									className="inbox-queue-menu-trigger"
									aria-label="Seleccionar cola"
									title="Seleccionar cola"
								>
									<MoreVertical size={18} strokeWidth={2.3} aria-hidden="true" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align="end"
								className="inbox-queue-menu min-w-56 rounded-lg bg-popover p-1 shadow-xl"
							>
								{QUEUES.map((item) => {
									const isActive = queue === item.key;
									const Icon = item.key === 'PAYMENT_REVIEW' ? CheckCheck : item.key === 'HUMAN' ? UserRound : item.key === 'AUTO' ? Bot : Inbox;

									return (
										<DropdownMenuItem
											key={item.key}
											disabled={inboxQuery.isFetching && isActive}
											className={`inbox-queue-menu-item ${isActive ? 'inbox-queue-menu-item--active' : ''}`}
											onSelect={() => selectQueue(item.key)}
										>
											<Icon size={16} strokeWidth={2.3} aria-hidden="true" />
											<span>{getQueueLabel(item.key)}</span>
											<strong>{counts[item.key] || 0}</strong>
										</DropdownMenuItem>
									);
								})}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
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
						const avatarUrl = resolveContactAvatarUrl(contact);

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
										<AvatarImageOrFallback
											url={avatarUrl}
											fallback={contact.avatar?.initials || '?'}
										/>
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
						<MessageConversation
							contactName={
								conversation?.contact?.name ||
								activeContact?.displayName ||
								'Sin nombre'
							}
							contactSubtitle={
								conversation?.contact?.phone ||
								activeContact?.phoneDisplay ||
								'Sin telefono'
							}
							avatarFallback={(
								conversation?.contact?.name ||
								activeContact?.displayName ||
								'?'
							).trim().charAt(0).toUpperCase()}
							avatarUrl={
								resolveContactAvatarUrl(conversation?.contact) ||
								resolveContactAvatarUrl(activeContact)
							}
							status={conversation?.aiEnabled ? 'online' : 'dnd'}
							queueLabel={currentQueueLabel}
							aiLabel={conversation?.aiEnabled ? 'IA activa' : 'Humano'}
							showBackButton
							onBack={() => setShowConversationSidebar(true)}
							actions={[
								{
									id: 'toggle-sidebar',
									label: showConversationSidebar ? 'Ocultar conversaciones' : 'Mostrar conversaciones',
									active: showConversationSidebar,
									onClick: () => setShowConversationSidebar((prev) => !prev),
									icon: showConversationSidebar ? EyeOff : Inbox,
								},
								{
									id: 'auto',
									label: 'Automatico',
									active: conversation?.queue === 'AUTO',
									disabled: moveQueueMutation.isPending,
									onClick: () => handleMoveQueue('AUTO'),
									icon: Bot,
								},
								{
									id: 'human',
									label: 'Atencion humana',
									active: conversation?.queue === 'HUMAN',
									disabled: moveQueueMutation.isPending,
									onClick: () => handleMoveQueue('HUMAN'),
									icon: UserRound,
								},
								{
									id: 'payment',
									label: 'Comprobantes',
									active: conversation?.queue === 'PAYMENT_REVIEW',
									disabled: moveQueueMutation.isPending,
									onClick: () => handleMoveQueue('PAYMENT_REVIEW'),
									icon: CheckCheck,
								},
								...(conversation?.queue === 'PAYMENT_REVIEW'
									? [{
										id: 'payment-verified',
										label: 'Comprobante verificado',
										disabled: moveQueueMutation.isPending,
										onClick: handlePaymentVerified,
										icon: ArchiveRestore,
									}]
									: []),
								{
									id: 'mark-unread',
									label: 'Marcar no leido',
									active: Boolean(activeContact?.hasUnread || conversation?.hasUnread),
									disabled: markConversationUnreadMutation.isPending || !selectedConversationId,
									onClick: handleMarkUnread,
									icon: Clock3,
								},
							]}
							moreActions={isAdmin ? [
								{
									id: 'reset-context',
									label: 'Reiniciar IA',
									danger: true,
									disabled: resetContextMutation.isPending || !selectedConversationId,
									onClick: () => resetContextMutation.mutate(),
									icon: RotateCcw,
								},
								{
									id: 'clear-history',
									label: 'Borrar historial',
									danger: true,
									disabled: clearHistoryMutation.isPending || !selectedConversationId,
									onClick: () => {
										const confirmed = window.confirm(
											'Borrar historial\n\nSe eliminaran los mensajes y el contexto de esta conversacion. Esta accion no se puede deshacer.\n\nQueres borrar el historial?'
										);

										if (confirmed) {
											clearHistoryMutation.mutate();
										}
									},
									icon: Eraser,
								},
							] : []}
							feedback={actionFeedback}
							isBusy={isBusyWithConversationAction}
							messagesContainerRef={messagesContainerRef}
							onMessagesScroll={handleMessagesScroll}
							loadOlderControl={hasOlderMessages ? (
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
							emptyState={(
								<div className="inbox-empty">
									Todavia no hay mensajes. Cuando el cliente escriba, el historial va a aparecer aca.
								</div>
							)}
							composer={(
								<AiChatInput
									onSendMessage={handleSendComposerMessage}
									onUploadFile={handleSelectFile}
									selectedFile={selectedFile}
									onClearFile={handleClearSelectedFile}
									isLoading={sendMessageMutation.isPending}
									disabled={!selectedConversationId}
									error={composerError}
									placeholder="Escribi un mensaje"
								/>
							)}
						>
							{conversationQuery.isLoading ? (
								<div className="inbox-empty">
									<strong>Cargando mensajes</strong>
									<span>Estamos preparando el historial de esta conversacion.</span>
								</div>
							) : null}

							{!conversationQuery.isLoading && displayedMessages.length === 0 ? (
								<div className="inbox-empty">
									Todavia no hay mensajes. Cuando el cliente escriba, el historial va a aparecer aca.
								</div>
							) : null}

							{displayedMessages.map((msg) => (
								<MessageBubble key={msg.id} message={msg} conversation={conversation} />
							))}
						</MessageConversation>

					</div>
				)}
			</section>
		</div>
	);
}
