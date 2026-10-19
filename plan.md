# Plano — identidade visual, demonstrações e temas

## Direção de design

- **Movimento:** beleza contemporânea com editorial feminino, inspirada diretamente na marca fornecida.
- **Princípios:** preservar o símbolo original; aplicar vinho e nude já usados pelo produto; manter contraste e legibilidade nos dois temas; identificar claramente todo conteúdo fictício.
- **Paleta:** vinho `#7B1E3A`, rosé `#A8506A`, nude `#B88B74`; no modo escuro, superfícies ameixa profundas e texto claro.
- **Layout e interação:** marca horizontal no cabeçalho com o símbolo e o slogan em texto acessível; controle de tema sempre disponível na navegação; modo escolhido persiste neste navegador.
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
- **Design:** manter a identidade ConectaFemme vinho/rosé e os temas claro/escuro; deixar a primeira dobra inicial mais enxuta, com filtros em painel refinado e botão de alto contraste; no expediente, organizar os dias em duas colunas no desktop, usar controles de horário compactos e recolher a gestão de horários futuros em uma seção expansível agrupada por data; manter disposição responsiva e impressão limpa sem navegação ou botões.
