"use client";

import { useRef, useState } from "react";
import { BookOpen, Languages, Paperclip, Send, Smile, StopCircle, Trash2, Wand2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const COMMANDS = [
	{ id: "summarize", label: "Resumen interno", icon: <Wand2 className="h-3.5 w-3.5" /> },
	{ id: "translate", label: "Traducir borrador", icon: <Languages className="h-3.5 w-3.5" /> },
	{ id: "explain", label: "Explicar contexto", icon: <BookOpen className="h-3.5 w-3.5" /> },
];

const EMOJIS = ["🙂", "😂", "😍", "✨", "❤️", "👍", "🙏", "📦"];
const FILE_ACCEPT =
	"image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv";

function formatFileSize(bytes = 0) {
	const size = Number(bytes || 0);
	if (!Number.isFinite(size) || size <= 0) return "";
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

type AiChatInputProps = {
	onSendMessage: (message: string) => void;
	onUploadFile?: (file: File) => void;
	onClearFile?: () => void;
	selectedFile?: File | null;
	isLoading?: boolean;
	disabled?: boolean;
	error?: string;
	placeholder?: string;
};

export default function AiChatInput({
	onSendMessage,
	onUploadFile,
	onClearFile,
	selectedFile = null,
	isLoading = false,
	disabled = false,
	error = "",
	placeholder = "Escribí un mensaje...",
}: AiChatInputProps) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [input, setInput] = useState("");
	const [selectedCommands, setSelectedCommands] = useState<string[]>([]);
	const [emojiOpen, setEmojiOpen] = useState(false);
	const [commandOpen, setCommandOpen] = useState(false);

	const canSubmit = Boolean(input.trim() || selectedFile) && !disabled;

	const handleSubmit = () => {
		if (!canSubmit || isLoading) return;
		onSendMessage(input.trim());
		setInput("");
		setSelectedCommands([]);
		setCommandOpen(false);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			handleSubmit();
			return;
		}

		if (event.key === "/" && !commandOpen) {
			event.preventDefault();
			setCommandOpen(true);
		}
	};

	const addCommand = (commandId: string) => {
		setSelectedCommands((current) => (current.includes(commandId) ? current : [...current, commandId]));
		setCommandOpen(false);
	};

	const removeCommand = (commandId: string) => {
		setSelectedCommands((current) => current.filter((item) => item !== commandId));
	};

	const addEmoji = (emoji: string) => {
		setInput((current) => `${current}${emoji}`);
		setEmojiOpen(false);
	};

	const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
		if (!onUploadFile || disabled || isLoading || selectedFile) return;

		const clipboardItems = Array.from(event.clipboardData?.items || []);
		const imageItem = clipboardItems.find((item) => item.kind === "file" && item.type.startsWith("image/"));
		const pastedFile = imageItem?.getAsFile() || null;

		if (!pastedFile) return;

		event.preventDefault();
		onUploadFile(pastedFile);
	};

	return (
		<div className="ai-chat-input w-full bg-background">
			{error ? <div className="inbox-composer-feedback inbox-composer-feedback--error">{error}</div> : null}
			{isLoading ? <div className="inbox-composer-feedback inbox-composer-feedback--sending">Enviando mensaje...</div> : null}

			{selectedFile ? (
				<div className="inbox-selected-file">
					<div className="inbox-selected-file-main">
						<span className="inbox-selected-file-icon">
							<Paperclip size={13} strokeWidth={2.4} aria-hidden="true" />
						</span>
						<span className="inbox-selected-file-name">{selectedFile.name}</span>
						<span className="inbox-selected-file-size">{formatFileSize(selectedFile.size)}</span>
					</div>
					<button
						type="button"
						className="inbox-selected-file-remove"
						onClick={onClearFile}
						disabled={isLoading}
						title="Quitar archivo"
					>
						<X size={14} strokeWidth={2.4} aria-hidden="true" />
					</button>
				</div>
			) : null}

			<div className="inbox-composer ai-chat-input__bar">
				<Button
					variant="ghost"
					size="icon"
					type="button"
					onClick={() => fileInputRef.current?.click()}
					disabled={disabled || isLoading}
					title="Adjuntar archivo"
				>
					<Paperclip className="h-5 w-5" />
				</Button>
				<input
					ref={fileInputRef}
					type="file"
					className="hidden"
					accept={FILE_ACCEPT}
					onChange={(event) => {
						const file = event.target.files?.[0];
						if (file && onUploadFile) onUploadFile(file);
						event.currentTarget.value = "";
					}}
					disabled={disabled || isLoading}
				/>

				<div className="flex min-w-0 flex-1 flex-col gap-2">
					{selectedCommands.length > 0 ? (
						<div className="flex flex-wrap gap-1">
							{selectedCommands.map((commandId) => {
								const command = COMMANDS.find((item) => item.id === commandId);
								return (
									<Badge
										key={commandId}
										variant="secondary"
										className="cursor-pointer gap-1"
										onClick={() => removeCommand(commandId)}
										title="Quitar herramienta"
									>
										{command?.icon}
										{command?.label}
									</Badge>
								);
							})}
						</div>
					) : null}

					<Popover open={commandOpen} onOpenChange={setCommandOpen}>
						<PopoverAnchor asChild>
							<Textarea
								value={input}
								onChange={(event) => setInput(event.target.value)}
								onKeyDown={handleKeyDown}
								onPaste={handlePaste}
								placeholder={placeholder}
								disabled={disabled || isLoading}
								className="inbox-textarea min-h-[44px] max-h-[160px] resize-none rounded-xl px-3 py-2 text-sm"
								rows={1}
							/>
						</PopoverAnchor>
						<PopoverContent className="w-60 p-0" align="start">
							<Command>
								<CommandInput placeholder="Buscar herramienta..." />
								<CommandList>
									<CommandGroup heading="Herramientas">
										{COMMANDS.map((command) => (
											<CommandItem key={command.id} onSelect={() => addCommand(command.id)} className="gap-2">
												{command.icon}
												{command.label}
											</CommandItem>
										))}
									</CommandGroup>
								</CommandList>
							</Command>
						</PopoverContent>
					</Popover>
				</div>

				<div className="ai-chat-input__actions flex items-center gap-1">
					<Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
						<PopoverTrigger asChild>
							<Button variant="ghost" size="icon" type="button" disabled={disabled || isLoading} title="Emoji">
								<Smile className="h-5 w-5" />
							</Button>
						</PopoverTrigger>
						<PopoverContent className="grid w-40 grid-cols-4 gap-2 p-2">
							{EMOJIS.map((emoji) => (
								<button
									key={emoji}
									type="button"
									onClick={() => addEmoji(emoji)}
									className="rounded-md p-1 text-lg transition hover:bg-accent"
								>
									{emoji}
								</button>
							))}
						</PopoverContent>
					</Popover>

					<Button
						variant="ghost"
						size="icon"
						type="button"
						onClick={() => setInput("")}
						disabled={disabled || isLoading || !input}
						title="Limpiar texto"
					>
						<Trash2 className="h-5 w-5" />
					</Button>
				</div>

				<Button
					onClick={handleSubmit}
					disabled={!canSubmit || isLoading}
					variant="outline"
					className={cn("rounded-full", canSubmit && "inbox-send-btn")}
					type="button"
					title={isLoading ? "Enviando" : "Enviar"}
				>
					{isLoading ? <StopCircle className="h-5 w-5" /> : <Send className="h-4 w-4" />}
				</Button>
			</div>
		</div>
	);
}
