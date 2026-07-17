"use client";

import type { ComponentType, ReactNode, RefObject } from "react";
import { MoreVertical } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type StatusType = "online" | "dnd" | "offline";

const STATUS_COLORS: Record<StatusType, string> = {
	online: "bg-green-500",
	dnd: "bg-red-500",
	offline: "bg-gray-400",
};

export type ConversationAction = {
	id: string;
	label: string;
	icon?: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: string | boolean; className?: string }>;
	active?: boolean;
	danger?: boolean;
	disabled?: boolean;
	onClick?: () => void;
};

function StatusBadge({ status }: { status: StatusType }) {
	return (
		<span
			aria-hidden="true"
			className={cn("inline-block size-3 rounded-full border-2 border-background", STATUS_COLORS[status])}
		/>
	);
}

function ConversationMenuItems({ actions }: { actions: ConversationAction[] }) {
	return actions.map((action) => {
		const Icon = action.icon;
		return (
			<DropdownMenuItem
				key={action.id}
				className={cn(
					"inbox-conversation-menu-item gap-2 rounded-md text-xs font-medium",
					action.active && "inbox-conversation-menu-item--active",
					action.danger && "text-destructive focus:text-destructive",
				)}
				disabled={action.disabled}
				aria-current={action.active ? "true" : undefined}
				onSelect={() => action.onClick?.()}
			>
				{Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
				<span className="min-w-0 flex-1 truncate">{action.label}</span>
			</DropdownMenuItem>
		);
	});
}

function MoreActionsMenu({ actions, moreActions }: { actions: ConversationAction[]; moreActions: ConversationAction[] }) {
	if (actions.length === 0 && moreActions.length === 0) return null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button aria-label="Acciones de conversacion" className="inbox-conversation-menu-trigger" size="icon" type="button" variant="outline">
					<MoreVertical aria-hidden="true" className="size-4" focusable="false" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="inbox-conversation-menu min-w-56 rounded-lg bg-popover p-1 shadow-xl" align="end">
				{actions.length > 0 ? (
					<>
						<DropdownMenuLabel className="px-2 py-1.5 text-[11px] uppercase text-muted-foreground">Conversacion</DropdownMenuLabel>
						<ConversationMenuItems actions={actions} />
					</>
				) : null}
				{actions.length > 0 && moreActions.length > 0 ? <DropdownMenuSeparator /> : null}
				{moreActions.length > 0 ? (
					<>
						<DropdownMenuLabel className="px-2 py-1.5 text-[11px] uppercase text-muted-foreground">Administracion</DropdownMenuLabel>
						<ConversationMenuItems actions={moreActions} />
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

type MessageConversationProps = {
	className?: string;
	contactName: string;
	contactSubtitle?: string;
	avatarUrl?: string;
	avatarFallback?: string;
	status?: StatusType;
	queueLabel?: string;
	aiLabel?: string;
	showBackButton?: boolean;
	onBack?: () => void;
	actions?: ConversationAction[];
	moreActions?: ConversationAction[];
	feedback?: string;
	feedbackTone?: "status" | "error";
	isBusy?: boolean;
	children?: ReactNode;
	emptyState?: ReactNode;
	loadOlderControl?: ReactNode;
	composer?: ReactNode;
	messagesContainerRef?: RefObject<HTMLDivElement>;
	onMessagesScroll?: () => void;
};

export default function MessageConversation({
	className,
	contactName,
	contactSubtitle = "",
	avatarUrl = "",
	avatarFallback = "?",
	status = "online",
	queueLabel = "",
	aiLabel = "",
	showBackButton = false,
	onBack,
	actions = [],
	moreActions = [],
	feedback = "",
	feedbackTone = "status",
	isBusy = false,
	children,
	emptyState = null,
	loadOlderControl = null,
	composer = null,
	messagesContainerRef,
	onMessagesScroll,
}: MessageConversationProps) {
	return (
		<Card className={cn("messaging-conversation-card inbox-chat-main flex min-h-0 w-full flex-1 flex-col overflow-hidden shadow-none", className)}>
			<CardHeader className="messaging-conversation-header inbox-chat-header">
				<div className="inbox-chat-header-top">
					{showBackButton ? (
						<button type="button" className="inbox-back-to-list-btn" onClick={onBack}>
							<span>Conversaciones</span>
						</button>
					) : null}

					<div className="messaging-conversation-identity inbox-chat-identity">
						<Avatar className="messaging-conversation-avatar">
							<AvatarImage alt={contactName} src={avatarUrl} />
							<AvatarFallback>{avatarFallback}</AvatarFallback>
						</Avatar>
						<div className="min-w-0">
							<h2 className="inbox-chat-title">{contactName}</h2>
							<div className="inbox-chat-subtitle">
								<StatusBadge status={status} />
								<span>{contactSubtitle}</span>
							</div>
						</div>
					</div>

					<div className="inbox-badges">
						{queueLabel ? <span className="inbox-badge inbox-badge--neutral">{queueLabel}</span> : null}
						{aiLabel ? (
							<span className={cn("inbox-badge", status === "online" ? "inbox-badge--ai" : "inbox-badge--human")}>{aiLabel}</span>
						) : null}
						<MoreActionsMenu actions={actions} moreActions={moreActions} />
					</div>
				</div>

				{feedback || isBusy ? (
					<div
						className={cn(
							"inbox-action-feedback",
							isBusy && "inbox-action-feedback--busy",
							!isBusy && feedbackTone === "error" && "inbox-action-feedback--error",
						)}
						role={!isBusy && feedbackTone === "error" ? "alert" : "status"}
						aria-live={!isBusy && feedbackTone === "error" ? "assertive" : "polite"}
						aria-busy={isBusy}
					>
						{isBusy ? "Procesando accion..." : feedback}
					</div>
				) : null}
			</CardHeader>

			<CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
				<div
					ref={messagesContainerRef}
					className="inbox-messages"
					onScroll={onMessagesScroll}
					role="log"
					aria-label="Historial de conversacion"
					aria-live="polite"
					aria-relevant="additions text"
				>
					<div className="inbox-messages-list">
						{loadOlderControl}
						{children || emptyState}
					</div>
				</div>
			</CardContent>

			{composer ? <div className="inbox-composer-shell">{composer}</div> : null}
		</Card>
	);
}
