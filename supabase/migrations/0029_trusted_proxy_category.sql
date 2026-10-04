-- A proxy contract is distinct from the trusted admin/owner that controls it.
alter table public.trusted_address
  drop constraint if exists trusted_address_category_check;

alter table public.trusted_address
  add constraint trusted_address_category_check check (category in (
    'dex-factory', 'dex-router', 'dex-quoter', 'dex-position-manager',
    'dex-pool-manager', 'dex-state-view', 'permit2', 'lp-locker',
    'burn-address', 'infra-asset', 'rwa-beacon', 'rwa-impl', 'rwa-factory',
    'rwa-vault', 'rwa-operator', 'bridge-system-owner', 'trusted-proxy'
  ));
