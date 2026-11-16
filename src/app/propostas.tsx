import { useLocalSearchParams } from 'expo-router';
import { ProposalsScreen } from '../proposals/ProposalsScreen';
import { backTo, routeId } from '../navigation/routes';
import { useRouteSession } from '../navigation/useRouteSession';

export default function Proposals() {
  const auth = useRouteSession();
  const params = useLocalSearchParams();
  const company = routeId(params.company);
  const quote = routeId(params.quote);
  return auth && <ProposalsScreen client={auth.client} userId={auth.user.id}
    target={company && quote ? { company, quote } : undefined} back={() => backTo('/')} />;
}
