const META_BUSINESS_SETTINGS_URL = 'https://business.facebook.com/settings/';

function Step({ number, title, complete, children }) {
	return (
		<li className={`wa-setup-step${complete ? ' is-complete' : ''}`}>
			<span className="wa-setup-step-number" aria-hidden="true">{complete ? '✓' : number}</span>
			<div>
				<strong>{title}</strong>
				<div className="wa-setup-step-copy">{children}</div>
			</div>
		</li>
	);
}

export default function WhatsAppManualGuide({ app, channel, check, platformAdmin }) {
	const appUrl = app?.metaAppId ? `https://developers.facebook.com/apps/${encodeURIComponent(app.metaAppId)}/` : 'https://developers.facebook.com/apps/';
	const appConfigured = Boolean(app?.metaAppId && app?.callbackUrl);
	const channelLinked = Boolean(channel?.phoneNumberId && channel?.status === 'ACTIVE');
	const tokenExpiresAt = Number(check?.messagingPermissionCheck?.expiresAt || 0);
	const tokenExpiresSoon = tokenExpiresAt > 0 && tokenExpiresAt * 1000 < Date.now() + 7 * 24 * 60 * 60 * 1000;
	return (
		<div className="wa-setup-guide">
			<div className="wa-setup-guide-heading">
				<div>
					<strong>Conexión manual de WhatsApp Cloud API</strong>
					<p>Para una marca con su propia App y WABA. No requiere Embedded Signup ni ser proveedor de tecnología.</p>
				</div>
				<span>{channelLinked ? 'Canal vinculado' : 'Configuración pendiente'}</span>
			</div>
			<ol className="wa-setup-steps">
				<Step number="1" title="Registrar la App de la marca" complete={appConfigured}>
					En <a href={appUrl} target="_blank" rel="noreferrer">Meta for Developers</a>, abrí la App de esta marca y el caso de uso WhatsApp. En <a href={META_BUSINESS_SETTINGS_URL} target="_blank" rel="noreferrer">Configuración del negocio</a>, comprobá que la WABA y el número pertenecen al negocio correcto. El número de prueba de Meta no sirve para producción.
				</Step>
				<Step number="2" title="Dar acceso al usuario del sistema" complete={Boolean(check?.messagingPermissionCheck?.checked && !check?.messagingPermissionCheck?.missingScopes?.length && !tokenExpiresSoon)}>
				En Configuración del negocio → Usuarios → Usuarios del sistema, asignale la WABA y generá un token para <strong>esta App</strong> con <code>whatsapp_business_management</code> y <code>whatsapp_business_messaging</code>. Un token temporal de “Probar API” no es adecuado para producción.
				</Step>
				<Step number="3" title="Suscribir la App a la WABA" complete={Boolean(check?.subscription?.subscribed)}>
				En la App → WhatsApp → Configuración, pegá la Callback URL de abajo y el mismo Verify Token guardado en BladeIA. Verificá y suscribí el campo <code>messages</code>. Al vincular el canal, BladeIA también suscribe la App a la WABA.
				</Step>
				<Step number="4" title="Comprobar WABA, Phone Number ID y token" complete={Boolean(check?.ok)}>
				Copiá los identificadores del <strong>número real</strong> desde WhatsApp Manager o la configuración de la API. Pegalos abajo junto con el token y pulsá “Comprobar con Meta”. Solo después, vinculá el canal.
				</Step>
				<Step number="5" title="Probar entrada y salida" complete={false}>
				Enviá un mensaje desde un teléfono de prueba autorizado y verificá que llegue a la bandeja. Respondé desde BladeIA y comprobá que el destinatario lo reciba. Un número verificado en el negocio todavía puede requerir registro en Cloud API; esta comprobación no lo registra automáticamente.
				</Step>
			</ol>
			{tokenExpiresSoon ? <p className="wa-setup-caution">Este token vence pronto. Generá uno de usuario del sistema antes de dejar el canal en producción.</p> : null}
			<p className="wa-setup-caution">Si ese número sigue funcionando en la app WhatsApp Business, no lo elimines ni lo migres a ciegas: la coexistencia puede necesitar un proveedor habilitado. Primero verificá su estado en WhatsApp Manager.</p>
			{!platformAdmin ? <p className="wa-setup-caution">La vinculación final la realiza un administrador de BladeIA. Podés compartirle estos pasos y los identificadores, pero nunca enviar el token por chat.</p> : null}
		</div>
	);
}
