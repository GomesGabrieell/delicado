export type CostLine =
  | { kind: 'balloon'; quantity: bigint; packageSize: bigint; packagePrice: bigint; whole: boolean }
  | { kind: 'asset'; quantity: bigint; rentalCost: bigint; markup: bigint }
  | { kind: 'material'; quantity: bigint; catalogQuantity: bigint; catalogCost: bigint };

export type Discount = { kind: 'fixed' | 'percent'; value: bigint };
export type Transport = { kind: 'pickup' } | { kind: 'fixed'; cost: bigint }
  | { kind: 'distance'; km: bigint; rate: bigint };

const percentScale = 10_000n;

export function parseDecimal(text: string, scale: number) {
  const match = /^(\d{1,12})(?:[,.](\d+))?$/.exec(text.trim());
  if (!match || (match[2]?.length ?? 0) > scale) return null;
  return BigInt(match[1] + (match[2] ?? '').padEnd(scale, '0'));
}

function round(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Quantidade de referência inválida.');
  const magnitude = numerator < 0n ? -numerator : numerator;
  const result = (magnitude * 2n + denominator) / (denominator * 2n);
  return numerator < 0n ? -result : result;
}

export function calculate(input: {
  lines: CostLine[]; expenses: bigint[]; transport: Transport; labor: bigint;
  profitPercent: bigint; discount: Discount;
}) {
  let catalogCost = 0n;
  let markup = 0n;
  for (const line of input.lines) {
    if (line.kind === 'balloon') {
      if (line.packageSize <= 0n) throw new Error('Embalagem inválida.');
      catalogCost += line.whole
        ? ((line.quantity + line.packageSize - 1n) / line.packageSize) * line.packagePrice
        : round(line.quantity * line.packagePrice, line.packageSize);
    } else if (line.kind === 'asset') {
      const cost = line.quantity * line.rentalCost;
      catalogCost += cost;
      markup += round(cost * line.markup, percentScale);
    } else {
      catalogCost += round(line.quantity * line.catalogCost, line.catalogQuantity);
    }
  }
  const transport = input.transport.kind === 'pickup' ? 0n : input.transport.kind === 'fixed'
    ? input.transport.cost : round(input.transport.km * input.transport.rate, 1000n);
  const expenses = input.expenses.reduce((total, value) => total + value, 0n);
  const totalCost = catalogCost + expenses + transport + input.labor;
  const globalProfit = round(totalCost * input.profitPercent, percentScale);
  const gross = totalCost + markup + globalProfit;
  const discount = input.discount.kind === 'fixed' ? input.discount.value
    : round(gross * input.discount.value, percentScale);
  if (discount > gross) throw new Error('O desconto supera o preço antes do desconto.');
  const sale = gross - discount;
  const profit = sale - totalCost;
  return {
    catalogCost, markup, expenses, transport, labor: input.labor, totalCost, gross, discount, sale, profit,
    margin: sale === 0n ? null : round(profit * percentScale, sale),
    alert: profit < 0n ? 'loss' : profit === 0n ? 'break-even' : discount > 0n ? 'discount' : null,
  } as const;
}

export function formatScaled(value: bigint, scale: number) {
  const sign = value < 0n ? '-' : '';
  const digits = String(value < 0n ? -value : value).padStart(scale + 1, '0');
  if (!scale) return sign + digits;
  return `${sign}${digits.slice(0, -scale)},${digits.slice(-scale)}`;
}

export function brl(value: bigint) {
  const [integer, cents] = formatScaled(value, 2).split(',');
  return `R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cents}`;
}
