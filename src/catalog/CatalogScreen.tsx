import { useFocusEffect } from 'expo-router';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { confirmAction } from '../components/confirmAction';

import { ActionButton } from '../components/ActionButton';
import { Screen } from '../components/Screen';
import { colors } from '../theme';
import { catalogStyles as styles, Chip, Field } from './controls';
import { ItemForm } from './ItemForm';
import { groups, money } from './model';
import type { Category, Company, Item, Kind, Ownership } from './model';
import { archiveItem, catalogError, createCompany, getPhotoUrl, listCategories, listCompanies, listItems, pageSize } from './repository';

const kinds = Object.keys(groups) as Kind[];

function itemDescription(item: Item, categoryName?: string) {
  switch (item.kind) {
    case 'balloon':
      return [item.brand, item.size, item.balloon_type].join(' · ');
    case 'asset':
      return [categoryName, item.ownership === 'owned' ? 'Próprio' : 'Alugado'].filter(Boolean).join(' · ');
    case 'material':
      return [categoryName, `${item.quantity?.toLocaleString('pt-BR')} ${item.unit}`].filter(Boolean).join(' · ');
  }
}

function itemCost(item: Item) {
  switch (item.kind) {
    case 'balloon': return `${money(item.unit_cost ?? 0, 6)} por balão`;
    case 'asset': return `${money(item.rental_cost ?? 0)} de locação`;
    case 'material': return money(item.material_cost ?? 0);
  }
}

function ItemDetails({ client, company, item, category, onBack, onEdit, onChanged, onUse }: {
  client: SupabaseClient; company: Company; item: Item; category?: Category;
  onBack: () => void; onEdit: () => void; onChanged: (message: string) => void;
  onUse: () => void;
}) {
  const [photo, setPhoto] = useState('');
  const [photoError, setPhotoError] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(Boolean(item.photo_path));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!item.photo_path) return;
    let current = true;
    void getPhotoUrl(client, item.photo_path).then((url) => {
      if (current) setPhoto(url);
    }).catch(() => {
      if (current) setPhotoError(true);
    }).finally(() => {
      if (current) setPhotoLoading(false);
    });
    return () => { current = false; };
  }, [client, item.photo_path]);

  async function changeArchive() {
    setBusy(true);
    setError('');
    try {
      await archiveItem(client, company.id, item);
      onChanged(item.archived_at ? 'Item reativado.' : 'Item arquivado.');
    } catch (cause) {
      setError(catalogError(cause));
    } finally {
      setBusy(false);
    }
  }

  const action = item.archived_at ? 'Reativar' : 'Arquivar';
  return (
    <Screen title={item.name} description={itemDescription(item, category?.name)}>
      <View style={styles.card}>
        {photoLoading && <ActivityIndicator accessibilityLabel="Carregando foto" color={colors.blueGray} />}
        {photo !== '' && <Image source={{ uri: photo }} accessibilityLabel="Foto do balão"
          style={styles.photo} resizeMode="contain" onError={() => { setPhoto(''); setPhotoError(true); }} />}
        {photoError && <Text style={styles.error}>Não foi possível abrir a foto.</Text>}
        {company.role !== 'member' && <Text style={styles.strong}>{itemCost(item)}</Text>}
        {item.kind === 'balloon' && (
          <Text style={styles.text}>{item.package_quantity} por embalagem
            {company.role !== 'member' && item.package_price !== null ? ` · ${money(item.package_price)}` : ''}
          </Text>
        )}
        {item.kind === 'asset' && company.role !== 'member' && (
          <Text style={styles.text}>Acréscimo de {item.markup_percent?.toLocaleString('pt-BR')}%</Text>
        )}
        <Text style={styles.text}>{item.archived_at ? 'Arquivado' : 'Ativo'}</Text>
      </View>
      {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {company.role !== 'member' && (
        <>
          <ActionButton label="Editar item" disabled={busy} onPress={onEdit} />
          <Chip label={busy ? 'Aguarde…' : action} disabled={busy} onPress={() => {
            confirmAction(`${action} item?`, item.name, action, () => void changeArchive());
          }} />
        </>
      )}
      {!item.archived_at && <ActionButton label="Usar na calculadora" disabled={busy} onPress={onUse} />}
      <Chip label="Voltar à lista" disabled={busy} onPress={onBack} />
    </Screen>
  );
}

function CompanyCatalog({ client, company, onSwitch, openCalculator }: {
  client: SupabaseClient; company: Company; onSwitch: () => void;
  openCalculator: (company: string, product: string) => void;
}) {
  const [kind, setKind] = useState<Kind>('balloon');
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [ownership, setOwnership] = useState<Ownership | ''>('');
  const [sort, setSort] = useState<'name' | 'recent'>('name');
  const [showFilters, setShowFilters] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [more, setMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [categoriesReady, setCategoriesReady] = useState(false);
  const [error, setError] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Item>();
  const [editing, setEditing] = useState(false);
  const canWrite = company.role !== 'member';

  useEffect(() => {
    let current = true;
    setCategoriesReady(false);
    setCategoryError('');
    void listCategories(client, company.id, kind).then((data) => {
      if (current) {
        setCategories(data);
        setCategoriesReady(true);
      }
    }).catch((cause) => {
      if (current) setCategoryError(catalogError(cause));
    });
    return () => { current = false; };
  }, [client, company.id, kind, revision]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      void listItems(client, { companyId: company.id, kind, search, archived, categoryId, ownership, sort, offset, financial: canWrite })
        .then((data) => {
          if (!current) return;
          setItems(data.slice(0, pageSize));
          setMore(data.length > pageSize);
        }).catch((cause) => {
          if (current) setError(catalogError(cause));
        }).finally(() => {
          if (current) setLoading(false);
        });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [client, company.id, kind, search, archived, categoryId, ownership, sort, offset, revision, canWrite]);

  function filter(change: () => void) {
    setOffset(0);
    setNotice('');
    change();
  }

  function refresh(message = '') {
    setSelected(undefined);
    setEditing(false);
    setOffset(0);
    setNotice(message);
    setRevision((value) => value + 1);
  }

  if (editing && canWrite) {
    return <ItemForm client={client} company={company} kind={kind} item={selected} categories={categories}
      onCategory={(category) => setCategories((current) => [...current, category].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))}
      onSaved={refresh} onCancel={() => setEditing(false)} />;
  }
  if (selected) {
    return <ItemDetails client={client} company={company} item={selected}
      onUse={() => openCalculator(company.id, selected.id)}
      category={categories.find((category) => category.id === selected.category_id)}
      onBack={() => setSelected(undefined)} onEdit={() => setEditing(true)} onChanged={refresh} />;
  }

  return (
    <Screen title="Catálogo" description={company.name}>
      <View style={styles.row}>
        <Chip label="Trocar empresa" onPress={onSwitch} />
        <Chip label="Atualizar" onPress={() => refresh()} />
      </View>
      <View style={styles.row}>
        {kinds.map((group) => (
          <Chip key={group} label={groups[group]} active={group === kind} onPress={() => filter(() => {
            if (group === kind) return;
            setCategories([]);
            setCategoriesReady(false);
            setKind(group);
            setCategoryId('');
            setOwnership('');
          })} />
        ))}
      </View>
      <View style={styles.card}>
        <Field label="Pesquisar itens" value={search} onChangeText={(text) => filter(() => setSearch(text))} />
        <Chip label={showFilters ? 'Ocultar filtros' : 'Filtros e ordenação'}
          active={showFilters || archived || sort !== 'name' || Boolean(categoryId || ownership)}
          onPress={() => setShowFilters(!showFilters)} />
        {showFilters && (
          <>
            <View style={styles.row}>
              <Chip label="Ativos" active={!archived} onPress={() => filter(() => setArchived(false))} />
              <Chip label="Arquivados" active={archived} onPress={() => filter(() => setArchived(true))} />
              <Chip label="Nome A–Z" active={sort === 'name'} onPress={() => filter(() => setSort('name'))} />
              <Chip label="Mais recentes" active={sort === 'recent'} onPress={() => filter(() => setSort('recent'))} />
            </View>
            {kind !== 'balloon' && categories.length > 0 && (
              <View style={styles.row}>
                <Chip label="Todas as categorias" active={!categoryId} onPress={() => filter(() => setCategoryId(''))} />
                {categories.map((category) => <Chip key={category.id} label={category.name} active={categoryId === category.id}
                  onPress={() => filter(() => setCategoryId(category.id))} />)}
              </View>
            )}
            {kind === 'asset' && (
              <View style={styles.row}>
                <Chip label="Qualquer origem" active={!ownership} onPress={() => filter(() => setOwnership(''))} />
                <Chip label="Próprios" active={ownership === 'owned'} onPress={() => filter(() => setOwnership('owned'))} />
                <Chip label="Alugados" active={ownership === 'rented'} onPress={() => filter(() => setOwnership('rented'))} />
              </View>
            )}
          </>
        )}
      </View>
      {canWrite && <ActionButton label="Novo item" disabled={!categoriesReady} onPress={() => setEditing(true)} />}
      {notice !== '' && <Text accessibilityRole="alert" style={styles.strong}>{notice}</Text>}
      {categoryError !== '' && <Text accessibilityRole="alert" style={styles.error}>{categoryError}</Text>}
      {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {loading ? <ActivityIndicator accessibilityLabel="Carregando itens" color={colors.blueGray} /> : error === '' && (
        <View style={styles.stack}>
          {items.length === 0 && <Text style={styles.text}>Nenhum item encontrado.</Text>}
          {items.map((item) => (
            <Pressable key={item.id} accessibilityRole="button" onPress={() => setSelected(item)} style={styles.card}>
              <Text style={styles.title}>{item.name}</Text>
              <Text style={styles.text}>{itemDescription(item, categories.find((category) => category.id === item.category_id)?.name)}</Text>
              {canWrite && <Text style={styles.strong}>{itemCost(item)}</Text>}
            </Pressable>
          ))}
          <View style={styles.row}>
            {offset > 0 && <Chip label="Anterior" onPress={() => setOffset(offset - pageSize)} />}
            {more && <Chip label="Próxima" onPress={() => setOffset(offset + pageSize)} />}
          </View>
        </View>
      )}
    </Screen>
  );
}

export function CatalogScreen({ client, userId, openCalculator }: {
  client: SupabaseClient; userId: string; openCalculator: (company: string, product: string) => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [createError, setCreateError] = useState('');
  const [revision, setRevision] = useState(0);

  useFocusEffect(useCallback(() => {
    let current = true;
    setLoading(true);
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

  async function addCompany() {
    if (!name.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      setCompanyId(await createCompany(client, name.trim()));
      setName('');
      setRevision((value) => value + 1);
    } catch (cause) {
      setCreateError(catalogError(cause));
    } finally {
      setCreating(false);
    }
  }

  const company = companies.find((entry) => entry.id === companyId);
  if (company && !loading && !error) {
    return <CompanyCatalog key={company.id} client={client} company={company}
      openCalculator={openCalculator}
      onSwitch={() => { setCompanyId(''); setRevision((value) => value + 1); }} />;
  }

  return (
    <Screen title="Catálogo" description="Selecione a empresa que deseja consultar.">
      {loading ? <ActivityIndicator accessibilityLabel="Carregando empresas" color={colors.blueGray} /> : (
        <>
          {!error && companies.map((entry) => <ActionButton key={entry.id} label={entry.name} disabled={creating}
            onPress={() => setCompanyId(entry.id)} />)}
          {companies.length === 0 && !error && <Text style={styles.text}>Sua conta ainda não tem uma empresa ativa.</Text>}
          {(!error || creating) && (
            <View style={styles.card}>
              <Field label="Nome da nova empresa" value={name} onChangeText={setName} disabled={creating} />
              {createError !== '' && <Text accessibilityRole="alert" style={styles.error}>{createError}</Text>}
              <Chip label={creating ? 'Criando…' : 'Criar empresa'} disabled={creating || !name.trim()} onPress={() => void addCompany()} />
            </View>
          )}
          {error !== '' && (
            <>
              <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
              <Chip label="Tentar novamente" onPress={() => setRevision((value) => value + 1)} />
            </>
          )}
        </>
      )}
    </Screen>
  );
}
