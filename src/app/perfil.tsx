import { router } from 'expo-router';
import { AccountScreen } from '../screens/AccountScreen';
import { useRouteSession } from '../navigation/useRouteSession';

export default function Profile() {
  const auth = useRouteSession();
  return auth && <AccountScreen client={auth.client} email={auth.user.email}
    openSettings={() => router.push('/configuracoes')} />;
}
