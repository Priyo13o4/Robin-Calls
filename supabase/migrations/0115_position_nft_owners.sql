-- Current owner of each position NFT we have needed, kept fresh by the recorder's Transfer stream.
-- A row is seeded by one ownerOf read pinned at the cursor block, so cursor + rows always agree.
create table if not exists public.position_nft_cursors (
  manager text primary key check (manager = lower(manager)),
  indexed_to_block bigint not null check (indexed_to_block >= 0),
  indexed_to_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.position_nft_owners (
  manager text not null check (manager = lower(manager)),
  token_id numeric(78, 0) not null check (token_id >= 0),
  owner text not null check (owner = lower(owner)),
  block_number bigint not null check (block_number >= 0),
  primary key (manager, token_id)
);

create index if not exists position_nft_owners_owner_idx on public.position_nft_owners (owner);

grant select, insert, update, delete on public.position_nft_cursors to robincalls_app;
grant select, insert, update, delete on public.position_nft_owners to robincalls_app;
