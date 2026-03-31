import api from './api';

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

export async function fetchCampaignOverview() {
  const response = await api.get('/campaigns/stats');
  return unwrap(response);
}

export async function fetchTemplates(params = {}) {
  const response = await api.get('/campaigns/templates', { params });
  return unwrap(response);
}

export async function syncTemplates() {
  const response = await api.post('/campaigns/templates/sync');
  return unwrap(response);
}

export async function createTemplate(payload) {
  const response = await api.post('/campaigns/templates', payload);
  return unwrap(response);
}

export async function updateTemplate(templateId, payload) {
  const response = await api.patch(`/campaigns/templates/${templateId}`, payload);
  return unwrap(response);
}

export async function deleteTemplate(templateId) {
  const response = await api.delete(`/campaigns/templates/${templateId}`);
  return unwrap(response);
}

export async function fetchCampaigns(params = {}) {
  const response = await api.get('/campaigns', { params });
  return unwrap(response);
}

export async function fetchCampaignDetail(campaignId) {
  const response = await api.get(`/campaigns/${campaignId}`);
  return unwrap(response);
}

export async function createCampaign(payload) {
  const response = await api.post('/campaigns', payload);
  return unwrap(response);
}

export async function dispatchCampaign(campaignId) {
  const response = await api.post(`/campaigns/${campaignId}/launch`);
  return unwrap(response);
}

export async function pauseCampaign(campaignId) {
  const response = await api.post(`/campaigns/${campaignId}/cancel`);
  return unwrap(response);
}

export async function resumeCampaign(campaignId) {
  const response = await api.post(`/campaigns/${campaignId}/retry-failed`);
  return unwrap(response);
}

export async function uploadCampaignHeaderImage(file) {
  const formData = new FormData();
  formData.append('image', file);

  const response = await api.post('/media/campaign-header-image', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return unwrap(response);
}