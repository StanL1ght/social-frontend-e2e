export const env = {
  baseURL: process.env.BASE_URL ?? 'https://dev-social-frontend.sddt.efko.ru',
  email: process.env.E2E_EMAIL ?? '',
  password: process.env.E2E_PASSWORD ?? '',
  runMutationTests: process.env.RUN_MUTATION_TESTS === 'true',
  networkUrlFilter:
    process.env.NETWORK_URL_FILTER ??
    'multisearch|multi-search|private-web|search|catalog|person|post|group',
};

export function requireCredentials(): void {
  if (!env.email || !env.password) {
    throw new Error(
      'Не заданы E2E_EMAIL и E2E_PASSWORD. Скопируйте .env.example в .env и заполните тестовые данные.',
    );
  }
}
