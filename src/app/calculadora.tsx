import { router, useLocalSearchParams } from 'expo-router';
import { CalculatorScreen } from '../calculator/CalculatorScreen';
import { useRouteSession } from '../navigation/useRouteSession';
import { backTo, routeId } from '../navigation/routes';

export default function Calculator() {
  const auth = useRouteSession();
  const params = useLocalSearchParams();
  const company = routeId(params.company);
  const quote = routeId(params.quote);
  const product = routeId(params.product);
  return auth && <CalculatorScreen client={auth.client} userId={auth.user.id}
    target={company && quote ? { company, quote } : undefined}
    seed={company && product ? { company, product } : undefined}
    onQuoteSaved={() => backTo('/orcamentos')}
    onOpenQuote={(company, quoteId) => router.push({ pathname: '/orcamentos', params: { company, quoteId } })} />;
}
