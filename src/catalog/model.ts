export const groups = {
  balloon: 'Balões',
  asset: 'Acervo',
  material: 'Materiais complementares',
} as const;

export type Kind = keyof typeof groups;
export type Category = { id: string; name: string; kind: Exclude<Kind, 'balloon'> };
export type Company = { id: string; name: string; role: 'owner' | 'admin' | 'member' };
export type Ownership = 'owned' | 'rented';

export type Item = {
  id: string;
  kind: Kind;
  name: string;
  category_id: string | null;
  brand: string | null;
  size: string | null;
  balloon_type: string | null;
  package_quantity: number | null;
  package_price: number | null;
  unit_cost: number | null;
  ownership: Ownership | null;
  rental_cost: number | null;
  markup_percent: number | null;
  quantity: number | null;
  unit: string | null;
  material_cost: number | null;
  photo_path: string | null;
  archived_at: string | null;
};

export type Draft = {
  name: string;
  category_id: string;
  brand: string;
  size: string;
  balloon_type: string;
  package_quantity: string;
  package_price: string;
  ownership: Ownership;
  rental_cost: string;
  markup_percent: string;
  quantity: string;
  unit: string;
  material_cost: string;
};

export type Payload = Omit<Item, 'id' | 'kind' | 'unit_cost' | 'photo_path' | 'archived_at'>;

export function makeDraft(item?: Item): Draft {
  const decimal = (value?: number | null) => value == null ? '' : String(value).replace('.', ',');
  return {
    name: item?.name ?? '',
    category_id: item?.category_id ?? '',
    brand: item?.brand ?? '',
    size: item?.size ?? '',
    balloon_type: item?.balloon_type ?? '',
    package_quantity: decimal(item?.package_quantity),
    package_price: decimal(item?.package_price),
    ownership: item?.ownership ?? 'owned',
    rental_cost: decimal(item?.rental_cost),
    markup_percent: decimal(item?.markup_percent),
    quantity: decimal(item?.quantity),
    unit: item?.unit ?? '',
    material_cost: decimal(item?.material_cost),
  };
}

export function decimalValue(input: string, scale: number, minimum: number, maximum: number) {
  const text = input.trim();
  const pattern = scale ? new RegExp(`^\\d+(?:[,.]\\d{1,${scale}})?$`) : /^\d+$/;
  if (!pattern.test(text)) return null;
  const value = Number(text.replace(',', '.'));
  return value >= minimum && value <= maximum ? value : null;
}

export const money = (value: number, digits = 2) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: digits,
  }).format(value);

const maxMoney = 9_999_999_999.99;

export function packageValues(draft: Draft) {
  return {
    quantity: decimalValue(draft.package_quantity, 0, 1, 1_000_000),
    price: decimalValue(draft.package_price, 2, 0, maxMoney),
  };
}

export function validateDraft(kind: Kind, draft: Draft, categories: Category[]): Payload {
  const name = draft.name.trim();
  if (!name || name.length > 120) throw new Error('Informe um nome de até 120 caracteres.');
  const payload: Payload = {
    name, category_id: null, brand: null, size: null, balloon_type: null,
    package_quantity: null, package_price: null, ownership: null, rental_cost: null,
    markup_percent: null, quantity: null, unit: null, material_cost: null,
  };

  if (kind === 'balloon') {
    const brand = draft.brand.trim();
    const size = draft.size.trim();
    const balloon_type = draft.balloon_type.trim();
    if ([brand, size, balloon_type].some((value) => !value || value.length > 80)) {
      throw new Error('Preencha marca, tamanho e tipo com até 80 caracteres cada.');
    }
    const { quantity, price } = packageValues(draft);
    if (quantity === null) throw new Error('A embalagem deve conter de 1 a 1.000.000 de balões.');
    if (price === null) throw new Error('Informe um preço válido com até duas casas decimais.');
    return { ...payload, brand, size, balloon_type, package_quantity: quantity, package_price: price };
  }

  if (!categories.some((category) => category.kind === kind && category.id === draft.category_id)) {
    throw new Error('Selecione uma categoria deste grupo.');
  }
  payload.category_id = draft.category_id;
  if (kind === 'asset') {
    const rental_cost = decimalValue(draft.rental_cost, 2, 0, maxMoney);
    const markup_percent = decimalValue(draft.markup_percent, 2, 0, 10_000);
    if (rental_cost === null) throw new Error('Informe um custo de locação válido.');
    if (markup_percent === null) throw new Error('Informe um acréscimo de 0 a 10.000%.');
    return { ...payload, ownership: draft.ownership, rental_cost, markup_percent };
  }

  const quantity = decimalValue(draft.quantity, 3, 0.001, 999_999_999.999);
  const material_cost = decimalValue(draft.material_cost, 2, 0, maxMoney);
  const unit = draft.unit.trim();
  if (quantity === null) throw new Error('Informe uma quantidade positiva com até três casas decimais.');
  if (!unit || unit.length > 40) throw new Error('Informe a unidade de medida.');
  if (material_cost === null) throw new Error('Informe um custo válido para a quantidade informada.');
  return { ...payload, quantity, unit, material_cost };
}
