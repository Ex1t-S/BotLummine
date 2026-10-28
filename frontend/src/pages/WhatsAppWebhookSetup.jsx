import { useState } from 'react';

export default function WhatsAppWebhookSetup({ app, form, onChange, onSave, saving, webhook, onReveal, revealing }) {
	const [showToken, setShowToken] = useState(false);
	const [copyNotice, setCopyNotice] = useState('');
	async function copy(value, label) {
		try {
			await navigator.clipboard.writeText(value);
			setCopyNotice(`${label} copiado.`);
		} catch {
			setCopyNotice('No se pudo copiar. Seleccioná el valor y copialo manualmente.');
		}
	}
	const field = (label, key, options = {}) => (
		<label className="admin-field">
			<span>{label}</span>
			<input {...options} value={form[key]} onChange={(event) => onChange((current) => ({ ...current, [key]: event.target.value }))} />
		</label>
	);
	return (
		<div className="wa-setup-webhook-step">
			<h4>1. Generar webhook</h4>
			<p>Cargá el App ID y el App Secret de Meta. BladeIA guarda la App y genera la URL y el token de verificación.</p>
			<form className="tenant-admin-grid" onSubmit={onSave}>
				{field('App ID de Meta', 'metaAppId', { required: true, inputMode: 'numeric' })}
				{field('App Secret', 'appSecret', { type: 'password', required: !form.id, autoComplete: 'new-password', placeholder: form.id ? 'Guardado · dejá vacío para conservarlo' : '' })}
				<details className="wa-setup-optional wa-setup-full-width">
					<summary>Opciones de la App</summary>
					<div className="tenant-admin-grid">
						{field('Nombre de la App', 'name')}
						{field('ID del portfolio (opcional)', 'businessManagerId', { inputMode: 'numeric' })}
						{field('Verify Token propio (opcional)', 'verifyToken', { type: 'password', autoComplete: 'new-password', placeholder: 'BladeIA lo genera al crear la App' })}
						{field('Versión de Graph', 'graphVersion')}
						{field('Config ID de Embedded Signup (opcional)', 'embeddedSignupConfigId', { inputMode: 'numeric' })}
						<label className="admin-field"><span>Estado de la App</span><select value={form.status} onChange={(event) => onChange((current) => ({ ...current, status: event.target.value }))}><option value="ACTIVE">Activa</option><option value="DISABLED">Desactivada</option><option value="ERROR">Con errores</option></select></label>
					</div>
					<small>Al editar, dejá los secretos vacíos para conservarlos. Cambiar el Verify Token requiere verificarlo otra vez en Meta.</small>
				</details>
				<button type="submit" disabled={saving}>{saving ? 'Guardando App…' : app ? 'Guardar App y ver webhook' : 'Generar webhook'}</button>
			</form>
			{app?.callbackUrl ? (
				<div className="wa-setup-callback">
					<strong>Copiá estos datos en Meta → WhatsApp → Configuración</strong>
					<span>Callback URL</span>
					<code>{app.callbackUrl}</code>
					<button type="button" onClick={() => copy(app.callbackUrl, 'Callback URL')}>Copiar URL</button>
					{webhook?.verifyToken ? <>
						<label className="admin-field"><span>Verify Token</span><input readOnly type={showToken ? 'text' : 'password'} value={webhook.verifyToken} /></label>
						<div className="wa-setup-token-actions"><button type="button" onClick={() => copy(webhook.verifyToken, 'Verify Token')}>Copiar Verify Token</button><button type="button" onClick={() => setShowToken((current) => !current)}>{showToken ? 'Ocultar token' : 'Mostrar token'}</button></div>
					</> : <button type="button" disabled={revealing || saving} onClick={onReveal}>{revealing ? 'Cargando…' : 'Ver Verify Token guardado'}</button>}
					<p>En Meta, pulsá <strong>Verificar y guardar</strong> y suscribí el campo <code>messages</code>. Después completá los datos del número y pulsá Conectar.</p>
					{copyNotice ? <small role="status">{copyNotice}</small> : null}
				</div>
			) : null}
		</div>
	);
}
