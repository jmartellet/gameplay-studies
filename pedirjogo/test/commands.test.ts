import { describe, expect, it } from 'vitest';
import { createChatCommandHandler, type ChatUser } from '../src/bots/commands.js';
import { setup } from './helpers.js';

const BASE = 'https://fila.exemplo.com';
const viewer = (id: string, name = id): ChatUser => ({ provider: 'twitch', providerId: id, username: name, displayName: name });

function handler(cooldownMs = 0) {
  const ctx = setup();
  let now = 0;
  const handle = createChatCommandHandler({ service: ctx.service, baseUrl: BASE, cooldownMs, now: () => now });
  return { ...ctx, handle, advance: (ms: number) => (now += ms) };
}

describe('comandos de chat', () => {
  it('!pedirjogo sem nada responde com o link da fila', async () => {
    const { handle } = handler();
    expect(await handle('!pedirjogo', viewer('1', 'ana'))).toBe(
      `@ana peça e vote nos jogos da live aqui: ${BASE} (ou digite !pedirjogo <nome do jogo>)`,
    );
  });

  it('!pedirjogo <nome> pede o jogo e devolve o link direto dele', async () => {
    const { handle, service } = handler();
    const reply = await handle('!pedirjogo Hades', viewer('1', 'ana'));

    expect(reply).toBe(`@ana pediu Hades! Entrou na fila em #1 → ${BASE}/?jogo=20`);
    expect(service.getGame(20)?.votes).toBe(1);
  });

  it('outra pessoa pedindo o mesmo jogo conta como voto; a mesma pessoa não vota duas vezes', async () => {
    const { handle } = handler();
    await handle('!pedirjogo hades', viewer('1', 'ana'));

    expect(await handle('!votar hades', viewer('2', 'bia'))).toBe(`@bia votou em Hades: 2 votos, #1 na fila → ${BASE}/?jogo=20`);
    expect(await handle('!PEDIRJOGO hades', viewer('2', 'bia'))).toBe(
      `@bia você já votou em Hades (2 votos, #1) → ${BASE}/?jogo=20`,
    );
  });

  it('aceita AppID e link da loja', async () => {
    const { handle } = handler();
    expect(await handle('!pedirjogo 30', viewer('1'))).toContain('pediu Balatro');
    expect(await handle('!pedirjogo https://store.steampowered.com/app/10/CounterStrike/', viewer('2'))).toContain('pediu Counter-Strike');
  });

  it('avisa quando não encontra o jogo', async () => {
    const { handle } = handler();
    expect(await handle('!pedirjogo asdfgh', viewer('1', 'ana'))).toMatch(/^@ana não achei "asdfgh" na Steam/);
    expect(await handle('!pedirjogo 999', viewer('2', 'bia'))).toMatch(/não achei "999"/);
  });

  it('avisa quando o jogo já foi jogado', async () => {
    const { handle, service } = handler();
    await handle('!pedirjogo hades', viewer('1'));
    service.setStatus(20, 'jogado');
    expect(await handle('!votar hades', viewer('2', 'bia'))).toBe('@bia Hades já foi jogado na live 👀');
  });

  it('!top mostra os 3 primeiros', async () => {
    const { handle } = handler();
    expect(await handle('!top', viewer('9'))).toMatch(/fila está vazia/);
    await handle('!pedirjogo 10', viewer('1'));
    await handle('!pedirjogo 20', viewer('2'));
    await handle('!votar 20', viewer('3'));
    expect(await handle('!fila', viewer('4'))).toBe(`🏆 Top da fila: 1. Hades (2) · 2. Counter-Strike (1) → ${BASE}`);
  });

  it('ignora mensagens que não são comandos do bot', async () => {
    const { handle } = handler();
    expect(await handle('oi chat', viewer('1'))).toBeNull();
    expect(await handle('!lurk', viewer('1'))).toBeNull();
    expect(await handle('pedirjogo hades', viewer('1'))).toBeNull();
  });

  it('aplica cooldown por pessoa (sem responder, para não poluir o chat)', async () => {
    const { handle, advance } = handler(10_000);
    expect(await handle('!top', viewer('1'))).not.toBeNull();
    expect(await handle('!top', viewer('1'))).toBeNull();
    expect(await handle('!top', viewer('2'))).not.toBeNull();
    advance(10_000);
    expect(await handle('!top', viewer('1'))).not.toBeNull();
  });
});
