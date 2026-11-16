import { Feather } from '@expo/vector-icons';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../theme';

export const modules = {
  Quotes: { title: 'Orçamentos', description: 'Propostas e rascunhos', icon: 'file-text' },
  Catalog: { title: 'Catálogo', description: 'Balões, acervo e materiais', icon: 'grid' },
  Calculator: { title: 'Calculadora', description: 'Composição e preço', icon: 'sliders' },
  Clients: { title: 'Clientes', description: 'Contatos e histórico', icon: 'users' },
  Proposals: { title: 'Propostas', description: 'Respostas dos clientes', icon: 'inbox' },
} as const;

export type Module = keyof typeof modules;
const decor = require('../../assets/decoracao-abertura.png');
const serif = Platform.select({ web: 'Georgia, serif', ios: 'Georgia', android: 'serif' });

export function Dashboard({ openAccount, openModule, preview = false }: {
  openAccount: () => void; openModule: (module: Module) => void; preview?: boolean;
}) {
  return (
    <SafeAreaView style={styles.shell}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <View style={styles.top}>
            <View style={styles.brand}>
              <View style={styles.mark}><Text style={styles.initial}>D</Text></View>
              <Text accessibilityRole="header" style={styles.wordmark}>Delicado <Text style={styles.accent}>Pro</Text></Text>
            </View>
            <Pressable accessibilityRole="button" onPress={openAccount} style={styles.account}>
              <Feather name={preview ? 'settings' : 'user'} size={17} color={colors.blueGray} />
              <Text style={styles.meta}>{preview ? 'Configuração' : 'Minha conta'}</Text>
            </Pressable>
          </View>
          <View style={styles.hero}>
            <Image source={decor} resizeMode="cover" style={styles.photo}
              accessibilityLabel="Decoração com balões em azul acinzentado e marfim" />
            <View style={styles.heroCopy}>
              <Text accessibilityRole="header" style={styles.heroTitle}>Seu estúdio de decoração</Text>
              <Text style={styles.heroBody}>Organize materiais, clientes e orçamentos.</Text>
            </View>
          </View>
          <View style={styles.section}>
            <View style={styles.top}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>Área de trabalho</Text>
            </View>
            <View style={styles.grid}>
              {(Object.keys(modules) as Module[]).map((module) => {
                const { title, description, icon } = modules[module];
                return (
                  <Pressable key={module} accessibilityRole="button" onPress={() => openModule(module)}
                    style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
                    <View style={styles.tileTop}>
                      <View style={styles.tileIcon}><Feather name={icon} size={19} color={colors.blueGray} /></View>
                      <Feather name={preview ? 'lock' : 'arrow-up-right'} size={17} color={colors.blueGray} />
                    </View>
                    <View>
                      <Text style={styles.tileTitle}>{title}</Text>
                      <Text style={styles.tileDescription}>{description}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {preview && <View style={styles.notice}>
              <Feather name="info" size={16} color={colors.blueGray} />
              <Text style={styles.noticeText}>Selecione um módulo para ver como conectar o Supabase.</Text>
            </View>}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.offWhite },
  scroll: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 32 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: 22 },
  top: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.blueGray, alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 22, fontFamily: serif, color: colors.white },
  wordmark: { fontSize: 23, fontWeight: '700', color: colors.graphite, letterSpacing: -0.6 },
  accent: { color: colors.blueGray },
  account: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  meta: { color: colors.blueGray, fontSize: 13, fontWeight: '600' },
  hero: { borderRadius: 20, overflow: 'hidden', backgroundColor: colors.graphite },
  photo: { width: '100%', height: 184 },
  heroCopy: { paddingHorizontal: 20, paddingVertical: 17, gap: 6 },
  heroTitle: { fontFamily: serif, fontSize: 30, color: colors.white, letterSpacing: -0.5 },
  heroBody: { color: '#E0E7EB', fontSize: 14, lineHeight: 21 },
  section: { gap: 12 },
  sectionTitle: { color: colors.graphite, fontWeight: '700', fontSize: 21, letterSpacing: -0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '47%', flexGrow: 1, minWidth: 120, padding: 13, gap: 10, borderRadius: 15,
    backgroundColor: colors.white, borderWidth: 1, borderColor: '#DFE2E0' },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  tileIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8EEF2' },
  tileTitle: { color: colors.graphite, fontWeight: '700', fontSize: 16 },
  tileDescription: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  pressed: { opacity: 0.7 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  noticeText: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 18 },
});
