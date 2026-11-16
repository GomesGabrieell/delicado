import assert from 'node:assert/strict';
import { test } from 'node:test';

import { brl, calculate, parseDecimal } from '../src/calculator/finance.ts';

const baseline = {
  lines: [], expenses: [], transport: { kind: 'pickup' }, labor: 0n,
  profitPercent: 0n, discount: { kind: 'fixed', value: 0n },
};
const balloon = { kind: 'balloon', quantity: 31n, packageSize: 30n, packagePrice: 1000n, whole: false };

test('converte decimal brasileiro sem ponto flutuante e rejeita precisão excedente', () => {
  assert.equal(parseDecimal('0,10', 2), 10n);
  assert.equal(parseDecimal('0.20', 2), 20n);
  assert.equal(parseDecimal('1.001', 2), null);
  assert.equal(parseDecimal('1e2', 2), null);
  assert.equal(brl(123456789012345678n), 'R$ 1.234.567.890.123.456,78');
});

test('balões proporcionais usam preço da embalagem e arredondam uma vez', () => {
  assert.equal(calculate({ ...baseline, lines: [balloon] }).catalogCost, 1033n);
  assert.equal(calculate({ ...baseline, lines: [{ ...balloon, quantity: 1n, packageSize: 2n, packagePrice: 1n }] }).catalogCost, 1n);
});

test('embalagem inteira arredonda a quantidade de embalagens para cima', () => {
  assert.equal(calculate({ ...baseline, lines: [{ ...balloon, whole: true }] }).catalogCost, 2000n);
  assert.equal(calculate({ ...baseline, lines: [{ ...balloon, quantity: 30n, whole: true }] }).catalogCost, 1000n);
});

test('separa acréscimo do acervo, mão de obra, custos e lucro global', () => {
  const result = calculate({
    ...baseline,
    lines: [
      { kind: 'asset', quantity: 2n, rentalCost: 2500n, markup: 1000n },
      { kind: 'material', quantity: 250n, catalogQuantity: 1000n, catalogCost: 1000n },
    ],
    expenses: [500n, 500n], labor: 2000n,
    transport: { kind: 'distance', km: 12500n, rate: 200n },
    profitPercent: 2000n, discount: { kind: 'percent', value: 1000n },
  });
  assert.equal(result.markup, 500n);
  assert.equal(result.transport, 2500n);
  assert.equal(result.totalCost, 10750n);
  assert.equal(result.gross, 13400n);
  assert.equal(result.sale, 12060n);
  assert.equal(result.profit, 1310n);
  assert.equal(result.margin, 1086n);
});

test('desconto fixo sinaliza prejuízo e impede preço negativo', () => {
  const transport = { kind: 'fixed', cost: 1000n };
  assert.equal(calculate({ ...baseline, transport, discount: { kind: 'fixed', value: 200n } }).alert, 'loss');
  assert.throws(() => calculate({ ...baseline, transport, discount: { kind: 'fixed', value: 1001n } }), /desconto/);
});

test('venda zero tem margem indefinida e custo integral continua visível', () => {
  const result = calculate({ ...baseline, labor: 100n, discount: { kind: 'percent', value: 10000n } });
  assert.equal(result.sale, 0n);
  assert.equal(result.profit, -100n);
  assert.equal(result.margin, null);
  assert.equal(calculate(baseline).alert, 'break-even');
});
