# ZapBot Pro - Extensão Chrome para WhatsApp Web & Atendimento com IA

Extensão nativa para o Google Chrome (Manifest V3) que adiciona automações profissionais diretamente na interface do **WhatsApp Web**, incluindo **Atendimento Inteligente com IA (Google Gemini, DeepSeek e OpenAI)**, **Disparador em Massa com Proteção Anti-Ban** e **Extrator de Contatos de Grupos com 1 Clique**.

---

## 🚀 Principais Recursos

1. **🤖 Atendente Inteligente por IA (Gemini, DeepSeek & OpenAI)**:
   - Respostas automáticas humanizadas no WhatsApp.
   - Suporte aos modelos de ponta: **Google Gemini 2.0/Flash**, **DeepSeek V3 / R1** e **OpenAI GPT-4o mini**.
   - **Filtro por Listas**: A IA só responde contatos pertencentes à lista selecionada.
   - **Contexto em Tempo Real**: Lê o histórico recente da conversa para gerar respostas precisas.
   - **Pausa Automática por Intervenção Humana**: Se você digitar manualmente no chat, a IA se desativa temporariamente para aquele cliente (tempo configurável).
   - **Base de Conhecimento / FAQ**: Treine a IA com as informações da sua empresa, catálogo e tabela de preços.

2. **🚀 Disparador em Massa (Anti-Ban)**:
   - Importe contatos via planilha CSV (`telefone,nome`) ou selecione listas salvas.
   - Mensagens personalizadas com tags dinâmicas: `{{nome}}` e `{{saudacao}}`.
   - Controle deslizante de delay humano (ex: 8 a 20 segundos aleatórios entre mensagens).
   - Botões de **Iniciar**, **Pausar** e **Parar** com barra de progresso em tempo real.

3. **👥 Extrator de Participantes de Grupos**:
   - Abra qualquer grupo no WhatsApp Web e clique em **Extrair**.
   - Baixe os contatos em formato `.csv` ou salve diretamente em uma lista de atendimento da IA.

4. **📋 Gerenciador de Listas & 📊 Histórico de Logs**:
   - Crie listas de leads, clientes ou suporte.
   - Visualize o histórico de mensagens enviadas e respostas geradas pela IA.

---

## 📦 Como Instalar no Google Chrome

1. Abra o navegador Google Chrome.
2. Acesse a página de extensões digitando na barra de endereços:
   ```
   chrome://extensions/
   ```
3. No canto superior direito, ative a chave **"Modo do desenvolvedor"**.
4. Clique no botão **"Carregar sem compactação"** (Load unpacked).
5. Selecione a pasta do projeto que contém o arquivo `manifest.json`.
6. Pronto! O ícone do **ZapBot Pro** 🤖 aparecerá na barra de ferramentas do seu Chrome.

---

## 🛠️ Como Usar

1. Acesse o [WhatsApp Web](https://web.whatsapp.com/) no seu Chrome.
2. Clique no ícone do **ZapBot Pro** para abrir o **Painel Lateral (Side Panel)**.
3. **Para ativar a IA**:
   - Na aba **Atendente IA**, escolha o provedor (*Google Gemini* ou *OpenAI*).
   - Insira sua chave de API gratuita (obtida no [Google AI Studio](https://aistudio.google.com/)).
   - Defina seu Prompt e regras de negócio.
   - Escolha em **"Responder apenas contatos de"** qual lista a IA deve atender (ou "Todas as conversas").
   - Ative a chave **"Auto-Resposta por IA"**.
4. **Para extrair grupos**:
   - Abra a conversa do grupo no WhatsApp Web.
   - Na aba **Grupos**, clique em **"Extrair Participantes do Grupo Aberto"**.
   - Baixe o CSV ou salve em uma lista com 1 clique!

---

## Atendimento em grupos

Na aba **Grupos**, cadastre o nome completo do grupo, configure seu número com DDI e clique em **Salvar grupos e temporizador**. Ative a IA no painel. O atendimento de um grupo cadastrado independe da lista de contatos individuais.

Para validar no Chrome, recarregue a extensão em `chrome://extensions/` e atualize a aba do WhatsApp Web. Peça a outro participante de um grupo de teste para mencionar o bot e mandar uma segunda mensagem em seguida. Confira se o bot responde à menção uma única vez. Repita com uma citação a uma mensagem da conta do bot. Alterne para outro chat enquanto a IA prepara uma resposta e confira no log que o envio foi cancelado.

A suíte local pode ser executada com `node --test tests`.

## 📁 Estrutura do Projeto

```
Bot/
├── manifest.json              # Configuração Manifest V3
├── assets/
│   └── icons/                 # Ícones da extensão (16, 48, 128px)
├── background/
│   └── service-worker.js      # Gerenciamento de SidePanel, badge e chamadas
├── content/
│   ├── whatsapp-driver.js     # Driver de interação segura com o DOM do WhatsApp
│   ├── content.js             # Listener e coordenador de automação injetado na aba
│   └── content.css            # Estilos da toolbar e badges injetados
├── modules/
│   ├── storage-manager.js     # Gerenciamento de dados no chrome.storage.local
│   └── ai-responder.js        # Integração com APIs da Gemini e OpenAI
├── sidepanel/
│   ├── sidepanel.html         # Interface completa com 5 abas
│   ├── sidepanel.css          # Tema moderno Dark Mode
│   └── sidepanel.js           # Lógica do painel de controle
└── legacy_python/             # Arquivos legados do antigo bot em Python/Selenium
```

## Licença

[MIT](LICENSE)
