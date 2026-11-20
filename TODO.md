# TODO

- [x] Adaptar a logo ConectaFemme enviada e manter o slogan “beleza que conecta” no cabeçalho.
- [x] Oferecer a todos os usuários um seletor de modo claro/escuro e persistir a opção escolhida.
- [x] Inserir profissionais fictícios iniciais e identificá-los claramente como demonstrações, sem contatos reais ou agendamentos efetivos.
- [x] Adicionar ao painel administrativo uma aba para excluir especificamente os perfis demonstrativos.
- [x] Preparar uma conta administradora inicial, armazenar a senha apenas como hash e compartilhar com a usuária as credenciais de acesso.
- [x] Atualizar o site público via GitHub/Vercel e confirmar que as telas e a integração Supabase continuam respondendo.
- [ ] Expediente e disponibilidade: manter a seleção dos dias da semana; permitir inserir manualmente os horários disponíveis de cada dia, sem intervalo ou duração automática; salvar e permitir editar os horários; manter disponibilidades recorrentes nos próximos 60 dias, horários extras por data e proteção para não expor horários já ocupados como livres.
- [ ] Link público e Instagram do profissional: mostrar no painel o link individual para copiar e enviar às clientes; permitir cadastrar o link/usuário do Instagram; exibir o link validado no perfil público.
- [ ] Imagens por arquivo: permitir escolher fotos do dispositivo para a imagem do perfil e para até quatro imagens de cada serviço; otimizar imagens grandes no navegador; carregar arquivos em armazenamento Supabase pelo endpoint autenticado, sem exigir URLs digitadas.
- [ ] Agendamento registrado pelo profissional: disponibilizar no painel um formulário com serviço, horário livre, nome e WhatsApp da cliente; registrar o atendimento mesmo sem uma conta da cliente; reservar o horário e mostrar os dados de contato na lista de agendamentos.
- [ ] Ordenação e limite de preço: incluir na busca pública um preço máximo e ordenação por menor/maior preço; exibir o preço inicial do serviço mais barato e deixar profissionais sem preços cadastrados após os que têm valores.
- [ ] **Edição de serviços:** para cada serviço já cadastrado, oferecer ação de editar seus dados, salvar as alterações e preservar as imagens existentes se não forem substituídas.
- [ ] **Expediente separado da agenda e impressão:** apresentar expediente e agenda em abas distintas; na agenda, permitir selecionar atendimentos por dia, semana ou mês e imprimir a seleção.
- [ ] **Financeiro interno do profissional:** adicionar aba privada para registrar recebimentos com valor, data e forma de pagamento; somente o profissional responsável pode consultar; os lançamentos não aparecem às clientes nem processam pagamentos; permitir gerar e imprimir relatório por período.
- [x] **Clientes e pós-atendimento:** criar uma aba Clientes no painel profissional que mostre nome e histórico das clientes com atendimentos registrados; oferecer botão que abra conversa direta pelo WhatsApp da cliente; fornecer mensagem padrão editável, preenchida automaticamente com o nome do estabelecimento e da cliente, sem edição manual desses dados em cada conversa.
- [x] **Imagens de perfil e divulgação:** manter a logo circular do profissional totalmente visível mesmo sobreposta à foto de capa; reduzir a proporção visual das fotos dos serviços divulgados e otimizar os arquivos enviados para serviços a até 1.200 px, preservando qualidade suficiente para exibição.

- [x] **Expediente compacto:** reduzir a altura do seletor de horários em telas de computador; exibir os horários futuros em uma seção discreta e expansível, agrupada por data, com remoção acessível somente dos horários ainda não reservados.
- [x] **Busca inicial:** manter o título e o texto de apoio existentes; tornar a área de busca mais compacta e atraente como primeira seção do site; garantir texto do botão de busca com contraste legível no modo claro e também no modo escuro.
- [x] **Cabeçalho da marca:** apresentar o símbolo feminino ao lado do nome Conecta Femme, ambos legíveis no canto superior esquerdo; manter cabeçalho próximo de 85–100 px no desktop; usar fundos claro e escuro conforme o tema, preservando as cores da marca.
- [x] **Iniciais nos cartões sem imagem:** na página inicial, quando não houver foto de apresentação nem logo do profissional, exibir as duas iniciais do nome profissional/empresa em vez do logo do ConectaFemme; preservar as fotos e logos cadastradas.


- [ ] **Termos gerais no cadastro:** clientes e profissionais devem marcar obrigatoriamente que leram e aceitam os Termos de Uso antes de criar conta; o link abre o documento completo sem perder os dados preenchidos; o backend rejeita cadastros sem aceite e registra versão e data/hora do documento aceito.
- [ ] **Regras adicionais para profissionais:** ao escolher “Profissional / Estabelecimento”, mostrar um segundo aceite obrigatório das Regras para Profissionais; ocultá-lo para clientes; validar novamente no backend e guardar a versão e data/hora do aceite profissional junto ao aceite geral.
- [ ] **Agendamento e notificações em perfil DEMO:** permitir que clientes façam agendamentos nos perfis profissionais marcados como DEMO e que o próprio profissional DEMO registre agendamentos manuais; conservar as regras de autenticação, validação de serviço/horário e prevenção de dupla reserva; acionar a notificação push da reserva ao perfil profissional quando houver assinatura ativa.
- [ ] **Galeria compacta de serviços:** reduzir mais a altura das imagens na página pública do profissional e exibir até quatro cartões de serviço lado a lado em telas largas, mantendo layout responsivo em tablets e celulares.
