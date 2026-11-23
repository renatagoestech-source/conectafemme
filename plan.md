# Plano — identidade visual, demonstrações e temas

## Direção de design

- **Movimento:** beleza contemporânea com editorial feminino, inspirada diretamente na marca fornecida.
- **Princípios:** preservar o símbolo original; aplicar vinho e nude já usados pelo produto; manter contraste e legibilidade nos dois temas; identificar claramente todo conteúdo fictício.
- **Paleta:** vinho `#7B1E3A`, rosé `#A8506A`, nude `#B88B74`; no modo escuro, superfícies ameixa profundas e texto claro.
- **Layout e interação:** marca horizontal no cabeçalho com o símbolo e o slogan em texto acessível; controle de tema sempre disponível na navegação; modo escolhido persiste neste navegador; cartões de profissionais sem foto/logo próprios usam um monograma discreto de duas iniciais em vez do logo da plataforma.
- **Demonstrações:** perfis e serviços sintéticos, rotulados publicamente como demonstração; nenhum contato real, nenhum agendamento habilitado nesses perfis; aba administrativa separada para removê-los.
- **Segurança administrativa:** criar um usuário administrador inicial no Supabase; guardar somente hash de senha no banco e não colocar credenciais no código.

## Estrutura

- `index.html`: cabeçalho com marca e slogan, ícone e inicialização do tema.
- `assets/conectafemme-logo.png`: logo ConectaFemme fornecida, com fundo removido e preparada para o cabeçalho.
- `style.css`: variáveis de cor compartilhadas pelos temas claro e escuro.
- `app.js`: alternância persistente, rótulos dos perfis demonstrativos e aba de remoção administrativa.
- `supabase/functions/conectaelas-api/index.ts`: exposição da marca de demonstração, autorização e exclusão apenas de perfis de demonstração.
- `supabase/migrations/`: migração da coluna `is_demo`; dados fictícios adicionados ao banco Supabase.
- Deploy: GitHub `main` aciona Vercel; a API segue no Supabase Edge Functions.


## Expediente, agenda, serviços e financeiro

- **Expediente:** manter a seleção dos dias da semana, substituir intervalos e duração automática por horários de atendimento definidos manualmente para cada dia. Persistir a lista no `providers.weekly_schedule` e gerar as disponibilidades recorrentes para os próximos 60 dias; manter horários avulsos por data e permitir remover disponibilidades não reservadas.
- **Serviços:** oferecer edição dos serviços existentes usando a ação `service_save` autenticada, preservando as imagens existentes quando nenhum arquivo novo for enviado.
- **Agenda:** separar a configuração do expediente da visão de atendimentos. Permitir filtrar atendimentos por dia, semana ou mês, com impressão da seleção.
- **Financeiro:** criar uma tabela privada de lançamentos acessível somente ao profissional responsável, para controle interno; registrar valor, data, meio de pagamento e dados opcionais, e apresentar filtros, totais e relatório imprimível. As clientes não veem os registros; o sistema não processa pagamentos.
- **Arquitetura:** interface permanece HTML/CSS/JavaScript estático; ações financeiras e atualização de serviços/horários usam a Edge Function já autenticada; a migração cria a tabela financeira com RLS habilitado e índice por profissional/data. Não aplicar migrações nem escrever dados no banco compartilhado neste trabalho.
- **Design:** manter a identidade ConectaFemme vinho/rosé e os temas claro/escuro; destacar no cabeçalho, em aproximadamente 88 px, o símbolo feminino e o nome Conecta Femme lado a lado, com fundo claro/escuro coerente com o tema; deixar a primeira dobra inicial mais enxuta, com filtros em painel refinado e botão de alto contraste; no expediente, organizar os dias em duas colunas no desktop, usar controles de horário compactos e recolher a gestão de horários futuros em uma seção expansível agrupada por data; manter disposição responsiva e impressão limpa sem navegação ou botões.


## Termos de Uso e Regras para Profissionais

- **Documentos:** publicar página estática acessível com Termos de Uso gerais e seção distinta de Regras para Profissionais, data/versão, navegação clara e contato oficial já divulgado pelo site. Revisar o texto enviado sem prometer que substitui análise jurídica; explicitar o papel de conexão da plataforma, os acordos entre usuários, que a plataforma não processa pagamentos, o uso interno dos registros financeiros e como apresentar denúncias e atualizações.
- **Aceite no cadastro:** clientes e profissionais marcam checkbox obrigatório dos Termos gerais; link em nova aba permite ler o documento e voltar ao formulário preenchido. Ao escolher perfil profissional, exibir um segundo checkbox obrigatório das Regras; escondê-lo para clientes. Desabilitar “Cadastrar” enquanto faltar o aceite correspondente e validar de novo ao enviar.
- **Registro e integridade:** a Edge Function rejeita ausência de cada aceite aplicável e registra usuário, identificador/versão do documento e horário UTC no servidor. Usar tabela privada com RLS habilitado e acesso só ao `service_role`; preservar histórico por versão, sem endpoint público para consultar aceites. Em falha ao gravar os registros, desfazer a conta criada.
- **Entrega:** atualizar schema/migração, Edge Function usada pelo site, página de termos, links do rodapé, cache PWA e documentação, validar antes de publicar no GitHub/Vercel e Supabase.

## Lembretes de agendamento e remarcação

- **Comportamento:** manter a confirmação já existente; para agendamentos confirmados de clientes com conta, enviar um lembrete curto por notificação push e e-mail às 08:00 no horário de Brasília no dia do atendimento e outro 30 minutos antes, com o texto “Faltam 30 minutos para o seu atendimento. Não se atrase!” e uma ação/link para remarcar.
- **Remarcação:** oferecer à cliente ou à profissional a seleção de outro horário livre do mesmo profissional e serviço. Fazer a troca do horário e da reserva do atendimento atomicamente no banco, somente para agendamentos futuros confirmados pertencentes a uma das partes; bloquear concorrência e não alterar dados de agendamentos cancelados/concluídos. Após a troca, notificar a outra parte por push; evitar duplicidade de notificações com eventos idempotentes.
- **Arquitetura:** manter a interface estática em `app.js` e a experiência de clique no `service-worker.js`; implementar a mutação autenticada em `supabase/functions/conectaelas-api/index.ts`, usando uma função SQL transacional em nova migração; ampliar `supabase/functions/conectafemme-reminders/index.ts` e os cron jobs existentes para 08:00 e varredura por minuto do aviso de 30 minutos. Usar o provedor transacional configurado como segredo do servidor para e-mails; não armazenar credenciais no repositório. Não testar com writes nos dados reais.
- **Estrutura e apresentação:** reaproveitar o painel da cliente e a identidade ConectaFemme já existente; mostrar seleção de dia/horário disponível em um diálogo acessível. O link do e-mail e a ação da notificação abrem o painel e conduzem à mesma seleção. O painel da profissional permanece como ponto de recebimento do aviso de push.


## Confirmação automática e ações bilaterais nos agendamentos

- **Confirmação:** reservas online e registros manuais feitos pelo profissional passam a ser gravados como `confirmado`; agendamentos pendentes futuros existentes são migrados para confirmado. A ação de confirmação manual sai do painel. Na reserva online, enviar push de confirmação para as duas contas quando houver assinatura.
- **Cancelamento/remarcação:** cliente e profissional podem cancelar ou remarcar atendimentos confirmados. O cancelamento e a liberação do horário são atômicos em RPC transacional e avisam a outra parte por push. A remarcação usa uma nova função SQL transacional que valida o papel e a relação do usuário com o booking, bloqueia os slots em ordem estável, permite apenas o mesmo profissional e horários futuros/livres, atualiza o slot e incrementa `reschedule_version`. O serviço do booking permanece o mesmo.
- **Notificações:** a Edge Function push resolve a parte oposta conforme o ator; evento de remarcação usa a versão do booking para deduplicação. A cliente sem conta (agendamento manual externo) não tem destinatário de push; nesse caso, a profissional não consegue avisar via push pelo sistema. Os lembretes existentes permanecem inalterados.
- **Interface:** ações Cancelar e Remarcar ficam disponíveis no painel de ambos os perfis para atendimentos confirmados; diálogo reaproveita seleção dos horários livres da mesma agenda.
