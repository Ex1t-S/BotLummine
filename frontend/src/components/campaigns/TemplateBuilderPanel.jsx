import { useEffect, useMemo, useState } from 'react';
import { uploadCampaignHeaderImage } from '../../lib/campaigns.js';

function createEmptyButton(type = 'QUICK_REPLY') {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    text: '',
    url: '',
    phoneNumber: '',
  };
}

const defaultForm = {
  name: '',
  language: 'es_AR',
  category: 'MARKETING',
  headerType: 'TEXT',
  headerText: '',
  headerMediaId: '',
  headerMediaPreviewUrl: '',
  headerAssetHandle: '',
  bodyText: '',
  footerText: '',
  buttons: [],
};

function normalizeString(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function toUpper(value, fallback = '') {
  return normalizeString(value, fallback).toUpperCase();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getComponentByType(components = [], type = '') {
  return safeArray(components).find((component) => toUpper(component?.type) === toUpper(type)) || null;
}

function normalizeButton(button = {}, index = 0) {
  return {
    id: button.id || `button_${index}_${Math.random().toString(36).slice(2, 8)}`,
    type: toUpper(button.type, 'QUICK_REPLY'),
    text: normalizeString(button.text || ''),
    url: normalizeString(button.url || ''),
    phoneNumber: normalizeString(button.phone_number || button.phoneNumber || ''),
  };
}

function extractHeaderHandle(header = {}, template = {}) {
  const fromExample = safeArray(header?.example?.header_handle)[0];
  const fromRawPayload = template?.rawPayload?.headerMedia?.headerHandle;
  const fromTemplate = template?.headerMedia?.headerHandle;

  return normalizeString(fromExample || fromRawPayload || fromTemplate || '');
}

function mapTemplateToForm(template) {
  if (!template) {
    return { ...defaultForm };
  }

  const components = safeArray(template?.rawPayload?.components);
  const header = getComponentByType(components, 'HEADER');
  const body = getComponentByType(components, 'BODY');
  const footer = getComponentByType(components, 'FOOTER');
  const buttonsComponent = getComponentByType(components, 'BUTTONS');

  return {
    name: normalizeString(template.name || ''),
    language: normalizeString(template.language || 'es_AR', 'es_AR'),
    category: toUpper(template.category || 'MARKETING', 'MARKETING'),
    headerType: toUpper(header?.format || template.headerFormat || 'TEXT', 'TEXT'),
    headerText: normalizeString(header?.text || template.headerText || ''),
    headerMediaId: normalizeString(
      header?.image?.id || template?.rawPayload?.headerMedia?.mediaId || ''
    ),
    headerMediaPreviewUrl: normalizeString(
      header?.image?.link || template?.rawPayload?.headerMedia?.previewUrl || ''
    ),
    headerAssetHandle: extractHeaderHandle(header, template),
    bodyText: normalizeString(body?.text || template.bodyText || ''),
    footerText: normalizeString(footer?.text || template.footerText || ''),
    buttons: safeArray(buttonsComponent?.buttons).map((button, index) => normalizeButton(button, index)),
  };
}

function buildButtonsComponent(buttons = []) {
  const normalized = safeArray(buttons)
    .map((button, index) => normalizeButton(button, index))
    .filter((button) => button.text);

  if (!normalized.length) {
    return null;
  }

  return {
    type: 'BUTTONS',
    buttons: normalized.map((button) => {
      if (button.type === 'URL') {
        return {
          type: 'URL',
          text: button.text,
          url: button.url,
        };
      }

      if (button.type === 'PHONE_NUMBER') {
        return {
          type: 'PHONE_NUMBER',
          text: button.text,
          phone_number: button.phoneNumber,
        };
      }

      return {
        type: 'QUICK_REPLY',
        text: button.text,
      };
    }),
  };
}

function buildSampleValue(variableNumber, context = 'general') {
  if (context === 'name') return `Ejemplo ${variableNumber}`;
  if (context === 'header') return `Dato ${variableNumber}`;
  if (context === 'phone') return `54922100000${variableNumber}`;
  if (context === 'url') return `ejemplo-${variableNumber}`;
  return `Valor ${variableNumber}`;
}

function buildHeaderComponent(form) {
  if (form.headerType === 'TEXT' && form.headerText.trim()) {
    const headerVariables = getVariableNumbers(form.headerText);
    const component = {
      type: 'HEADER',
      format: 'TEXT',
      text: form.headerText.trim(),
    };

    if (headerVariables.length) {
      component.example = {
        header_text: headerVariables.map((variableNumber) => buildSampleValue(variableNumber, 'header')),
      };
    }

    return component;
  }

  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.headerType)) {
    const headerComponent = {
      type: 'HEADER',
      format: form.headerType,
    };

    if (form.headerAssetHandle) {
      headerComponent.example = {
        header_handle: [form.headerAssetHandle],
      };
    }

    return headerComponent;
  }

  return null;
}

function buildBodyComponent(form) {
  const bodyVariables = getVariableNumbers(form.bodyText);
  const component = {
    type: 'BODY',
    text: form.bodyText.trim(),
  };

  if (bodyVariables.length) {
    component.example = {
      body_text: [bodyVariables.map((variableNumber) => buildSampleValue(variableNumber, 'name'))],
    };
  }

  return component;
}

function buildPayload(form) {
  const components = [];
  const headerComponent = buildHeaderComponent(form);

  if (headerComponent) {
    components.push(headerComponent);
  }

  components.push(buildBodyComponent(form));

  if (form.footerText.trim()) {
    components.push({
      type: 'FOOTER',
      text: form.footerText.trim(),
    });
  }

  const buttonsComponent = buildButtonsComponent(form.buttons);
  if (buttonsComponent) {
    components.push(buttonsComponent);
  }

  return {
    name: form.name.trim(),
    language: form.language,
    category: form.category,
    components,
    headerMedia:
      form.headerType === 'IMAGE'
        ? {
            mediaId: normalizeString(form.headerMediaId || '') || null,
            previewUrl: normalizeString(form.headerMediaPreviewUrl || '') || null,
            headerHandle: normalizeString(form.headerAssetHandle || '') || null,
          }
        : null,
  };
}

function getVariableNumbers(text = '') {
  const matches = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1]));
  return [...new Set(matches)].sort((a, b) => a - b);
}

function describeButtonType(type = '') {
  if (type === 'URL') return 'Abrir enlace';
  if (type === 'PHONE_NUMBER') return 'Llamar';
  return 'Respuesta rápida';
}

function isMetaSampleTemplate(template) {
  return String(template?.name || '').trim().toLowerCase() === 'hello_world';
}

function extractUploadValue(response = {}, keys = []) {
  for (const key of keys) {
    const value = response?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

export default function TemplateBuilderPanel({
  selectedTemplate,
  onCreateTemplate,
  onUpdateTemplate,
  creating,
  updating,
}) {
  const [form, setForm] = useState(defaultForm);
  const [localError, setLocalError] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [forcedCreateMode, setForcedCreateMode] = useState(false);

  useEffect(() => {
    if (selectedTemplate?.id) {
      setForm(mapTemplateToForm(selectedTemplate));
      setForcedCreateMode(false);
    } else {
      setForm({ ...defaultForm });
      setForcedCreateMode(true);
    }
    setLocalError('');
  }, [selectedTemplate?.id]);

  const isEditingSelectedTemplate = Boolean(selectedTemplate?.id) && !forcedCreateMode;
  const isReadOnlyTemplate = isEditingSelectedTemplate && isMetaSampleTemplate(selectedTemplate);

  const variables = useMemo(() => {
    const buttonUrls = safeArray(form.buttons)
      .map((button) => button.url || '')
      .join('\n');

    return getVariableNumbers(
      `${form.headerText}\n${form.bodyText}\n${form.footerText}\n${buttonUrls}`
    );
  }, [form]);

  const previewButtons = useMemo(() => {
    return safeArray(form.buttons)
      .map((button, index) => normalizeButton(button, index))
      .filter((button) => button.text);
  }, [form.buttons]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateButton(buttonId, patch) {
    setForm((current) => ({
      ...current,
      buttons: safeArray(current.buttons).map((button) =>
        button.id === buttonId ? { ...button, ...patch } : button
      ),
    }));
  }

  function addButton(type = 'QUICK_REPLY') {
    setForm((current) => {
      if (safeArray(current.buttons).length >= 3) {
        return current;
      }

      return {
        ...current,
        buttons: [...safeArray(current.buttons), createEmptyButton(type)],
      };
    });
  }

  function removeButton(buttonId) {
    setForm((current) => ({
      ...current,
      buttons: safeArray(current.buttons).filter((button) => button.id !== buttonId),
    }));
  }

  function startCreateMode() {
    setForcedCreateMode(true);
    setForm({ ...defaultForm });
    setLocalError('');
  }

  function restoreSelectedTemplate() {
    if (!selectedTemplate?.id) {
      startCreateMode();
      return;
    }

    setForcedCreateMode(false);
    setForm(mapTemplateToForm(selectedTemplate));
    setLocalError('');
  }

  async function handleImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setLocalError('');
    setUploadingImage(true);

    try {
      const response = await uploadCampaignHeaderImage(file);
      const previewUrl = URL.createObjectURL(file);
      const nextMediaId = extractUploadValue(response, ['mediaId', 'id']);
      const nextHeaderHandle = extractUploadValue(response, [
        'headerHandle',
        'header_handle',
        'mediaHandle',
        'handle',
      ]);

      setForm((current) => ({
        ...current,
        headerType: 'IMAGE',
        headerMediaId: nextMediaId,
        headerMediaPreviewUrl: previewUrl,
        headerAssetHandle: nextHeaderHandle,
      }));

      if (!nextHeaderHandle) {
        setLocalError(
          'La imagen se subió, pero el backend no devolvió un header_handle. Para templates con IMAGE, Meta exige ese handle de ejemplo.'
        );
      }
    } catch (error) {
      setLocalError(
        error?.response?.data?.error || 'No se pudo subir la imagen del header.'
      );
    } finally {
      setUploadingImage(false);
      event.target.value = '';
    }
  }

  function validatePayload(payload) {
    if (!payload.name) {
      return 'Poné un nombre interno para el template.';
    }

    const bodyComponent = payload.components.find((component) => component.type === 'BODY');
    const bodyText = bodyComponent?.text;
    if (!bodyText) {
      return 'El body del template es obligatorio.';
    }

    if (getVariableNumbers(bodyText).length && !bodyComponent?.example?.body_text?.[0]?.length) {
      return 'Si el body usa variables como {{1}}, Meta exige examples.body_text. Ya debería armarse solo; si no, hay algo roto en el builder.';
    }

    if (form.headerType === 'TEXT' && !form.headerText.trim()) {
      return 'Si el header es de texto, completalo antes de guardar.';
    }

    if (form.headerType === 'IMAGE' && !form.headerAssetHandle) {
      return 'Para templates con header IMAGE necesitás subir una imagen que devuelva header_handle.';
    }

    for (const button of safeArray(form.buttons)) {
      if (!button.text.trim()) {
        return 'Todos los botones tienen que tener texto.';
      }

      if (button.type === 'URL' && !button.url.trim()) {
        return 'Los botones de enlace necesitan una URL.';
      }

      if (button.type === 'PHONE_NUMBER' && !button.phoneNumber.trim()) {
        return 'Los botones de llamada necesitan un número.';
      }
    }

    return '';
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (isReadOnlyTemplate) {
      setLocalError('El template hello_world es de muestra de Meta y no se puede editar. Creá uno nuevo.');
      return;
    }

    const payload = buildPayload(form);
    const validationError = validatePayload(payload);

    if (validationError) {
      setLocalError(validationError);
      return;
    }

    setLocalError('');

    if (isEditingSelectedTemplate) {
      await onUpdateTemplate(selectedTemplate.id, payload);
      return;
    }

    await onCreateTemplate(payload);
    setForcedCreateMode(true);
    setForm({ ...defaultForm });
  }

  return (
    <section className="campaign-panel">
      <div className="campaign-panel-header">
        <div>
          <h3>{isEditingSelectedTemplate ? 'Editar template' : 'Crear template nuevo'}</h3>
          <p>
            Ahora sí: podés crear uno nuevo aunque tengas un template seleccionado, con header image real,
            botones con link y un payload que Meta no te rebote por faltarle el ejemplo.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {!forcedCreateMode ? (
            <button type="button" className="button secondary" onClick={startCreateMode}>
              + Nuevo template
            </button>
          ) : null}

          {forcedCreateMode && selectedTemplate?.id ? (
            <button type="button" className="button ghost" onClick={restoreSelectedTemplate}>
              Volver a editar seleccionado
            </button>
          ) : null}
        </div>
      </div>

      <div className="campaign-builder-grid">
        <form className="campaign-form" onSubmit={handleSubmit}>
          {isReadOnlyTemplate ? (
            <div
              style={{
                marginBottom: 14,
                padding: '12px 14px',
                borderRadius: 12,
                background: '#fff7ed',
                border: '1px solid #fdba74',
                color: '#9a3412',
                fontWeight: 600,
              }}
            >
              Estás viendo un template sample de Meta. No se puede editar ni eliminar desde la API. Tocá{' '}
              <strong>+ Nuevo template</strong> y creá uno propio.
            </div>
          ) : null}

          <div className="campaign-form-grid two-columns">
            <label className="field">
              <span>Nombre interno</span>
              <input
                value={form.name}
                onChange={(event) => updateForm('name', event.target.value)}
                placeholder="promo_body_abril"
              />
            </label>

            <label className="field">
              <span>Idioma</span>
              <select
                value={form.language}
                onChange={(event) => updateForm('language', event.target.value)}
              >
                <option value="es_AR">es_AR</option>
                <option value="es_ES">es_ES</option>
                <option value="en_US">en_US</option>
                <option value="pt_BR">pt_BR</option>
              </select>
            </label>

            <label className="field">
              <span>Categoría</span>
              <select
                value={form.category}
                onChange={(event) => updateForm('category', event.target.value)}
              >
                <option value="MARKETING">MARKETING</option>
                <option value="UTILITY">UTILITY</option>
                <option value="AUTHENTICATION">AUTHENTICATION</option>
              </select>
            </label>

            <label className="field">
              <span>Tipo de header</span>
              <select
                value={form.headerType}
                onChange={(event) => {
                  const nextType = event.target.value;
                  setForm((current) => ({
                    ...current,
                    headerType: nextType,
                    headerText: nextType === 'TEXT' ? current.headerText : '',
                    ...(nextType !== 'IMAGE'
                      ? {
                          headerMediaId: '',
                          headerMediaPreviewUrl: '',
                          headerAssetHandle: '',
                        }
                      : {}),
                  }));
                }}
              >
                <option value="TEXT">TEXT</option>
                <option value="IMAGE">IMAGE</option>
                <option value="VIDEO">VIDEO</option>
                <option value="DOCUMENT">DOCUMENT</option>
              </select>
            </label>
          </div>

          {form.headerType === 'TEXT' ? (
            <label className="field">
              <span>Header</span>
              <input
                value={form.headerText}
                onChange={(event) => updateForm('headerText', event.target.value)}
                placeholder="Hola {{1}}"
              />
            </label>
          ) : form.headerType === 'IMAGE' ? (
            <div
              className="field"
              style={{
                display: 'grid',
                gap: 12,
                padding: 14,
                border: '1px solid #e5e7eb',
                borderRadius: 14,
                background: '#fff',
              }}
            >
              <span>Imagen de header</span>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <label
                  style={{
                    height: 42,
                    padding: '0 14px',
                    borderRadius: 12,
                    border: '1px solid #d1d5db',
                    background: '#fff',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    cursor: uploadingImage ? 'wait' : 'pointer',
                  }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    style={{ display: 'none' }}
                    disabled={uploadingImage}
                  />
                  {uploadingImage ? 'Subiendo imagen...' : 'Subir imagen'}
                </label>

                {(form.headerMediaId || form.headerMediaPreviewUrl || form.headerAssetHandle) ? (
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        headerMediaId: '',
                        headerMediaPreviewUrl: '',
                        headerAssetHandle: '',
                      }))
                    }
                  >
                    Quitar imagen
                  </button>
                ) : null}
              </div>

              {form.headerAssetHandle ? (
                <div style={{ fontSize: 12, color: '#475569' }}>
                  Header handle listo: <strong>{form.headerAssetHandle}</strong>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#b45309' }}>
                  Para crear un template con IMAGE, Meta exige un <strong>header_handle</strong> de ejemplo.
                </div>
              )}

              {form.headerMediaId ? (
                <div style={{ fontSize: 12, color: '#475569' }}>
                  Media ID guardado: <strong>{form.headerMediaId}</strong>
                </div>
              ) : null}

              {form.headerMediaPreviewUrl ? (
                <div
                  style={{
                    borderRadius: 14,
                    border: '1px solid #e5e7eb',
                    padding: 10,
                    background: '#f8fafc',
                    width: 'fit-content',
                  }}
                >
                  <img
                    src={form.headerMediaPreviewUrl}
                    alt="Preview header"
                    style={{
                      width: 220,
                      maxWidth: '100%',
                      display: 'block',
                      borderRadius: 12,
                    }}
                  />
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Subí la imagen y el editor va a intentar guardar tanto el media id como el header handle.
                </div>
              )}
            </div>
          ) : (
            <div
              className="field"
              style={{
                padding: 14,
                border: '1px dashed #cbd5e1',
                borderRadius: 14,
                background: '#fff',
                color: '#64748b',
              }}
            >
              Por ahora el flujo fuerte queda resuelto para <strong>TEXT</strong> e <strong>IMAGE</strong>.
              Si después querés, dejamos VIDEO y DOCUMENT con upload real y su example también.
            </div>
          )}

          <label className="field">
            <span>Body</span>
            <textarea
              rows={7}
              value={form.bodyText}
              onChange={(event) => updateForm('bodyText', event.target.value)}
              placeholder="Escribí el cuerpo del mensaje con variables {{1}}, {{2}}..."
            />
          </label>

          <label className="field">
            <span>Footer</span>
            <input
              value={form.footerText}
              onChange={(event) => updateForm('footerText', event.target.value)}
              placeholder="Lummine · Atención por WhatsApp"
            />
          </label>

          <div
            className="field"
            style={{
              display: 'grid',
              gap: 12,
              padding: 14,
              border: '1px solid #e5e7eb',
              borderRadius: 14,
              background: '#fff',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <span>Botones</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => addButton('QUICK_REPLY')}
                  disabled={form.buttons.length >= 3}
                >
                  + Respuesta rápida
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => addButton('URL')}
                  disabled={form.buttons.length >= 3}
                >
                  + Enlace
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => addButton('PHONE_NUMBER')}
                  disabled={form.buttons.length >= 3}
                >
                  + Llamada
                </button>
              </div>
            </div>

            {form.buttons.length ? (
              <div style={{ display: 'grid', gap: 12 }}>
                {form.buttons.map((button, index) => (
                  <div
                    key={button.id}
                    style={{
                      display: 'grid',
                      gap: 10,
                      padding: 12,
                      border: '1px solid #e5e7eb',
                      borderRadius: 12,
                      background: '#f8fafc',
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr auto',
                        gap: 10,
                        alignItems: 'end',
                      }}
                    >
                      <label className="field" style={{ margin: 0 }}>
                        <span>Tipo</span>
                        <select
                          value={button.type}
                          onChange={(event) =>
                            updateButton(button.id, {
                              type: event.target.value,
                              url: event.target.value === 'URL' ? button.url : '',
                              phoneNumber: event.target.value === 'PHONE_NUMBER' ? button.phoneNumber : '',
                            })
                          }
                        >
                          <option value="QUICK_REPLY">QUICK_REPLY</option>
                          <option value="URL">URL</option>
                          <option value="PHONE_NUMBER">PHONE_NUMBER</option>
                        </select>
                      </label>

                      <label className="field" style={{ margin: 0 }}>
                        <span>Texto del botón</span>
                        <input
                          value={button.text}
                          onChange={(event) => updateButton(button.id, { text: event.target.value })}
                          placeholder={`Botón ${index + 1}`}
                        />
                      </label>

                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => removeButton(button.id)}
                        style={{ height: 42 }}
                      >
                        Quitar
                      </button>
                    </div>

                    {button.type === 'URL' ? (
                      <label className="field" style={{ margin: 0 }}>
                        <span>Enlace</span>
                        <input
                          value={button.url}
                          onChange={(event) => updateButton(button.id, { url: event.target.value })}
                          placeholder="https://tu-sitio.com/catalogo/{{1}}"
                        />
                      </label>
                    ) : null}

                    {button.type === 'PHONE_NUMBER' ? (
                      <label className="field" style={{ margin: 0 }}>
                        <span>Número</span>
                        <input
                          value={button.phoneNumber}
                          onChange={(event) => updateButton(button.id, { phoneNumber: event.target.value })}
                          placeholder="+5492210000000"
                        />
                      </label>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#64748b' }}>
                Podés dejarlo sin botones o agregar hasta 3.
              </div>
            )}
          </div>

          <div className="campaign-variable-box">
            <strong>Variables detectadas</strong>
            <div className="campaign-variable-list">
              {variables.length ? (
                variables.map((variable) => <span key={variable}>{`{{${variable}}}`}</span>)
              ) : (
                <span>Sin variables</span>
              )}
            </div>
          </div>

          {localError ? (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                fontWeight: 600,
              }}
            >
              {localError}
            </div>
          ) : null}

          <div className="campaign-form-actions">
            <button className="button primary" type="submit" disabled={creating || updating || uploadingImage}>
              {isEditingSelectedTemplate
                ? updating
                  ? 'Guardando…'
                  : 'Guardar cambios'
                : creating
                  ? 'Creando…'
                  : 'Crear template'}
            </button>
          </div>
        </form>

        <div className="campaign-preview-shell">
          <div className="campaign-whatsapp-preview">
            <div className="campaign-preview-phone-bar">WhatsApp preview</div>
            <div className="campaign-preview-bubble">
              {form.headerType === 'TEXT' && form.headerText ? (
                <div className="campaign-preview-header">{form.headerText}</div>
              ) : null}

              {form.headerType === 'IMAGE' ? (
                form.headerMediaPreviewUrl ? (
                  <div style={{ marginBottom: 10 }}>
                    <img
                      src={form.headerMediaPreviewUrl}
                      alt="Header preview"
                      style={{ width: '100%', display: 'block', borderRadius: 12 }}
                    />
                  </div>
                ) : (
                  <div
                    style={{
                      marginBottom: 10,
                      padding: '18px 12px',
                      borderRadius: 12,
                      background: '#dbeafe',
                      color: '#1d4ed8',
                      fontWeight: 700,
                      textAlign: 'center',
                    }}
                  >
                    Acá se verá la imagen del header
                  </div>
                )
              ) : null}

              <div className="campaign-preview-body">{form.bodyText || 'El cuerpo del template se ve acá.'}</div>
              {form.footerText ? <div className="campaign-preview-footer">{form.footerText}</div> : null}
              {previewButtons.length ? (
                <div className="campaign-preview-buttons">
                  {previewButtons.map((button) => (
                    <button key={button.id} type="button">
                      {button.text}
                      <small style={{ display: 'block', opacity: 0.7, fontSize: 11 }}>
                        {describeButtonType(button.type)}
                      </small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
