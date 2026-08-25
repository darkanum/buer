import { describe, it, expect, vi } from 'vitest';
import { researchCharacter, buildCharacterPrompt } from '../scripts/research/search.js';

/** Dublê: devolve as mensagens que o teste programou, uma por chamada. */
function fakeClient(messages: unknown[]) {
  const calls: unknown[] = [];
  let i = 0;
  return {
    calls,
    client: {
      stream(params: unknown) {
        calls.push(params);
        const message = messages[i++];
        return { finalMessage: async () => message as never };
      },
    },
  };
}

const textMessage = (text: string, stop = 'end_turn') => ({
  stop_reason: stop,
  content: [{ type: 'text', text }],
  usage: { input_tokens: 100, output_tokens: 200 },
});

describe('buildCharacterPrompt', () => {
  it('nomeia o personagem e exige atribuição por fonte', () => {
    const p = buildCharacterPrompt('xiangling');
    expect(p).toContain('xiangling');
    expect(p).toMatch(/icy-veins/);
    expect(p).toMatch(/game8/);
    expect(p).toMatch(/genshin-builds/);
    expect(p).toMatch(/separadamente|por fonte|cada fonte/i);
  });

  it('proíbe explicitamente inventar dado ausente', () => {
    expect(buildCharacterPrompt('xiangling')).toMatch(/não invente|não preencha|omita/i);
  });
});

describe('researchCharacter', () => {
  it('declara a ferramenta de busca restrita aos três domínios', async () => {
    const { client, calls } = fakeClient([textMessage('resultado')]);
    await researchCharacter('xiangling', { client });

    const params = calls[0] as { tools: { type: string; allowed_domains: string[] }[]; model: string };
    expect(params.model).toBe('claude-opus-5');
    const tool = params.tools.find((t) => t.type === 'web_search_20260209')!;
    expect(tool).toBeDefined();
    expect(tool.allowed_domains).toEqual(['icy-veins.com', 'game8.co', 'genshin-builds.com']);
  });

  it('retoma quando a resposta pausa, e só devolve quando termina', async () => {
    const { client, calls } = fakeClient([
      { ...textMessage('parcial', 'pause_turn') },
      textMessage('completo'),
    ]);
    const out = await researchCharacter('xiangling', { client });

    expect(calls).toHaveLength(2);
    expect(out.text).toContain('completo');
    // a retomada reenvia o turno pausado como mensagem do assistente
    const second = calls[1] as { messages: { role: string }[] };
    expect(second.messages.at(-1)!.role).toBe('assistant');
    // terminou de verdade: nada a ressalvar na ficha
    expect(out.truncated).toBe(false);
  });

  it('para de retomar depois do limite, E MARCA que a pesquisa saiu truncada', async () => {
    // O teste anterior aqui assertava `calls.length <= 3`, o que passaria
    // mesmo se a retomada nunca acontecesse. Este exige as três chamadas
    // exatas — prova a retomada — e o sinal de truncamento, que é o que
    // impede a reconciliação de ler a pesquisa cortada como "a fonte não
    // cobre este campo".
    const paused = { ...textMessage('parcial', 'pause_turn') };
    const { client, calls } = fakeClient([paused, paused, paused, paused, paused]);
    const out = await researchCharacter('xiangling', { client, maxResumes: 2 });

    expect(calls).toHaveLength(3); // a primeira + exatamente 2 retomadas
    for (const call of calls.slice(1)) {
      expect((call as { messages: { role: string }[] }).messages.at(-1)!.role).toBe('assistant');
    }
    expect(out.truncated).toBe(true);
  });

  it('pesquisa que termina no primeiro turno não é truncada', async () => {
    const { client } = fakeClient([textMessage('completo')]);
    const out = await researchCharacter('xiangling', { client });
    expect(out.truncated).toBe(false);
  });

  it('colhe as URLs dos resultados de busca', async () => {
    const { client } = fakeClient([
      {
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [
          {
            type: 'web_search_tool_result',
            content: [
              { type: 'web_search_result', url: 'https://icy-veins.com/a' },
              { type: 'web_search_result', url: 'https://game8.co/b' },
            ],
          },
          { type: 'text', text: 'ok' },
        ],
      },
    ]);
    const out = await researchCharacter('xiangling', { client });
    expect(out.urls).toEqual(['https://icy-veins.com/a', 'https://game8.co/b']);
  });

  it('erro da ferramenta de busca não derruba a execução nem vira URL', async () => {
    // Server tool devolve HTTP 200 com um bloco de erro: `content` vira OBJETO,
    // não lista. Indexar sem checar quebraria aqui.
    const { client } = fakeClient([
      {
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [
          { type: 'web_search_tool_result', content: { error_code: 'max_uses_exceeded' } },
          { type: 'text', text: 'segui sem busca' },
        ],
      },
    ]);
    const out = await researchCharacter('xiangling', { client });
    expect(out.urls).toEqual([]);
    expect(out.text).toContain('segui sem busca');
  });

  it('soma o uso de tokens de todas as chamadas, inclusive as retomadas', async () => {
    const { client } = fakeClient([
      { ...textMessage('parcial', 'pause_turn') },
      textMessage('completo'),
    ]);
    const out = await researchCharacter('xiangling', { client });
    expect(out.usage.inputTokens).toBe(200);
    expect(out.usage.outputTokens).toBe(400);
  });
});
