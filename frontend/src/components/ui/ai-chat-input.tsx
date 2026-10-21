"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Paperclip, Send, Smile, Square, LoaderCircle, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

const EMOJIS = ["🙂", "😂", "😍", "✨", "❤️", "👍", "🙏", "📦"];
const FILE_ACCEPT =
	"image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv";

const RECORDING_MIME_TYPES = [
	"audio/ogg;codecs=opus",
	"audio/mp4",
	"audio/webm;codecs=opus",
	"audio/webm",
];

function formatFileSize(bytes = 0) {
	const size = Number(bytes || 0);
	if (!Number.isFinite(size) || size <= 0) return "";
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

type AiChatInputProps = {
	onSendMessage: (message: string) => boolean | void | Promise<boolean | void>;
	onUploadFile?: (file: File) => void;
	onClearFile?: () => void;
	onRecording?: (file: File) => void;
	selectedFile?: File | null;
	isLoading?: boolean;
	disabled?: boolean;
	error?: string;
	placeholder?: string;
	value?: string;
	onValueChange?: (value: string) => void;
};

export default function AiChatInput({
	onSendMessage,
	onUploadFile,
	onClearFile,
	onRecording,
	selectedFile = null,
	isLoading = false,
	disabled = false,
	error = "",
	placeholder = "Escribí un mensaje...",
	value,
	onValueChange,
}: AiChatInputProps) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const submissionInFlightRef = useRef(false);
	const [internalInput, setInternalInput] = useState("");
	const [emojiOpen, setEmojiOpen] = useState(false);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const recordingStreamRef = useRef<MediaStream | null>(null);
	const recordingChunksRef = useRef<Blob[]>([]);
	const [isRecording, setIsRecording] = useState(false);
	const [recordingSeconds, setRecordingSeconds] = useState(0);
	const [recordingError, setRecordingError] = useState("");
    const [attachmentPreview, setAttachmentPreview] = useState('');
    useEffect(() => {
        if (!selectedFile || !/^(image|audio)\//.test(selectedFile.type)) { setAttachmentPreview(''); return; }
        const url = URL.createObjectURL(selectedFile);
        setAttachmentPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [selectedFile]);

	const input = value ?? internalInput;
	const setInput = (nextValue: string | ((current: string) => string)) => {
		const resolvedValue = typeof nextValue === "function" ? nextValue(input) : nextValue;
		if (value === undefined) setInternalInput(resolvedValue);
		onValueChange?.(resolvedValue);
	};
	const canSubmit = Boolean(input.trim() || selectedFile) && !disabled && !isLoading && !isRecording;
	const mountedRef = useRef(true);

	useEffect(() => {
		if (!isRecording) return undefined;
		const timer = window.setInterval(() => setRecordingSeconds((current) => current + 1), 1000);
		return () => window.clearInterval(timer);
	}, [isRecording]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
		mountedRef.current = false;
		if (mediaRecorderRef.current) mediaRecorderRef.current.onstop = null;
		if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
		recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
		};
	}, []);

	const formatRecordingTime = (seconds: number) =>
		`${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;

	const stopRecording = () => {
		mediaRecorderRef.current?.stop();
		setIsRecording(false);
	};

	const startRecording = async () => {
		if (isRecording || disabled || isLoading || !onRecording) return;
		setRecordingError("");

		if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
			setRecordingError("Este navegador no permite grabar audios.");
			return;
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			if (!mountedRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
			const mimeType = RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || "";
			const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
			recordingStreamRef.current = stream;
			mediaRecorderRef.current = recorder;
			recordingChunksRef.current = [];
			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) recordingChunksRef.current.push(event.data);
			};
			recorder.onstop = () => {
				const type = recorder.mimeType || mimeType || "audio/webm";
				const extension = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
				const file = new File(recordingChunksRef.current, `audio-${Date.now()}.${extension}`, { type });
				if (file.size > 0 && mountedRef.current) onRecording(file);
				recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
				recordingStreamRef.current = null;
				mediaRecorderRef.current = null;
			};
			recorder.start();
			setRecordingSeconds(0);
			setIsRecording(true);
		} catch (error) {
			console.error(error);
			recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
			recordingStreamRef.current = null;
			setRecordingError("No se pudo acceder al micrófono. Revisá los permisos del navegador.");
		}
	};

	const handleSubmit = async () => {
		if (!canSubmit || submissionInFlightRef.current) return;
		submissionInFlightRef.current = true;

		try {
			const sent = await onSendMessage(input.trim());
			if (sent === false) return;
			if (value === undefined && mountedRef.current) setInput("");
		} finally {
			submissionInFlightRef.current = false;
		}
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			handleSubmit();
			return;
		}

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
            <div className="inbox-composer-label">Responder al cliente</div>
			{error || recordingError ? <div role="alert" className="inbox-composer-feedback inbox-composer-feedback--error">{error || recordingError}</div> : null}
			{isLoading ? <div role="status" aria-live="polite" className="inbox-composer-feedback inbox-composer-feedback--sending">Enviando mensaje...</div> : null}

			{selectedFile ? (
				<div className="inbox-selected-file">
					<div className="inbox-selected-file-main">
                        {attachmentPreview && selectedFile.type.startsWith("image/") ? <img className="inbox-file-thumbnail" src={attachmentPreview} alt="Vista previa del adjunto" /> : null}
                        {attachmentPreview && selectedFile.type.startsWith("audio/") ? <audio controls src={attachmentPreview} aria-label="Escuchar audio antes de enviar" /> : null}
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
						aria-label="Quitar archivo"
					>
						<X size={14} strokeWidth={2.4} aria-hidden="true" />
					</button>
				</div>
			) : null}

			<div className="inbox-composer ai-chat-input__bar">
				<Button
					variant={isRecording ? "destructive" : "ghost"}
					size="icon"
					type="button"
					onClick={isRecording ? stopRecording : startRecording}
					disabled={disabled || isLoading || Boolean(selectedFile)}
					title={isRecording ? "Detener grabación" : "Grabar audio de voz"}
					aria-label={isRecording ? "Detener grabación" : "Grabar audio de voz"}
				>
					{isRecording ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
				</Button>
				{isRecording ? <span className="inbox-recording-indicator" role="status">{formatRecordingTime(recordingSeconds)}</span> : null}
				<Button
					variant="ghost"
					size="icon"
					type="button"
					onClick={() => fileInputRef.current?.click()}
					disabled={disabled || isLoading || isRecording}
					title="Adjuntar archivo" aria-label="Adjuntar archivo"
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
					disabled={disabled || isLoading || isRecording}
				/>

				<div className="flex min-w-0 flex-1 flex-col gap-2">
<Textarea
								value={input}
								onChange={(event) => setInput(event.target.value)}
								onKeyDown={handleKeyDown}
								onPaste={handlePaste}
								placeholder={placeholder}
								aria-label="Mensaje"
								disabled={disabled || isLoading || isRecording}
								className="inbox-textarea min-h-[44px] max-h-[160px] resize-none rounded-xl px-3 py-2 text-sm"
								rows={2}
							/>
				</div>

				<div className="ai-chat-input__actions flex items-center gap-1">
					<Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
						<PopoverTrigger asChild>
							<Button variant="ghost" size="icon" type="button" disabled={disabled || isLoading || isRecording} title="Emoji" aria-label="Agregar emoji">
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
									aria-label={`Agregar ${emoji}`}
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
						title="Limpiar texto" aria-label="Limpiar borrador"
					>
						<Trash2 className="h-5 w-5" />
					</Button>
				</div>

				<Button
					onClick={handleSubmit}
					disabled={!canSubmit || isLoading}
					variant="default"
					className="inbox-send-btn"
					type="button"
					title={isLoading ? "Enviando" : "Enviar"} aria-label="Enviar mensaje"
				>
					<span>{isLoading ? 'Enviando' : 'Enviar'}</span>{isLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
				</Button>
			</div>
            <p className="inbox-composer-hint">{isRecording ? "Detené el audio antes de enviarlo. Cambiar de chat descarta la grabación." : "Enter para enviar · Shift + Enter para otra línea"}</p>
		</div>
	);
}
