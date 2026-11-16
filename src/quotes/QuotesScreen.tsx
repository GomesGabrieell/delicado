import { useFocusEffect } from 'expo-router';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Text, View } from 'react-native';
import { confirmAction } from '../components/confirmAction';

import { brl, formatScaled } from '../calculator/finance';
import { Chip, Field, catalogStyles as styles } from '../catalog/controls';
import type { Company } from '../catalog/model';
import { listCompanies } from '../catalog/repository';
import { ActionButton } from '../components/ActionButton';
import { Screen } from '../components/Screen';
import { colors } from '../theme';
import {
  createClient, duplicateQuote, findClients, historyPage, imageUrl, listQuoteHistory, listQuotes, loadQuoteDetails, quoteError,
  quotePage, saveQuote, statuses, uploadInspiration,
  type Quote, type QuoteClient, type QuoteFields, type Status,
} from './repository';

const blank: QuoteFields = { title: '', client_id: null, event_date: null, location: '', decoration: '', payment_terms: '' };
const actions: Record<string, string> = {
  proposal_issued: 'Proposta emitida',
  created: 'Criado', edited: 'Dados alterados', status: 'Estado alterado', composition: 'Composição salva',
  calculated: 'Cálculo registrado', image: 'Imagem anexada', duplicated: 'Criado por duplicação',
};

function Spinner() {
  return <ActivityIndicator color={colors.blueGray} accessibilityLabel="Carregando" />;
}

function Inspiration({ client, path }: { client: SupabaseClient; path: string }) {
  const [uri, setUri] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void imageUrl(client, path).then((url) => { if (active) setUri(url); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [client, path]);
  if (error) return <Text style={styles.error}>Imagem indisponível.</Text>;
  if (!uri) return <Spinner />;
  return <Image source={{ uri }} resizeMode="contain" style={styles.photo}
    accessibilityLabel="Imagem de inspiração" onError={() => setError(true)} />;
}

function QuoteEditor({ client, company, original, initialClient, onSaved, onCancel }: {
  client: SupabaseClient; company: Company; original?: Quote; onSaved: (quote: Quote) => void; onCancel: () => void;
  initialClient?: string;
}) {
  const [fields, setFields] = useState<QuoteFields>(() => original ? {
    title: original.title, client_id: original.client_id, event_date: original.event_date,
    location: original.location, decoration: original.decoration, payment_terms: original.payment_terms,
  } : { ...blank, client_id: initialClient ?? null });
  const [clients, setClients] = useState<QuoteClient[]>([]);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clientError, setClientError] = useState('');
  const [retry, setRetry] = useState(0);
  const selected = fields.client_id;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setClientError('');
    const timer = setTimeout(() => {
      void findClients(client, company.id, search, selected).then((data) => { if (active) setClients(data); })
        .catch((cause) => { if (active) setClientError(quoteError(cause)); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [client, company.id, search, selected, retry]);

  function field(key: Exclude<keyof QuoteFields, 'client_id'>, label: string, maxLength: number, multiline = false) {
    return <Field label={label} value={fields[key] ?? ''} maxLength={maxLength} disabled={busy} multiline={multiline}
      onChangeText={(value) => setFields((previous) => ({ ...previous, [key]: value }))} />;
  }

  async function addClient() {
    if (!newName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const entry = await createClient(client, company.id, newName.trim());
      setFields((previous) => ({ ...previous, client_id: entry.id }));
      setSearch(entry.name);
      setNewName('');
    } catch (cause) {
      setError(quoteError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      if (!fields.title.trim()) throw new Error('Informe o título do orçamento.');
      const date = fields.event_date?.trim();
      if (date) {
        const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
        const iso = match && `${match[3]}-${match[2]}-${match[1]}`;
        const parsed = iso ? new Date(iso + 'T00:00:00Z') : null;
        if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso || iso.startsWith('0000')) {
          throw new Error('Informe uma data válida no formato DD/MM/AAAA.');
        }
        onSaved(await saveQuote(client, company.id, { ...fields, title: fields.title.trim(), event_date: iso }, original));
      } else {
        onSaved(await saveQuote(client, company.id, { ...fields, title: fields.title.trim(), event_date: null }, original));
      }
    } catch (cause) {
      setError(quoteError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={original ? 'Editar orçamento' : 'Novo orçamento'} description={original?.code ?? company.name}>
      <View style={styles.card}>
        {field('title', 'Título', 120)}
        {field('event_date', 'Data do evento (DD/MM/AAAA)', 10)}
        {field('location', 'Local do evento', 240)}
        {field('decoration', 'Descrição da decoração', 4000, true)}
        {field('payment_terms', 'Condições de pagamento', 2000, true)}
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Cliente</Text>
        <Field label="Buscar cliente" value={search} onChangeText={setSearch} disabled={busy} />
        {loading ? <Spinner /> : clientError ? <>
          <Text accessibilityRole="alert" style={styles.error}>{clientError}</Text>
          <Chip label="Tentar novamente" onPress={() => setRetry((value) => value + 1)} />
        </> : <View style={styles.row}>
          <Chip label="Sem cliente" active={!selected} disabled={busy} onPress={() => setFields((previous) => ({ ...previous, client_id: null }))} />
          {clients.map((entry) => <Chip key={entry.id} label={entry.name} active={entry.id === selected} disabled={busy}
            onPress={() => setFields((previous) => ({ ...previous, client_id: entry.id }))} />)}
        </View>}
        <Field label="Nome de novo cliente" value={newName} onChangeText={setNewName} disabled={busy} />
        <Chip label="Cadastrar e vincular" disabled={busy || !newName.trim()} onPress={() => void addClient()} />
      </View>
      {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <ActionButton label={busy ? 'Aguarde…' : 'Salvar rascunho'} disabled={busy} onPress={() => void save()} />
      <Chip label="Cancelar" disabled={busy} onPress={onCancel} />
    </Screen>
  );
}

function QuoteDetails({ client, company, id, back, edit, compose, open, proposals }: {
  client: SupabaseClient; company: Company; id: string; back: () => void; edit: (quote: Quote) => void;
  compose: (id: string) => void;
  open: (id: string) => void;
  proposals: (id: string) => void;
}) {
  const financial = company.role !== 'member';
  const [data, setData] = useState<Awaited<ReturnType<typeof loadQuoteDetails>>>();
  const [hasOlderHistory, setHasOlderHistory] = useState(false);
  const [customer, setCustomer] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError('');
    void loadQuoteDetails(client, company.id, id, financial).then(async (result) => {
      const name = result.quote.client_id
        ? (await findClients(client, company.id, '', result.quote.client_id)).find((entry) => entry.id === result.quote.client_id)?.name
        : '';
      if (active) {
        setData(result);
        setHasOlderHistory(result.history.length > historyPage);
        setCustomer(name ?? '');
      }
    }).catch((cause) => { if (active) { setError(quoteError(cause)); setData(undefined); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, company.id, id, financial, revision]));

  async function run(action: () => Promise<unknown>, onSuccess = () => setRevision((value) => value + 1)) {
    setBusy(true);
    setError('');
    try { await action(); onSuccess(); }
    catch (cause) { setError(quoteError(cause)); }
    finally { setBusy(false); }
  }

  async function loadOlderHistory() {
    if (!data) return;
    const shown = data.history.slice(0, -1);
    const before = shown.at(-1)?.id;
    if (before === undefined) return;
    await run(async () => {
      const older = await listQuoteHistory(client, company.id, id, before);
      setData({ ...data, history: [...shown, ...older] });
      setHasOlderHistory(older.length > historyPage);
    }, () => undefined);
  }

  if (loading || !data) return <Screen title="Orçamento">
    {loading ? <Spinner /> : <>
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <Chip label="Tentar novamente" onPress={() => setRevision((value) => value + 1)} />
    </>}
    <Chip label="Voltar à lista" onPress={back} />
  </Screen>;
  const { quote, snapshot, images, history } = data;
  const draft = quote.status === 'draft';
  function changeStatus(status: Status) {
    void run(() => saveQuote(client, company.id, { status }, quote));
  }
  return (
    <Screen title={quote.title} description={`${quote.code} · ${statuses[quote.status]}`}>
      <View style={styles.card}>
        <Text style={styles.title}>Evento e cliente</Text>
        <Text style={styles.text}>{customer || 'Cliente pendente'}</Text>
        <Text style={styles.text}>{quote.event_date?.split('-').reverse().join('/') || 'Data pendente'}</Text>
        <Text style={styles.text}>{quote.location || 'Local pendente'}</Text>
        {quote.decoration !== '' && <Text style={styles.text}>{quote.decoration}</Text>}
        {quote.payment_terms !== '' && <Text style={styles.text}>Pagamento · {quote.payment_terms}</Text>}
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Composição</Text>
        {quote.items.length === 0 && <Text style={styles.text}>Nenhum item registrado.</Text>}
        {quote.items.map((item) => <Text key={item.id} style={styles.text}>
          {item.name} · {item.quantity.replace('.', ',')}{item.unit ? ` ${item.unit}` : ''}
        </Text>)}
        {draft && <Chip label="Abrir na calculadora" disabled={busy} onPress={() => compose(id)} />}
      </View>
      {financial && <View style={styles.card}>
        <Text style={styles.title}>Resumo financeiro registrado</Text>
        {snapshot ? <>
          <Text style={styles.text}>Custo total · {brl(BigInt(snapshot.totalCost ?? '0'))}</Text>
          <Text style={styles.strong}>Preço de venda · {brl(BigInt(snapshot.sale ?? '0'))}</Text>
          <Text style={styles.text}>Lucro estimado · {brl(BigInt(snapshot.profit ?? '0'))}</Text>
          <Text style={styles.text}>Margem · {snapshot.margin == null ? 'Indefinida' : `${formatScaled(BigInt(snapshot.margin), 2)}%`}</Text>
        </> : <Text style={styles.text}>Registre o cálculo na etapa Resumo da calculadora.</Text>}
      </View>}
      <View style={styles.card}>
        <Text style={styles.title}>Inspiração</Text>
        {images.map(({ path }) => <Inspiration key={path} client={client} path={path} />)}
        {draft && <Chip label="Anexar imagem" disabled={busy || images.length >= 20}
          onPress={() => void run(() => uploadInspiration(client, company.id, id))} />}
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Histórico</Text>
        {(hasOlderHistory ? history.slice(0, -1) : history).map((entry) => <Text key={entry.id} style={styles.text}>
          {new Date(entry.happened_at).toLocaleString('pt-BR')} · {actions[entry.action]} · {statuses[entry.status]}
        </Text>)}
        {hasOlderHistory && <Chip label="Carregar eventos anteriores" disabled={busy} onPress={() => void loadOlderHistory()} />}
      </View>
      {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {busy && <Spinner />}
      <View style={styles.row}>
        {financial && <Chip label="Propostas comerciais" disabled={busy} onPress={() => proposals(id)} />}
        {draft && <Chip label="Editar dados" disabled={busy} onPress={() => edit(quote)} />}
        <Chip label="Duplicar" disabled={busy} onPress={() => confirmAction('Duplicar orçamento?', quote.code,
          'Duplicar', () => void run(async () => open(await duplicateQuote(client, company.id, id)), () => undefined))} />
        {financial && draft && <Chip label="Marcar pronto para revisão" disabled={busy} onPress={() => changeStatus('ready')} />}
        {financial && !draft && <Chip label="Reabrir rascunho" disabled={busy} onPress={() => changeStatus('draft')} />}
        {financial && quote.status !== 'archived' && <Chip label="Arquivar" disabled={busy} onPress={() =>
          confirmAction('Arquivar orçamento?', quote.code, 'Arquivar', () => changeStatus('archived'))} />}
      </View>
      <Chip label="Voltar à lista" disabled={busy} onPress={back} />
    </Screen>
  );
}

function CompanyQuotes({ client, company, back, compose, target, proposals }: {
  client: SupabaseClient; company: Company; back: () => void; compose: (id: string) => void;
  target?: { clientId?: string; quoteId?: string };
  proposals: (id: string) => void;
}) {
  const [edit, setEdit] = useState<Quote | 'new' | undefined>(target?.clientId ? 'new' : undefined);
  const [id, setId] = useState(target?.quoteId ?? '');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status | ''>('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [rows, setRows] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (edit || id) return;
    let active = true;
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      void listQuotes(client, company.id, query, status, offset).then((data) => { if (active) setRows(data); })
        .catch((cause) => { if (active) setError(quoteError(cause)); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [client, company.id, edit, id, query, status, offset, revision]);

  if (edit) return <QuoteEditor client={client} company={company}
    original={edit === 'new' ? undefined : { ...edit, event_date: edit.event_date?.split('-').reverse().join('/') ?? null }}
    initialClient={target?.clientId} onSaved={(quote) => { setEdit(undefined); setId(quote.id); }}
    onCancel={() => { if (target && !id) back(); else setEdit(undefined); }} />;
  if (id) return <QuoteDetails key={id} client={client} company={company} id={id} compose={compose} proposals={proposals}
    back={() => { if (target) back(); else { setOffset(0); setId(''); } }} edit={setEdit} open={setId} />;
  return (
    <Screen title="Orçamentos" description={company.name}>
      <ActionButton label="Novo orçamento" onPress={() => setEdit('new')} />
      <Field label="Pesquisar por título, código ou local" value={query} onChangeText={(value) => { setQuery(value); setOffset(0); }} />
      <View style={styles.row}>
        <Chip label="Todos" active={!status} onPress={() => { setStatus(''); setOffset(0); }} />
        {(Object.keys(statuses) as Status[]).map((value) => <Chip key={value} label={statuses[value]}
          active={status === value} onPress={() => { setStatus(value); setOffset(0); }} />)}
      </View>
      {loading ? <Spinner /> : error ? <>
        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        <Chip label="Tentar novamente" onPress={() => setRevision((value) => value + 1)} />
      </> : <>
        {rows.length === 0 && <Text style={styles.text}>Nenhum orçamento encontrado.</Text>}
        {rows.slice(0, quotePage).map((quote) => <View key={quote.id} style={styles.card}>
          <Text style={styles.title}>{quote.title}</Text>
          <Text style={styles.text}>{quote.code} · {statuses[quote.status]}</Text>
          <Chip label={`Abrir ${quote.code}`} onPress={() => setId(quote.id)} />
        </View>)}
        <View style={styles.row}>
          {offset > 0 && <Chip label="Anterior" onPress={() => setOffset(offset - quotePage)} />}
          {rows.length > quotePage && <Chip label="Próxima" onPress={() => setOffset(offset + quotePage)} />}
        </View>
      </>}
      <Chip label="Trocar empresa" onPress={back} />
    </Screen>
  );
}

export function QuotesScreen({ client, userId, compose, target, onBack, proposals }: {
  client: SupabaseClient; userId: string; compose: (company: string, id: string) => void;
  target?: { company: string; clientId?: string; quoteId?: string }; onBack: () => void;
  proposals: (company: string, quote: string) => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [id, setId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    setError('');
    void listCompanies(client, userId).then((data) => { if (active) setCompanies(data); })
      .catch((cause) => { if (active) { setError(quoteError(cause)); setCompanies([]); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, userId, revision]));
  const company = companies.find((entry) => entry.id === (target?.company ?? id));
  if (company) return <CompanyQuotes key={company.id} client={client} company={company}
    proposals={(quote) => proposals(company.id, quote)}
    back={target ? onBack : () => setId('')} target={target} compose={(quote) => compose(company.id, quote)} />;
  return <Screen title="Orçamentos" description="Selecione uma empresa.">
    {loading ? <Spinner /> : error ? <>
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <Chip label="Tentar novamente" onPress={() => { setLoading(true); setRevision((value) => value + 1); }} />
    </> : target ? <Text style={styles.error}>Empresa indisponível para esta conta.</Text>
      : companies.length === 0 ? <Text style={styles.text}>Nenhuma empresa ativa.</Text>
      : companies.map((entry) => <ActionButton key={entry.id} label={entry.name} onPress={() => setId(entry.id)} />)}
  </Screen>;
}
