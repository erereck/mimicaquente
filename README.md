# Mímica Quente

Jogo local de batata quente com mímicas. O notebook funciona como painel principal
e os celulares se conectam pela mesma rede Wi‑Fi.

## Como iniciar

1. Dê dois cliques em `INICIAR.bat`.
2. Aguarde o painel abrir em `http://localhost:3000`.
3. Crie a sala e use o QR code exibido no notebook.
4. Se o Windows perguntar, permita o acesso à rede privada.

O jogo não envia dados para a internet. As salas e os placares ficam apenas na
memória do notebook e são apagados quando o programa é fechado.

## Publicação na Vercel

O projeto está preparado para `https://mimicaquente.vercel.app` usando:

- Next.js no runtime padrão da Vercel;
- WebSocket seguro em `/api/ws`;
- Fluid Compute;
- Redis compartilhado para manter salas e placares entre instâncias;
- reconexão automática dos notebooks e celulares;
- expiração automática das salas após 6 horas.

### Configuração necessária

1. No painel da Vercel, abra o projeto `mimicaquente`.
2. Entre no Marketplace e adicione a integração **Upstash Redis** ao projeto.
3. Confirme que a integração criou a variável `REDIS_URL` para Production.
4. Em Environment Variables, adicione:
   `NEXT_PUBLIC_APP_URL=https://mimicaquente.vercel.app`
5. Faça um novo deploy da branch `main`.

Nunca coloque a senha ou a URL privada do Redis dentro do repositório. Ela deve
ficar somente nas variáveis de ambiente da Vercel.

Sem `REDIS_URL`, o site abre normalmente, mas informa que o servidor ainda
aguarda a configuração do Redis ao tentar criar uma sala.

## Palavras

Edite `data/palavras.json` para adicionar novas palavras. As palavras ficam
agrupadas pelo nome do tema. Mantenha cada palavra entre aspas e separada por
vírgula dentro da lista do tema correspondente.
