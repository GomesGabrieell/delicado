import { useFocusEffect } from 'expo-router';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { confirmAction } from '../components/confirmAction';

import { Chip, Field, catalogStyles as styles } from '../catalog/controls';
import type { Company } from '../catalog/model';
import { listCompanies } from '../catalog/repository';
import { ActionButton } from '../components/ActionButton';
import { Screen } from '../components/Screen';
import { statuses } from '../quotes/repository';
import { colors } from '../theme';
import { clientFields, validateClient, type Client, type ClientFields } from './model';
import { archiveClient, clientAudit, clientError, clientPage, clientQuotes, listClients, loadClient, saveClient } from './repository';

type Target = { company: string; clientId?: string; quoteId?: string };
const labels = { document: 'CPF ou CNPJ', whatsapp: 'WhatsApp', email: 'E-mail', address: 'Endereço', notes: 'Observações' };
const lengths = { document: 24, whatsapp: 25, email: 254, address: 500, notes: 2000 };
const auditLabels = { created: 'Cadastro criado', edited: 'Dados editados', archived: 'Cliente arquivado', restored: 'Cliente reativado' };
const auditFields: Record<string, string> = { ...labels, name: 'Nome' };
const empty: ClientFields = { name: '', document: null, whatsapp: null, email: null, address: null, notes: null };

function Loading() {
  return <ActivityIndicator color={colors.blueGray} accessibilityLabel="Carregando clientes" />;
}

function ClientEditor({ client, company, existing, initial, close, saved }: {
  client: SupabaseClient; company: Company; existing?: Client; initial?: ClientFields;
  close: () => void; saved: (id: string) => void;
}) {
  const [fields, setFields] = useState(initial ?? empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (key: keyof ClientFields, value: string) => setFields((current) => ({ ...current, [key]: value }));
  async function persist() {
    setBusy(true);
    setError('');
    try { saved(await saveClient(client, company.id, validateClient(fields), existing)); }
    catch (cause) { setError(clientError(cause)); }
    finally { setBusy(false); }
  }
  return <Screen title={existing ? 'Editar cliente' : 'Novo cliente'} description={company.name}>
    <View style={styles.card}>
      <Field label="Nome completo ou razão social" value={fields.name} disabled={busy} onChangeText={(value) => update('name', value)} />
      {clientFields.map((key) => <Field key={key} label={labels[key]} value={fields[key] ?? ''}
        maxLength={lengths[key]} disabled={busy} multiline={key === 'notes' || key === 'address'}
        onChangeText={(value) => update(key, value)} />)}
    </View>
    {error !== '' && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
    <ActionButton label={busy ? 'Salvando…' : 'Salvar cliente'} disabled={busy} onPress={() => void persist()} />
    <Chip label="Cancelar" disabled={busy} onPress={close} />
  </Screen>;
}

function ClientDetails({ client, company, id, close, openQuote }: {
  client: SupabaseClient; company: Company; id: string; close: () => void; openQuote: (target: Target) => void;
}) {
  const manage = company.role !== 'member';
  const [data, setData] = useState<Awaited<ReturnType<typeof loadClient>>>();
  const [quotes, setQuotes] = useState<Awaited<ReturnType<typeof clientQuotes>>>([]);
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof clientAudit>>>([]);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [quotesLoading, setQuotesLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [quotesError, setQuotesError] = useState('');
  useFocusEffect(useCallback(() => {
    let current = true;
    setLoading(true);
    setError('');
    void Promise.all([loadClient(client, company.id, id, manage), manage ? clientAudit(client, company.id, id) : []])
      .then(([result, history]) => {
        if (current) {
          setData(result);
          setAudit(history.slice(0, clientPage));
          setAuditHasMore(history.length > clientPage);
        }
      }).catch((cause) => { if (current) { setData(undefined); setError(clientError(cause)); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, company.id, id, manage, revision]));
  useFocusEffect(useCallback(() => {
    let current = true;
    setQuotesLoading(true);
    setQuotesError('');
    void clientQuotes(client, company.id, id, offset).then((items) => { if (current) setQuotes(items); })
      .catch((cause) => { if (current) setQuotesError(clientError(cause)); })
      .finally(() => { if (current) setQuotesLoading(false); });
    return () => { current = false; };
  }, [client, company.id, id, offset, revision]));

  async function changeArchive(row: Client) {
    setBusy(true);
    setError('');
    try { await archiveClient(client, company.id, row); setRevision((value) => value + 1); }
    catch (cause) { setError(clientError(cause)); }
    finally { setBusy(false); }
  }
  async function moreAudit() {
    const before = audit.at(-1)?.id;
    if (before === undefined) return;
    setBusy(true);
    setError('');
    try {
      const page = await clientAudit(client, company.id, id, before);
      setAudit([...audit, ...page.slice(0, clientPage)]);
      setAuditHasMore(page.length > clientPage);
    }
    catch (cause) { setError(clientError(cause)); }
    finally { setBusy(false); }
  }

  if (loading || !data) return <Screen title="Cliente">
    {loading ? <Loading /> : <>
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <Chip label="Tentar novamente" onPress={() => setRevision((value) => value + 1)} />
    </>}
    <Chip label="Voltar à lista" onPress={close} />
  </Screen>;
  const { row, fields } = data;
  if (editing && manage && fields) return <ClientEditor client={client} company={company} existing={row}
    initial={{ ...fields, name: row.name }} close={() => setEditing(false)}
    saved={() => { setEditing(false); setRevision((value) => value + 1); }} />;
  const archiveAction = row.archived_at ? 'Reativar' : 'Arquivar';
  return <Screen title={row.name} description={row.archived_at ? 'Cliente arquivado' : 'Cliente ativo'}>
    {manage && fields && <View style={styles.card}>
      <Text style={styles.title}>Cadastro</Text>
      {clientFields.map((key) => fields[key] ? <View key={key}>
        <Text style={styles.strong}>{labels[key]}</Text>
        <Text selectable style={styles.text}>{fields[key]}</Text>
      </View> : null)}
      {!clientFields.some((key) => fields[key]) && <Text style={styles.text}>Sem dados de contato cadastrados.</Text>}
      <View style={styles.row}>
        {!row.archived_at && <Chip label="Editar" disabled={busy} onPress={() => setEditing(true)} />}
        <Chip label={archiveAction} disabled={busy} onPress={() => confirmAction(`${archiveAction} cliente?`, row.name,
          archiveAction, () => void changeArchive(row))} />
      </View>
    </View>}
    <View style={styles.card}>
      <Text style={styles.title}>Orçamentos vinculados</Text>
      {!row.archived_at && <ActionButton label="Novo orçamento" disabled={busy}
        onPress={() => openQuote({ company: company.id, clientId: id })} />}
      {quotesLoading ? <Loading /> : quotesError ? <>
        <Text style={styles.error} accessibilityRole="alert">{quotesError}</Text>
        <Chip label="Tentar novamente" onPress={() => setRevision((value) => value + 1)} />
      </> : <>
        {quotes.length === 0 && <Text style={styles.text}>Nenhum orçamento nesta página.</Text>}
        {quotes.slice(0, clientPage).map((quote) => <View key={quote.id} style={styles.stack}>
          <Text style={styles.strong}>{quote.title}</Text>
          <Text style={styles.text}>{statuses[quote.status]}{quote.event_date ? ` · ${quote.event_date.split('-').reverse().join('/')}` : ''}</Text>
          <Chip label={`Abrir ${quote.code}`} onPress={() => openQuote({ company: company.id, quoteId: quote.id })} />
        </View>)}
        <View style={styles.row}>
          {offset > 0 && <Chip label="Anterior" onPress={() => setOffset(offset - clientPage)} />}
          {quotes.length > clientPage && <Chip label="Próxima" onPress={() => setOffset(offset + clientPage)} />}
        </View>
      </>}
    </View>
    {manage && <View style={styles.card}>
      <Text style={styles.title}>Alterações do cadastro</Text>
      {audit.length === 0 && <Text style={styles.text}>Nenhuma alteração registrada.</Text>}
      {audit.map((entry) => <Text key={entry.id} style={styles.text}>
        {auditLabels[entry.action]} · {new Date(entry.happened_at).toLocaleString('pt-BR')}
        {entry.action === 'edited' ? ` · ${entry.changed_fields.map((key) => auditFields[key] ?? key).join(', ')}` : ''}
      </Text>)}
      {auditHasMore && <Chip label="Carregar alterações anteriores" disabled={busy} onPress={() => void moreAudit()} />}
    </View>}
    {busy && <Loading />}
    {error !== '' && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
    <Chip label="Voltar à lista" disabled={busy} onPress={close} />
  </Screen>;
}

function CompanyClients({ client, company, back, openQuote }: {
  client: SupabaseClient; company: Company; back: () => void; openQuote: (target: Target) => void;
}) {
  const manage = company.role !== 'member';
  const [selected, setSelected] = useState('');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [byDocument, setByDocument] = useState(false);
  const [archived, setArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [rows, setRows] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (selected || creating) return;
    let active = true;
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      void listClients(client, company.id, query, manage && byDocument, archived, offset)
        .then((data) => { if (active) setRows(data); })
        .catch((cause) => { if (active) setError(clientError(cause)); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [client, company.id, manage, selected, creating, query, byDocument, archived, offset, revision]);
  if (creating && manage) return <ClientEditor client={client} company={company} close={() => setCreating(false)}
    saved={(id) => { setCreating(false); setSelected(id); }} />;
  if (selected) return <ClientDetails client={client} company={company} id={selected}
    close={() => { setSelected(''); setOffset(0); }} openQuote={openQuote} />;
  return <Screen title="Clientes" description={company.name}>
    {manage && <ActionButton label="Novo cliente" onPress={() => setCreating(true)} />}
    <View style={styles.card}>
      {manage && <View style={styles.row}>
        <Chip label="Nome" active={!byDocument} onPress={() => { setByDocument(false); setQuery(''); setOffset(0); }} />
        <Chip label="CPF ou CNPJ" active={byDocument} onPress={() => { setByDocument(true); setQuery(''); setOffset(0); }} />
      </View>}
      <Field label={manage && byDocument ? 'Buscar por documento' : 'Buscar por nome'} value={query}
        onChangeText={(value) => { setQuery(value); setOffset(0); }} />
      <View style={styles.row}>
        <Chip label="Ativos" active={!archived} onPress={() => { setArchived(false); setOffset(0); }} />
        <Chip label="Arquivados" active={archived} onPress={() => { setArchived(true); setOffset(0); }} />
      </View>
    </View>
    {loading ? <Loading /> : error ? <>
      <Text style={styles.error} accessibilityRole="alert">{error}</Text>
      <Chip label="Tentar novamente" onPress={() => setRevision((value) => value + 1)} />
    </> : <>
      {rows.length === 0 && <Text style={styles.text}>Nenhum cliente encontrado.</Text>}
      {rows.slice(0, clientPage).map((row) => <View key={row.id} style={styles.card}>
        <Text style={styles.title}>{row.name}</Text>
        <Chip label={`Consultar ${row.name}`} onPress={() => setSelected(row.id)} />
      </View>)}
      <View style={styles.row}>
        {offset > 0 && <Chip label="Anterior" onPress={() => setOffset(offset - clientPage)} />}
        {rows.length > clientPage && <Chip label="Próxima" onPress={() => setOffset(offset + clientPage)} />}
      </View>
    </>}
    <Chip label="Trocar empresa" onPress={back} />
  </Screen>;
}

export function ClientsScreen({ client, userId, openQuote }: {
  client: SupabaseClient; userId: string; openQuote: (target: Target) => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    void listCompanies(client, userId).then((items) => { if (active) { setCompanies(items); setError(''); } })
      .catch((cause) => { if (active) { setCompanies([]); setError(clientError(cause)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, userId, revision]));
  const company = companies.find(({ id }) => id === companyId);
  if (company) return <CompanyClients key={company.id} client={client} company={company}
    back={() => setCompanyId('')} openQuote={openQuote} />;
  return <Screen title="Clientes" description="Selecione uma empresa.">
    {loading ? <Loading /> : error ? <>
      <Text style={styles.error} accessibilityRole="alert">{error}</Text>
      <Chip label="Tentar novamente" onPress={() => { setLoading(true); setRevision((value) => value + 1); }} />
    </> : companies.length ? companies.map((entry) => <ActionButton key={entry.id} label={entry.name} onPress={() => setCompanyId(entry.id)} />)
      : <Text style={styles.text}>Nenhuma empresa ativa.</Text>}
  </Screen>;
}
