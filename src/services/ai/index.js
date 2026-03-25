import { runGeminiReply } from './gemini.service.js';
import { runOpenAIReply } from './openai.service.js';
import { buildPrompt } from './prompt-builder.js';

export async function runAssistantReply({
  businessName,
  contactName,
  recentMessages,
  conversationSummary = '',
  customerContext = {},
  conversationState = {},
  liveOrderContext = null
}) {
  const provider = String(process.env.AI_PROVIDER || 'gemini').toLowerCase();

  const prompt = buildPrompt({
    businessName,
    contactName,
    recentMessages,
    conversationSummary,
    customerContext,
    conversationState,
    liveOrderContext
  });

  if (provider === 'openai') {
    return runOpenAIReply(prompt);
  }

  return runGeminiReply(prompt);
}