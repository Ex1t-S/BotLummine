import { useEffect, useMemo, useState } from 'react';

const defaultAudienceText = `5492210000000|German|Body Modelador Reductor|XL|negro
5492210000001|Magali|Body Bretel Fino|L|beige`;

const defaultVariablesText = '{"1":"German","2":"Body Modelador Reductor","3":"15% OFF"}';

const initialForm = {
  name: '',
  description: '',
  audienceText: defaultAudienceText,
  variablesText: defaultVariablesText,
  sendNow: false,
};

function parseAudience(rawValue = '') {
  return rawValue
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [phone, firstName, productName, size, color] = row.split('|').map((value) => value?.trim() || '');
      return {
        phone,
        firstName,
        productName,
        size,
        color,
      };
    })
    .filter((item) => item.phone);
}

function safeParseJson(rawValue, fallback) {
  try {
    return rawValue ? JSON.parse(rawValue) : fallback;
  } catch (_error) {
    return fallback;
  }
}

export default function CampaignComposerPanel({
  templates = [],
  selectedTemplate,
  onSelectTemplate,
  onCreateCampaign,
  creating,
}) {
  const [form, setForm] = useState(initialForm);

  useEffect(() => {
    if (!selectedTemplate && templates.length) {
      onSelectTemplate(templates[0]);
    }
  }, [templates, selectedTemplate, onSelectTemplate]);

  const audience = useMemo(() => parseAudience(form.audienceText), [form.audienceText]);
  const estimatedCost = useMemo(() => audience.length * 0.032, [audience.length]);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!selectedTemplate?.id) return;

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      templateId: selectedTemplate.id,
      sendNow: form.sendNow,
      audience,
      templateVariables: safeParseJson(form.variablesText, {}),
    };

    await onCreateCampaign(payload);
    setForm(initialForm);
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
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
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

        <label className="field">
          <span>Descripción</span>
          <input
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            placeholder="Campaña para compradores que dejaron checkout a mitad de camino"
          />
        </label>

        <label className="field">
          <span>Audiencia</span>
          <textarea
            rows={8}
            value={form.audienceText}
            onChange={(event) => setForm((current) => ({ ...current, audienceText: event.target.value }))}
            placeholder="telefono|nombre|producto|talle|color"
          />
          <small>Formato: teléfono|nombre|producto|talle|color. Una fila por destinatario.</small>
        </label>

        <label className="field">
          <span>Variables por defecto</span>
          <textarea
            rows={5}
            value={form.variablesText}
            onChange={(event) => setForm((current) => ({ ...current, variablesText: event.target.value }))}
            placeholder='{"1":"German","2":"Promo especial"}'
          />
          <small>Se usan como fallback si un destinatario no trae un valor específico.</small>
        </label>

        <div className="campaign-composer-summary">
          <div>
            <strong>{audience.length}</strong>
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
              onChange={(event) => setForm((current) => ({ ...current, sendNow: event.target.checked }))}
            />
            <span>Enviar apenas se cree</span>
          </label>
        </div>

        <div className="campaign-form-actions">
          <button className="button primary" type="submit" disabled={creating || !selectedTemplate?.id}>
            {creating ? 'Guardando…' : form.sendNow ? 'Crear y despachar' : 'Guardar campaña'}
          </button>
        </div>
      </form>
    </section>
  );
}
