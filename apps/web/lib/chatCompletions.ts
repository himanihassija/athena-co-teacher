import { NextRequest, NextResponse } from 'next/server';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { randomUUID } from 'crypto';

type ChatBody = {
  messages?: Array<{ role: string; content: unknown }>;
  model?: string;
  stream?: boolean;
  [key: string]: unknown;
};

export type ChatCompletionsDeps = {
  createOpenAIClient: typeof createOpenAI;
  streamTextImpl: typeof streamText;
};

export function createChatCompletionsHandler({
  createOpenAIClient,
  streamTextImpl,
}: ChatCompletionsDeps) {
  return async function POST(request: NextRequest) {
    const apiKey = process.env.NEXT_LLM_API_KEY;
    const llmUrl = process.env.NEXT_LLM_URL;
    const modelId = 'gpt-4o';

    if (!apiKey || !llmUrl) {
      return NextResponse.json(
        { error: 'NEXT_LLM_API_KEY and NEXT_LLM_URL must be set' },
        { status: 500 },
      );
    }

    const baseURL = llmUrl.replace(/\/chat\/completions\/?$/, '');
    let body: ChatBody;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const openai = createOpenAIClient({ apiKey, baseURL });
    const result = streamTextImpl({
      model: openai(modelId),
      messages: (body.messages ?? []) as NonNullable<
        Parameters<typeof streamText>[0]['messages']
      >,
    });

    const encoder = new TextEncoder();
    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const model = body.model ?? modelId;
    const sseChunk = (
      delta: Record<string, unknown>,
      finishReason: string | null = null,
    ) =>
      encoder.encode(
        `data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`,
      );

    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(sseChunk({ role: 'assistant', content: '' }));
          for await (const chunk of result.textStream) {
            controller.enqueue(sseChunk({ content: chunk }));
          }
          controller.enqueue(sseChunk({}, 'stop'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err) {
          console.error('[custom-llm] Stream error:', err);
          controller.error(err);
        }
      },
    });

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  };
}
