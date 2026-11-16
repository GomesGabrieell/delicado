import { router } from 'expo-router';
import { CatalogScreen } from '../catalog/CatalogScreen';
import { useRouteSession } from '../navigation/useRouteSession';

export default function Catalog() {
  const auth = useRouteSession();
  return auth && <CatalogScreen client={auth.client} userId={auth.user.id}
    openCalculator={(company, product) => router.push({ pathname: '/calculadora', params: { company, product } })} />;
}
