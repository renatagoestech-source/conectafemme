# ConectaFemme

Aplicação web para conectar clientes a profissionais de beleza, cadastrar serviços, horários e agendamentos.

## Supabase

- Banco PostgreSQL isolado: `conectaelas`, região São Paulo (`sa-east-1`).
- Migração de schema: `supabase/migrations/20261015100000_initial_schema.sql`.
- API server-side: Supabase Edge Function `conectaelas-api`; a chave secreta é lida do ambiente seguro de Edge Functions e nunca vai ao navegador ou ao GitHub.
- O frontend usa apenas a chave publicável em `supabase-config.js`. As tabelas têm RLS ativado e sem políticas de acesso público; somente a função de servidor usa a chave privilegiada.
- Senhas da aplicação são armazenadas com PBKDF2-SHA256, salt aleatório e 310.000 iterações.

## Deploy

A interface estática é publicada pela Vercel a partir da branch `main`. A API e o banco são hospedados pelo Supabase. A função autentica os tokens da aplicação e aplica autorização por perfil.

## Demonstrações e administração

O banco contém perfis de demonstração identificados por `is_demo`; eles usam e-mails reservados, não têm contato real e não aceitam agendamentos. A conta administradora inicial é gerenciada diretamente no Supabase; nunca armazene a senha em arquivos do repositório. O painel tem uma aba dedicada para excluir perfis de demonstração e seus dados relacionados.

O seletor de tema oferece modo claro/escuro, lembra a escolha neste navegador e respeita a preferência do sistema na primeira visita.

## Agenda e perfil profissional

- O profissional escolhe os dias da semana e cadastra manualmente os horários disponíveis de cada dia; pode editá-los depois. As disponibilidades recorrentes são atualizadas para os próximos 60 dias, e horários avulsos podem ser incluídos por data. Expediente e agenda são áreas separadas; a agenda pode ser filtrada e impressa por dia, semana ou mês.
- A aba Financeiro permite registrar recebimentos manuais, informar a forma de pagamento e gerar/imprimir relatórios por período; ela não processa pagamentos.
- O painel oferece um link público individual para compartilhar com clientes e permite exibir o perfil do Instagram.
- Fotos de perfil e de serviços são selecionadas como arquivos JPG, PNG ou WebP. O navegador otimiza imagens grandes; a Edge Function autentica o profissional e grava os arquivos no bucket público `conectaelas-images`.
- O profissional pode registrar na agenda um atendimento combinado por telefone, WhatsApp ou presencialmente, com serviço, horário e contato da cliente.
- A busca pública permite definir um preço máximo e ordenar os profissionais pelo menor ou maior preço dos serviços.
