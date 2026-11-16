import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, spacing } from '../theme';

export function Field({ label, value, onChangeText, decimal, maxLength = 120, disabled, multiline }: {
  label: string; value: string; onChangeText: (value: string) => void;
  decimal?: boolean; maxLength?: number; disabled?: boolean; multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText}
        keyboardType={decimal ? 'decimal-pad' : 'default'} maxLength={maxLength}
        editable={!disabled} multiline={multiline} style={[styles.input, multiline && styles.multiline]} />
    </View>
  );
}

export function Chip({ label, active, onPress, disabled }: {
  label: string; active?: boolean; onPress: () => void; disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active, disabled }}
      disabled={disabled} onPress={onPress} style={[styles.chip, active && styles.active]}>
      <Text style={[styles.label, active && styles.activeText]}>{label}</Text>
    </Pressable>
  );
}

export const catalogStyles = StyleSheet.create({
  stack: { gap: spacing.medium },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.small },
  card: {
    backgroundColor: colors.white, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14, padding: spacing.medium, gap: spacing.small,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.graphite },
  text: { fontSize: 15, lineHeight: 22, color: colors.muted },
  strong: { fontSize: 16, fontWeight: '700', color: colors.blueGray },
  error: { fontSize: 15, color: colors.error },
  photo: { width: '100%', height: 200, borderRadius: 10, backgroundColor: colors.offWhite },
});

const styles = StyleSheet.create({
  field: { gap: spacing.small },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  label: { fontSize: 15, fontWeight: '600', color: colors.graphite },
  input: {
    backgroundColor: colors.white, borderColor: colors.border, borderWidth: 1, borderRadius: 10,
    minHeight: 48, color: colors.graphite, fontSize: 16,
    paddingHorizontal: spacing.medium, paddingVertical: spacing.small,
  },
  chip: {
    borderRadius: 22, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.white,
    minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: spacing.small,
  },
  active: { backgroundColor: colors.blueGray, borderColor: colors.blueGray },
  activeText: { color: colors.white },
});
