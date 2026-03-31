import api from './api';

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

export async function fetchCampaignOverview() {
  const response = await api.get('/api/campaigns/overview');
  return unwrap(response);
}

export async function fetchTemplates(params = {}) {
  const response = await api.get('/api/campaigns/templates', { params });
  return unwrap(response);
}

export async function syncTemplates() {
  const response = await api.post('/api/campaigns/templates/sync');
  return unwrap(response);
}

export async function createTemplate(payload) {
  const response = await api.post('/api/campaigns/templates', payload);
  return unwrap(response);
}

export async function updateTemplate(templateId, payload) {
  const response = await api.patch(`/api/campaigns/templates/${templateId}`, payload);
  return unwrap(response);
}

export async function deleteTemplate(templateId) {
  const response = await api.delete(`/api/campaigns/templates/${templateId}`);
  return unwrap(response);
}

export async function fetchCampaigns(params = {}) {
  const response = await api.get('/api/campaigns', { params });
  return unwrap(response);
}

export async function fetchCampaignDetail(campaignId) {
  const response = await api.get(`/api/campaigns/${campaignId}`);
  return unwrap(response);
}

export async function createCampaign(payload) {
  const response = await api.post('/api/campaigns', payload);
  return unwrap(response);
}

export async function dispatchCampaign(campaignId) {
  const response = await api.post(`/api/campaigns/${campaignId}/dispatch`);
  return unwrap(response);
}

export async function pauseCampaign(campaignId) {
  const response = await api.post(`/api/campaigns/${campaignId}/pause`);
  return unwrap(response);
}

export async function resumeCampaign(campaignId) {
  const response = await api.post(`/api/campaigns/${campaignId}/resume`);
  return unwrap(response);
}
