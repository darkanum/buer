// Task 8.3 — screen 2 (design spec §4.1): "comando de instalação, token
// gerado, `genshin sync`". Shown when the logged-in user has no snapshot yet
// (no `app.account` row for them — see lib/session.ts's requireAccount,
// which every OTHER screen uses instead of this one, precisely to redirect
// here in that case).

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '../../lib/db.js';
import { getAccountByOwner } from '../../lib/render.js';
import { getCurrentUser } from '../../lib/session.js';
import { generateOnboardingToken } from './actions.js';
import { ONBOARDING_TOKEN_COOKIE } from './constants.js';

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/');

  const account = await getAccountByOwner(db, user.userId);
  if (account) redirect('/characters');

  const cookieStore = await cookies();
  const revealedToken = cookieStore.get(ONBOARDING_TOKEN_COOKIE)?.value ?? null;

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Conectar sua conta de Genshin Impact</h1>
      <p>
        O OneWash lê o Battle Chronicle do HoYoLAB através de uma ferramenta de linha de
        comando (CLI) que roda na SUA máquina, usando a sessão já aberta no SEU navegador. O
        código dela é aberto e auditável — nenhuma parte deste fluxo tenta ler ou decifrar o
        cookie store do Chrome/Edge.
      </p>

      <h2>1. Instale a CLI</h2>
      <pre style={{ background: '#111', color: '#eee', padding: '0.75rem 1rem', borderRadius: 6, overflowX: 'auto' }}>
        <code>npm install -g @onewash/cli</code>
      </pre>

      <h2>2. Gere um token de acesso</h2>
      <p>
        Esse token autentica a CLI como você, só para enviar snapshots (permissão{' '}
        <code>snapshots:write</code>) — ele NÃO dá acesso à sua conta HoYoLAB nem à sua conta
        OneWash de outra forma.
      </p>

      {revealedToken ? (
        <div style={{ border: '1px solid #444', borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '1rem' }}>
          <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>
            Copie este token agora — ele não será mostrado de novo:
          </p>
          <pre style={{ background: '#111', color: '#eee', padding: '0.75rem 1rem', borderRadius: 6, overflowX: 'auto' }}>
            <code>{revealedToken}</code>
          </pre>
        </div>
      ) : null}

      <form action={generateOnboardingToken}>
        <button type="submit">{revealedToken ? 'Gerar um novo token' : 'Gerar token'}</button>
      </form>

      <h2>3. Sincronize</h2>
      <p>Com o token em mãos, rode:</p>
      <pre style={{ background: '#111', color: '#eee', padding: '0.75rem 1rem', borderRadius: 6, overflowX: 'auto' }}>
        <code>genshin sync --token &lt;TOKEN&gt;</code>
      </pre>
      <p>
        Assim que o primeiro sync terminar, esta página some — o grid de personagens (
        <code>/characters</code>) passa a ser a tela inicial.
      </p>
    </main>
  );
}
