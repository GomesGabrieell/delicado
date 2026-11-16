import { useFocusEffect } from 'expo-router';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { confirmAction } from '../components/confirmAction';

import { Chip, Field, catalogStyles as styles } from '../catalog/controls';
import { groups, type Company, type Kind } from '../catalog/model';
import { catalogError, listCompanies } from '../catalog/repository';
import { ActionButton } from '../components/ActionButton';
import { Screen } from '../components/Screen';
import { colors } from '../theme';
import { createQuoteFromCalculator, loadQuote, quoteError, saveQuoteComposition, type Snapshot } from '../quotes/repository';
import { FinancialSteps, financialSteps, type CartLine } from './FinancialSteps';
import { parseDecimal } from './finance';
import { calculatorPageSize, listDrafts, loadProducts, saveDraft, searchProducts, type Product, type SavedDraft } from './repository';

const kinds = Object.keys(groups) as Kind[];

function ProductPicker({ client, companyId, kind, lines, add }: {
  client: SupabaseClient; companyId: string; kind: Kind; lines: CartLine[]; add: (product: Product) => void;
}) {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      void searchProducts(client, companyId, kind, search, offset).then((result) => {
        if (current) setItems(result);
      }).catch((cause) => {
        if (current) setError(catalogError(cause));
      }).finally(() => {
        if (current) setLoading(false);
      });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [client, companyId, kind, search, offset, revision]);

  return (
    <View style={styles.stack}>
      <Field label="Buscar no catálogo" value={search} onChangeText={(text) => { setSearch(text); setOffset(0); }} />
      {loading ? <ActivityIndicator color={colors.blueGray} accessibilityLabel="Carregando produtos" /> : error ? <>
        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        <Chip label="Tentar novamente" onPress={() => setRevision((value) => value + 1)} />
      </> : <>
        {items.length === 0 && <Text style={styles.text}>Nenhum produto encontrado.</Text>}
        {items.slice(0, calculatorPageSize).map((product) => {
          const added = lines.some((line) => line.product.id === product.id);
          const description = product.kind === 'balloon' ? [product.brand, product.size].filter(Boolean).join(' · ')
            : product.kind === 'material' ? product.unit : product.ownership === 'rented' ? 'Alugado' : 'Próprio';
          return (
            <View key={product.id} style={styles.card}>
              <Text style={styles.title}>{product.name}</Text>
              {description && <Text style={styles.text}>{description}</Text>}
              <Chip label={added ? 'No carrinho' : `Adicionar ${product.name}`} disabled={added || lines.length >= 200}
                onPress={() => add(product)} />
            </View>
          );
        })}
        <View style={styles.row}>
          {offset > 0 && <Chip label="Anterior" onPress={() => setOffset(offset - calculatorPageSize)} />}
          {items.length > calculatorPageSize && <Chip label="Próxima" onPress={() => setOffset(offset + calculatorPageSize)} />}
        </View>
      </>}
    </View>
  );
}

function CompanyCalculator({ client, company, onBack, target, seedProduct, onQuoteSaved, onOpenQuote }: {
  client: SupabaseClient; company: Company; onBack: () => void;
  target?: string; onQuoteSaved?: () => void;
  seedProduct?: string; onOpenQuote: (company: string, quote: string) => void;
}) {
  const financial = company.role !== 'member';
  const steps = financial ? [...Object.values(groups), ...financialSteps] : Object.values(groups);
  const [index, setIndex] = useState(0);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [draft, setDraft] = useState<SavedDraft>();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'cart' | 'drafts'>('cart');
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const [financialVersion, setFinancialVersion] = useState(0);
  const [quoteVersion, setQuoteVersion] = useState('');
  const [quoteSnapshot, setQuoteSnapshot] = useState<Snapshot>();
  const step = steps[index];
  const kind = kinds[index];

  useEffect(() => {
    if (!seedProduct || target) return;
    let active = true;
    setBusy(true);
    void loadProducts(client, company.id, [seedProduct]).then(([product]) => {
      if (!active) return;
      if (!product || product.archived_at) throw new Error('Este produto não está disponível para orçamento.');
      setLines([{ product, quantity: '1', whole: false }]);
      setIndex(kinds.indexOf(product.kind));
    }).catch((cause) => { if (active) setError(catalogError(cause)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [client, company.id, seedProduct, target]);

  useEffect(() => {
    if (!target) return;
    let active = true;
    setBusy(true);
    void loadQuote(client, company.id, target, financial).then(async ({ quote, snapshot }) => {
      if (quote.status !== 'draft') throw new Error('Reabra o orçamento para editar a composição.');
      const products = new Map((await loadProducts(client, company.id, quote.items.map(({ id }) => id)))
        .map((product) => [product.id, product]));
      if (!active) return;
      setName(quote.title);
      setQuoteVersion(quote.updated_at);
      setQuoteSnapshot(snapshot);
      setMissing(quote.items.filter(({ id }) => !products.has(id)).map(({ id }) => id));
      setLines(quote.items.flatMap(({ id, quantity }, position) => {
        const product = products.get(id);
        return product ? [{ product, quantity: quantity.replace('.', ','), whole: snapshot?.inputs?.lines[position]?.whole ?? false }] : [];
      }));
    }).catch((cause) => {
      if (active) setError(quoteError(cause));
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [client, company.id, target, financial]);

  useEffect(() => {
    if (mode !== 'drafts') return;
    let current = true;
    setLoadingDrafts(true);
    setError('');
    void listDrafts(client, company.id, offset).then((data) => {
      if (current) setDrafts(data);
    }).catch((cause) => {
      if (current) setError(catalogError(cause));
    }).finally(() => {
      if (current) setLoadingDrafts(false);
    });
    return () => { current = false; };
  }, [client, company.id, mode, offset, revision]);

  function edit(id: string, values: Partial<Pick<CartLine, 'quantity' | 'whole'>>) {
    setLines((items) => items.map((line) => line.product.id === id ? { ...line, ...values } : line));
  }

  async function open(saved: SavedDraft) {
    setBusy(true);
    setError('');
    try {
      const products = new Map((await loadProducts(client, company.id, saved.lines.map((line) => line.id)))
        .map((product) => [product.id, product]));
      const cart: CartLine[] = [];
      const unavailable: string[] = [];
      for (const line of saved.lines) {
        const product = products.get(line.id);
        if (product) cart.push({ product, quantity: line.quantity.replace('.', ','), whole: false });
        else unavailable.push(line.id);
      }
      setLines(cart);
      setMissing(unavailable);
      setDraft(saved);
      setName(saved.name);
      setIndex(0);
      setFinancialVersion((value) => value + 1);
      setRevision((value) => value + 1);
      setMode('cart');
    } catch (cause) {
      setError(catalogError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function persist(snapshot?: Snapshot, createQuote = false) {
    setError('');
    setMessage('');
    if (missing.length) {
      setError('Remova os itens indisponíveis antes de salvar.');
      return;
    }
    if (lines.length === 0 || (!target && !name.trim())) {
      setError(lines.length === 0 ? 'Adicione pelo menos um item.' : 'Informe o nome do orçamento ou da composição.');
      return;
    }
    setBusy(true);
    try {
      const composition = lines.map(({ product, quantity }) => {
        const scale = product.kind === 'material' ? 3 : 0;
        const value = parseDecimal(quantity, scale);
        if (product.archived_at || value === null || value === 0n || value >= 10n ** BigInt(9 + scale)) {
          throw new Error(`Revise ou remova “${product.name}” antes de salvar.`);
        }
        const normalized = quantity.trim().replace(',', '.').replace(/^0+(?=\d)/, '');
        return { id: product.id, quantity: normalized };
      });
      if (target) {
        if (!quoteVersion) throw new Error('Reabra o orçamento antes de salvar.');
        await saveQuoteComposition(client, company.id, target, quoteVersion, composition, snapshot);
        onQuoteSaved?.();
        return;
      }
      if (createQuote) {
        const id = await createQuoteFromCalculator(client, company.id, name.trim(), composition, snapshot);
        onOpenQuote(company.id, id);
        return;
      }
      const saved = await saveDraft(client, company.id, name.trim(), composition, draft);
      setDraft(saved);
      setMessage('Composição salva.');
    } catch (cause) {
      setError(target || createQuote ? quoteError(cause) : catalogError(cause));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: 'cart' | 'drafts') {
    setError('');
    setMessage('');
    setMode(next);
  }

  function reset() {
    const clear = () => {
      setDraft(undefined);
      setLines([]);
      setMissing([]);
      setName('');
      setIndex(0);
      setFinancialVersion((value) => value + 1);
      switchMode('cart');
    };
    if (!lines.length && !name) {
      clear();
      return;
    }
    confirmAction('Iniciar nova composição?', 'As alterações ainda não salvas serão descartadas.', 'Iniciar', clear);
  }

  return (
    <Screen title="Calculadora" description={company.name}>
      {!target && <View style={styles.row}>
        <Chip label="Trocar empresa" disabled={busy} onPress={onBack} />
        <Chip label={mode === 'cart' ? 'Composições salvas' : 'Voltar ao carrinho'} disabled={busy}
          onPress={() => switchMode(mode === 'cart' ? 'drafts' : 'cart')} />
        <Chip label="Nova composição" disabled={busy} onPress={reset} />
      </View>}
      {mode === 'drafts' ? (
        <View style={styles.card}>
          <Text style={styles.title}>Composições salvas</Text>
          {loadingDrafts || busy ? <ActivityIndicator color={colors.blueGray} accessibilityLabel="Carregando composição" /> : <>
            {!error && drafts.length === 0 && <Text style={styles.text}>Nenhuma composição salva.</Text>}
            {drafts.slice(0, calculatorPageSize).map((saved) => (
              <Chip key={saved.id} label={saved.name} disabled={Boolean(error)} onPress={() => void open(saved)} />
            ))}
            <View style={styles.row}>
              {error !== '' && <Chip label="Atualizar" onPress={() => setRevision((value) => value + 1)} />}
              {offset > 0 && <Chip label="Anterior" onPress={() => setOffset(offset - calculatorPageSize)} />}
              {drafts.length > calculatorPageSize && <Chip label="Próxima" onPress={() => setOffset(offset + calculatorPageSize)} />}
            </View>
          </>}
        </View>
      ) : (
        <>
          <View style={styles.row}>
            {steps.map((label, position) => (
              <Chip key={label} label={label} active={position === index} onPress={() => setIndex(position)} />
            ))}
          </View>
          <Text accessibilityRole="header" style={styles.title}>{step}</Text>
          {missing.length > 0 && <View style={styles.card}>
            <Text style={styles.error}>{missing.length} item(ns) indisponível(is) na composição.</Text>
            <Chip label="Remover itens indisponíveis" onPress={() => setMissing([])} />
          </View>}
          {kind && <>
            {lines.filter((line) => line.product.kind === kind).map(({ product, quantity, whole }) => (
              <View key={product.id} style={styles.card}>
                <Text style={styles.title}>{product.name}</Text>
                {product.archived_at && <Text style={styles.error}>Item arquivado. Remova-o da composição.</Text>}
                <Field label={product.unit ? `Quantidade (${product.unit})` : 'Quantidade'} value={quantity} decimal
                  onChangeText={(value) => edit(product.id, { quantity: value })} disabled={busy} />
                {financial && kind === 'balloon' && <View style={styles.row}>
                  <Chip label="Proporcional" active={!whole} onPress={() => edit(product.id, { whole: false })} />
                  <Chip label="Embalagens inteiras" active={whole} onPress={() => edit(product.id, { whole: true })} />
                </View>}
                <Chip label={`Remover ${product.name}`} disabled={busy}
                  onPress={() => setLines((items) => items.filter((line) => line.product.id !== product.id))} />
              </View>
            ))}
          </>}
        </>
      )}
      {!target && mode === 'cart' && <Field label="Nome da composição ou do orçamento" value={name}
        onChangeText={setName} disabled={busy} />}
      {financial && (!target || quoteVersion) && <View style={mode === 'drafts' ? { display: 'none' } : styles.stack}>
        <FinancialSteps key={financialVersion} client={client} companyId={company.id} lines={lines}
          step={step} hasMissingItems={missing.length > 0} quoteBusy={busy} initialSnapshot={quoteSnapshot}
          quoteLabel={target ? 'Registrar cálculo no orçamento' : 'Criar orçamento com este cálculo'}
          onSaveQuote={(snapshot) => void persist(snapshot, !target)} />
      </View>}
      {mode === 'cart' && <>
        {kind && !busy && (!target || quoteVersion) && <ProductPicker key={kind} client={client} companyId={company.id} kind={kind} lines={lines}
          add={(product) => setLines((items) => items.length >= 200 || items.some((item) => item.product.id === product.id)
            ? items : [...items, { product, quantity: '1', whole: false }])} />}
        {target ? (!financial && <ActionButton label="Salvar composição no orçamento" disabled={busy} onPress={() => void persist()} />) : <View style={styles.card}>
          <Text style={styles.text}>Salve os produtos e as quantidades para retomar a composição.</Text>
          <ActionButton label={busy ? 'Salvando…' : 'Salvar composição'} disabled={busy} onPress={() => void persist()} />
          {!financial && <Chip label="Criar orçamento com a composição" disabled={busy} onPress={() => void persist(undefined, true)} />}
          {message !== '' && <Text accessibilityRole="alert" style={styles.text}>{message}</Text>}
        </View>}
      </>}
      {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </Screen>
  );
}

export function CalculatorScreen({ client, userId, target, seed, onQuoteSaved, onOpenQuote }: {
  client: SupabaseClient; userId: string; target?: { company: string; quote: string }; onQuoteSaved?: () => void;
  seed?: { company: string; product: string }; onOpenQuote: (company: string, quote: string) => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState('');
  const [useSeed, setUseSeed] = useState(Boolean(seed));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    let current = true;
    setLoading(true);
    setError('');
    setError('');
    void listCompanies(client, userId).then((data) => {
      if (current) setCompanies(data);
    }).catch((cause) => {
      if (current) setError(catalogError(cause));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [client, userId, revision]));

  const company = companies.find(({ id }) => id === (target?.company ?? (useSeed ? seed?.company : selected)));
  if (!error && company) {
    return <CompanyCalculator key={company.id} client={client} company={company} target={target?.quote}
      seedProduct={useSeed ? seed?.product : undefined} onQuoteSaved={onQuoteSaved} onOpenQuote={onOpenQuote}
      onBack={() => { setUseSeed(false); setSelected(''); setRevision((value) => value + 1); }} />;
  }
  return (
    <Screen title="Calculadora" description="Selecione uma empresa para compor o orçamento.">
      {loading ? <ActivityIndicator color={colors.blueGray} accessibilityLabel="Carregando empresas" /> : error ? <>
        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        <Chip label="Tentar novamente" onPress={() => setRevision((value) => value + 1)} />
      </> : target || useSeed ? <Text style={styles.error}>Empresa indisponível para esta conta.</Text>
        : companies.length === 0 ? <Text style={styles.text}>Nenhuma empresa ativa. Acesse o Catálogo para criar uma empresa.</Text>
        : companies.map((entry) => <ActionButton key={entry.id} label={entry.name} onPress={() => setSelected(entry.id)} />)}
    </Screen>
  );
}
