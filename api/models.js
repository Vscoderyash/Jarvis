const { timingSafeEqual } = require('node:crypto');

const CACHE_MS = 5 * 60 * 1000;
const RETIRED_NVIDIA_MODELS = new Set(['meta/llama-3.1-8b-instruct', 'meta/llama-3.1-70b-instruct', 'meta/llama-3.3-70b-instruct', 'nvidia/llama-3.3-nemotron-super-49b-v1.5', 'mistralai/mistral-large-2-instruct', 'qwen/qwen2.5-coder-32b-instruct', '01-ai/yi-large']);
const cache = new Map();

function hasValidAccess(req) {
  const expected = process.env.JARVIS_ACCESS_TOKEN;
  if (!expected) return false;
  const authorization = String(req.headers.authorization || '');
  const actual = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const left = Buffer.from(expected), right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function getModels(id, key, authorized) {
  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.models;
  if (id !== 'nvidia' && !authorized) return [];

  const base = id === 'nvidia'
    ? (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '')
    : id === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.anthropic.com';
  const url = id === 'anthropic' ? `${base}/v1/models?limit=1000` : `${base}/models`;
  const headers = id === 'anthropic'
    ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${key}` };
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(6500) });
  if (!response.ok) throw new Error(`model list returned ${response.status}`);
  const payload = await response.json();
  let models = Array.isArray(payload.data) ? payload.data.filter(model => model && typeof model === 'object') : [];
  if (id === 'openrouter') models = models.filter(model => {
    // OpenRouter's :batch catalog entries require the asynchronous /batches API, not this chat stream route.
    if (/:batch$/i.test(model.id)) return false;
    const inputs = model.architecture?.input_modalities, outputs = model.architecture?.output_modalities;
    return (!Array.isArray(inputs) || inputs.includes('text')) && (!Array.isArray(outputs) || outputs.includes('text'));
  });
  models = models.map(model => ({
    id: typeof model.id === 'string' ? model.id : '',
    name: (typeof model.name === 'string' ? model.name : typeof model.display_name === 'string' ? model.display_name : model.id || '').slice(0, 120),
    supportsImages: id === 'nvidia' ? /(vision|vl)/i.test(model.id || '') : id === 'anthropic' ? Boolean(model.capabilities?.image_input?.supported) : Array.isArray(model.architecture?.input_modalities) && model.architecture.input_modalities.includes('image'),
  })).filter(model => model.id && model.id.length <= 200);
  if (id === 'nvidia') {
    models = models.filter(model => !RETIRED_NVIDIA_MODELS.has(model.id) && !/(embed|rerank|reward|guard|safety|parse|nv-)/i.test(model.id));
  }
  if (id === 'openrouter') models = models.slice(0, 300);
  if (id === 'anthropic') models = models.filter(model => /^claude-/i.test(model.id));
  const preferred = id === 'nvidia' ? 'nvidia/nemotron-3.5-bolt-e4b' : id === 'anthropic' ? 'haiku' : '';
  models.sort((a, b) => Number(b.id.toLowerCase().includes(preferred)) - Number(a.id.toLowerCase().includes(preferred)) || a.name.localeCompare(b.name));
  cache.set(id, { at: Date.now(), models });
  return models;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const providers = [
    { id: 'nvidia', name: 'NVIDIA', key: process.env.NVIDIA_API_KEY },
    { id: 'openrouter', name: 'OpenRouter', key: process.env.OPENROUTER_API_KEY },
    { id: 'anthropic', name: 'Anthropic', key: process.env.ANTHROPIC_API_KEY },
  ];
  const needsGate = providers.some(provider => provider.id !== 'nvidia' && provider.key) || Boolean(process.env.JARVIS_ACCESS_TOKEN);
  const authorized = hasValidAccess(req);
  const results = await Promise.all(providers.map(async provider => {
    if (!provider.key) return { id: provider.id, name: provider.name, configured: false, locked: false, models: [] };
    const locked = (Boolean(process.env.JARVIS_ACCESS_TOKEN) && !authorized) || (provider.id !== 'nvidia' && needsGate && (!process.env.JARVIS_ACCESS_TOKEN || !authorized));
    if (locked) return { id: provider.id, name: provider.name, configured: true, locked: true, models: [] };
    try {
      const models = await getModels(provider.id, provider.key, authorized);
      return { id: provider.id, name: provider.name, configured: true, locked: false, models };
    } catch {
      return { id: provider.id, name: provider.name, configured: true, locked: false, models: [], error: 'Could not load models. Check the provider key.' };
    }
  }));
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({ providers: results, accessRequired: needsGate, accessConfigured: Boolean(process.env.JARVIS_ACCESS_TOKEN), accessGranted: !needsGate || authorized });
};
