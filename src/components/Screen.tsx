import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '../theme';

type ScreenProps = PropsWithChildren<{ title: string; description?: string }>;

export function Screen({ title, description, children }: ScreenProps) {
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.column}>
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            {description && <Text style={styles.description}>{description}</Text>}
          </View>
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.offWhite },
  content: { flexGrow: 1, padding: spacing.large, paddingTop: spacing.extraLarge },
  column: { alignSelf: 'center', width: '100%', maxWidth: 480, gap: spacing.large },
  heading: { gap: spacing.small },
  title: { color: colors.graphite, fontSize: 32, fontWeight: '700' },
  description: { color: colors.muted, fontSize: 16, lineHeight: 24 },
});
