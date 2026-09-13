# Meu Painel JB — GitHub + Render

## 1. Enviar ao GitHub

1. Crie um repositório vazio no GitHub, por exemplo: `meu-painel-jb`.
2. Extraia o ZIP.
3. Envie todos os arquivos e pastas para a raiz do repositório.
4. Confirme que o arquivo `render.yaml` aparece na página principal do repositório.

## 2. Publicar no Render

1. Entre em https://dashboard.render.com.
2. Clique em **New +** e depois em **Blueprint**.
3. Conecte sua conta do GitHub e escolha o repositório.
4. O Render reconhecerá o `render.yaml` e criará:
   - o aplicativo web;
   - o banco PostgreSQL.
5. Quando o Render solicitar `APP_PASSWORD`, informe a senha pessoal que você usará para entrar no aplicativo.
6. Confirme em **Apply** e aguarde a publicação.

O banco e as tabelas são preparados automaticamente na primeira inicialização.

## 3. Instalar no iPhone

1. Abra o endereço fornecido pelo Render usando o Safari.
2. Entre com sua senha pessoal.
3. Toque no botão **Compartilhar**.
4. Escolha **Adicionar à Tela de Início**.
5. Confirme em **Adicionar**.

O ícone **Painel JB** aparecerá junto aos outros aplicativos.

## 4. Ativar notificações de lembretes (opcional)

O aplicativo funciona normalmente sem esta etapa. Para receber notificações mesmo quando ele estiver fechado:

1. Em um computador com Node.js, dentro da pasta do projeto, execute:

   ```bash
   npm install
   npm run generate-vapid
   ```

2. Copie as chaves exibidas.
3. No Render, abra o serviço **meu-painel-jb** e entre em **Environment**.
4. Adicione:
   - `VAPID_PUBLIC_KEY`: chave pública;
   - `VAPID_PRIVATE_KEY`: chave privada;
   - altere `VAPID_SUBJECT` para `mailto:seuemail@exemplo.com`.
5. Salve e aguarde a nova publicação.
6. No iPhone, abra o aplicativo instalado e, em **Apps JB**, toque em **Ativar lembretes no iPhone**.

As notificações web exigem que o aplicativo esteja instalado na Tela de Início do iPhone.

## Segurança

- Nunca coloque a senha pessoal diretamente nos arquivos do GitHub.
- Configure-a somente na variável `APP_PASSWORD` do Render.
- O cookie de acesso é protegido e permanece válido por 30 dias.
- Para trocar a senha, altere `APP_PASSWORD` no Render.

## Estrutura incluída

- Agenda e lembretes;
- Cadastro de alunos;
- Planejamento de conteúdo;
- atalhos configuráveis para JB Play, BT Tracker, JB Drills e JB Tactics;
- login com senha;
- banco PostgreSQL;
- PWA instalável no iPhone;
- configuração automática pelo Render Blueprint.
