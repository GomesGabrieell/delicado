import { Alert } from 'react-native';

export function confirmAction(title: string, message: string, label: string, action: () => void) {
  Alert.alert(title, message, [
    { text: 'Cancelar', style: 'cancel' },
    { text: label, onPress: action },
  ]);
}
