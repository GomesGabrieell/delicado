import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';

import { ActionButton } from '../components/ActionButton';
import { Screen } from '../components/Screen';
import { catalogStyles as styles, Chip, Field } from './controls';
import { groups, makeDraft, money, packageValues, validateDraft } from './model';
import type { Category, Company, Draft, Item, Kind } from './model';
import { catalogError, createCategory, getPhotoUrl, saveItem } from './repository';
import { readPhoto, releasePhoto } from '../services/localPhoto';

export function ItemForm({ client, company, kind, item, categories, onCategory, onSaved, onCancel }: {
  client: SupabaseClient; company: Company; kind: Kind; item?: Item; categories: Category[];
  onCategory: (category: Category) => void; onSaved: (message: string) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => makeDraft(item));
  const [itemId] = useState(() => item?.id ?? randomUUID());
  const [categoryName, setCategoryName] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>();
  const [savedPhoto, setSavedPhoto] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { quantity, price } = packageValues(draft);

  useEffect(() => {
    let active = true;
    if (item?.photo_path) {
      void getPhotoUrl(client, item.photo_path).then((url) => {
        if (active) setSavedPhoto(url);
      }).catch(() => {
        if (active) setError('Não foi possível carregar a foto atual.');
      });
    }
    return () => { active = false; };
  }, [client, item]);

  useEffect(() => () => {
    if (photoUri) releasePhoto(photoUri);
  }, [photoUri]);

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function field(key: Exclude<keyof Draft, 'ownership'>, label: string, maxLength: number, decimal = false) {
    return <Field label={label} value={draft[key]} onChangeText={(value) => setField(key, value)}
      maxLength={maxLength} decimal={decimal} disabled={busy} />;
  }

  async function pickPhoto() {
    setBusy(true);
    setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > 25 * 1024 * 1024) {
        throw new Error('Selecione uma foto original de até 25 MB.');
      }
      const context = ImageManipulator.manipulate(asset.uri);
      if (Math.max(asset.width, asset.height) > 1600) {
        context.resize(asset.width >= asset.height ? { width: 1600 } : { height: 1600 });
      }
      const rendered = await context.renderAsync();
      const photo = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
      try { await readPhoto(photo.uri); }
      catch (cause) { releasePhoto(photo.uri); throw cause; }
      setPhotoUri(photo.uri);
    } catch (cause) {
      setError(catalogError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function addCategory() {
    if (kind === 'balloon' || !categoryName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const category = await createCategory(client, company.id, kind, categoryName.trim());
      onCategory(category);
      setField('category_id', category.id);
      setCategoryName('');
    } catch (cause) {
      setError(catalogError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const payload = validateDraft(kind, draft, categories);
      const notice = await saveItem(client, { companyId: company.id, kind, id: itemId, payload, previous: item, photoUri });
      onSaved(notice || 'Item salvo.');
    } catch (cause) {
      setError(catalogError(cause));
    } finally {
      setBusy(false);
    }
  }

  const preview = photoUri === undefined ? savedPhoto : photoUri;
  return (
    <Screen title={item ? 'Editar item' : 'Novo item'} description={groups[kind]}>
      <View style={styles.card}>
        {field('name', 'Nome', 120)}
        {kind === 'balloon' ? (
          <>
            {field('brand', 'Marca', 80)}
            {field('size', 'Tamanho', 80)}
            {field('balloon_type', 'Tipo', 80)}
            {field('package_quantity', 'Quantidade por embalagem', 7, true)}
            {field('package_price', 'Preço da embalagem (R$)', 13, true)}
            {quantity !== null && price !== null && <Text style={styles.strong}>Custo unitário · {money(price / quantity, 6)}</Text>}
          </>
        ) : (
          <>
            <Text style={styles.title}>Categoria</Text>
            <View style={styles.row}>
              {categories.map((category) => (
                <Chip key={category.id} label={category.name} active={draft.category_id === category.id}
                  disabled={busy} onPress={() => setField('category_id', category.id)} />
              ))}
            </View>
            <Field label="Nova categoria" value={categoryName} onChangeText={setCategoryName} maxLength={80} disabled={busy} />
            <Chip label="Criar categoria" disabled={busy || !categoryName.trim()} onPress={() => void addCategory()} />
          </>
        )}
        {kind === 'asset' && (
          <>
            <View style={styles.row}>
              <Chip label="Próprio" active={draft.ownership === 'owned'} disabled={busy} onPress={() => setField('ownership', 'owned')} />
              <Chip label="Alugado" active={draft.ownership === 'rented'} disabled={busy} onPress={() => setField('ownership', 'rented')} />
            </View>
            {field('rental_cost', 'Custo de locação (R$)', 13, true)}
            {field('markup_percent', 'Acréscimo (%)', 8, true)}
          </>
        )}
        {kind === 'material' && (
          <>
            {field('quantity', 'Quantidade', 13, true)}
            {field('unit', 'Unidade de medida', 40)}
            {field('material_cost', 'Custo da quantidade informada (R$)', 13, true)}
          </>
        )}
      </View>
      {kind === 'balloon' && (
        <View style={styles.card}>
          <Text style={styles.title}>Foto opcional</Text>
          {preview && <Image source={{ uri: preview }} style={styles.photo} resizeMode="contain" />}
          <View style={styles.row}>
            <Chip label="Selecionar foto" disabled={busy} onPress={() => void pickPhoto()} />
            {(preview || (item?.photo_path && photoUri !== null)) && (
              <Chip label="Remover foto" disabled={busy} onPress={() => setPhotoUri(null)} />
            )}
          </View>
        </View>
      )}
      {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <ActionButton label={busy ? 'Aguarde…' : 'Salvar item'} disabled={busy} onPress={() => void save()} />
      <Chip label="Cancelar" disabled={busy} onPress={onCancel} />
    </Screen>
  );
}
