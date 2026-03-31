import { useEffect, useMemo, useState } from 'react';
import { uploadCampaignHeaderImage } from '../../lib/campaigns.js';

const defaultAudienceText = `5492210000000|German|Body Modelador Reductor|XL|negro
5492210000001|Magali|Body Bretel Fino|L|beige`;

const initialForm = {
  name: '',
  description: '',
  audienceText: defaultAudienceText,
  sendNow: false,
};

function normalizeType(value = '') {
  return String(value || '').trim().toUpperCase();
}

function getTemplateComponents(template) {
  if (Array.isArray(template?.components)) {
    return template.components;
  }

  if (Array.isArray(template?.rawPayload?.components)) {
    return template.rawPayload.components;
  }

  return [];
}

function templateRequiresHeaderImage(template) {
  const components = getTemplateComponents(template);

  const header = components.find(
    (component) => normalizeType(component?.type) === 'HEADER'
  );

  if (!header) return false;

  return normalizeType(header?.format) === 'IMAGE';
}

function parseAudience(rawValue = '', extraVariables = {}) {
  return rawValue
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [phone, contactName, productName, size, color] = row
        .split('|')
        .map((value) => value?.trim() || '');

      return {
        phone,
        contactName,
        variables: {
          '1': contactName || '',
          '2': productName || '',
          '3': size || '',
          '4': color || '',
          contact_name: contactName || '',
          first_name: (contactName || '').split(/\s+/).filter(Boolean)[0] || '',
          product_name: productName || '',
          size: size || '',
          color: color || '',
          ...extraVariables,
        },
      };
    })
    .filter((item) => item.phone);
}

function extractCreatedCampaignId(result) {
  return (
    result?.id ||
    result?.campaign?.id ||
    result?.data?.id ||
    result?.data?.campaign?.id ||
    null
  );
}

export default function CampaignComposerPanel({
  templates = [],
  selectedTemplate,
  onSelectTemplate,
  onCreateCampaign,
  creating,
}) {
  const [form, setForm] = useState(initialForm);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadedMediaId, setUploadedMediaId] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [imageError, setImageError] = useState('');

  useEffect(() => {
    if (!selectedTemplate && templates.length) {
      onSelectTemplate(templates[0]);
    }
  }, [templates, selectedTemplate, onSelectTemplate]);

  useEffect(() => {
    setUploadedMediaId('');
    setUploadedFileName('');
    setImageError('');
  }, [selectedTemplate?.id]);

  const requiresHeaderImage = useMemo(
    () => templateRequiresHeaderImage(selectedTemplate),
    [selectedTemplate]
  );

  const recipients = useMemo(() => {
    const extraVariables = uploadedMediaId
      ? { header_image_id: uploadedMediaId }
      : {};

    return parseAudience(form.audienceText, extraVariables);
  }, [form.audienceText, uploadedMediaId]);

  const estimatedCost = useMemo(() => recipients.length * 0.032, [recipients.length]);

  async function handleImageChange(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    setImageError('');
    setUploadingImage(true);

    try {
      const result = await uploadCampaignHeaderImage(file);
      const mediaId = result?.mediaId || '';

      if (!mediaId) {
        throw new Error('Meta no devolvió mediaId para la imagen.');
      }

      setUploadedMediaId(mediaId);
      setUploadedFileName(file.name);
    } catch (error) {
      setUploadedMediaId('');
      setUploadedFileName('');
      setImageError(
        error?.response?.data?.error ||
          error?.message ||
          'No se pudo subir la imagen del encabezado.'
      );
    } finally {
      setUploadingImage(false);
      event.target.value = '';
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!selectedTemplate?.id) return;

    if (requiresHeaderImage && !uploadedMediaId) {
      setImageError('Esta plantilla requiere una imagen de encabezado antes de crear la campaña.');
      return;
    }

    const payload = {
      name: form.name.trim(),
      templateId: selectedTemplate.id,
      languageCode: selectedTemplate.language || 'es_AR',
      recipients,
      audienceSource: 'manual',
      notes: form.description.trim() || null,
      sendComponents: Array.isArray(selectedTemplate.components) ? selectedTemplate.components : [],
    };

    const result = await onCreateCampaign(payload);
    const createdCampaignId = extractCreatedCampaignId(result);

    if (form.sendNow) {
      if (createdCampaignId && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('campaign:launch-requested', {
            detail: { campaignId: createdCampaignId },
          })
        );
      } else {
        console.error(
          '[CAMPAIGN] No se pudo obtener el campaignId del resultado de creación',
          result
        );
      }
    }

    setForm(initialForm);
    setUploadedMediaId('');
    setUploadedFileName('');
    setImageError('');
  }

  return (
    <section className="campaign-panel">
      <div className="campaign-panel-header">
        <div>
          <h3>Crear campaña</h3>
          <p>Elegí template, cargá audiencia y dejala lista para enviar o despacharla al instante.</p>
        </div>
      </div>

      <form className="campaign-form" onSubmit={handleSubmit}>
        <div className="campaign-form-grid two-columns">
          <label className="field">
            <span>Nombre de campaña</span>
            <input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Recuperación abril - bodys"
            />
          </label>

          <label className="field">
            <span>Template</span>
            <select
              value={selectedTemplate?.id || ''}
              onChange={(event) => {
                const template = templates.find((item) => item.id === event.target.value);
                if (template) onSelectTemplate(template);
              }}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} · {template.language}
                </option>
              ))}
            </select>
          </label>
        </div>

        {requiresHeaderImage ? (
          <div className="field">
            <span>Imagen del encabezado</span>

            <div
              style={{
                border: '1px solid #d7dceb',
                borderRadius: '14px',
                padding: '14px',
                display: 'grid',
                gap: '10px',
                background: '#fafbff',
              }}
            >
              <div style={{ fontSize: '0.92rem', color: '#5d6b8a' }}>
                Esta plantilla requiere una imagen en el header para poder enviarse.
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <label
                  className="button secondary"
                  style={{ cursor: uploadingImage ? 'not-allowed' : 'pointer' }}
                >
                  {uploadingImage ? 'Subiendo…' : uploadedMediaId ? 'Cambiar imagen' : 'Subir imagen'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    disabled={uploadingImage}
                    style={{ display: 'none' }}
                  />
                </label>

                {uploadedFileName ? (
                  <span style={{ fontSize: '0.92rem', color: '#1f2a44' }}>
                    {uploadedFileName}
                  </span>
                ) : null}
              </div>

              {uploadedMediaId ? (
                <div
                  style={{
                    fontSize: '0.9rem',
                    color: '#0a7a33',
                    background: '#eefaf1',
                    border: '1px solid #cbeed4',
                    padding: '10px 12px',
                    borderRadius: '10px',
                  }}
                >
                  Imagen cargada correctamente. Media ID: <strong>{uploadedMediaId}</strong>
                </div>
              ) : null}

              {imageError ? (
                <div
                  style={{
                    fontSize: '0.9rem',
                    color: '#a61c1c',
                    background: '#fff1f1',
                    border: '1px solid #f2caca',
                    padding: '10px 12px',
                    borderRadius: '10px',
                  }}
                >
                  {imageError}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <label className="field">
          <span>Descripción</span>
          <input
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({ ...current, description: event.target.value }))
            }
            placeholder="Campaña para compradores que dejaron checkout a mitad de camino"
          />
        </label>

        <label className="field">
          <span>Audiencia</span>
          <textarea
            rows={8}
            value={form.audienceText}
            onChange={(event) =>
              setForm((current) => ({ ...current, audienceText: event.target.value }))
            }
            placeholder="telefono|nombre|producto|talle|color"
          />
          <small>Formato: teléfono|nombre|producto|talle|color. Una fila por destinatario.</small>
        </label>

        <div className="campaign-composer-summary">
          <div>
            <strong>{recipients.length}</strong>
            <span>destinatarios estimados</span>
          </div>
          <div>
            <strong>USD {estimatedCost.toFixed(2)}</strong>
            <span>costo estimado</span>
          </div>
          <label className="campaign-toggle">
            <input
              type="checkbox"
              checked={form.sendNow}
              onChange={(event) =>
                setForm((current) => ({ ...current, sendNow: event.target.checked }))
              }
            />
            <span>Enviar apenas se cree</span>
          </label>
        </div>

        <div className="campaign-form-actions">
          <button
            className="button primary"
            type="submit"
            disabled={
              creating ||
              !selectedTemplate?.id ||
              (requiresHeaderImage && !uploadedMediaId)
            }
          >
            {creating ? 'Guardando…' : form.sendNow ? 'Crear y despachar' : 'Guardar campaña'}
          </button>
        </div>
      </form>
    </section>
  );
}