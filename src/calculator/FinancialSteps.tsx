import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { confirmAction } from '../components/confirmAction';

import { Chip, Field, catalogStyles as styles } from '../catalog/controls';
import { ActionButton } from '../components/ActionButton';
import type { Snapshot } from '../quotes/repository';
import { catalogError, type CatalogFinancials } from '../catalog/repository';
import { colors } from '../theme';
import { brl, calculate, formatScaled, parseDecimal } from './finance';
import type { CostLine, Transport } from './finance';
import { loadDefault, loadPrices, saveDefault, type Product } from './repository';

export type CartLine = { product: Product; quantity: string; whole: boolean };

export const financialSteps = ['Serviços e despesas', 'Transporte', 'Mão de obra', 'Formação do preço', 'Descontos', 'Resumo'];

function decimal(text: string | number | null, scale: number, message: string, max?: bigint) {
  const value = parseDecimal(String(text ?? ''), scale);
  if (value === null || (max !== undefined && value > max)) throw new Error(message);
  return value;
}

function costLine({ product, quantity, whole }: CartLine, price: CatalogFinancials | undefined): CostLine {
  if (!price || price.archived_at) throw new Error(`Atualize ou remova “${product.name}”.`);
  const qty = decimal(quantity, product.kind === 'material' ? 3 : 0, `Revise a quantidade de “${product.name}”.`);
  if (qty === 0n) throw new Error(`Informe uma quantidade positiva para “${product.name}”.`);
  const invalid = `Revise o cadastro de “${product.name}” no catálogo.`;
  switch (product.kind) {
    case 'balloon': return { kind: product.kind, quantity: qty, whole,
      packageSize: decimal(price.package_quantity, 0, invalid), packagePrice: decimal(price.package_price, 2, invalid) };
    case 'asset': return { kind: product.kind, quantity: qty,
      rentalCost: decimal(price.rental_cost, 2, invalid), markup: decimal(price.markup_percent, 2, invalid) };
    case 'material': return { kind: product.kind, quantity: qty,
      catalogQuantity: decimal(price.quantity, 3, invalid), catalogCost: decimal(price.material_cost, 2, invalid) };
  }
}

function fromScaled(value: string | undefined, scale = 2) {
  return value && /^\d+$/.test(value) ? formatScaled(BigInt(value), scale) : '';
}

export function FinancialSteps({ client, companyId, lines, step, hasMissingItems, onSaveQuote, quoteBusy, initialSnapshot, quoteLabel }: {
  client: SupabaseClient; companyId: string; lines: CartLine[]; step: string; hasMissingItems: boolean;
  onSaveQuote?: (snapshot: Snapshot) => void; quoteBusy?: boolean; initialSnapshot?: Snapshot;
  quoteLabel: string;
}) {
  const saved = initialSnapshot?.inputs;
  const [prices, setPrices] = useState<Map<string, CatalogFinancials>>(new Map());
  const [defaultProfit, setDefaultProfit] = useState('');
  const [override, setOverride] = useState(() => fromScaled(saved?.profitPercent));
  const [useDefault, setUseDefault] = useState(!saved);
  const [expenses, setExpenses] = useState(() => (saved?.expenses ?? []).map((cost, id) => ({
    id, name: initialSnapshot?.expenseNames?.[id] ?? '', cost: fromScaled(cost),
  })));
  const [nextExpense, setNextExpense] = useState(expenses.length);
  const [transportMode, setTransportMode] = useState<Transport['kind']>(saved?.transport.kind ?? 'pickup');
  const [transportCost, setTransportCost] = useState(() => fromScaled(saved?.transport.cost));
  const [km, setKm] = useState(() => fromScaled(saved?.transport.km, 3));
  const [rate, setRate] = useState(() => fromScaled(saved?.transport.rate));
  const [labor, setLabor] = useState(() => fromScaled(saved?.labor));
  const [discountMode, setDiscountMode] = useState<'fixed' | 'percent'>(saved?.discount.kind ?? 'fixed');
  const [discount, setDiscount] = useState(() => fromScaled(saved?.discount.value));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const ids = lines.map(({ product }) => product.id).join(',');

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void loadDefault(client, companyId).then((value) => {
      if (current) setDefaultProfit(value);
    }).catch((cause) => {
      if (current) setError(catalogError(cause));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [client, companyId, revision]);

  const [loadedPrices, setLoadedPrices] = useState<{ ids: string; revision: number }>();
  const [priceError, setPriceError] = useState('');
  useEffect(() => {
    let current = true;
    setPriceError('');
    void loadPrices(client, companyId, ids ? ids.split(',') : []).then((values) => {
      if (current) {
        setPrices(values);
        setLoadedPrices({ ids, revision });
      }
    }).catch((cause) => {
      if (current) setPriceError(catalogError(cause));
    });
    return () => { current = false; };
  }, [client, companyId, ids, revision]);

  async function persistDefault() {
    setSaveMessage('');
    setSaving(true);
    try {
      decimal(defaultProfit, 2, 'Informe um acréscimo entre 0% e 10.000%.', 1_000_000n);
      await saveDefault(client, companyId, defaultProfit.trim());
      setSaveMessage('Percentual padrão salvo para a empresa.');
    } catch (cause) {
      setSaveMessage(catalogError(cause));
    } finally {
      setSaving(false);
    }
  }

  let result: ReturnType<typeof calculate> | undefined;
  let input: Parameters<typeof calculate>[0] | undefined;
  let validation = '';
  const waiting = loading || loadedPrices?.ids !== ids || loadedPrices?.revision !== revision;
  if (hasMissingItems) {
    validation = 'Remova os itens indisponíveis para calcular o preço.';
  } else if (!waiting && !error && !priceError) {
    try {
      const transport: Transport = transportMode === 'pickup' ? { kind: 'pickup' }
        : transportMode === 'fixed' ? { kind: 'fixed', cost: decimal(transportCost, 2, 'Informe o valor do transporte.') }
        : { kind: 'distance', km: decimal(km, 3, 'Informe a distância total.'), rate: decimal(rate, 2, 'Informe a tarifa por km.') };
      input = {
        lines: lines.map((line) => costLine(line, prices.get(line.product.id))),
        expenses: expenses.map((expense) => {
          if (!expense.name.trim()) throw new Error('Informe a descrição de cada serviço ou despesa.');
          return decimal(expense.cost, 2, 'Informe o valor de cada serviço ou despesa.');
        }),
        transport,
        labor: decimal(labor || '0', 2, 'Revise o custo da mão de obra.'),
        profitPercent: decimal(useDefault ? defaultProfit : override, 2, 'Informe o acréscimo na etapa Formação do preço.', 1_000_000n),
        discount: { kind: discountMode, value: decimal(discount || '0', 2, 'Revise o desconto.',
          discountMode === 'percent' ? 10_000n : undefined) },
      };
      result = calculate(input);
    } catch (cause) {
      validation = catalogError(cause);
    }
  }

  return (
    <>
      {step === financialSteps[0] && (
        <View style={styles.stack}>
          {expenses.map((expense) => (
            <View key={expense.id} style={styles.card}>
              <Field label="Descrição do serviço ou despesa" value={expense.name}
                onChangeText={(name) => setExpenses((all) => all.map((item) => item.id === expense.id ? { ...item, name } : item))} />
              <Field label="Custo (R$)" value={expense.cost} decimal
                onChangeText={(cost) => setExpenses((all) => all.map((item) => item.id === expense.id ? { ...item, cost } : item))} />
              <Chip label="Remover despesa" onPress={() => setExpenses((all) => all.filter(({ id }) => id !== expense.id))} />
            </View>
          ))}
          <Chip label="Adicionar serviço ou despesa" onPress={() => {
            setExpenses((all) => [...all, { id: nextExpense, name: '', cost: '' }]);
            setNextExpense((value) => value + 1);
          }} />
        </View>
      )}
      {step === financialSteps[1] && (
        <View style={styles.card}>
          <View style={styles.row}>
            <Chip label="Retirada" active={transportMode === 'pickup'} onPress={() => setTransportMode('pickup')} />
            <Chip label="Valor fixo" active={transportMode === 'fixed'} onPress={() => setTransportMode('fixed')} />
            <Chip label="Por km" active={transportMode === 'distance'} onPress={() => setTransportMode('distance')} />
          </View>
          {transportMode === 'fixed' && <Field label="Custo de transporte (R$)" value={transportCost} decimal onChangeText={setTransportCost} />}
          {transportMode === 'distance' && <>
            <Field label="Distância total (km)" value={km} decimal onChangeText={setKm} />
            <Field label="Tarifa (R$/km)" value={rate} decimal onChangeText={setRate} />
          </>}
        </View>
      )}
      {step === financialSteps[2] && (
        <View style={styles.card}>
          <Field label="Custo total de mão de obra (R$)" value={labor} decimal onChangeText={setLabor} />
        </View>
      )}
      {step === financialSteps[3] && (
        <View style={styles.card}>
          <View style={styles.row}>
            <Chip label="Padrão da empresa" active={useDefault} onPress={() => setUseDefault(true)} />
            <Chip label="Específico" active={!useDefault} onPress={() => setUseDefault(false)} />
          </View>
          {useDefault ? <>
            <Field label="Acréscimo padrão (%)" value={defaultProfit} decimal disabled={loading || saving || Boolean(error)} onChangeText={setDefaultProfit} />
            <Chip label={saving ? 'Salvando…' : 'Salvar padrão da empresa'} disabled={loading || saving || Boolean(error)}
              onPress={() => void persistDefault()} />
            {saveMessage !== '' && <Text accessibilityRole="alert" style={styles.text}>{saveMessage}</Text>}
          </> : <Field label="Acréscimo específico (%)" value={override} decimal onChangeText={setOverride} />}
        </View>
      )}
      {step === financialSteps[4] && (
        <View style={styles.card}>
          <View style={styles.row}>
            <Chip label="Em reais" active={discountMode === 'fixed'} onPress={() => { setDiscountMode('fixed'); setDiscount(''); }} />
            <Chip label="Percentual" active={discountMode === 'percent'} onPress={() => { setDiscountMode('percent'); setDiscount(''); }} />
          </View>
          <Field label={discountMode === 'fixed' ? 'Desconto (R$)' : 'Desconto (%)'} value={discount} decimal onChangeText={setDiscount} />
        </View>
      )}
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>Resumo financeiro</Text>
        {initialSnapshot && <Text style={styles.text}>Este recálculo usa os preços atuais. O orçamento mantém os valores registrados até você salvar um novo cálculo.</Text>}
        {error || priceError ? <>
          <Text accessibilityRole="alert" style={styles.error}>{error || priceError}</Text>
          <Chip label="Tentar novamente" onPress={() => setRevision((value) => value + 1)} />
        </> : waiting ? <ActivityIndicator color={colors.blueGray} accessibilityLabel="Carregando custos" /> : null}
        {validation !== '' && <Text accessibilityRole="alert" style={styles.error}>{validation}</Text>}
        {result && <>
          <Text style={styles.text}>Custo total · {brl(result.totalCost)}</Text>
          <Text style={styles.strong}>Preço de venda · {brl(result.sale)}</Text>
          <Text style={styles.text}>Lucro estimado · {brl(result.profit)}</Text>
          <Text style={styles.text}>Margem · {result.margin === null ? 'Indefinida (venda zero)' : `${formatScaled(result.margin, 2)}%`}</Text>
          {step === 'Resumo' && <>
            <Text style={styles.text}>Itens · {brl(result.catalogCost)}</Text>
            <Text style={styles.text}>Acréscimo do acervo · {brl(result.markup)}</Text>
            <Text style={styles.text}>Serviços e despesas · {brl(result.expenses)}</Text>
            <Text style={styles.text}>Transporte · {brl(result.transport)}</Text>
            <Text style={styles.text}>Mão de obra · {brl(result.labor)}</Text>
            <Text style={styles.text}>Antes do desconto · {brl(result.gross)}</Text>
            <Text style={styles.text}>Desconto · {brl(result.discount)}</Text>
          </>}
          {result.alert && <Text accessibilityRole="alert" style={result.alert === 'loss' ? styles.error : styles.text}>
            {result.alert === 'loss' ? 'Atenção: preço de venda abaixo do custo.'
              : result.alert === 'break-even' ? 'Atenção: esta composição está sem lucro.'
              : 'O desconto reduziu o lucro estimado.'}
          </Text>}
          {step === 'Resumo' && onSaveQuote && input && <ActionButton label={quoteLabel}
            disabled={quoteBusy || !lines.length} onPress={() => {
              const snapshot = JSON.parse(JSON.stringify({
                ...result, inputs: input, expenseNames: expenses.map(({ name }) => name.trim()), ruleVersion: '2.2',
              }, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value)) as Snapshot;
              if (!initialSnapshot) {
                onSaveQuote(snapshot);
                return;
              }
              confirmAction('Substituir o cálculo registrado?', 'O novo resumo usará os preços deste recálculo.',
                'Registrar novo cálculo', () => onSaveQuote(snapshot));
            }} />}
        </>}
      </View>
    </>
  );
}
