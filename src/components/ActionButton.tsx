import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, spacing } from '../theme';

type ActionButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

export function ActionButton({ label, onPress, disabled = false }: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, (disabled || pressed) && styles.dimmed]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: colors.blueGray,
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 48,
    padding: spacing.medium,
  },
  dimmed: { opacity: 0.72 },
  label: { color: colors.white, fontWeight: '600', fontSize: 16 },
});
