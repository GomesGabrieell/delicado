import { router } from 'expo-router';
import type { Module } from '../screens/Dashboard';

export const moduleRoutes = {
  Catalog: '/catalogo', Calculator: '/calculadora', Clients: '/clientes',
  Quotes: '/orcamentos', Proposals: '/propostas',
} as const satisfies Record<Module, string>;

export function backTo(path: '/' | '/clientes' | '/orcamentos') {
  if (router.canGoBack()) router.back();
  else router.replace(path);
}

export function routeId(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase() : undefined;
}
