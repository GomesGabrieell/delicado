import { router } from 'expo-router';
import { ClientsScreen } from '../clients/ClientsScreen';
import { useRouteSession } from '../navigation/useRouteSession';

export default function Clients() {
  const auth = useRouteSession();
  return auth && <ClientsScreen client={auth.client} userId={auth.user.id}
    openQuote={(params) => router.push({ pathname: '/orcamentos', params })} />;
}
