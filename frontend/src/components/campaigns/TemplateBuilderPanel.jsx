import { useEffect, useMemo, useState } from 'react';

const defaultForm = {
  name: '',
  language: 'es_AR',
  category: 'MARKETING',
  headerType: 'TEXT',
  headerText: '',
  bodyText: '',
  footerText: '',
  buttonsText: '',
};

function splitButtons(rawValue = '') {
  return rawValue
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function buildPayload(form) {
  return {
    name: form.name.trim(),
    language: form.language,
    category: form.category,
    components: [
      form.headerText.trim()
        ? {
            type: 'HEADER',
            format: form.headerType,
            text: form.headerText.trim(),
          }
        : null,
      {
        type: 'BODY',
        text: form.bodyText.trim(),
      },
      form.footerText.trim()
        ? {
            type: 'FOOTER',
            text: form.footerText.trim(),
          }
        : null,
      splitButtons(form.buttonsText).length
        ? {
            type: 'BUTTONS',
            buttons: splitButtons(form.buttonsText).map((text) => ({
              type: 'QUICK_REPLY',
              text,
            })),
          }
        : null,
    ].filter(Boolean),
  };
}

function getVariableNumbers(text = '') {
  const matches = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1]));
  return [...new Set(matches)].sort((a, b) => a - b);
}

export default function TemplateBuilderPanel({
  selectedTemplate,
  onCreateTemplate,
  onUpdateTemplate,
  creating,
  updating,
}) {
  const [form, setForm] = useState(defaultForm);

  useEffect(() => {
    if (!selectedTemplate) {
      setForm(defaultForm);
      return;
    }

    const buttonLines = (selectedTemplate.buttons || [])
      .map((button) => button.text)
      .filter(Boolean)
      .join('\n');

    setForm({
      name: selectedTemplate.name || '',
      language: selectedTemplate.language || 'es_AR',
      category: selectedTemplate.category || 'MARKETING',
      headerType: selectedTemplate.headerType || 'TEXT',
      headerText: selectedTemplate.headerText || '',
      bodyText: selectedTemplate.bodyText || '',
      footerText: selectedTemplate.footerText || '',
      buttonsText: buttonLines,
    });
  }, [selectedTemplate]);

  const variables = useMemo(() => {
    return getVariableNumbers(`${form.headerText}\n${form.bodyText}\n${form.footerText}`);
  }, [form]);

  const previewButtons = useMemo(() => splitButtons(form.buttonsText), [form.buttonsText]);

  async function handleSubmit(event) {
    event.preventDefault();

    const payload = buildPayload(form);

    if (!payload.name || !payload.components.find((component) => component.type === 'BODY')?.text) {
      return;
    }

    if (selectedTemplate?.id) {
      await onUpdateTemplate(selectedTemplate.id, payload);
      return;
    }

    await onCreateTemplate(payload);
    setForm(defaultForm);
  }

  return (
    <section className="campaign-panel">
      <div className="campaign-panel-header">
        <div>
          <h3>{selectedTemplate ? 'Editar template' : 'Crear template nuevo'}</h3>
          <p>Armá la plantilla, previsualizala y mandala a revisión desde el panel.</p>
        </div>
      </div>

      <div className="campaign-builder-grid">
        <form className="campaign-form" onSubmit={handleSubmit}>
          <div className="campaign-form-grid two-columns">
            <label className="field">
              <span>Nombre interno</span>
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="promo_body_abril"
              />
            </label>

            <label className="field">
              <span>Idioma</span>
              <select
                value={form.language}
                onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}
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
                onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
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
                onChange={(event) => setForm((current) => ({ ...current, headerType: event.target.value }))}
              >
                <option value="TEXT">TEXT</option>
                <option value="IMAGE">IMAGE</option>
                <option value="VIDEO">VIDEO</option>
                <option value="DOCUMENT">DOCUMENT</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span>Header</span>
            <input
              value={form.headerText}
              onChange={(event) => setForm((current) => ({ ...current, headerText: event.target.value }))}
              placeholder="Hola {{1}}"
            />
          </label>

          <label className="field">
            <span>Body</span>
            <textarea
              rows={7}
              value={form.bodyText}
              onChange={(event) => setForm((current) => ({ ...current, bodyText: event.target.value }))}
              placeholder="Escribí el cuerpo del mensaje con variables {{1}}, {{2}}..."
            />
          </label>

          <div className="campaign-form-grid two-columns">
            <label className="field">
              <span>Footer</span>
              <input
                value={form.footerText}
                onChange={(event) => setForm((current) => ({ ...current, footerText: event.target.value }))}
                placeholder="Lummine · Atención por WhatsApp"
              />
            </label>

            <label className="field">
              <span>Botones rápidos</span>
              <textarea
                rows={3}
                value={form.buttonsText}
                onChange={(event) => setForm((current) => ({ ...current, buttonsText: event.target.value }))}
                placeholder={['Ver catálogo', 'Quiero mi promo', 'Hablar con asesor'].join('\n')}
              />
            </label>
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

          <div className="campaign-form-actions">
            <button className="button primary" type="submit" disabled={creating || updating}>
              {selectedTemplate ? (updating ? 'Guardando…' : 'Guardar cambios') : creating ? 'Creando…' : 'Crear template'}
            </button>
          </div>
        </form>

        <div className="campaign-preview-shell">
          <div className="campaign-whatsapp-preview">
            <div className="campaign-preview-phone-bar">WhatsApp preview</div>
            <div className="campaign-preview-bubble">
              {form.headerText ? <div className="campaign-preview-header">{form.headerText}</div> : null}
              <div className="campaign-preview-body">{form.bodyText || 'El cuerpo del template se ve acá.'}</div>
              {form.footerText ? <div className="campaign-preview-footer">{form.footerText}</div> : null}
              {previewButtons.length ? (
                <div className="campaign-preview-buttons">
                  {previewButtons.map((button) => (
                    <button key={button} type="button">
                      {button}
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
