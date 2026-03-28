import OpenAI from 'openai';

export async function runOpenAIReply(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-5.4';

  if (!apiKey) {
    throw new Error('Falta OPENAI_API_KEY en el archivo .env');
  }

  const client = new OpenAI({ apiKey });

  const response = await client.responses.create({
    model,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: prompt
          }
        ]
      }
    ]
  });

  const text = response.output_text || 'No pude generar una respuesta en este momento.';

  return {
    provider: 'openai',
    model,
    text,
    usage: {
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      totalTokens: response.usage?.total_tokens ?? null
    },
    raw: response
  };
}