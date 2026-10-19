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
- [ ] **Financeiro do profissional:** adicionar aba para registrar recebimentos com valor, data e forma de pagamento; permitir consultar os lançamentos, gerar relatório por período e imprimir o relatório.
